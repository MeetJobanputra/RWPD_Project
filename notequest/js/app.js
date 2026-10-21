// app.js - navigation, profile (XP, streak, daily quest), the bento home screen and theme toggle.

const appRoot = document.getElementById('app');
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_QUEST_TARGET = 5;
const XP_PER_LEVEL = 100;

let profile = {
  id: 'profile',
  xp: 0,
  streak: 0,
  lastActiveDay: '',
  questDay: '',
  questDone: 0,
  tileOrder: [],
};

/* ---------- Profile helpers ---------- */

// Local date as YYYY-MM-DD ("en-CA" happens to format dates that way)
function dayString(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * DAY_MS).toLocaleDateString('en-CA');
}

function saveProfile() {
  return Store.put('meta', profile);
}

function updateLevelBadge() {
  const level = Math.floor(profile.xp / XP_PER_LEVEL) + 1;
  document.getElementById('level-badge').textContent = `Level ${level} - ${profile.xp % XP_PER_LEVEL}/${XP_PER_LEVEL} XP`;
}

async function addXp(amount) {
  profile.xp += amount;

  if (profile.lastActiveDay !== dayString()) {
    profile.streak = profile.lastActiveDay === dayString(1) ? profile.streak + 1 : 1;
    profile.lastActiveDay = dayString();
  }

  await saveProfile();
  updateLevelBadge();
  showToast(`+${amount} XP`);
}

function resetQuestIfNewDay() {
  if (profile.questDay !== dayString()) {
    profile.questDay = dayString();
    profile.questDone = 0;
  }
}

async function recordQuestProgress() {
  resetQuestIfNewDay();
  profile.questDone++;
  await saveProfile();
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast align-items-center text-bg-primary border-0';
  toast.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div></div>`;

  document.getElementById('toast-area').append(toast);
  new bootstrap.Toast(toast, { delay: 2200 }).show();
  toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

/* ---------- Bento home ---------- */

async function showHome() {
  const pages = await Store.getAll('pages');
  const cards = await Store.getAll('cards');

  resetQuestIfNewDay();
  const questDone = Math.min(profile.questDone, DAILY_QUEST_TARGET);
  const level = Math.floor(profile.xp / XP_PER_LEVEL) + 1;
  const dueCount = cards.filter((card) => card.due <= Date.now()).length;

  const recentPages = [...pages].sort((a, b) => b.updated - a.updated).slice(0, 6);
  const weakCards = cards.filter((card) => card.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 3);

  const tiles = {
    quest: `
      <div class="tile tile-quest" data-tile="quest">
        <div class="tile-label">Daily quest: review ${DAILY_QUEST_TARGET} cards</div>
        <div class="tile-number">${questDone}/${DAILY_QUEST_TARGET}</div>
        <div class="progress my-3"><div class="progress-bar" style="width: ${(questDone / DAILY_QUEST_TARGET) * 100}%"></div></div>
        <div><button class="btn btn-warning fw-semibold" data-go="play">Start reviewing</button></div>
      </div>`,

    streak: `
      <div class="tile tile-streak" data-tile="streak">
        <div class="tile-label">Streak</div>
        <div class="tile-number">${profile.streak}</div>
        <small>days in a row</small>
      </div>`,

    level: `
      <div class="tile tile-level" data-tile="level">
        <div class="tile-label">Level</div>
        <div class="tile-number">${level}</div>
        <div class="progress mt-2"><div class="progress-bar" style="width: ${profile.xp % XP_PER_LEVEL}%"></div></div>
      </div>`,

    due: `
      <div class="tile" data-tile="due">
        <div class="tile-label">Cards due</div>
        <div class="tile-number">${dueCount}</div>
        <small>${cards.length} cards in total</small>
      </div>`,

    library: `
      <div class="tile" data-tile="library">
        <div class="tile-label">Your notes</div>
        <div class="tile-number">${pages.length}</div>
        <small>pages</small>
      </div>`,

    recent: `
      <div class="tile tile-recent" data-tile="recent">
        <div class="tile-label mb-2">Recent pages</div>
        ${recentPages.length === 0
          ? '<p class="mb-0">Nothing here yet. Open Notes to write your first page.</p>'
          : recentPages.map((page) => `<div class="py-1"><a href="#" data-open-page="${page.id}">${escapeHtml(page.title) || 'Untitled'}</a></div>`).join('')}
      </div>`,

    weak: `
      <div class="tile tile-weak" data-tile="weak">
        <div class="tile-label mb-2">Trickiest cards</div>
        ${weakCards.length === 0
          ? '<p class="mb-0">No misses yet. Wrong answers will show up here.</p>'
          : weakCards.map((card) => `<div class="py-1 text-truncate">${escapeHtml(card.back)} <small class="opacity-75">missed ${card.wrong}x</small></div>`).join('')}
      </div>`,

    how: `
      <div class="tile tile-how" data-tile="how">
        <div class="tile-label mb-2">How it works</div>
        <ol class="mb-0 ps-3">
          <li>Write notes on any page</li>
          <li>Select a phrase and make a card</li>
          <li>Play the boss battle to earn XP</li>
        </ol>
      </div>`,
  };

  // Show tiles in the order the user dragged them to (new tiles go to the end)
  const savedOrder = profile.tileOrder.filter((id) => tiles[id]);
  const order = [...new Set([...savedOrder, ...Object.keys(tiles)])];

  appRoot.innerHTML = `<div class="bento" id="bento">${order.map((id) => tiles[id]).join('')}</div>`;

  Sortable.create(document.getElementById('bento'), {
    animation: 150,
    onEnd: () => {
      profile.tileOrder = [...document.querySelectorAll('#bento .tile')].map((tile) => tile.dataset.tile);
      saveProfile();
    },
  });
}

/* ---------- Navigation ---------- */

const views = { home: showHome, notes: showNotes, play: showPlay };

async function showView(name, argument) {
  document.querySelectorAll('#main-nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === name);
  });
  await views[name](argument);
}

document.getElementById('main-nav').addEventListener('click', (event) => {
  if (event.target.dataset.view) {
    showView(event.target.dataset.view);
  }
});

// Buttons and links inside the views use data attributes instead of their own listeners
appRoot.addEventListener('click', (event) => {
  const goButton = event.target.closest('[data-go]');
  const pageLink = event.target.closest('[data-open-page]');

  if (goButton) {
    showView(goButton.dataset.go);
  }
  if (pageLink) {
    event.preventDefault();
    showView('notes', pageLink.dataset.openPage);
  }
});

document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const goingDark = root.dataset.bsTheme !== 'dark';
  root.dataset.bsTheme = goingDark ? 'dark' : 'light';
  document.getElementById('theme-toggle').textContent = goingDark ? 'Light mode' : 'Dark mode';
});

async function startApp() {
  const savedProfile = await Store.get('meta', 'profile');
  if (savedProfile) {
    profile = { ...profile, ...savedProfile };
  }
  updateLevelBadge();
  showView('home');
}

startApp();
