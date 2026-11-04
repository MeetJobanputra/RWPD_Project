# FocusOS — Your notes become the game

A study website that turns your own notes and mind maps into a playable quiz.
Built with HTML5, CSS3, Bootstrap 5, vanilla JavaScript and the Canvas API.
No backend, no login, no paid APIs. Everything is stored in your browser.

## Run it

**Option A — quickest (works for everything except offline install)**
Double-click `index.html`. All features work. The service worker (offline caching) is skipped because browsers block it on `file://` pages.

**Option B — local server (recommended, enables offline mode)**
```bash
cd focusos
python3 -m http.server 8000        # Windows: python -m http.server 8000
```
Open http://localhost:8000. After the first load the status in the sidebar shows "Ready to work offline"; you can then disconnect from the internet and reload.
(Any static server works: `npx serve`, VS Code Live Server, etc.)

## Features

| Page | What it does |
|---|---|
| Dashboard | Greeting and date, real counts of notes / mind maps / quizzes completed, best score, quick actions, recent notes and recent quizzes. |
| My Notes | Create, edit, delete, search. Title, subject, tags. Grouped by subject with a subject filter. Auto-saves with a "Saved" indicator. Export one note or all notes as `.txt`. |
| Drawing Board | Canvas drawing with mouse, pen and touch. Colour, brush size, eraser, undo, clear, save to a gallery, reopen, download PNG. |
| Mind Maps | Central topic plus sub-topics. Add, rename, delete (with sub-topics), drag to move, pan and zoom. Per-topic "extra info". Custom question-and-answer pairs. Auto-save. **Start Quiz Battle** button. |
| Arena Mode | Turns a mind map into a multiple-choice quiz (solo or two-player duel). Timer, score, progress, feedback, results screen, restart/rematch, difficulty. |
| Leaderboard | Top players, quizzes played, recent results, reset with confirmation. Stored on this device only. |
| Settings & Backup | Player name, default difficulty, sound toggle, download / restore a JSON backup, delete all data. |

### How Arena Mode makes questions (and why nothing is invented)
Questions come only from your saved content:
1. **Connections** — "Which topic is directly connected under *X*?" and "Which topic is *Y* connected under?"
2. **Descriptions** — if a topic has "Extra info", "Which topic matches this description?"
3. **Your own pairs** — question, correct answer, and up to 3 wrong answers.

Wrong choices are always other topics or other answers from your own map. When fewer than four meaningful choices exist, fewer are shown. A map with only a central topic and no extras cannot make a quiz; the app tells you what to add.

### Scoring
100 points per correct answer + up to 50 speed bonus. Hard difficulty = 1.5× points. Timers: Easy 20 s, Normal 15 s, Hard 8 s.

### Controls
- Solo: keys `1`–`4`, or click/tap. `Enter` / `Space` for the next question.
- Duel (turn-based, one keyboard): Player 1 uses `A S D F`, Player 2 uses `J K L ;`. Only the player whose turn it is can answer. Duel uses an even number of questions so both players get the same count.

## Project structure
```
index.html          all pages (one HTML shell, hash routing: #/notes, #/arena …)
manifest.json       web app manifest (installable)
sw.js               service worker (offline cache)
css/style.css       all custom styling
js/storage.js       safe localStorage layer, data cleaning, backup/restore
js/ui.js            toasts, dialogs, downloads, formatting
js/quiz.js          mind map -> quiz question generator
js/notes.js         notes page
js/draw.js          drawing board (Canvas)
js/mindmap.js       mind map editor (SVG)
js/arena.js         quiz game, duel mode, results
js/leaderboard.js   leaderboard page
js/settings.js      settings and backup
js/app.js           router, dashboard, service worker registration
assets/             icons and the local Bootstrap CSS
```

## Data and privacy
Saved in `localStorage` under keys beginning `focusos:` (notes, mindmaps, drawings, results, settings). Nothing is sent anywhere. Corrupted or missing data falls back to empty defaults instead of crashing.

## Limitations (please read before presenting)
- **Browser storage is per browser and per address.** `http://localhost:8000` and `file://` have separate storage; Chrome and Firefox do not share data. Clearing site data erases everything, so use **Settings → Download backup**.
- Storage is limited (usually about 5 MB). Many large drawings can fill it; the app shows an error rather than failing silently.
- Offline mode needs a first visit over `http://localhost` or HTTPS, and a browser with service worker support. After editing any file, change `CACHE_NAME` in `sw.js` so the new version is picked up.
- The leaderboard is local, not global. Two-player duel is same-keyboard, turn-based only.
- Mind map zoom: mouse wheel and the +/− buttons. Two-finger pinch is not implemented.
- Bundled Bootstrap: the file `assets/vendor/bootstrap.min.css` is a Bootstrap 5.3.2 build (Bootswatch "Cerulean" variant) because the project was assembled without internet access. FocusOS only relies on its grid and utility classes and overrides the look. To use the official build, replace that file with `bootstrap.min.css` from getbootstrap.com.
- Private/incognito windows may block or erase storage when closed.

## Testing checklist
1. **Dashboard** starts at zero; counts change after steps below.
2. **Notes**: new note → type title/subject/tags/text → see "Saved". Search a tag. Reload; note persists. Export `.txt`. Delete (confirm).
3. **Drawing**: draw with mouse (and touch on a phone), change colour/size, eraser, undo, clear, Save, reload, Open from the gallery.
4. **Mind map**: New map "Cell" → select the centre → Add sub-topic ×3 → drag a node → scroll to zoom → reload and reopen. Add "Extra info" to one topic; add a custom Q&A with a wrong answer.
5. **Arena solo**: Start Quiz Battle → Start. Answer by key and by click; let one timer expire; finish; check score, accuracy, time.
6. **Arena duel**: choose Two-player duel, two different names. Confirm turns alternate and keys A S D F / J K L ; work. Check winner (or draw) and Rematch.
7. **Leaderboard**: results appear; Reset asks for confirmation.
8. **Backup**: download, delete all data, restore; everything returns. Try restoring a random `.json` file; it is rejected with a message.
9. **Offline**: via localhost, wait for "Ready to work offline", turn off Wi-Fi (or DevTools → Network → Offline), reload.
10. **Mobile**: narrow the window below 992 px; the ☰ button opens the sidebar.
