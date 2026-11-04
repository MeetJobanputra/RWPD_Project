/* ==========================================================
   mindmap.js — Mind Maps page.

   A mind map is plain data (see Store.sanitizeMap):
     nodes: [{ id, text, info, x, y, parentId }]   parentId === null is the central topic
     qa:    [{ id, q, a, wrong: [] }]              custom quiz questions
   The picture is drawn with SVG from that data, so Arena Mode can
   read the very same data to build quiz questions.
   ========================================================== */
const MindMap = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_ZOOM = 0.3, MAX_ZOOM = 2.5;

  let maps = [];            // all saved maps (cleaned)
  let map = null;           // the map currently open
  let selectedId = null;    // selected node id
  let saveTimer = null;
  let editingQaId = null;   // id of the Q&A pair being edited (null = adding new)
  let drag = null;          // active drag state (node move or background pan)
  let nodeEls = new Map();  // node id -> <g>
  let edgeEls = new Map();  // child node id -> <line>
  let ready = false;

  const el = id => document.getElementById(id);
  const svgEl = () => el('mm-svg');

  function make(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
    return node;
  }

  /* ---------- small data helpers ---------- */
  const nodeById = id => map.nodes.find(n => n.id === id) || null;
  const rootNode = () => map.nodes.find(n => n.parentId === null);
  const childrenOf = id => map.nodes.filter(n => n.parentId === id);

  function depthOf(node) {
    let depth = 0, cursor = node;
    while (cursor && cursor.parentId !== null && depth < 50) { cursor = nodeById(cursor.parentId); depth++; }
    return depth;
  }

  function subtreeIds(id) {
    const ids = [id];
    childrenOf(id).forEach(child => ids.push(...subtreeIds(child.id)));
    return ids;
  }

  function displayText(node) {
    return node.text.length > 24 ? node.text.slice(0, 23) + '…' : node.text;
  }

  function nodeSize(node) {
    const isRoot = node.parentId === null;
    const width = Math.min(230, Math.max(isRoot ? 120 : 90, displayText(node).length * 8.4 + 32));
    return { w: width, h: isRoot ? 52 : 40 };
  }

  /* ---------- loading / saving ---------- */
  function loadMaps() {
    maps = Store.all('mindmaps').map(Store.sanitizeMap).filter(Boolean).sort((a, b) => b.updated - a.updated);
  }

  function setStatus(text, state) {
    const s = el('mm-status');
    s.textContent = (state === 'saved' ? '✓ ' : '') + text;
    s.className = 'save-status ms-auto ' + (state || '');
  }

  function scheduleSave() {
    if (!map) return;
    setStatus('Saving…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!map) return true;
    map.name = el('mm-name').value.trim().slice(0, 60) || rootNode().text;
    map.updated = Date.now();
    const ok = Store.upsert('mindmaps', map);
    if (ok) {
      if (!maps.includes(map)) maps.push(map);
      setStatus('Saved ' + UI.fmtClock(map.updated), 'saved');
      renderSelect();
    } else {
      setStatus('Not saved — storage problem', 'error');
    }
    return ok;
  }

  /* ---------- opening maps ---------- */
  function renderSelect() {
    el('mm-select').innerHTML = maps.map(m =>
      '<option value="' + UI.esc(m.id) + '"' + (map && m.id === map.id ? ' selected' : '') + '>' + UI.esc(m.name) + '</option>').join('');
  }

  function openMap(id) {
    if (map) saveNow();
    map = maps.find(m => m.id === id) || null;
    el('mm-empty').hidden = !!map;
    el('mm-workspace').hidden = !map;
    if (!map) return;
    selectedId = rootNode().id;
    editingQaId = null;
    el('mm-name').value = map.name;
    renderSelect();
    if (!map.pan) fitView(false);
    renderAll();
    fillPanel();
    resetQaForm();
    renderQa();
    setStatus('Saved ' + UI.fmtClock(map.updated), 'saved');
  }

  async function createMap() {
    const topic = await UI.prompt('New mind map', 'Central topic (the main idea of the map)', '', 60);
    if (!topic) return;
    const now = Date.now();
    const fresh = Store.sanitizeMap({
      id: Store.uid(), name: topic,
      nodes: [{ id: Store.uid(), text: topic, info: '', x: 0, y: 0, parentId: null }],
      qa: [], pan: null, zoom: 1, created: now, updated: now
    });
    if (!Store.upsert('mindmaps', fresh)) return;
    maps.unshift(fresh);
    map = null;               // so openMap does not re-save an old map
    openMap(fresh.id);
    UI.toast('Mind map created. Select a topic and press “Add sub-topic”.', 'success');
  }

  async function deleteMap() {
    if (!map) return;
    const ok = await UI.confirm('Delete this mind map?', '“' + map.name + '” and its custom quiz questions will be removed from this device.', 'Delete map', true);
    if (!ok) return;
    clearTimeout(saveTimer); saveTimer = null;
    Store.remove('mindmaps', map.id);
    maps = maps.filter(m => m.id !== map.id);
    map = null;
    if (maps.length) openMap(maps[0].id); else { el('mm-empty').hidden = false; el('mm-workspace').hidden = true; }
    UI.toast('Mind map deleted', 'success');
  }

  /* ---------- drawing the map ---------- */
  function applyTransform() {
    el('mm-world').setAttribute('transform', 'translate(' + map.pan.x + ' ' + map.pan.y + ') scale(' + map.zoom + ')');
    el('mm-zoom-label').textContent = Math.round(map.zoom * 100) + '%';
  }

  function viewSize() {
    const rect = svgEl().getBoundingClientRect();
    return { w: rect.width || 800, h: rect.height || 520 };
  }

  /** Zoom and pan so the whole map is visible. */
  function fitView(save) {
    const view = viewSize();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    map.nodes.forEach(n => {
      const s = nodeSize(n);
      minX = Math.min(minX, n.x - s.w / 2); maxX = Math.max(maxX, n.x + s.w / 2);
      minY = Math.min(minY, n.y - s.h / 2); maxY = Math.max(maxY, n.y + s.h / 2);
    });
    const pad = 60;
    const zoom = Math.min(1.2, Math.max(MIN_ZOOM, Math.min(view.w / (maxX - minX + pad * 2), view.h / (maxY - minY + pad * 2))));
    map.zoom = zoom;
    map.pan = { x: view.w / 2 - ((minX + maxX) / 2) * zoom, y: view.h / 2 - ((minY + maxY) / 2) * zoom };
    if (save !== false) { applyTransform(); scheduleSave(); }
  }

  function renderAll() {
    const world = el('mm-world');
    world.innerHTML = '';
    nodeEls = new Map(); edgeEls = new Map();
    const edgeLayer = make('g', { class: 'mm-edges' });
    const nodeLayer = make('g', { class: 'mm-nodes' });
    world.appendChild(edgeLayer);
    world.appendChild(nodeLayer);

    map.nodes.forEach(n => {
      if (n.parentId === null) return;
      const line = make('line', { class: 'mm-edge' });
      edgeEls.set(n.id, line);
      edgeLayer.appendChild(line);
    });

    map.nodes.forEach(n => {
      const size = nodeSize(n);
      const group = make('g', {
        class: 'mm-node d' + Math.min(depthOf(n), 3) + (n.id === selectedId ? ' selected' : ''),
        'data-id': n.id, tabindex: '0', role: 'button', 'aria-label': 'Topic: ' + n.text
      });
      group.appendChild(make('rect', { x: -size.w / 2, y: -size.h / 2, width: size.w, height: size.h, rx: 14 }));
      const label = make('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      label.textContent = displayText(n);
      group.appendChild(label);
      const tip = make('title');
      tip.textContent = n.text + (n.info ? ' — ' + n.info : '');
      group.appendChild(tip);
      nodeEls.set(n.id, group);
      nodeLayer.appendChild(group);
      positionNode(n);
    });
    applyTransform();
  }

  /** Move one node's picture (and the lines touching it) without redrawing everything. */
  function positionNode(n) {
    nodeEls.get(n.id).setAttribute('transform', 'translate(' + n.x + ' ' + n.y + ')');
    updateEdge(n);
    childrenOf(n.id).forEach(updateEdge);
  }

  function updateEdge(n) {
    const line = edgeEls.get(n.id);
    const parent = n.parentId ? nodeById(n.parentId) : null;
    if (!line || !parent) return;
    line.setAttribute('x1', parent.x); line.setAttribute('y1', parent.y);
    line.setAttribute('x2', n.x);      line.setAttribute('y2', n.y);
  }

  /* ---------- selecting ---------- */
  function selectNode(id) {
    selectedId = id;
    nodeEls.forEach((group, nodeId) => group.classList.toggle('selected', nodeId === id));
    fillPanel();
  }

  function fillPanel() {
    const node = selectedId ? nodeById(selectedId) : null;
    el('mm-node-text').disabled = !node;
    el('mm-node-info').disabled = !node;
    el('mm-node-save').disabled = !node;
    el('mm-node-text').value = node ? node.text : '';
    el('mm-node-info').value = node ? node.info : '';
  }

  /* ---------- editing topics ---------- */
  function childPosition(parent) {
    const index = childrenOf(parent.id).length;
    let angle, distance;
    if (parent.parentId === null) {
      angle = -Math.PI / 2 + index * 2.399;         // spread around the center (golden angle)
      distance = 190 + Math.floor(index / 6) * 40;
    } else {
      const grand = nodeById(parent.parentId);
      const outward = Math.atan2(parent.y - grand.y, parent.x - grand.x);
      const spread = [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1];
      angle = outward + spread[index % spread.length];
      distance = 160;
    }
    return { x: Math.round(parent.x + Math.cos(angle) * distance), y: Math.round(parent.y + Math.sin(angle) * distance) };
  }

  async function addChild() {
    const parent = (selectedId && nodeById(selectedId)) || rootNode();
    const text = await UI.prompt('Add sub-topic', 'Name of the new topic under “' + parent.text + '”', '', 60);
    if (!text) return;
    const pos = childPosition(parent);
    const node = { id: Store.uid(), text, info: '', x: pos.x, y: pos.y, parentId: parent.id };
    map.nodes.push(node);
    selectedId = node.id;
    renderAll();
    fillPanel();
    scheduleSave();
  }

  function updateSelectedNode() {
    const node = nodeById(selectedId);
    if (!node) return;
    const text = el('mm-node-text').value.trim();
    if (!text) { UI.toast('A topic needs a name.', 'error'); el('mm-node-text').focus(); return; }
    node.text = text.slice(0, 60);
    node.info = el('mm-node-info').value.trim().slice(0, 300);
    renderAll();
    renderQa();
    scheduleSave();
    UI.toast('Topic updated', 'success');
  }

  async function deleteSelectedNode() {
    const node = nodeById(selectedId);
    if (!node) { UI.toast('Select a topic first.', 'error'); return; }
    if (node.parentId === null) {
      UI.toast('The central topic cannot be deleted. Use “Delete map” to remove the whole map.', 'error');
      return;
    }
    const ids = subtreeIds(node.id);
    const extra = ids.length - 1;
    const ok = await UI.confirm('Delete this topic?',
      '“' + node.text + '”' + (extra ? ' and its ' + UI.plural(extra, 'sub-topic') : '') + ' will be removed.', 'Delete topic', true);
    if (!ok) return;
    map.nodes = map.nodes.filter(n => !ids.includes(n.id));
    selectedId = node.parentId;
    renderAll();
    fillPanel();
    renderQa();
    scheduleSave();
  }

  /* ---------- dragging, panning, zooming ---------- */
  function onPointerDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const group = e.target.closest('.mm-node');
    if (group) {
      const node = nodeById(group.dataset.id);
      selectNode(node.id);
      drag = { type: 'node', node, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y, moved: false };
    } else {
      drag = { type: 'pan', startX: e.clientX, startY: e.clientY, origX: map.pan.x, origY: map.pan.y, moved: false };
    }
    drag.pointerId = e.pointerId;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;   // ignore tiny wiggles while clicking
    drag.moved = true;
    if (drag.type === 'node') {
      drag.node.x = Math.round(drag.origX + dx / map.zoom);
      drag.node.y = Math.round(drag.origY + dy / map.zoom);
      positionNode(drag.node);
    } else {
      map.pan = { x: drag.origX + dx, y: drag.origY + dy };
      applyTransform();
    }
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (finished.moved) scheduleSave();
    else if (finished.type === 'pan') { selectedId = null; nodeEls.forEach(g => g.classList.remove('selected')); fillPanel(); }
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = svgEl().getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.zoom * factor));
    const ratio = newZoom / map.zoom;
    map.pan = { x: px - (px - map.pan.x) * ratio, y: py - (py - map.pan.y) * ratio };
    map.zoom = newZoom;
    applyTransform();
    scheduleSave();
  }

  function zoomFromCenter(factor) {
    const rect = svgEl().getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  /* ---------- custom question-and-answer pairs ---------- */
  function renderQa() {
    const box = el('qa-list');
    if (!map || map.qa.length === 0) {
      box.innerHTML = '<p class="muted small">No custom questions yet. Topics and extra info already create questions on their own; add pairs here for facts the map cannot show.</p>';
      return;
    }
    box.innerHTML = map.qa.map(pair => {
      const usable = QuizBuilder.pairIsUsable(map, pair);
      return '<div class="qa-item" data-id="' + UI.esc(pair.id) + '">' +
        '<div class="qa-text"><strong>' + UI.esc(pair.q) + '</strong>' +
        '<div class="small">Answer: ' + UI.esc(pair.a) + '</div>' +
        (pair.wrong.length ? '<div class="muted small">Wrong choices: ' + UI.esc(pair.wrong.join(' · ')) + '</div>' : '') +
        (usable ? '' : '<div class="warn small">Needs at least one wrong answer to be used in a quiz.</div>') +
        '</div>' +
        '<div class="qa-actions"><button class="btn-fx sm" data-act="edit">Edit</button><button class="btn-fx sm danger" data-act="delete">Delete</button></div>' +
      '</div>';
    }).join('');
  }

  function resetQaForm() {
    editingQaId = null;
    ['qa-question', 'qa-answer', 'qa-wrong-0', 'qa-wrong-1', 'qa-wrong-2'].forEach(id => { el(id).value = ''; });
    el('qa-save').textContent = 'Add question';
    el('qa-cancel').hidden = true;
  }

  function saveQaPair() {
    if (!map) return;
    const q = el('qa-question').value.trim();
    const a = el('qa-answer').value.trim();
    if (!q || !a) { UI.toast('Enter both a question and the correct answer.', 'error'); return; }

    const wrong = [];
    for (let i = 0; i < 3; i++) {
      const value = el('qa-wrong-' + i).value.trim();
      if (!value) continue;
      if (value.toLowerCase() === a.toLowerCase()) { UI.toast('A wrong answer cannot be the same as the correct answer.', 'error'); return; }
      if (wrong.some(w => w.toLowerCase() === value.toLowerCase())) { UI.toast('Wrong answers must be different from each other.', 'error'); return; }
      wrong.push(value);
    }

    if (editingQaId) {
      const pair = map.qa.find(item => item.id === editingQaId);
      if (pair) { pair.q = q; pair.a = a; pair.wrong = wrong; }
    } else {
      map.qa.push({ id: Store.uid(), q, a, wrong });
    }
    resetQaForm();
    renderQa();
    scheduleSave();
    UI.toast('Question saved', 'success');
  }

  function onQaListClick(e) {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const id = button.closest('.qa-item').dataset.id;
    const pair = map.qa.find(item => item.id === id);
    if (!pair) return;
    if (button.dataset.act === 'edit') {
      editingQaId = id;
      el('qa-question').value = pair.q;
      el('qa-answer').value = pair.a;
      for (let i = 0; i < 3; i++) el('qa-wrong-' + i).value = pair.wrong[i] || '';
      el('qa-save').textContent = 'Update question';
      el('qa-cancel').hidden = false;
      el('qa-question').focus();
    } else {
      map.qa = map.qa.filter(item => item.id !== id);
      if (editingQaId === id) resetQaForm();
      renderQa();
      scheduleSave();
    }
  }

  /* ---------- go to Arena ---------- */
  function startQuizBattle() {
    if (!map) return;
    if (!saveNow()) return;
    const count = QuizBuilder.build(map).length;
    if (count === 0) {
      UI.toast('This map cannot make a quiz yet. Add at least two topics, or a custom question with a wrong answer.', 'error');
      return;
    }
    App.go('arena', { mapId: map.id });
  }

  /* ---------- wiring ---------- */
  function init() {
    el('mm-new').addEventListener('click', createMap);
    el('mm-empty-new').addEventListener('click', createMap);
    el('mm-select').addEventListener('change', e => openMap(e.target.value));
    el('mm-name').addEventListener('input', scheduleSave);
    el('mm-save').addEventListener('click', () => { if (saveNow()) UI.toast('Mind map saved', 'success'); });
    el('mm-delete-map').addEventListener('click', deleteMap);
    el('mm-add').addEventListener('click', addChild);
    el('mm-delete-node').addEventListener('click', deleteSelectedNode);
    el('mm-zoom-in').addEventListener('click', () => zoomFromCenter(1.2));
    el('mm-zoom-out').addEventListener('click', () => zoomFromCenter(1 / 1.2));
    el('mm-reset-view').addEventListener('click', () => fitView(true));
    el('mm-quiz').addEventListener('click', startQuizBattle);
    el('mm-node-save').addEventListener('click', updateSelectedNode);
    el('qa-save').addEventListener('click', saveQaPair);
    el('qa-cancel').addEventListener('click', resetQaForm);
    el('qa-list').addEventListener('click', onQaListClick);

    const svg = svgEl();
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('wheel', e => {
      if (!map) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    svg.addEventListener('dblclick', e => {
      const group = e.target.closest('.mm-node');
      if (!group) return;
      selectNode(group.dataset.id);
      el('mm-node-text').focus();
      el('mm-node-text').select();
    });
    svg.addEventListener('keydown', e => {
      const group = e.target.closest('.mm-node');
      if (!group) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNode(group.dataset.id); }
      if (e.key === 'Delete') { selectNode(group.dataset.id); deleteSelectedNode(); }
    });
    window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });
    ready = true;
  }

  async function show(params) {
    if (!ready) init();
    loadMaps();
    const wanted = params && params.mapId;
    const stillThere = map && maps.find(m => m.id === map.id);
    map = null;
    if (wanted && maps.find(m => m.id === wanted)) openMap(wanted);
    else if (stillThere) openMap(stillThere.id);
    else if (maps.length) openMap(maps[0].id);
    else openMap(null);
    if (params && params.newMap) createMap();
  }

  function hide() { if (saveTimer) saveNow(); }

  return { show, hide };
})();
