/* ==========================================================
   draw.js — Drawing Board using the HTML Canvas API.
   Mouse, pen and touch all work through "pointer events".
   ========================================================== */
const Draw = (() => {
  const CANVAS_BG = '#12152b';   // eraser paints with this color
  const MAX_UNDO = 15;

  let canvas, ctx;
  let tool = 'pen';
  let isDrawing = false;
  let lastPoint = null;
  let undoStack = [];            // earlier canvas snapshots (ImageData)
  let currentId = null;          // id of the saved drawing being edited
  let dirty = false;             // unsaved changes?
  let ready = false;

  const el = id => document.getElementById(id);

  /** Convert a pointer position on screen to canvas pixel coordinates. */
  function pointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function brushColor() { return tool === 'eraser' ? CANVAS_BG : el('draw-color').value; }
  function brushSize() { return Number(el('draw-size').value); }

  function pushUndo() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    updateUndoButton();
  }
  function updateUndoButton() { el('draw-undo').disabled = undoStack.length === 0; }

  function fillBackground() {
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /* ---------- drawing ---------- */
  function startStroke(e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pushUndo();
    isDrawing = true;
    dirty = true;
    lastPoint = pointFromEvent(e);
    // A single click should leave a dot
    ctx.fillStyle = brushColor();
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, brushSize() / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function moveStroke(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const point = pointFromEvent(e);
    ctx.strokeStyle = brushColor();
    ctx.lineWidth = brushSize();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint = point;
  }

  function endStroke() { isDrawing = false; lastPoint = null; }

  function undo() {
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    dirty = true;
    updateUndoButton();
  }

  function clearBoard() {
    pushUndo();
    fillBackground();
    dirty = true;
    UI.toast('Board cleared — press Undo to bring it back.');
  }

  function setTool(name) {
    tool = name;
    el('tool-pen').classList.toggle('active', name === 'pen');
    el('tool-eraser').classList.toggle('active', name === 'eraser');
    el('tool-pen').setAttribute('aria-pressed', name === 'pen');
    el('tool-eraser').setAttribute('aria-pressed', name === 'eraser');
  }

  /* ---------- saving and gallery ---------- */
  function saveDrawing() {
    const drawings = Store.all('drawings');
    const typedName = el('draw-name').value.trim().slice(0, 40);
    const existing = currentId ? drawings.find(d => d.id === currentId) : null;
    const item = {
      id: existing ? existing.id : Store.uid(),
      name: typedName || (existing ? existing.name : 'Drawing ' + (drawings.length + 1)),
      dataUrl: canvas.toDataURL('image/png'),
      updated: Date.now()
    };
    if (Store.upsert('drawings', item)) {
      currentId = item.id;
      el('draw-name').value = item.name;
      dirty = false;
      UI.toast('Drawing saved', 'success');
      renderGallery();
    }
  }

  function downloadPng() {
    canvas.toBlob(blob => {
      if (!blob) { UI.toast('Could not create the image.', 'error'); return; }
      UI.download(UI.safeFileName(el('draw-name').value, 'drawing') + '.png', blob);
    }, 'image/png');
  }

  function openDrawing(id) {
    const item = Store.get('drawings', id);
    if (!item) return;
    const image = new Image();
    image.onload = () => {
      fillBackground();
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      undoStack = []; updateUndoButton();
      currentId = item.id;
      el('draw-name').value = item.name;
      dirty = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    image.onerror = () => UI.toast('This drawing could not be opened (the saved image is damaged).', 'error');
    image.src = item.dataUrl;
  }

  async function newBoard() {
    if (dirty) {
      const ok = await UI.confirm('Start a new board?', 'Unsaved changes on this board will be lost.', 'Start new board', true);
      if (!ok) return;
    }
    fillBackground();
    undoStack = []; updateUndoButton();
    currentId = null; dirty = false;
    el('draw-name').value = '';
  }

  async function deleteDrawing(id) {
    const item = Store.get('drawings', id);
    if (!item) return;
    const ok = await UI.confirm('Delete this drawing?', '“' + item.name + '” will be removed from this device.', 'Delete drawing', true);
    if (!ok) return;
    Store.remove('drawings', id);
    if (currentId === id) currentId = null;
    renderGallery();
  }

  function renderGallery() {
    const items = Store.all('drawings').sort((a, b) => b.updated - a.updated);
    const box = el('draw-gallery');
    if (items.length === 0) {
      box.innerHTML = '<p class="muted small">No saved drawings yet. Draw something and press Save.</p>';
      return;
    }
    box.innerHTML = items.map(d =>
      '<div class="gallery-item" data-id="' + UI.esc(d.id) + '">' +
        '<img src="' + UI.esc(d.dataUrl) + '" alt="Drawing: ' + UI.esc(d.name) + '" loading="lazy">' +
        '<div class="gallery-meta"><strong>' + UI.esc(d.name) + '</strong><span class="muted small">' + UI.esc(UI.fmtDate(d.updated)) + '</span></div>' +
        '<div class="gallery-actions">' +
          '<button class="btn-fx sm" data-act="open">Open</button>' +
          '<button class="btn-fx sm danger" data-act="delete">Delete</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  /* ---------- wiring ---------- */
  function init() {
    canvas = el('draw-canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    fillBackground();
    updateUndoButton();

    canvas.addEventListener('pointerdown', startStroke);
    canvas.addEventListener('pointermove', moveStroke);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    el('tool-pen').addEventListener('click', () => setTool('pen'));
    el('tool-eraser').addEventListener('click', () => setTool('eraser'));
    el('draw-size').addEventListener('input', () => { el('draw-size-label').textContent = el('draw-size').value + 'px'; });
    el('draw-undo').addEventListener('click', undo);
    el('draw-clear').addEventListener('click', clearBoard);
    el('draw-save').addEventListener('click', saveDrawing);
    el('draw-download').addEventListener('click', downloadPng);
    el('draw-new').addEventListener('click', newBoard);
    el('draw-gallery').addEventListener('click', e => {
      const button = e.target.closest('[data-act]');
      if (!button) return;
      const id = button.closest('.gallery-item').dataset.id;
      if (button.dataset.act === 'open') openDrawing(id); else deleteDrawing(id);
    });
    ready = true;
  }

  function show() {
    if (!ready) init();
    renderGallery();
  }

  return { show };
})();
