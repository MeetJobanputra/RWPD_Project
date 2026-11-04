/* ==========================================================
   settings.js — preferences, backup/restore, and "delete everything".
   ========================================================== */
const Settings = (() => {
  let ready = false;
  const el = id => document.getElementById(id);

  function fill() {
    const s = Store.getSettings();
    el('set-name').value = s.playerName;
    el('set-difficulty').value = s.difficulty;
    el('set-sound').checked = s.sound;
    const kb = (Store.usageBytes() / 1024).toFixed(1);
    el('set-usage').textContent = 'FocusOS is using about ' + kb + ' KB of this browser’s storage (browsers usually allow around 5 MB per site).';
  }

  function savePreferences() {
    const name = el('set-name').value.trim().slice(0, 20);
    if (!name) { UI.toast('Enter a player name.', 'error'); el('set-name').focus(); return; }
    if (Store.saveSettings({ playerName: name, difficulty: el('set-difficulty').value, sound: el('set-sound').checked })) {
      UI.toast('Preferences saved', 'success');
      App.refreshGreeting();
    }
  }

  function exportBackup() {
    const backup = Store.exportAll();
    const stamp = new Date().toISOString().slice(0, 10);
    UI.download('focusos-backup-' + stamp + '.json', JSON.stringify(backup, null, 2), 'application/json');
    UI.toast('Backup downloaded', 'success');
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => UI.toast('The file could not be read.', 'error');
    reader.onload = async () => {
      let clean;
      try {
        clean = Store.validateBackup(JSON.parse(reader.result));
      } catch (err) {
        UI.toast(err instanceof SyntaxError ? 'This file is not valid JSON.' : err.message, 'error');
        return;
      }
      const summary = UI.plural(clean.notes.length, 'note') + ', ' + UI.plural(clean.mindmaps.length, 'mind map') + ', ' +
        UI.plural(clean.drawings.length, 'drawing') + ', ' + UI.plural(clean.results.length, 'result');
      const ok = await UI.confirm('Restore this backup?',
        'It contains ' + summary + '. Restoring REPLACES everything currently stored in FocusOS on this device.', 'Replace my data', true);
      if (!ok) return;
      if (Store.importAll(clean)) {
        UI.toast('Backup restored', 'success');
        fill();
        App.refreshGreeting();
      }
    };
    reader.readAsText(file);
  }

  async function resetEverything() {
    const ok = await UI.confirm('Delete all FocusOS data?',
      'Notes, mind maps, drawings, scores and settings will be permanently removed from this browser. Download a backup first if you might need them.',
      'Delete everything', true);
    if (!ok) return;
    Store.resetAll();
    fill();
    App.refreshGreeting();
    UI.toast('All FocusOS data deleted', 'success');
  }

  function show() {
    if (!ready) {
      el('set-save').addEventListener('click', savePreferences);
      el('set-export').addEventListener('click', exportBackup);
      el('set-import-btn').addEventListener('click', () => el('set-import').click());
      el('set-import').addEventListener('change', e => { importBackup(e.target.files[0]); e.target.value = ''; });
      el('set-reset').addEventListener('click', resetEverything);
      ready = true;
    }
    fill();
  }

  return { show };
})();
