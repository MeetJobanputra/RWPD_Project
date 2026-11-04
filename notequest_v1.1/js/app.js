/* ==========================================================
   app.js — the "glue": page router, navigation, dashboard,
   and service-worker registration.

   FocusOS is a single page (index.html). Each "page" is a <section>.
   The URL hash (#/notes, #/arena …) decides which one is visible.
   ========================================================== */
const App = (() => {
  const pages = {};            // route name -> module with show() / hide()
  let currentRoute = null;
  let routeParams = {};        // extra data passed along with App.go()

  const el = id => document.getElementById(id);

  function register(route, module) { pages[route] = module; }

  /** Go to a page. `params` can pass data, e.g. App.go('arena', { mapId }). */
  function go(route, params) {
    routeParams = params || {};
    const target = '#/' + route;
    if (location.hash === target) render(); else location.hash = target;
  }

  function render() {
    let route = location.hash.replace(/^#\//, '') || 'dashboard';
    if (!pages[route]) route = 'dashboard';

    // Tell the page we are leaving that it is being hidden (saves pending work, stops timers)
    if (currentRoute && pages[currentRoute] && pages[currentRoute].hide) pages[currentRoute].hide();
    currentRoute = route;

    document.querySelectorAll('.page').forEach(section => section.classList.toggle('active', section.id === 'page-' + route));
    document.querySelectorAll('.nav-list a').forEach(link => {
      const active = link.dataset.route === route;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });

    const section = el('page-' + route);
    document.title = section.dataset.title + ' — FocusOS';
    closeSidebar();

    const params = routeParams;
    routeParams = {};
    try {
      pages[route].show(params);
    } catch (err) {
      console.error('FocusOS: page failed to load', err);
      UI.toast('Something went wrong loading this page. Try Settings → Back up and restore, or reload.', 'error');
    }
    window.scrollTo({ top: 0 });
  }

  /* ---------- mobile sidebar ---------- */
  function openSidebar() { el('sidebar').classList.add('open'); el('backdrop').classList.add('show'); }
  function closeSidebar() { el('sidebar').classList.remove('open'); el('backdrop').classList.remove('show'); }

  /* ---------- dashboard ---------- */
  function refreshGreeting() {
    const name = Store.getSettings().playerName;
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    el('dash-welcome').textContent = part + ', ' + name;
    el('dash-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  /** Group saved results by match (gameId) so a duel counts as one quiz. */
  function groupResultsByGame(results) {
    const games = {};
    results.forEach(r => {
      const key = r.gameId || r.id;
      (games[key] = games[key] || []).push(r);
    });
    return Object.values(games).sort((a, b) => (b[0].date || 0) - (a[0].date || 0));
  }

  const dashboard = {
    show() {
      refreshGreeting();
      const notes = Store.all('notes');
      const maps = Store.all('mindmaps');
      const results = Store.all('results');
      const games = groupResultsByGame(results);
      const best = results.reduce((max, r) => Math.max(max, Number(r.score) || 0), -1);

      el('stat-notes').textContent = notes.length;
      el('stat-maps').textContent = maps.length;
      el('stat-quizzes').textContent = games.length;
      el('stat-best').textContent = best >= 0 ? best : '—';

      const recentNotes = notes.slice().sort((a, b) => b.updated - a.updated).slice(0, 5);
      el('dash-recent-notes').innerHTML = recentNotes.length === 0
        ? '<div class="empty"><p>No notes yet.</p><button class="btn-fx primary" data-go="notes" data-action="new-note">Write your first note</button></div>'
        : '<ul class="recent-list">' + recentNotes.map(n =>
            '<li><a href="#/notes" data-note-id="' + UI.esc(n.id) + '"><strong>' + UI.esc(n.title || 'Untitled note') + '</strong>' +
            '<span class="muted small">' + UI.esc(n.subject || 'General') + ' · ' + UI.esc(UI.fmtDate(n.updated)) + '</span></a></li>').join('') + '</ul>';

      const recentGames = games.slice(0, 5);
      el('dash-recent-quizzes').innerHTML = recentGames.length === 0
        ? '<div class="empty"><p>You have not played a quiz yet.</p><button class="btn-fx primary" data-go="arena">⚔️ Start Arena Mode</button></div>'
        : '<ul class="recent-list">' + recentGames.map(g => {
            const first = g[0];
            const scores = g.map(r => UI.esc(r.name) + ' ' + (Number(r.score) || 0)).join(' vs ');
            return '<li><div><strong>' + UI.esc(first.mapName || 'Quiz') + '</strong>' +
              '<span class="muted small">' + scores + ' · ' + (first.mode === 'duel' ? 'Duel' : 'Solo') + ' · ' + UI.esc(UI.fmtDate(first.date)) + '</span></div></li>';
          }).join('') + '</ul>';
    }
  };

  /* ---------- offline support (service worker) ---------- */
  function setupOfflineSupport() {
    const status = el('sw-status');
    if (!('serviceWorker' in navigator)) { status.textContent = 'Offline mode: not supported in this browser'; return; }
    if (!/^https?:$/.test(location.protocol)) {
      status.textContent = 'Offline mode: open through a local server (see README)';
      return;
    }
    navigator.serviceWorker.register('sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(() => { status.textContent = '✓ Ready to work offline'; })
      .catch(() => { status.textContent = 'Offline mode: could not start'; });
  }

  /* ---------- start up ---------- */
  function start() {
    register('dashboard', dashboard);
    register('notes', Notes);
    register('draw', Draw);
    register('mindmaps', MindMap);
    register('arena', Arena);
    register('leaderboard', Leaderboard);
    register('settings', Settings);

    // Any element with data-go="route" navigates there (optionally with data-action)
    document.addEventListener('click', e => {
      const noteLink = e.target.closest('[data-note-id]');
      if (noteLink) { e.preventDefault(); go('notes', { noteId: noteLink.dataset.noteId }); return; }

      const trigger = e.target.closest('[data-go]');
      if (!trigger) return;
      const params = {};
      if (trigger.dataset.action === 'new-note') params.newNote = true;
      if (trigger.dataset.action === 'new-map') params.newMap = true;
      go(trigger.dataset.go, params);
    });

    el('menu-btn').addEventListener('click', openSidebar);
    el('backdrop').addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
    window.addEventListener('hashchange', render);

    render();
    setupOfflineSupport();
  }

  document.addEventListener('DOMContentLoaded', start);

  return { go, refreshGreeting };
})();
