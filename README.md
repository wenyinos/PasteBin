# Code PasteBin

A clean and practical code snippet sharing platform (single-file backend + single-page frontend).

<p align="center">
  <img src="public/favicon/favicon-32x32.png" alt="Code PasteBin Logo" width="64" height="64">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js"></a>
  <a href="README.zh.md"><img src="https://img.shields.io/badge/语言-中文-blue" alt="中文"></a>
</p>

Live demo: https://paste.wenyinos.com

## Features

- User registration / login (JWT, 24-hour expiry)
- Create code snippets with short links (8-hex-digit short code)
- Browse latest 50 public snippets
- Prism.js syntax highlighting (multiple languages)
- CAPTCHA (math puzzle) for registration / login protection
- Responsive design, mobile-friendly

## Quick Start

```bash
npm install
npm start
# or
node server.js
```

Default address: `http://localhost:3331`

## Available Commands

- Install dependencies: `npm install`
- Start server: `npm start`
- Direct start: `node server.js`

Note: This project does not currently have test suites, linters, or typecheck configured.

## Architecture

- Backend: `server.js` (Express 5.2, all API and service logic in this file)
- Database: `db.js` initializes SQLite schema; `database.sqlite` is auto-created on first run
- Frontend: `public/index.html` (single-page app containing HTML/CSS/JS)
- Build: No build step — static files served directly by Express

## API Overview

| Method | Path | Auth |
|--------|------|------|
| POST   | /api/register | No (requires CAPTCHA) |
| POST   | /api/login    | No (requires CAPTCHA) |
| GET    | /api/captcha  | No |
| POST   | /api/pastes   | JWT |
| GET    | /api/pastes   | JWT |
| GET    | /api/pastes/all | No |
| GET    | /api/paste/:shortCode | No |
| DELETE | /api/pastes/:id | JWT (owner only) |

## Database Schema

`users`
- `id`, `username`(unique), `password`, `created_at`

`pastes`
- `id`, `user_id`, `short_code`(unique), `content`, `language`, `created_at`

## Frontend Development Notes

- The language `<select>` uses `id="pasteLanguage"`; the display label uses `id="displayPasteLanguage"` — do not reuse the same id.
- `updateNav()` must wrap JWT parsing in `try...catch`, otherwise a stale local token will break the entire page script.
- Both `loadPublicPaste` and `loadAllPastes` must explicitly toggle visibility of `#mainSection` and `#publicView`.
- For Prism highlighting, clear the `<code>` element's `className` first, then use `classList.add('language-{lang}')`.
- Share links must include `window.location.pathname`, not just `origin`, otherwise links break when deployed under a subpath.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | Bootstrap 5, Prism.js, Bootstrap Icons |
| Backend  | Node.js, Express 5.2 |
| Database | SQLite (better-sqlite3) |
| Auth     | jsonwebtoken, bcryptjs |

## Directory Structure

```text
PasteBin/
├── public/              # Single-page frontend assets
├── db.js                # SQLite initialization
├── server.js            # Backend server & API
├── package.json         # Dependencies & scripts
└── database.sqlite      # Auto-generated on first run (gitignored)
```

## Security & Constraints

- JWT expiration: 24h
- Password hashing: `bcryptjs`
- Server explicitly blocks direct access to `.sqlite` database file
- Express v5 routing/error-handling semantics differ from v4 — be mindful when extending routes

## License

GPL v3 © 2026 wenyinos
