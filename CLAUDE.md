# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` or `node server.js` (port 3331)
- **Install deps:** `npm install`
- No test suite, linter, or type checker is configured

## Architecture

Three source files, no build step:

| File | Role |
|------|------|
| `server.js` | All backend logic — Express app, API routes, auth middleware, CAPTCHA, static serving |
| `db.js` | SQLite schema init via better-sqlite3; creates `database.sqlite` at project root on first run |
| `public/index.html` | Entire frontend SPA — inline HTML, CSS, JS (Bootstrap 5 + Prism.js from CDN) |

**Stack:** Express **v5.2** (not v4), better-sqlite3, bcryptjs, jsonwebtoken. Frontend is Chinese-language UI.

## Key Gotchas

- The language `<select>` has `id="pasteLanguage"`; a display `<span>` uses `id="displayPasteLanguage"`. Do **not** reuse `pasteLanguage` for new display elements — the ID conflict previously broke language selection.
- `updateNav()` parses JWT via `atob(token.split('.')[1])` — can throw on stale/invalid tokens in localStorage. Always wrap in try-catch or page JS silently breaks on load.
- `loadPublicPaste` and `loadAllPastes` must explicitly toggle visibility of both `#mainSection` and `#publicView`. Omitting either toggle causes blank pages.
- Prism.js class on `<code>` must be set as `language-{lang}` using `classList.add` after clearing `className`; direct `className` assignment can miss base styling.
- Share link generation must include `window.location.pathname`, not just `origin`, or links break when served from a subpath.

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

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | Auto-generated, persisted to `.jwt-secret` | JWT signing secret |
| `ALLOWED_ORIGINS` | `http://localhost:3331` | Comma-separated CORS origins |

## Constraints

- Express v5.2 — route param syntax and error handler signature differ from v4
- JWT expiration: 24 hours
- Passwords: bcryptjs (pure JS, not native bcrypt)
- Security headers are set manually in server.js (not via `helmet`, which is listed in package.json but unused)
- `database.sqlite` and `.jwt-secret` are gitignored; the server blocks direct HTTP access to `.sqlite` files
