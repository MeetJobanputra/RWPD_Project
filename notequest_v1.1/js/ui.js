/* ==========================================================
   ui.js — small helpers shared by every page:
   toasts, confirm/prompt dialogs, file downloads, formatting.
   ========================================================== */
const UI = (() => {
  /** Escape text before putting it into innerHTML (prevents broken markup / script injection). */
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Show a short message in the corner. type: 'info' | 'success' | 'error' */
  function toast(message, type) {
    const box = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  /**
   * Open the shared <dialog>. Resolves with:
   *   - confirm: true / false
   *   - prompt:  the typed text, or null if cancelled
   */
  function ask(opts) {
    return new Promise(resolve => {
      const dlg = document.getElementById('dlg');
      dlg.innerHTML =
        '<div class="dlg-body">' +
          '<h3>' + esc(opts.title) + '</h3>' +
          (opts.message ? '<p class="muted">' + esc(opts.message) + '</p>' : '') +
          (opts.input ? '<label class="field-label" for="dlg-input">' + esc(opts.label || '') + '</label>' +
            '<input id="dlg-input" class="input" maxlength="' + (opts.max || 60) + '" value="' + esc(opts.value || '') + '">' : '') +
          '<div class="dlg-actions">' +
            '<button class="btn-fx ghost" data-r="cancel">Cancel</button>' +
            '<button class="btn-fx ' + (opts.danger ? 'danger' : 'primary') + '" data-r="ok">' + esc(opts.okLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>';

      let result = opts.input ? null : false;
      const input = dlg.querySelector('#dlg-input');

      function accept() {
        if (opts.input) {
          const text = input.value.trim();
          if (!text) { input.focus(); input.classList.add('invalid'); return; } // required
          result = text;
        } else {
          result = true;
        }
        dlg.close();
      }
      function onClick(e) {
        if (e.target === dlg) { dlg.close(); return; }          // click on backdrop
        const btn = e.target.closest('[data-r]');
        if (!btn) return;
        if (btn.dataset.r === 'ok') accept(); else dlg.close();
      }
      function onKey(e) { if (e.key === 'Enter' && input && e.target === input) { e.preventDefault(); accept(); } }

      dlg.addEventListener('click', onClick);
      dlg.addEventListener('keydown', onKey);
      dlg.addEventListener('close', () => {
        dlg.removeEventListener('click', onClick);
        dlg.removeEventListener('keydown', onKey);
        resolve(result);
      }, { once: true });

      dlg.showModal();
      if (input) { input.focus(); input.select(); }
    });
  }

  const confirmBox = (title, message, okLabel, danger) =>
    ask({ title, message, okLabel: okLabel || 'OK', danger: !!danger });
  const promptBox = (title, label, value, max) =>
    ask({ title, label, value, max, input: true, okLabel: 'Add' });

  /** Download text or a Blob as a file. */
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Turn a title into a safe file name. */
  function safeFileName(name, fallback) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60);
    return cleaned || fallback || 'focusos';
  }

  function fmtDate(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtClock(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  /** 83 seconds -> "1:23" */
  function fmtDuration(ms) {
    const total = Math.round(ms / 1000);
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // Show a toast if the browser refuses to save (e.g. storage is full).
  Store.onError = () => toast('Could not save: browser storage is full or blocked. Try downloading a backup and freeing space.', 'error');

  return { esc, toast, confirm: confirmBox, prompt: promptBox, download, safeFileName, fmtDate, fmtClock, fmtDuration, plural };
})();
