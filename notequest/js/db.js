// db.js - a small wrapper around IndexedDB, so the rest of the code can use simple async calls.
// Everything is stored in the user's browser: no server and no database to set up.

const DB_NAME = 'notequest';
const STORE_NAMES = ['pages', 'cards', 'files', 'meta'];

let databasePromise = null;

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      STORE_NAMES.forEach((name) => {
        request.result.createObjectStore(name, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

async function runRequest(storeName, mode, action) {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));

    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

const Store = {
  getAll: (store) => runRequest(store, 'readonly', (s) => s.getAll()),
  get: (store, id) => runRequest(store, 'readonly', (s) => s.get(id)),
  put: (store, item) => runRequest(store, 'readwrite', (s) => s.put(item)),
  remove: (store, id) => runRequest(store, 'readwrite', (s) => s.delete(id)),
};

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Stops user text from being treated as HTML when we build strings for innerHTML.
function escapeHtml(text) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(text == null ? '' : text).replace(/[&<>"]/g, (char) => replacements[char]);
}
