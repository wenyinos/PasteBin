# GEMINI.md - Project Context & Instructions

This file provides foundational context and instructions for Gemini CLI when working in this repository.

## Project Overview

**Code PasteBin** is a lightweight, visually polished code sharing platform. It features user authentication, syntax highlighting for 26+ languages, and public sharing via short URLs.

- **Architecture:** Node.js/Express backend with a SQLite database and a single-page static frontend.
- **Primary Tech Stack:** Node.js, Express 5.2, better-sqlite3, JWT, bcryptjs, Bootstrap 5.3, Prism.js 1.29.

## Building and Running

### Development Commands
- **Install dependencies:** `npm install`
- **Start the server:** `npm start` (Runs on `http://localhost:3331` by default)

### Environment & Database
- The application uses **Express v5.2**. Note that route parameter syntax and error handling may differ slightly from v4.
- **SQLite** is used for persistence. `database.sqlite` is automatically created in the root directory on the first run.
- **JWT_SECRET** is currently hardcoded in `server.js`.

## Project Structure

- `server.js`: Main Express application (routes, auth, and logic).
- `db.js`: Database initialization and schema management.
- `public/`: Static frontend assets.
    - `index.html`: The entire SPA (HTML, CSS, and JS).
    - `js/`, `css/`, `fonts/`, `favicon/`: Third-party assets and icons.

## Development Conventions & Critical Gotchas

### Backend (server.js)
- **Auth Middleware:** Use the `authenticate` function to protect routes. It expects a Bearer token in the `Authorization` header.
- **Security:**
    - Passwords must be hashed using `bcryptjs`.
    - A route guard blocks direct access to `.sqlite` files.
    - Math-based CAPTCHA is required for register/login endpoints.

### Frontend (public/index.html)
- **ID Management:** Do **not** reuse the ID `pasteLanguage`. It is reserved for the language selection dropdown. Using it for display elements will break language selection logic.
- **JWT Parsing:** Always wrap `atob()` calls for JWT parsing (in `updateNav`) in a `try-catch` block to handle stale or invalid tokens in `localStorage`.
- **View Toggling:** When switching views (e.g., `loadPublicPaste`), you must explicitly toggle both `#mainSection` and `#publicView` visibility.
- **Syntax Highlighting:** When applying Prism.js highlighting, use `element.classList.add('language-' + lang)` after clearing existing classes to ensure base styling is preserved.
- **Link Generation:** Always include `window.location.pathname` when generating share links to support deployments on subpaths.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/captcha` | No | Get math CAPTCHA question |
| POST | `/api/register` | No | Register new user (requires CAPTCHA) |
| POST | `/api/login` | No | Login (requires CAPTCHA) |
| GET | `/api/pastes` | JWT | Get current user's pastes |
| GET | `/api/pastes/all` | No | Get 50 most recent public pastes |
| POST | `/api/pastes` | JWT | Create a new paste |
| GET | `/api/paste/:shortCode`| No | Retrieve a specific paste |
| DELETE | `/api/pastes/:id` | JWT | Delete a paste (owner only) |
