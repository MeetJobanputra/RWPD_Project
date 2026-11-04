/* ==========================================================
   storage.js — everything FocusOS saves goes through here.

   Data lives in the browser's localStorage under keys that
   start with "focusos:". Each key holds JSON:
     notes, mindmaps, drawings, results (arrays) and settings (object).

   Reading is defensive: if the saved data is missing or corrupted,
   we quietly fall back to safe defaults instead of crashing.
   ========================================================== */
const Store = (() => {
  const PREFIX = 'focusos:';
  const COLLECTIONS = ['notes', 'mindmaps', 'drawings', 'results'];

  const DEFAULT_SETTINGS = { playerName: 'Player 1', difficulty: 'normal', sound: true };

  /** Called when a write fails (e.g. storage is full). ui.js sets this to show a toast. */
  let onError = null;

  /** Make a reasonably unique id. */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** Read raw JSON for a key. Returns undefined if missing or corrupted. */
  function readJson(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return undefined;
      return JSON.parse(raw);
    } catch (err) {
      console.warn('FocusOS: could not read "' + key + '", using defaults.', err);
      return undefined;
    }
  }

  /** Write JSON for a key. Returns true on success, false on failure. */
  function writeJson(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error('FocusOS: could not save "' + key + '".', err);
      if (onError) onError(err);
      return false;
    }
  }

  /** Get a whole collection as an array of objects (never throws). */
  function all(name) {
    const data = readJson(name);
    if (!Array.isArray(data)) return [];
    return data.filter(item => item && typeof item === 'object' && typeof item.id === 'string');
  }

  function saveAll(name, list) {
    return writeJson(name, list);
  }

  function get(name, id) {
    return all(name).find(item => item.id === id) || null;
  }

  /** Insert a new item or replace the one with the same id. */
  function upsert(name, item) {
    const list = all(name);
    const index = list.findIndex(existing => existing.id === item.id);
    if (index >= 0) list[index] = item; else list.push(item);
    return saveAll(name, list);
  }

  function remove(name, id) {
    return saveAll(name, all(name).filter(item => item.id !== id));
  }

  /* ---------- settings ---------- */
  function getSettings() {
    const data = readJson('settings');
    const merged = Object.assign({}, DEFAULT_SETTINGS, (data && typeof data === 'object' && !Array.isArray(data)) ? data : {});
    if (!['easy', 'normal', 'hard'].includes(merged.difficulty)) merged.difficulty = 'normal';
    merged.playerName = String(merged.playerName || DEFAULT_SETTINGS.playerName).slice(0, 20);
    merged.sound = merged.sound !== false;
    return merged;
  }

  function saveSettings(settings) {
    return writeJson('settings', Object.assign({}, getSettings(), settings));
  }

  /* ---------- mind map cleaning ----------
     A mind map is stored as plain data:
       { id, name, nodes:[{id,text,info,x,y,parentId}], qa:[{id,q,a,wrong:[]}], pan, zoom, updated }
     parentId === null marks the central topic. This function repairs
     anything odd (bad numbers, missing root, broken parent links, cycles). */
  function cleanText(value, max, fallback) {
    const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
    return text || fallback;
  }

  function finiteOr(value, fallback) {
    return (typeof value === 'number' && isFinite(value)) ? value : fallback;
  }

  function sanitizeMap(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const seen = new Set();
    let nodes = (Array.isArray(raw.nodes) ? raw.nodes : [])
      .filter(n => n && typeof n === 'object')
      .map(n => ({
        id: (typeof n.id === 'string' && n.id) ? n.id : uid(),
        text: cleanText(n.text, 60, 'Topic'),
        info: typeof n.info === 'string' ? n.info.trim().slice(0, 300) : '',
        x: finiteOr(n.x, 0),
        y: finiteOr(n.y, 0),
        parentId: (typeof n.parentId === 'string' && n.parentId) ? n.parentId : null
      }))
      .filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });

    if (nodes.length === 0) {
      nodes = [{ id: uid(), text: 'Central topic', info: '', x: 0, y: 0, parentId: null }];
    }

    // Exactly one root: the first node without a parent.
    let root = nodes.find(n => n.parentId === null) || nodes[0];
    root.parentId = null;
    const ids = new Set(nodes.map(n => n.id));
    nodes.forEach(n => {
      if (n === root) return;
      if (n.parentId === null || !ids.has(n.parentId) || n.parentId === n.id) n.parentId = root.id;
    });

    // Break cycles: walking up from any node must reach the root.
    const byId = new Map(nodes.map(n => [n.id, n]));
    nodes.forEach(n => {
      let cursor = n, steps = 0;
      while (cursor && cursor.parentId !== null && steps <= nodes.length) {
        cursor = byId.get(cursor.parentId);
        steps++;
      }
      if (steps > nodes.length) n.parentId = root.id;
    });

    const qa = (Array.isArray(raw.qa) ? raw.qa : [])
      .filter(item => item && typeof item.q === 'string' && typeof item.a === 'string' && item.q.trim() && item.a.trim())
      .map(item => ({
        id: (typeof item.id === 'string' && item.id) ? item.id : uid(),
        q: item.q.trim().slice(0, 200),
        a: item.a.trim().slice(0, 100),
        wrong: (Array.isArray(item.wrong) ? item.wrong : [])
          .filter(w => typeof w === 'string' && w.trim())
          .map(w => w.trim().slice(0, 100)).slice(0, 3)
      }));

    const pan = (raw.pan && isFinite(raw.pan.x) && isFinite(raw.pan.y)) ? { x: raw.pan.x, y: raw.pan.y } : null;
    const zoom = Math.min(2.5, Math.max(0.3, finiteOr(raw.zoom, 1)));

    return {
      id: (typeof raw.id === 'string' && raw.id) ? raw.id : uid(),
      name: cleanText(raw.name, 60, root.text),
      nodes, qa, pan, zoom,
      created: finiteOr(raw.created, Date.now()),
      updated: finiteOr(raw.updated, Date.now())
    };
  }

  /* ---------- backup / restore ---------- */
  function exportAll() {
    return {
      app: 'FocusOS',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        notes: all('notes'),
        mindmaps: all('mindmaps'),
        drawings: all('drawings'),
        results: all('results'),
        settings: getSettings()
      }
    };
  }

  /** Check a parsed backup file. Returns a cleaned data object, or throws an Error with a friendly message. */
  function validateBackup(parsed) {
    if (!parsed || typeof parsed !== 'object' || parsed.app !== 'FocusOS' || !parsed.data || typeof parsed.data !== 'object') {
      throw new Error('This file is not a FocusOS backup.');
    }
    const clean = {};
    COLLECTIONS.forEach(name => {
      const list = parsed.data[name];
      if (list === undefined) { clean[name] = []; return; }
      if (!Array.isArray(list)) throw new Error('The backup is damaged (“' + name + '” is not a list).');
      clean[name] = list.filter(item => item && typeof item === 'object' && typeof item.id === 'string');
    });
    clean.mindmaps = clean.mindmaps.map(sanitizeMap).filter(Boolean);
    const s = parsed.data.settings;
    clean.settings = (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
    return clean;
  }

  function importAll(clean) {
    let ok = true;
    COLLECTIONS.forEach(name => { ok = writeJson(name, clean[name]) && ok; });
    ok = writeJson('settings', Object.assign({}, DEFAULT_SETTINGS, clean.settings)) && ok;
    return ok;
  }

  function resetAll() {
    COLLECTIONS.concat('settings').forEach(name => {
      try { localStorage.removeItem(PREFIX + name); } catch (err) { /* ignore */ }
    });
  }

  /** Approximate size of FocusOS data in bytes (characters ≈ bytes for our JSON). */
  function usageBytes() {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) total += key.length + (localStorage.getItem(key) || '').length;
      }
    } catch (err) { /* ignore */ }
    return total * 2; // JS strings are UTF-16
  }

  return {
    uid, all, get, upsert, remove, saveAll,
    getSettings, saveSettings,
    sanitizeMap, exportAll, validateBackup, importAll, resetAll, usageBytes,
    set onError(fn) { onError = fn; }
  };
})();
