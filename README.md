# Code PasteBin

A clean and practical code snippet sharing platform (single-file backend + single-page frontend).

Authentication is delegated to the community auth center — this app stores no local passwords.

## Features

### Content

- Create snippets with optional **title**, **language**, and **expiration** (never / 10m / 1h / 1d / 1w / 1M / 1y, configurable)
- **Visibility levels**: public (listed), unlisted (link-only), private (author only)
- **Burn after reading**: recipients get a confirmation prompt; the snippet is destroyed on reveal. Authors can re-read their own snippets without destroying them
- **Client-side encryption**: content is encrypted in the browser (AES-GCM + PBKDF2) before upload — the server only ever stores ciphertext. The decryption key travels in the URL `#fragment`, which browsers never send to the server
- **Markdown rendering** with sanitization (GitHub-flavored tables, task lists, code blocks); external images are stripped
- Raw text view (`/raw/:code`) and file download (`/dl/:code`) for `curl`/tooling
- Per-snippet view counter (author's own visits excluded)

### Interface

- Prism.js syntax highlighting (25+ languages) with automatic downgrade for very large content
- Light / dark theme toggle (persisted, defaults to system preference)
- Keyboard shortcuts on the detail view: `r` raw, `c` copy, `y` copy link, `q` QR, `m` rendered view, `n` home, `?` help
- QR code for mobile access
- Line-range links (`?s=CODE&hl=10-20`) highlight and scroll to a specific range
- Search and pagination on the list (latest / mine)
- Sensitive-content warning before saving (local regex check for keys, tokens, private keys, ID numbers — advisory only, nothing is reported)
- Purple design system, fully self-hosted assets (fonts, CSS, JS) — no CDN

### Access

- Sign in via the auth center (SSO); local session is a JWT with 24-hour expiry
- **API tokens** for CLI / scripted use: create, list, and revoke from the nav bar. Plaintext is shown once; the server stores only a SHA-256 hash. Tokens do **not** expire on SSO sign-out — revoke them manually if leaked

### Community & moderation

- **Report** button on every snippet detail page (duplicate open reports from the same user are collapsed)
- **Admin panel** (visible only to accounts whose auth-center group id matches `PASTE_ADMIN_BBS_GID`, default `1`): usage statistics, open reports with dismiss/delete actions, and a full content list with deletion
- **Audit trail**: deletions (author, admin, expiry sweep), burn-after-reading reads and reports are all recorded in `audit_log`
- **Per-user purge** endpoint for handling account removal requests
- **Scheduled backups** (opt-in via `PASTE_BACKUP_DIR`) using SQLite's online backup API, keeping the newest N copies

## Quick Start

```bash
npm install
cp .env.example .env   # fill in the WY_SSO_* values
npm start              # http://localhost:3331
npm test               # end-to-end API tests (temporary database, safe to run)
```

## Configuration

All runtime configuration is read from the environment (`.env` is loaded at startup if present):

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP listen port | `3331` |
| `WY_SSO_*` | Auth center connection (see `.env.example`) | — |
| `JWT_SECRET` | JWT signing key; auto-generated into `.jwt-secret` if unset | random |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list | `http://localhost:3331` |
| `PASTE_DB_PATH` | SQLite file path | `./database.sqlite` |
| `PASTE_EXPIRATIONS` | Comma-separated expiration options in seconds (`0` = never) | `0,600,3600,86400,604800,2592000,31536000` |
| `PASTE_RATE_LIMIT_MAX` | Create requests per user per 10 minutes | `20` |
| `PASTE_PURGE_INTERVAL_MS` | Interval for sweeping expired snippets | `3600000` |
| `PASTE_TOKEN_TTL_DAYS` | API token lifetime in days | `90` |
| `PASTE_ADMIN_BBS_GID` | Auth-center group id treated as site admin | `1` |
| `PASTE_BACKUP_DIR` | Directory for scheduled backups (empty = disabled) | — |
| `PASTE_BACKUP_KEEP` | Number of backup copies to retain | `7` |
| `PASTE_BACKUP_INTERVAL_MS` | Backup interval | `86400000` |

## API Overview

Authenticated routes accept either a browser JWT or an API token (`paste_…`) via `Authorization: Bearer`.

| Method | Path | Auth |
|--------|------|------|
| GET | `/healthz` | No |
| GET | `/api/config` | No (feature flags, expiration options) |
| GET | `/api/sso` | No (center ticket exchange → local JWT; needs the `wy_auth` cookie) |
| POST | `/api/pastes` | Yes |
| GET | `/api/pastes` | Yes (own snippets, all visibility levels) |
| GET | `/api/pastes/all` | No (public feed; `?q=` `?lang=` `?page=` `?limit=`) |
| GET | `/api/paste/:shortCode` | No (private/unlisted require ownership) |
| POST | `/api/paste/:shortCode/burn` | No (confirm a burn-after-reading read) |
| GET | `/raw/:shortCode` | No |
| GET | `/dl/:shortCode` | No |
| DELETE | `/api/pastes/:id` | Yes (owner only) |
| GET / POST | `/api/tokens` | Yes (browser session only for creation) |
| DELETE | `/api/tokens/:id` | Yes (owner only) |
| POST | `/api/reports` | Yes |
| GET | `/api/admin/stats` | Admin |
| GET | `/api/admin/pastes` | Admin |
| DELETE | `/api/admin/pastes/:id` | Admin |
| GET | `/api/admin/reports` | Admin |
| POST | `/api/admin/reports/:id/resolve` | Admin |
| POST | `/api/admin/users/:id/purge` | Admin |

## Architecture

- Backend: `server.js` — Express 5, all routes and service logic; HMAC-signed auth-center client
- Database: `db.js` — SQLite schema with idempotent column migrations; `database.sqlite` auto-created on first run
- Frontend: `public/index.html` (markup), `public/js/app.js` (page logic), `public/css/theme.css` (design system), `public/js/vendor/` (self-hosted marked / DOMPurify / qrcode-generator)

## Security

- Unified authentication — no local passwords stored
- Single sign-out: write operations re-validate the center ticket every 30 minutes
- API tokens stored as SHA-256 hashes only; plaintext returned once
- Client-side encryption means the server cannot read encrypted snippets even if the database leaks
- Rate limiting on snippet creation and the SSO exchange endpoint
- CSP, `nosniff`, `X-Frame-Options`, strict referrer policy; the SQLite file is never served over HTTP
- Input validation and size limits (100KB per snippet)
- Advisory sensitive-content check runs entirely in the browser

## Deployment Notes

1. Install dependencies with `npm install`.
2. Create `.env` from `.env.example` and fill in the credentials issued by the auth center.
3. Set `JWT_SECRET` explicitly in production so sessions survive restarts.
4. Run behind a TLS-terminating reverse proxy and make sure it forwards `X-Forwarded-For` (rate limiting depends on it).
5. Node.js 20.12 or newer is required (uses `process.loadEnvFile`).
6. Back up `database.sqlite` before upgrades; schema migrations run automatically on startup.

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | Bootstrap 5, Prism.js, marked + DOMPurify, self-hosted woff2 fonts |
| Backend | Node.js, Express 5 |
| Database | SQLite (better-sqlite3) |
| Auth | jsonwebtoken + community auth center (SSO) |
| Tests | `node:test` (no extra dependencies) |

## License

GPL v3 © 2026 wenyinos
