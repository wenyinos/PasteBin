# AGENTS.md

## Commands

- **Start server:** `npm start` or `node server.js` (runs on port 3331)
- **Install deps:** `npm install`
- No test suite, no linter, no typecheck configured

## Architecture

- **Single-file backend:** `server.js` contains all Express routes and server logic
- **Database:** `db.js` initializes SQLite schema via better-sqlite3; file `database.sqlite` is auto-created at root on first run (gitignored)
- **Single-page frontend:** `public/index.html` contains all HTML, CSS, and JS (Bootstrap 5 + Prism.js)
- **No build step:** frontend is served statically as-is

## Key Gotchas

- The `<select>` for language has `id="pasteLanguage"`; there is also a display `<span>` with `id="displayPasteLanguage"`. Do **not** reuse `pasteLanguage` for any new display element — the ID conflict previously broke language selection.
- `updateNav()` parses JWT via `atob(token.split('.')[1])` — this can throw if localStorage contains a stale/invalid token. Always wrap in try-catch or the entire page JS will silently break on load.
- `loadPublicPaste` and `loadAllPastes` must explicitly toggle visibility of `#mainSection` and `#publicView`. Omitting either toggle causes the detail page to appear blank or "return to home".
- Prism.js class on `<code>` must be set as `language-{lang}` using `classList.add` after clearing `className`; simply assigning `className` can miss the `code` element's base styling.
- Share link generation must include `window.location.pathname`, not just `origin`, or links break when the app is served from a subpath.

## API Endpoints (all in server.js)

| Method | Path | Auth |
|--------|------|------|
| POST | /api/register | No (requires CAPTCHA) |
| POST | /api/login | No (requires CAPTCHA) |
| GET | /api/captcha | No |
| POST | /api/pastes | JWT |
| GET | /api/pastes | JWT |
| GET | /api/pastes/all | No |
| GET | /api/paste/:shortCode | No |
| DELETE | /api/pastes/:id | JWT (owner only) |

## Constraints

- Express v5.2 — route parameter syntax and error handling differ from v4
- JWT expiration: 24 hours
- Passwords: bcryptjs (not native bcrypt)
- Database access: server blocks direct `.sqlite` file access via route guard
