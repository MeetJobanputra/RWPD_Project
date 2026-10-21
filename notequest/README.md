# NoteQuest (working title)

Notion-style notes with game-based revision. Frontend only: HTML, CSS, plain JavaScript and Bootstrap 5.3.
No backend and no database server. Everything is stored in the browser (IndexedDB).

## Run
Open `index.html` in Chrome or Edge (needs internet for the Bootstrap CDN).
A local server is still the better habit: VS Code "Live Server", or `python -m http.server 8000` and open http://localhost:8000

## Files
- `index.html`   page shell, navbar, script tags
- `css/style.css` theme on top of Bootstrap, bento grid, notes workspace, play arena
- `js/db.js`     IndexedDB helper (pages, cards, files, meta)
- `js/notes.js`  page tree, block editor, highlight -> card, source file upload
- `js/game.js`   boss battle quiz and Leitner scheduling
- `js/app.js`    navigation, XP / streak / daily quest, bento home

Scripts load in that order and share plain global functions, so there is no build step.

## Next
Search, templates, trash, more game modes, PDF/PPTX text extraction, backup/restore, optional LLM quiz mode.
