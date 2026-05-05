# Code PasteBin

A clean and practical code snippet sharing platform (single-file backend + single-page frontend).

Live demo: https://paste.wenyinos.com

## Features

- User registration / login (JWT, 24-hour expiry)
- Create code snippets with short links (16-hex-digit short code)
- Browse latest 50 public snippets
- Prism.js syntax highlighting (25+ languages)
- CAPTCHA (arithmetic puzzle) for registration / login protection
- Responsive design, mobile-friendly

## Quick Start

```bash
npm install
npm start
```

Default address: `http://localhost:3331`

## Architecture

- Backend: `server.js` (Express 5.2, all API and service logic)
- Database: `db.js` initializes SQLite schema; `database.sqlite` auto-created on first run
- Frontend: `public/index.html` (single-page app with HTML/CSS/JS)

## API Overview

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

## Security

- JWT secret auto-generated if not set (tokens invalidated on restart)
- Password complexity enforced (min 8 characters)
- Rate limiting on auth endpoints (10 requests / 15 minutes)
- CSP headers with inline script support
- CSRF protection via Origin validation
- Input validation and size limits (100KB per paste)

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend | Bootstrap 5, Prism.js, Bootstrap Icons |
| Backend | Node.js, Express 5.2 |
| Database | SQLite (better-sqlite3) |
| Auth | jsonwebtoken, bcryptjs |

## License

GPL v3 © 2026 wenyinos
