// game.js - the boss battle quiz. Cards are scheduled with simple Leitner boxes.

const DAYS_UNTIL_REVIEW = [0, 1, 2, 4, 8, 16]; // index = Leitner box
const MAX_BOX = 5;
const QUESTIONS_PER_BATTLE = 10;
const STARTING_HEARTS = 3;

let battle = null; // everything about the battle in progress

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

/* ---------- Start screen ---------- */

async function showPlay() {
  const cards = await Store.getAll('cards');

  if (cards.length === 0) {
    appRoot.innerHTML = `
      <div class="arena">
        <h2>No cards yet</h2>
        <p class="arena-hint">Open Notes, select a phrase and press "Make card from selection".</p>
        <button class="btn btn-primary" data-go="notes">Go to Notes</button>
      </div>`;
    return;
  }

  const dueCount = cards.filter((card) => card.due <= Date.now()).length;

  appRoot.innerHTML = `
    <div class="arena" id="arena">
      <h2>Boss battle</h2>
      <p class="arena-hint">Every correct answer hurts the boss. Lose all ${STARTING_HEARTS} hearts and the battle ends.</p>

      <div class="d-flex gap-2 mb-4">
        <span class="arena-chip">${cards.length} cards</span>
        <span class="arena-chip">${dueCount} due today</span>
      </div>

      <div class="btn-group mb-4" role="group">
        <input type="radio" class="btn-check" name="mode" id="mode-easy" value="easy" checked>
        <label class="btn btn-outline-light" for="mode-easy">Easy: pick the answer</label>
        <input type="radio" class="btn-check" name="mode" id="mode-hard" value="hard">
        <label class="btn btn-outline-light" for="mode-hard">Hard: type it (+5 XP)</label>
      </div>
      <div><button class="btn btn-primary btn-lg" id="start-battle">Start battle</button></div>
    </div>`;

  document.getElementById('start-battle').addEventListener('click', () => startBattle(cards));
}

function startBattle(allCards) {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const dueCards = allCards.filter((card) => card.due <= Date.now());
  const pool = dueCards.length > 0 ? dueCards : allCards; // nothing due? practise anyway

  battle = {
    mode: mode,
    allCards: allCards,
    questions: shuffle(pool).slice(0, QUESTIONS_PER_BATTLE),
    index: 0,
    hearts: STARTING_HEARTS,
    correct: 0,
    arena: document.getElementById('arena'),
  };
  showQuestion();
}

/* ---------- Questions ---------- */

function showQuestion() {
  if (battle.index >= battle.questions.length || battle.hearts <= 0) {
    finishBattle();
    return;
  }

  const card = battle.questions[battle.index];
  const bossHp = battle.questions.length - battle.correct;

  // Wrong options for easy mode come from the other cards' answers
  const otherAnswers = [...new Set(
    battle.allCards.filter((other) => other.id !== card.id && other.back !== card.back).map((other) => other.back)
  )];
  const choices = battle.mode === 'easy' && otherAnswers.length > 0
    ? shuffle([card.back, ...shuffle(otherAnswers).slice(0, 3)])
    : null;

  const answerArea = choices
    ? choices.map((text) => `<button class="btn btn-outline-light choice-button">${escapeHtml(text)}</button>`).join('')
    : `<input class="form-control form-control-lg mb-2" id="typed-answer" placeholder="Type the missing text" autocomplete="off">
       <button class="btn btn-primary" id="submit-answer">Attack</button>`;

  battle.arena.innerHTML = `
    <div class="d-flex justify-content-between">
      <span class="hearts">${'&#9829;'.repeat(battle.hearts)}</span>
      <span>Boss HP: ${bossHp}</span>
    </div>
    <div class="progress my-2"><div class="progress-bar" style="width: ${(bossHp / battle.questions.length) * 100}%"></div></div>
    <p class="arena-question">${escapeHtml(card.front).replace('_____', '<span class="arena-blank">_____</span>')}</p>
    ${answerArea}`;

  const isCorrect = (answer) => answer.trim().toLowerCase() === card.back.trim().toLowerCase();

  if (choices) {
    battle.arena.querySelectorAll('.choice-button').forEach((button) => {
      button.addEventListener('click', () => submitAnswer(card, isCorrect(button.textContent)));
    });
  } else {
    const input = document.getElementById('typed-answer');
    input.focus();
    document.getElementById('submit-answer').addEventListener('click', () => submitAnswer(card, isCorrect(input.value)));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitAnswer(card, isCorrect(input.value));
    });
  }
}

async function submitAnswer(card, wasCorrect) {
  card.seen++;

  if (wasCorrect) {
    card.box = Math.min(card.box + 1, MAX_BOX);
    battle.correct++;
    await addXp(battle.mode === 'hard' ? 15 : 10);
    await recordQuestProgress();
  } else {
    card.box = 1;
    card.wrong++;
    battle.hearts--;
    showToast('Answer: ' + card.back);
  }

  card.due = Date.now() + DAYS_UNTIL_REVIEW[card.box] * DAY_MS;
  await Store.put('cards', card);

  battle.index++;
  showQuestion();
}

function finishBattle() {
  const won = battle.correct === battle.questions.length;
  if (won && typeof confetti === 'function') {
    confetti();
  }

  const title = won ? 'Boss defeated!' : battle.hearts <= 0 ? 'Out of hearts' : 'Round over';
  battle.arena.innerHTML = `
    <h2>${title}</h2>
    <p class="arena-hint">${battle.correct} of ${battle.questions.length} answered correctly.</p>
    <button class="btn btn-primary" id="play-again">Play again</button>`;
  document.getElementById('play-again').addEventListener('click', showPlay);
}
