# AGENTS.md

## Commands

- **Start server:** `npm start` or `node server.js` (runs on port 3331)
- **Install deps:** `npm install`
- No test suite, no linter, no typecheck configured

## Architecture

- **Single-file backend:** `server.js` contains all Express routes and server logic
- **Database:** `db.js` initializes SQLite schema via better-sqlite3; file `database.sqlite` is auto-created at root on first run (gitignored)
- **Single-page frontend:** `public/index.html` holds markup and page JS; all custom styles live in `public/css/theme.css` (purple design system modeled on wenyinos.com; Bootstrap 5.0.1 + Prism.js underneath)
- **Theme system:** light/dark switched via `html[data-theme]`; `public/js/theme.js` handles the toggle. Choice persists in `localStorage('theme')`, defaults to `prefers-color-scheme`; an inline `<head>` script applies it before first paint to avoid flashing.
- **Fonts:** self-hosted woff2 in `public/fonts/` (Questrial, Noto Sans SC 400/500/700, Noto Serif SC 700, Fira Code). Never introduce CDN/online assets — the CSP allows `'self'` only.
- **No build step:** frontend is served statically as-is

## Key Gotchas

- The `<select>` for language has `id="pasteLanguage"`; there is also a display `<span>` with `id="displayPasteLanguage"`. Do **not** reuse `pasteLanguage` for any new display element — the ID conflict previously broke language selection.
- `updateNav()` parses JWT via `atob(token.split('.')[1])` — this can throw if localStorage contains a stale/invalid token. Always wrap in try-catch or the entire page JS will silently break on load.
- `loadPublicPaste` and `loadAllPastes` must explicitly toggle visibility of `#mainSection` and `#publicView`. Omitting either toggle causes the detail page to appear blank or "return to home".
- New UI colors must use the CSS custom properties in `theme.css` (`--purple-primary`, `--text-ink`, `--card-bg`, `--border-soft`, ...). Hardcoded colors will break one of the two modes.
- Navbar buttons use `.btn-nav-ghost` / `.btn-nav-solid` instead of Bootstrap `.btn-*` — white-on-purple in the gradient navbar, with color-scheme overrides for the mobile collapse panel (which sits on a light card background).
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
