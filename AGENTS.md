# AGENTS.md

## Commands

- **Start server:** `npm start` or `node server.js` (port 3331)
- **Install deps:** `npm install`
- **Tests:** `npm test` (`node --test`, uses a temporary DB via `PASTE_DB_PATH`)
- No linter or typecheck configured

## Architecture

- **Single-file backend:** `server.js` contains all Express routes and server logic
- **Database:** `db.js` initializes SQLite schema via better-sqlite3; file `database.sqlite` is auto-created at root on first run (gitignored). New columns are added through the idempotent `MIGRATIONS` list.
- **Single-page frontend:** `public/index.html` holds markup only; page logic lives in `public/js/app.js`; all custom styles in `public/css/theme.css` (purple design system; Bootstrap 5.0.1 + Prism.js underneath)
- **Vendored libraries:** `public/js/vendor/` holds marked (Markdown), DOMPurify (sanitizing), and qrcode-generator. Never reference a CDN — the CSP allows `'self'` only.
- **Theme system:** light/dark switched via `html[data-theme]`; a small inline `<head>` script in `index.html` applies the stored preference before first paint (keep it inline — deferring causes a flash). `public/js/theme.js` handles the toggle.
- **Fonts:** self-hosted woff2 in `public/fonts/` (Questrial, Noto Sans SC, Noto Serif SC, Fira Code)
- **No build step:** frontend is served statically as-is

## Key Gotchas

### Frontend

- All body scripts use `defer`, and `app.js` **must come last** — it calls `marked`, `DOMPurify`, and `qrcode` at runtime. Adding a new vendor script means inserting it *before* `app.js`.
- The `<select>` for language has `id="pasteLanguage"`; there is also a display `<span>` with `id="displayPasteLanguage"`. Do **not** reuse `pasteLanguage` for a new display element — the ID conflict previously broke language selection.
- `updateNav()` parses JWT via `atob(token.split('.')[1])` — this can throw if localStorage holds a stale/invalid token. Always wrap in try-catch or the entire page JS silently breaks on load.
- `loadPublicPaste` and `loadAllPastes` must explicitly toggle visibility of `#mainSection` and `#publicView`. Omitting either toggle causes the detail page to appear blank or "return to home".
- New UI colors must use the CSS custom properties in `theme.css` (`--purple-primary`, `--text-ink`, `--card-bg`, `--border-soft`, ...). Hardcoded colors break one of the two modes.
- Navbar buttons use `.btn-nav-ghost` / `.btn-nav-solid` instead of Bootstrap `.btn-*`.
- Prism.js class on `<code>` must be set as `language-{lang}` using `classList.add` after clearing `className`.
- Share links must include `window.location.pathname`, not just `origin`, or links break when served from a subpath.
- List rendering uses `insertAdjacentHTML` with a template that escapes **every** user-controlled field via `escapeHtml()` (title / username / preview / language label). Any new interpolated field must be escaped too.
- Delete buttons in list items use `data-del` + event delegation, not inline `onclick` — keep it that way so the CSP can eventually drop `'unsafe-inline'`.

### Encryption (client-side, zero-knowledge)

- Content is encrypted in the browser (AES-GCM, PBKDF2-SHA256, 150k iterations). `nonce`/salt travel inside the base64 payload as `salt(16) || iv(12) || ciphertext`.
- The decryption key travels in the URL **`#fragment`** — browsers never send it to the server. Do not move it into a query parameter.
- The share-link label deliberately hides the fragment (`分享链接（含解密密钥，已隐藏）`) so screenshots/screen shares don't leak the key. Keep the full URL only on the `href`/clipboard action.
- **`crypto.subtle` requires a secure context.** Production is HTTPS and `localhost` works, but an HTTP dev domain (e.g. one served through a local reverse proxy) does **not** — test encryption via `localhost:3331`. In an insecure context the encrypt toggle refuses to turn on.
- The server never decrypts. `preview` for encrypted rows is the literal placeholder `[已加密]`; the detail API returns the raw ciphertext.

### Burn after reading

- Non-authors get `{needs_confirmation: true}` first; the body is delivered (and the row deleted) only by `POST /api/paste/:code/burn`.
- **Authors can re-read their own burn-after-reading snippets** without destroying them (otherwise a single self-view would lose the content).
- `/raw/:code` and `/dl/:code` destroy on read with no confirmation step — a "read without burning" path would be a bypass. Concurrency safety comes from `DELETE ... changes === 1`.
- Burn-after-reading rows are excluded from the public feed but still appear in the author's own list.

### Data & time

- SQLite stores `CURRENT_TIMESTAMP` / `datetime('now')` as UTC in `'YYYY-MM-DD HH:MM:SS'` (second precision, no timezone). ISO strings from JS (`toISOString()`) will **not** compare correctly against them — always compute expiry in SQL (`datetime('now', '+N seconds')`).
- API responses convert to ISO 8601 with a trailing `Z` (`strftime` or `toIso()`), otherwise the frontend parses the timestamp as local time and shows an 8-hour offset.
- `visibility` filtering exists in `readPaste()` and in the `/api/pastes/all` query. **Any new read path must apply it too** — a missed filter leaks private/unlisted content.
- Cross-visibility rule: unauthorized reads return **404, never 403** (don't reveal that a code exists).

### Schema changes

- Add new columns to the `MIGRATIONS` array in `db.js` (idempotent `PRAGMA table_info` check + `ALTER TABLE`).
- **Create indexes only after the column migrations run** — putting `CREATE INDEX ... ON pastes(visibility)` in the initial `db.exec` block crashes startup on existing databases where the column doesn't exist yet.

### Security & ops

- `process.loadEnvFile` must run **before** `require('./db')` in `server.js`; `db.js` reads `PASTE_DB_PATH` at require time. `loadEnvFile` does not override already-set environment variables, which is what makes the test suite safe.
- Tests must always inject `PASTE_DB_PATH` pointing at a temp file. Never point a test at `database.sqlite`.
- `express-rate-limit` v8: when keying by IP inside a custom `keyGenerator`, use `rateLimit.ipKeyGenerator(req.ip)` (normalizes IPv6 subnets).
- API tokens are stored as SHA-256 hashes; the plaintext is returned exactly once. Token requests skip SSO ticket reconciliation (no browser cookie) — this is a deliberate, documented trade-off.
- Rate limiting depends on `X-Forwarded-For`; `trust proxy` is set to `loopback`, so the reverse proxy must be on the same host.

### Moderation & audit

- Admin rights come from the auth center: `users.bbs_gid` is synced on every login inside `ssoUpsertUser()`, and `isAdmin()` compares it against `PASTE_ADMIN_BBS_GID` (default `1` = the center's super-admin group). No local role column, no hardcoded usernames.
- `audit_log` records author deletes, admin deletes, purge sweeps, burn reads and reports. `audit()` swallows write errors on purpose — logging must never break a request.
- Backups run only when `PASTE_BACKUP_DIR` is set; they use `db.backup()` (online backup, safe while serving) and roll off all but the newest `PASTE_BACKUP_KEEP` files.
- Admin endpoints are guarded by `requireAdmin` and must stay that way — they bypass the visibility rules by design.

## API Endpoints (all in server.js)

Authenticated routes accept a browser JWT **or** an API token (`paste_…`) in `Authorization: Bearer`.

| Method | Path | Auth |
|--------|------|------|
| GET | /healthz | No |
| GET | /api/config | No |
| GET | /api/sso | No (needs `wy_auth` cookie) |
| POST | /api/pastes | Yes |
| GET | /api/pastes | Yes (`?q=` `?lang=` `?page=` `?limit=`) |
| GET | /api/pastes/all | No (`?q=` `?lang=` `?page=` `?limit=`) |
| GET | /api/paste/:shortCode | No |
| POST | /api/paste/:shortCode/burn | No |
| GET | /raw/:shortCode | No |
| GET | /dl/:shortCode | No |
| DELETE | /api/pastes/:id | Yes (owner only) |
| GET | /api/tokens | Yes |
| POST | /api/tokens | Yes (browser session only) |
| DELETE | /api/tokens/:id | Yes (owner only) |
| POST | /api/reports | Yes |
| GET | /api/admin/stats | Admin |
| GET | /api/admin/pastes | Admin (ignores visibility) |
| DELETE | /api/admin/pastes/:id | Admin |
| GET | /api/admin/reports | Admin |
| POST | /api/admin/reports/:id/resolve | Admin |
| POST | /api/admin/users/:id/purge | Admin |

List endpoints return an envelope: `{ items: [...], hasMore: boolean }`.

## Constraints

- Express v5.2 — route parameter syntax and error handling differ from v4
- JWT expiration: 24 hours
- Authentication: unified SSO only (no local passwords); rate limiting applies to snippet creation and the SSO exchange
- Database access: server blocks direct `.sqlite` file access via route guard
- Node.js ≥ 20.12 required (`process.loadEnvFile`)
