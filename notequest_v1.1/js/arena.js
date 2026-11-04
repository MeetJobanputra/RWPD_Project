/* ==========================================================
   arena.js — Arena Mode: the quiz game.

   Flow:  setup screen  ->  game screen (one question at a time)  ->  results screen
   Modes: "solo" (one player) and "duel" (two players, one keyboard, taking turns)
   Questions come from QuizBuilder, which only uses the user's saved mind map content.
   ========================================================== */
const Arena = (() => {
  const DIFFICULTY = {
    easy:   { seconds: 20, multiplier: 1 },
    normal: { seconds: 15, multiplier: 1 },
    hard:   { seconds: 8,  multiplier: 1.5 }
  };
  const KEYS_PLAYER_1 = ['a', 's', 'd', 'f'];
  const KEYS_PLAYER_2 = ['j', 'k', 'l', ';'];
  const BASE_POINTS = 100;
  const MAX_SPEED_BONUS = 50;

  let game = null;          // the match in progress (null when on setup screen)
  let timerId = null;       // setInterval id for the question countdown
  let questionCounts = {};  // mind map id -> number of questions it can produce
  let mapsById = {};
  let audioContext = null;
  let ready = false;

  const el = id => document.getElementById(id);
  const selectedMode = () => document.querySelector('input[name="arena-mode"]:checked').value;

  /* ---------- sound (tiny beeps made with the Web Audio API; optional) ---------- */
  function beep(frequency, seconds) {
    if (!Store.getSettings().sound) return;
    try {
      audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + seconds);
    } catch (err) { /* sound is optional; ignore errors */ }
  }

  /* ---------- screens ---------- */
  function showView(name) {
    el('arena-setup').hidden = name !== 'setup';
    el('arena-game').hidden = name !== 'game';
    el('arena-results').hidden = name !== 'results';
    window.scrollTo({ top: 0 });
  }

  function stopTimer() { clearInterval(timerId); timerId = null; }

  function abandonGame() { stopTimer(); game = null; }

  /* ---------- setup screen ---------- */
  function loadSetup(preselectedId) {
    const maps = Store.all('mindmaps').map(Store.sanitizeMap).filter(Boolean).sort((a, b) => b.updated - a.updated);
    mapsById = {}; questionCounts = {};
    maps.forEach(m => { mapsById[m.id] = m; questionCounts[m.id] = QuizBuilder.build(m).length; });

    el('arena-no-maps').hidden = maps.length > 0;
    el('arena-form').hidden = maps.length === 0;
    if (maps.length === 0) return;

    el('arena-map').innerHTML = maps.map(m =>
      '<option value="' + UI.esc(m.id) + '">' + UI.esc(m.name) + ' — ' + UI.plural(questionCounts[m.id], 'question') + '</option>').join('');

    const best = maps.find(m => questionCounts[m.id] > 0);
    el('arena-map').value = (preselectedId && mapsById[preselectedId]) ? preselectedId : (best ? best.id : maps[0].id);

    const settings = Store.getSettings();
    el('arena-difficulty').value = settings.difficulty;
    if (!el('arena-p1').value) el('arena-p1').value = settings.playerName;
    updateSetupInfo();
  }

  function maxQuestionsFor(mapId) {
    const count = questionCounts[mapId] || 0;
    return selectedMode() === 'duel' ? count - (count % 2) : count;   // duel needs an even number
  }

  function updateSetupInfo() {
    const mapId = el('arena-map').value;
    const count = questionCounts[mapId] || 0;
    const duel = selectedMode() === 'duel';
    el('arena-p2-wrap').hidden = !duel;
    el('arena-duel-hint').hidden = !duel;

    const max = maxQuestionsFor(mapId);
    const input = el('arena-count');
    input.max = max;
    const wanted = parseInt(input.value, 10);
    input.value = Math.max(1, Math.min(isNaN(wanted) ? 10 : wanted, Math.max(max, 1)));

    let message;
    if (count === 0) message = 'This map cannot make a quiz yet. Add sub-topics, extra info or custom questions in Mind Maps.';
    else if (duel && max < 2) message = 'A duel needs at least 2 questions. Add more topics or questions in Mind Maps.';
    else message = UI.plural(count, 'question') + ' can be made from this map.';
    el('arena-available').textContent = message;
    el('arena-start').disabled = max < 1 || (duel && max < 2);
  }

  function readSetup() {
    const mode = selectedMode();
    const mapId = el('arena-map').value;
    const map = mapsById[mapId];
    const name1 = el('arena-p1').value.trim().slice(0, 20);
    const name2 = el('arena-p2').value.trim().slice(0, 20);
    if (!map) { UI.toast('Choose a mind map first.', 'error'); return null; }
    if (!name1) { UI.toast('Enter a name for Player 1.', 'error'); el('arena-p1').focus(); return null; }
    if (mode === 'duel') {
      if (!name2) { UI.toast('Enter a name for Player 2.', 'error'); el('arena-p2').focus(); return null; }
      if (name1.toLowerCase() === name2.toLowerCase()) { UI.toast('Players need different names.', 'error'); el('arena-p2').focus(); return null; }
    }
    let count = parseInt(el('arena-count').value, 10);
    if (isNaN(count) || count < 1) { UI.toast('Enter how many questions you want (at least 1).', 'error'); el('arena-count').focus(); return null; }
    const max = maxQuestionsFor(mapId);
    count = Math.min(count, max);
    if (mode === 'duel') count -= count % 2;
    if (count < 1 || (mode === 'duel' && count < 2)) { UI.toast('This map does not have enough questions for that mode.', 'error'); return null; }
    return { mode, mapId, difficulty: el('arena-difficulty').value, count, names: mode === 'duel' ? [name1, name2] : [name1] };
  }

  /* ---------- starting a match ---------- */
  function startGame(settings) {
    const map = mapsById[settings.mapId];
    const pool = QuizBuilder.shuffle(QuizBuilder.build(map)).slice(0, settings.count);
    if (pool.length === 0) { UI.toast('No questions could be made from this map.', 'error'); return; }
    const level = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    game = {
      settings, mapName: map.name, questions: pool, index: 0,
      seconds: level.seconds, multiplier: level.multiplier,
      players: settings.names.map(name => ({ name, score: 0, correct: 0, answered: 0, ms: 0 })),
      turn: 0, answered: false, over: false, questionStart: 0
    };
    showView('game');
    renderQuestion();
  }

  function renderScoreboard() {
    el('game-scoreboard').innerHTML = game.players.map((p, i) =>
      '<div class="score-card' + (game.settings.mode === 'duel' && i === game.turn ? ' active' : '') + '">' +
        '<span class="score-name">' + UI.esc(p.name) + '</span>' +
        '<span class="score-points">' + p.score + '</span>' +
      '</div>').join('');
  }

  function renderQuestion() {
    const q = game.questions[game.index];
    const duel = game.settings.mode === 'duel';
    game.turn = duel ? game.index % 2 : 0;
    game.answered = false;

    el('game-progress-text').textContent = 'Question ' + (game.index + 1) + ' of ' + game.questions.length;
    el('game-progress-bar').style.width = (game.index / game.questions.length * 100) + '%';
    renderScoreboard();

    const banner = el('game-turn');
    banner.hidden = !duel;
    if (duel) {
      const keys = (game.turn === 0 ? KEYS_PLAYER_1 : KEYS_PLAYER_2).slice(0, q.options.length).map(k => k.toUpperCase()).join(' ');
      banner.textContent = game.players[game.turn].name + '’s turn — keys: ' + keys;
      banner.className = 'turn-banner p' + game.turn;
    }

    el('game-question').textContent = q.prompt;
    const labels = duel ? (game.turn === 0 ? KEYS_PLAYER_1 : KEYS_PLAYER_2).map(k => k.toUpperCase()) : ['1', '2', '3', '4'];
    el('game-options').innerHTML = q.options.map((text, i) =>
      '<button class="option" data-i="' + i + '"><kbd>' + labels[i] + '</kbd><span>' + UI.esc(text) + '</span></button>').join('');

    el('game-feedback').className = 'feedback';
    el('game-feedback').innerHTML = '';
    el('game-next').hidden = true;

    // Start the countdown
    stopTimer();
    game.questionStart = Date.now();
    tick();
    timerId = setInterval(tick, 100);
  }

  function tick() {
    if (!game || game.answered) return;
    const elapsed = (Date.now() - game.questionStart) / 1000;
    const remaining = Math.max(0, game.seconds - elapsed);
    const bar = el('game-timer-bar');
    bar.style.width = (remaining / game.seconds * 100) + '%';
    bar.classList.toggle('low', remaining / game.seconds <= 0.3);
    el('game-timer-text').textContent = Math.ceil(remaining);
    if (remaining <= 0) answer(-1);   // out of time
  }

  /** choiceIndex is -1 when the timer ran out. */
  function answer(choiceIndex) {
    if (!game || game.over || game.answered) return;
    game.answered = true;
    stopTimer();

    const q = game.questions[game.index];
    const player = game.players[game.turn];
    const elapsedMs = Math.min(Date.now() - game.questionStart, game.seconds * 1000);
    player.ms += elapsedMs;
    player.answered++;

    const isCorrect = choiceIndex === q.answerIndex;
    let message, feedbackClass;
    if (isCorrect) {
      const speed = 1 - elapsedMs / (game.seconds * 1000);                  // 1 = instant, 0 = last moment
      const points = Math.round((BASE_POINTS + MAX_SPEED_BONUS * speed) * game.multiplier);
      player.score += points;
      player.correct++;
      message = '✅ Correct! +' + points + ' points';
      feedbackClass = 'good';
      beep(880, 0.15);
    } else {
      const prefix = choiceIndex === -1 ? '⏰ Time’s up!' : '❌ Not quite.';
      message = prefix + ' The answer was “' + q.options[q.answerIndex] + '”.';
      feedbackClass = 'bad';
      beep(220, 0.25);
    }

    // Colour the choices
    el('game-options').querySelectorAll('.option').forEach(button => {
      const i = Number(button.dataset.i);
      button.disabled = true;
      if (i === q.answerIndex) button.classList.add('correct');
      else if (i === choiceIndex) button.classList.add('wrong');
    });

    el('game-feedback').className = 'feedback ' + feedbackClass;
    el('game-feedback').innerHTML = '<strong>' + UI.esc(message) + '</strong><span>' + UI.esc(q.explain) + '</span>';
    renderScoreboard();

    const last = game.index === game.questions.length - 1;
    el('game-next').textContent = last ? 'See results' : 'Next question';
    el('game-next').hidden = false;
    el('game-progress-bar').style.width = ((game.index + 1) / game.questions.length * 100) + '%';
  }

  function next() {
    if (!game || game.over || !game.answered) return;
    if (game.index >= game.questions.length - 1) { finish(); return; }
    game.index++;
    renderQuestion();
  }

  /* ---------- results ---------- */
  function accuracyOf(p) { return p.answered ? Math.round(p.correct / p.answered * 100) : 0; }

  function finish() {
    game.over = true;
    stopTimer();

    // Was this a personal best? (checked before saving the new result)
    const earlier = Store.all('results');
    const previousBest = (name) => earlier
      .filter(r => String(r.name).toLowerCase() === name.toLowerCase())
      .reduce((best, r) => Math.max(best, Number(r.score) || 0), -1);

    const gameId = Store.uid();
    const now = Date.now();
    const newResults = game.players.map(p => ({
      id: Store.uid(), gameId, name: p.name,
      mapId: game.settings.mapId, mapName: game.mapName,
      mode: game.settings.mode, difficulty: game.settings.difficulty,
      score: p.score, correct: p.correct, total: p.answered, ms: Math.round(p.ms), date: now
    }));
    const saved = Store.saveAll('results', earlier.concat(newResults));

    const duel = game.settings.mode === 'duel';
    const [a, b] = game.players;
    let headline, sub = game.mapName + ' · ' + game.settings.difficulty + ' difficulty';
    if (duel) {
      if (a.score === b.score) headline = '🤝 It’s a draw!';
      else headline = '🏆 ' + (a.score > b.score ? a.name : b.name) + ' wins!';
    } else {
      headline = a.score + ' points';
      sub = a.name + ' · ' + sub;
    }

    el('results-headline').textContent = headline;
    el('results-sub').textContent = sub;
    el('results-stats').innerHTML = game.players.map(p =>
      '<div class="result-block">' +
        (duel ? '<div class="result-name">' + UI.esc(p.name) + '</div>' : '') +
        '<div class="result-row"><span>Score</span><strong>' + p.score + '</strong></div>' +
        '<div class="result-row"><span>Accuracy</span><strong>' + accuracyOf(p) + '% (' + p.correct + '/' + p.answered + ')</strong></div>' +
        '<div class="result-row"><span>Time taken</span><strong>' + UI.fmtDuration(p.ms) + '</strong></div>' +
      '</div>').join('');

    let note = saved ? 'Result saved to this device’s leaderboard.' : 'The result could not be saved (browser storage problem).';
    if (!duel) {
      const prev = previousBest(a.name);
      if (prev >= 0 && a.score > prev) note = '🎉 New personal best! ' + note;
    }
    el('results-note').textContent = note;
    el('results-again').textContent = duel ? 'Rematch' : 'Play again';
    showView('results');
    beep(660, 0.12);
    setTimeout(() => beep(990, 0.2), 140);
  }

  /* ---------- wiring ---------- */
  function onKeyDown(e) {
    if (!game || game.over || el('arena-game').hidden || el('dlg').open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (game.answered) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
      return;
    }
    const q = game.questions[game.index];
    const keys = game.settings.mode === 'duel'
      ? (game.turn === 0 ? KEYS_PLAYER_1 : KEYS_PLAYER_2)
      : ['1', '2', '3', '4'];
    const index = keys.indexOf(e.key.toLowerCase());
    if (index >= 0 && index < q.options.length) { e.preventDefault(); answer(index); }
  }

  function init() {
    el('arena-map').addEventListener('change', updateSetupInfo);
    el('arena-count').addEventListener('change', updateSetupInfo);
    document.querySelectorAll('input[name="arena-mode"]').forEach(r => r.addEventListener('change', updateSetupInfo));
    el('arena-start').addEventListener('click', () => { const s = readSetup(); if (s) startGame(s); });
    el('game-options').addEventListener('click', e => {
      const button = e.target.closest('.option');
      if (button && !button.disabled) answer(Number(button.dataset.i));
    });
    el('game-next').addEventListener('click', next);
    el('game-quit').addEventListener('click', async () => {
      const ok = await UI.confirm('Quit this battle?', 'Your progress in this match will not be saved.', 'Quit', true);
      if (ok) { abandonGame(); loadSetup(); showView('setup'); }
    });
    el('results-again').addEventListener('click', () => { const s = game.settings; loadSetup(s.mapId); startGame(s); });
    el('results-setup').addEventListener('click', () => { const id = game && game.settings.mapId; abandonGame(); loadSetup(id); showView('setup'); });
    document.addEventListener('keydown', onKeyDown);
    ready = true;
  }

  function show(params) {
    if (!ready) init();
    abandonGame();
    loadSetup(params && params.mapId);
    showView('setup');
  }

  return { show, hide: abandonGame };
})();
