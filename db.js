/**
 * PasteBin - Database initialization
 * Copyright (c) 2026 wenyinos. All rights reserved.
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pastes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    short_code TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    language TEXT DEFAULT 'plaintext',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

module.exports = db;