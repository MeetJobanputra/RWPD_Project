// notes.js - page tree, block editor, highlight-to-card and uploaded source files.

let pages = [];
let currentPage = null;
const saveTimers = new Map(); // one debounce timer per page, so quick page switches don't lose edits

function newBlock(type, html = '') {
  return { id: makeId(), type: type, html: html, done: false };
}

function welcomeBlocks() {
  return [
    newBlock('h2', 'How this works'),
    newBlock('p', 'Write notes here. Press Enter for a new block, and Backspace on an empty block to remove it.'),
    newBlock('p', 'The mitochondria is the powerhouse of the cell. Select the word powerhouse, then press Make card.'),
    newBlock('todo', 'Make your first card, then open Play'),
  ];
}

function savePageSoon(page) {
  page.updated = Date.now();
  clearTimeout(saveTimers.get(page.id));
  saveTimers.set(page.id, setTimeout(() => Store.put('pages', page), 400));
}

function findBlock(blockRow) {
  return currentPage.blocks.find((block) => block.id === blockRow.dataset.blockId);
}

function focusBlock(index) {
  const editables = document.querySelectorAll('.block-text');
  if (editables[index]) {
    editables[index].focus();
  }
}

/* ---------- Pages ---------- */

async function showNotes(pageId) {
  pages = await Store.getAll('pages');
  if (pages.length === 0) {
    await createPage(null, { silent: true });
  }

  currentPage =
    pages.find((page) => page.id === pageId) ||
    pages.find((page) => currentPage && page.id === currentPage.id) ||
    pages[0];

  renderNotes();
}

async function createPage(parentId, options = {}) {
  const isFirstPage = pages.length === 0;
  const page = {
    id: makeId(),
    parentId: parentId,
    title: isFirstPage ? 'Welcome to NoteQuest' : '',
    updated: Date.now(),
    blocks: isFirstPage ? welcomeBlocks() : [newBlock('p')],
  };

  await Store.put('pages', page);
  pages.push(page);
  currentPage = page;

  if (!options.silent) {
    renderNotes();
  }
}

async function deletePage(pageId) {
  // Collect the page and everything nested under it.
  const doomed = new Set([pageId]);
  let previousSize;
  do {
    previousSize = doomed.size;
    pages.forEach((page) => {
      if (doomed.has(page.parentId)) {
        doomed.add(page.id);
      }
    });
  } while (doomed.size > previousSize);

  for (const id of doomed) {
    await Store.remove('pages', id);
  }

  // Cards that came from deleted pages go too.
  const cards = await Store.getAll('cards');
  for (const card of cards) {
    if (doomed.has(card.pageId)) {
      await Store.remove('cards', card.id);
    }
  }

  pages = pages.filter((page) => !doomed.has(page.id));
  if (pages.length === 0) {
    await createPage(null, { silent: true });
  }
  currentPage = pages[0];
  renderNotes();
}

/* ---------- Rendering ---------- */

function renderPageTree(parentId, depth) {
  return pages
    .filter((page) => page.parentId === parentId)
    .map((page) => `
      <div class="page-row ${page === currentPage ? 'active' : ''}"
           style="padding-left: ${0.6 + depth}rem" data-open-id="${page.id}">
        <span class="flex-grow-1 text-truncate">${escapeHtml(page.title) || 'Untitled'}</span>
        <button class="row-action" data-add-child="${page.id}" title="Add sub-page">+</button>
        <button class="row-action" data-delete="${page.id}" title="Delete page">&times;</button>
      </div>
      ${renderPageTree(page.id, depth + 1)}`)
    .join('');
}

function renderNotes() {
  const blockTypes = [
    ['p', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'],
    ['todo', 'To-do'], ['quote', 'Quote'], ['code', 'Code'],
  ];
  const typeButtons = blockTypes
    .map(([type, label]) => `<button class="btn btn-outline-secondary" data-type="${type}">${label}</button>`)
    .join('');

  appRoot.innerHTML = `
    <div class="workspace">
      <aside class="panel" id="sidebar">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong>Pages</strong>
          <button class="btn btn-sm btn-primary" id="add-page">New page</button>
        </div>
        <div class="mb-4">${renderPageTree(null, 0)}</div>

        <strong>Sources</strong>
        <input type="file" id="source-upload" class="form-control form-control-sm my-2" accept=".pdf,.pptx">
        <div id="source-list"></div>
      </aside>

      <section class="panel paper">
        <input class="form-control page-title" id="page-title" placeholder="Untitled"
               value="${escapeHtml(currentPage.title)}">
        <div class="editor-toolbar d-flex flex-wrap gap-2" id="toolbar">
          <div class="btn-group btn-group-sm">${typeButtons}</div>
          <button class="btn btn-sm btn-warning" id="make-card">Make card from selection</button>
        </div>
        <div id="blocks"></div>
      </section>
    </div>`;

  renderBlocks();
  renderSources();
  wireNotesEvents();
}

function renderBlocks() {
  const html = currentPage.blocks.map((block) => {
    const checkbox = block.type === 'todo'
      ? `<input type="checkbox" class="form-check-input block-check" ${block.done ? 'checked' : ''}>`
      : '';

    return `
      <div class="block-row ${block.done ? 'is-done' : ''}" data-block-id="${block.id}">
        ${checkbox}
        <div class="block-text block-${block.type}" contenteditable="true">${block.html}</div>
      </div>`;
  }).join('');

  document.getElementById('blocks').innerHTML = html;
}

/* ---------- Events ---------- */

function wireNotesEvents() {
  const sidebar = document.getElementById('sidebar');
  const blocksArea = document.getElementById('blocks');
  const toolbar = document.getElementById('toolbar');

  sidebar.addEventListener('click', (event) => {
    const addChild = event.target.closest('[data-add-child]');
    const remove = event.target.closest('[data-delete]');
    const open = event.target.closest('[data-open-id]');

    if (event.target.id === 'add-page') {
      createPage(null);
    } else if (addChild) {
      createPage(addChild.dataset.addChild);
    } else if (remove) {
      deletePage(remove.dataset.delete);
    } else if (open) {
      currentPage = pages.find((page) => page.id === open.dataset.openId);
      renderNotes();
    }
  });

  document.getElementById('page-title').addEventListener('input', (event) => {
    currentPage.title = event.target.value;
    savePageSoon(currentPage);
  });

  // Typing inside a block
  blocksArea.addEventListener('input', (event) => {
    const row = event.target.closest('.block-row');
    if (row && event.target.classList.contains('block-text')) {
      findBlock(row).html = event.target.innerHTML;
      savePageSoon(currentPage);
    }
  });

  // To-do checkbox
  blocksArea.addEventListener('change', (event) => {
    const row = event.target.closest('.block-row');
    if (row && event.target.type === 'checkbox') {
      const block = findBlock(row);
      block.done = event.target.checked;
      row.classList.toggle('is-done', block.done);
      savePageSoon(currentPage);
    }
  });

  // Enter = new block, Backspace on an empty block = remove it
  blocksArea.addEventListener('keydown', (event) => {
    const row = event.target.closest('.block-row');
    if (!row) return;

    const block = findBlock(row);
    const index = currentPage.blocks.indexOf(block);

    if (event.key === 'Enter' && !event.shiftKey && block.type !== 'code') {
      event.preventDefault();
      currentPage.blocks.splice(index + 1, 0, newBlock('p'));
      renderBlocks();
      focusBlock(index + 1);
      savePageSoon(currentPage);
    }

    if (event.key === 'Backspace' && event.target.textContent === '' && currentPage.blocks.length > 1) {
      event.preventDefault();
      currentPage.blocks.splice(index, 1);
      renderBlocks();
      focusBlock(Math.max(0, index - 1));
      savePageSoon(currentPage);
    }
  });

  // Keep the text selection alive when a toolbar button is pressed
  toolbar.addEventListener('mousedown', (event) => event.preventDefault());

  toolbar.addEventListener('click', (event) => {
    const typeButton = event.target.closest('[data-type]');
    const activeRow = document.activeElement.closest('.block-row');

    if (typeButton && activeRow) {
      const block = findBlock(activeRow);
      block.type = typeButton.dataset.type;
      block.html = activeRow.querySelector('.block-text').innerHTML;
      renderBlocks();
      focusBlock(currentPage.blocks.indexOf(block));
      savePageSoon(currentPage);
    }

    if (event.target.id === 'make-card') {
      makeCardFromSelection();
    }
  });
}

/* ---------- Highlight -> flashcard ---------- */

async function makeCardFromSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  const editable = selection.anchorNode && selection.anchorNode.parentElement
    ? selection.anchorNode.parentElement.closest('.block-text')
    : null;

  if (!selectedText || !editable) {
    showToast('Select some text inside a note first');
    return;
  }

  // The card hides the selected text: "The ____ is the powerhouse of the cell"
  const cardFront = editable.innerText.replace(selectedText, '_____');

  document.execCommand('backColor', false, 'rgba(255, 197, 61, 0.45)'); // visually highlight it in the note
  findBlock(editable.closest('.block-row')).html = editable.innerHTML;
  savePageSoon(currentPage);

  await Store.put('cards', {
    id: makeId(),
    pageId: currentPage.id,
    front: cardFront,
    back: selectedText,
    box: 1,           // Leitner box, 1 = needs the most practice
    due: Date.now(),
    seen: 0,
    wrong: 0,
  });
  showToast('Card created from your highlight');
}

/* ---------- Source files (PDF / PPTX kept inside the browser) ---------- */

async function renderSources() {
  const files = await Store.getAll('files');
  const list = document.getElementById('source-list');

  list.innerHTML = files.length === 0
    ? '<small class="text-secondary">Upload a PDF or PPTX to keep it next to your notes.</small>'
    : files.map((file) => `
        <div class="d-flex justify-content-between small">
          <a href="#" class="text-truncate" data-file-id="${file.id}">${escapeHtml(file.name)}</a>
          <button class="row-action" data-remove-file="${file.id}" title="Remove file">&times;</button>
        </div>`).join('');

  list.onclick = async (event) => {
    const fileLink = event.target.closest('[data-file-id]');
    const removeButton = event.target.closest('[data-remove-file]');

    if (fileLink) {
      event.preventDefault();
      const stored = await Store.get('files', fileLink.dataset.fileId);
      window.open(URL.createObjectURL(stored.blob));
    }
    if (removeButton) {
      await Store.remove('files', removeButton.dataset.removeFile);
      renderSources();
    }
  };

  document.getElementById('source-upload').onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    await Store.put('files', { id: makeId(), name: file.name, type: file.type, blob: file, added: Date.now() });
    renderSources();
  };
}
