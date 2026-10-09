# Code PasteBin

A clean and practical code snippet sharing platform (single-file backend + single-page frontend).

Live demo: https://paste.wenyinos.com

## Features

- Sign in with the wenyinos unified account (SSO via the auth center); local session via JWT (24-hour expiry)
- Create code snippets with short links (16-hex-digit short code)
- Browse latest 50 public snippets
- Prism.js syntax highlighting (25+ languages)
- Light / dark theme toggle (persisted, defaults to system preference)
- Purple design system styled after wenyinos.com
- Single sign-out (write operations re-validate the auth ticket)
- Responsive design, mobile-friendly
- Fully self-hosted assets (fonts, CSS, JS) — no CDN, works offline

## Unified Authentication

Login / registration / logout are all handled by the [wenyinos auth center](https://wenyinos.com/auth) — **no local passwords are stored**. Configure the center connection in `.env` (template: `.env.example`):

- `WY_SSO_API_URL` / `WY_SSO_APP_ID` (`paste`) / `WY_SSO_SECRET` — issued by the auth center admin
- `WY_SSO_LOGIN_URL` / `WY_SSO_LOGOUT_URL` — center login / logout pages

The browser carries the center's HttpOnly `wy_auth` ticket cookie; the backend exchanges it via `GET /api/sso` for a local JWT. Accounts **without access to this site are redirected back to the auth center** (where the panel shows the reason); when the center is unreachable, only public browsing works (no local fallback).

**Account switch / center sign-out take effect immediately**: the local JWT carries a ticket fingerprint that is compared against the current center ticket on every request — switching accounts switches the identity automatically; after a center sign-out the site logs out locally (falls back to guest browsing).

## Quick Start

```bash
npm install
cp .env.example .env   # fill in WY_SSO_* values
npm start
```

Default address: `http://localhost:3331`

## Architecture

- Backend: `server.js` (Express 5.2, all API and service logic; HMAC-signed auth-center client)
- Database: `db.js` initializes SQLite schema (`users.sso_uid` maps the center user id); `database.sqlite` auto-created on first run
- Frontend: `public/index.html` (markup + page JS), `public/css/theme.css` (design system), `public/js/theme.js` (theme toggle)

## API Overview

| Method | Path | Auth |
|--------|------|------|
| GET | /api/config | No (login/logout URLs) |
| GET | /api/sso | No (center ticket exchange → local JWT; requires `wy_auth` cookie) |
| POST | /api/pastes | JWT |
| GET | /api/pastes | JWT |
| GET | /api/pastes/all | No |
| GET | /api/paste/:shortCode | No |
| DELETE | /api/pastes/:id | JWT (owner only) |

## Security

- Unified authentication — no local passwords stored (native register/login removed)
- Single sign-out: write operations (POST/DELETE) re-validate the center ticket every 30 minutes
- HMAC-SHA256 signed auth-center API calls (timestamp window + anti-replay nonce)
- Rate limiting on the SSO exchange endpoint
- JWT secret auto-generated if not set (tokens invalidated on restart)
- CSP headers with inline script support
- Input validation and size limits (100KB per paste)

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | Bootstrap 5, Prism.js, Bootstrap Icons, self-hosted woff2 fonts |
| Backend | Node.js, Express 5.2 |
| Database | SQLite (better-sqlite3) |
| Auth | jsonwebtoken + wenyinos auth center (SSO) |

## License

GPL v3 © 2026 wenyinos
