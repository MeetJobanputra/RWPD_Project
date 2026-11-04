/* ==========================================================
   notes.js — My Notes page: create, edit, delete, search,
   group by subject, auto-save and export to .txt
   ========================================================== */
const Notes = (() => {
  let currentId = null;      // id of the note open in the editor
  let saveTimer = null;      // pending auto-save timer
  let ready = false;

  const el = id => document.getElementById(id);

  /* ---------- helpers ---------- */
  function parseTags(text) {
    const tags = text.split(',').map(t => t.trim()).filter(Boolean);
    return Array.from(new Set(tags)).slice(0, 10);
  }

  function noteToText(note) {
    return [
      note.title,
      'Subject: ' + (note.subject || 'General'),
      'Tags: ' + (note.tags.length ? note.tags.join(', ') : '—'),
      'Last edited: ' + new Date(note.updated).toLocaleString(),
      '',
      note.content
    ].join('\n');
  }

  /* ---------- list on the left ---------- */
  function renderFilterOptions() {
    const notes = Store.all('notes');
    const subjects = Array.from(new Set(notes.map(n => n.subject || 'General'))).sort((a, b) => a.localeCompare(b));
    const select = el('note-filter');
    const previous = select.value || '__all';
    select.innerHTML = '<option value="__all">All subjects</option>' +
      subjects.map(s => '<option value="' + UI.esc(s) + '">' + UI.esc(s) + '</option>').join('');
    select.value = subjects.includes(previous) ? previous : '__all';

    // Subject suggestions in the editor
    el('subject-options').innerHTML = subjects.map(s => '<option value="' + UI.esc(s) + '">').join('');
  }

  function renderList() {
    renderFilterOptions();
    const query = el('note-search').value.trim().toLowerCase();
    const subjectFilter = el('note-filter').value;

    let notes = Store.all('notes').filter(n => {
      if (subjectFilter !== '__all' && (n.subject || 'General') !== subjectFilter) return false;
      if (!query) return true;
      const haystack = [n.title, n.content, n.subject, (n.tags || []).join(' ')].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    const box = el('note-list');
    if (notes.length === 0) {
      const hasAny = Store.all('notes').length > 0;
      box.innerHTML = '<p class="muted small">' + (hasAny ? 'No notes match your search.' : 'No notes yet. Click “New note” to write your first one.') + '</p>';
      return;
    }

    // Group by subject (alphabetical), newest first inside each group
    const groups = {};
    notes.sort((a, b) => b.updated - a.updated).forEach(n => {
      const key = n.subject || 'General';
      (groups[key] = groups[key] || []).push(n);
    });

    box.innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(subject =>
      '<div class="group-title">' + UI.esc(subject) + '</div>' +
      groups[subject].map(n =>
        '<button class="note-item' + (n.id === currentId ? ' active' : '') + '" data-id="' + UI.esc(n.id) + '">' +
          '<span class="note-item-title">' + UI.esc(n.title || 'Untitled note') + '</span>' +
          '<span class="note-item-snippet">' + UI.esc((n.content || '').replace(/\s+/g, ' ').slice(0, 70) || 'Empty note') + '</span>' +
          '<span class="note-item-meta">' + UI.esc(UI.fmtDate(n.updated)) +
            ((n.tags || []).length ? ' · ' + UI.esc(n.tags.map(t => '#' + t).join(' ')) : '') + '</span>' +
        '</button>'
      ).join('')
    ).join('');
  }

  /* ---------- editor on the right ---------- */
  function showEditor(note) {
    const has = !!note;
    el('note-empty').hidden = has;
    el('note-form').hidden = !has;
    if (!has) return;
    el('note-title').value = note.title;
    el('note-subject').value = note.subject;
    el('note-tags').value = (note.tags || []).join(', ');
    el('note-content').value = note.content;
    setStatus('Saved ' + UI.fmtClock(note.updated), 'saved');
  }

  function setStatus(text, state) {
    const s = el('note-status');
    s.textContent = (state === 'saved' ? '✓ ' : '') + text;
    s.className = 'save-status ' + (state || '');
  }

  function openNote(id) {
    flush();
    const note = Store.get('notes', id);
    currentId = note ? note.id : null;
    showEditor(note);
    renderList();
  }

  function newNote() {
    flush();
    const now = Date.now();
    const filter = el('note-filter').value;
    const note = {
      id: Store.uid(), title: 'Untitled note',
      subject: (filter && filter !== '__all') ? filter : '',
      tags: [], content: '', created: now, updated: now
    };
    if (!Store.upsert('notes', note)) return;
    currentId = note.id;
    showEditor(note);
    renderList();
    el('note-title').focus();
    el('note-title').select();
  }

  /* ---------- auto-save ---------- */
  function scheduleSave() {
    if (!currentId) return;
    setStatus('Saving…', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!currentId) return;
    const existing = Store.get('notes', currentId);
    if (!existing) return;
    const note = Object.assign({}, existing, {
      title: el('note-title').value.trim().slice(0, 120) || 'Untitled note',
      subject: el('note-subject').value.trim().slice(0, 40),
      tags: parseTags(el('note-tags').value),
      content: el('note-content').value,
      updated: Date.now()
    });
    if (Store.upsert('notes', note)) {
      setStatus('Saved ' + UI.fmtClock(note.updated), 'saved');
      renderList();
    } else {
      setStatus('Not saved — storage problem', 'error');
    }
  }

  /** Save immediately if a save is pending (used when leaving the page or switching notes). */
  function flush() { if (saveTimer) saveNow(); }

  /* ---------- delete / export ---------- */
  async function deleteCurrent() {
    const note = Store.get('notes', currentId);
    if (!note) return;
    const ok = await UI.confirm('Delete this note?', '“' + note.title + '” will be removed from this device. This cannot be undone.', 'Delete note', true);
    if (!ok) return;
    clearTimeout(saveTimer); saveTimer = null;
    Store.remove('notes', note.id);
    currentId = null;
    showEditor(null);
    renderList();
    UI.toast('Note deleted', 'success');
  }

  function exportCurrent() {
    flush();
    const note = Store.get('notes', currentId);
    if (!note) return;
    UI.download(UI.safeFileName(note.title, 'note') + '.txt', noteToText(note));
  }

  function exportAll() {
    const notes = Store.all('notes');
    if (notes.length === 0) { UI.toast('There are no notes to export yet.', 'error'); return; }
    const divider = '\n\n' + '='.repeat(40) + '\n\n';
    UI.download('focusos-all-notes.txt', notes.sort((a, b) => b.updated - a.updated).map(noteToText).join(divider));
  }

  /* ---------- wiring ---------- */
  function init() {
    el('note-new').addEventListener('click', newNote);
    el('note-empty-new').addEventListener('click', newNote);
    el('note-export').addEventListener('click', exportCurrent);
    el('note-export-all').addEventListener('click', exportAll);
    el('note-delete').addEventListener('click', deleteCurrent);
    el('note-search').addEventListener('input', renderList);
    el('note-filter').addEventListener('change', renderList);
    ['note-title', 'note-subject', 'note-tags', 'note-content'].forEach(id => el(id).addEventListener('input', scheduleSave));
    el('note-list').addEventListener('click', e => {
      const item = e.target.closest('.note-item');
      if (item) openNote(item.dataset.id);
    });
    window.addEventListener('beforeunload', flush);
    ready = true;
  }

  function show(params) {
    if (!ready) init();
    if (params && params.newNote) { newNote(); return; }
    if (params && params.noteId && Store.get('notes', params.noteId)) currentId = params.noteId;
    if (currentId && !Store.get('notes', currentId)) currentId = null;
    renderList();
    showEditor(currentId ? Store.get('notes', currentId) : null);
  }

  return { show, hide: flush };
})();
