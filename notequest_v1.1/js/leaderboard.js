/* ==========================================================
   leaderboard.js — scores stored on this device only.
   Each finished quiz saves one result per player in "results".
   ========================================================== */
const Leaderboard = (() => {
  let ready = false;
  const el = id => document.getElementById(id);

  function accuracy(r) { return r.total ? Math.round(r.correct / r.total * 100) : 0; }

  function render() {
    const results = Store.all('results').filter(r => typeof r.name === 'string');

    // Combine results by player name (ignoring upper/lower case)
    const players = {};
    results.forEach(r => {
      const key = r.name.toLowerCase();
      const p = players[key] = players[key] || { name: r.name, best: 0, played: 0, last: 0 };
      p.best = Math.max(p.best, Number(r.score) || 0);
      p.played++;
      if ((r.date || 0) >= p.last) { p.last = r.date || 0; p.name = r.name; }
    });
    const ranking = Object.values(players).sort((a, b) => b.best - a.best || b.played - a.played);

    const medals = ['🥇', '🥈', '🥉'];
    el('lb-players').innerHTML = ranking.length === 0
      ? '<div class="empty"><p>No scores yet. Finish a quiz in Arena Mode to appear here.</p><button class="btn-fx primary" data-go="arena">⚔️ Go to Arena Mode</button></div>'
      : '<div class="table-wrap"><table class="table-fx"><thead><tr><th>Rank</th><th>Player</th><th class="num">Highest score</th><th class="num">Quizzes played</th></tr></thead><tbody>' +
        ranking.map((p, i) =>
          '<tr><td>' + (medals[i] || (i + 1)) + '</td><td>' + UI.esc(p.name) + '</td><td class="num">' + p.best + '</td><td class="num">' + p.played + '</td></tr>').join('') +
        '</tbody></table></div>';

    const recent = results.slice().sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 15);
    el('lb-recent').innerHTML = recent.length === 0
      ? '<p class="muted small">Nothing played yet.</p>'
      : '<div class="table-wrap"><table class="table-fx"><thead><tr><th>Player</th><th>Mind map</th><th>Mode</th><th class="num">Score</th><th class="num">Accuracy</th><th>When</th></tr></thead><tbody>' +
        recent.map(r =>
          '<tr><td>' + UI.esc(r.name) + '</td><td>' + UI.esc(r.mapName || '—') + '</td>' +
          '<td><span class="badge-fx">' + (r.mode === 'duel' ? 'Duel' : 'Solo') + '</span></td>' +
          '<td class="num">' + (Number(r.score) || 0) + '</td><td class="num">' + accuracy(r) + '%</td>' +
          '<td>' + UI.esc(UI.fmtDate(r.date)) + '</td></tr>').join('') +
        '</tbody></table></div>';
  }

  async function reset() {
    if (Store.all('results').length === 0) { UI.toast('The leaderboard is already empty.'); return; }
    const ok = await UI.confirm('Reset the leaderboard?',
      'All saved scores on this device will be deleted. Your notes, drawings and mind maps are not affected.', 'Reset leaderboard', true);
    if (!ok) return;
    Store.saveAll('results', []);
    render();
    UI.toast('Leaderboard reset', 'success');
  }

  function show() {
    if (!ready) { el('lb-reset').addEventListener('click', reset); ready = true; }
    render();
  }

  return { show };
})();
