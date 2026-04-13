# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a simple pastebin application built with Node.js/Express and SQLite. The application allows users to register, login (with JWT authentication), create code snippets with syntax highlighting, and share them via short URLs. The frontend is built with Bootstrap 5 and Prism.js for syntax highlighting.

## Common Commands

### Starting the Application
```bash
npm start
# Or alternatively:
node server.js
```

The application will run on port 3331 by default.

### Installing Dependencies
```bash
npm install
```

### Database
The application uses SQLite with better-sqlite3. The database file is automatically created as `database.sqlite` in the root directory when the application starts.

## Architecture Overview

### Backend Structure
- `server.js`: Main Express application file containing all routes and server logic
- `db.js`: Database initialization and schema setup using better-sqlite3

### Frontend Structure
- `public/index.html`: Single page application with all frontend code (HTML, CSS, JavaScript)
- `public/favicon/`: Favicon assets

### Key Features
1. User authentication with registration/login using bcrypt password hashing and JWT tokens
2. CAPTCHA protection for registration and login (simple math problems)
3. Code snippet creation with 26 programming language syntax highlighting
4. Public sharing via short codes (8-character hex strings)
5. User can delete their own snippets
6. Responsive UI with Bootstrap 5

### API Endpoints
- Authentication: POST /api/register, POST /api/login
- CAPTCHA: GET /api/captcha
- Snippets: POST /api/pastes, GET /api/pastes, GET /api/pastes/all, GET /api/paste/:shortCode, DELETE /api/pastes/:id

### Security Measures
- Passwords hashed with bcrypt
- JWT tokens for authentication (24-hour expiration)
- CAPTCHA verification for auth endpoints
- Database access restriction (blocks direct .sqlite file access)
- CORS configuration

### Technologies Used
- Backend: Node.js, Express.js v5.2
- Database: better-sqlite3 v12.8
- Authentication: jsonwebtoken v9.0, bcryptjs v3.0
- Frontend: Bootstrap 5.3, Prism.js v1.29, Bootstrap Icons v1.11