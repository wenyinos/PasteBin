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

// 统一认证映射列（sso_uid = 认证中心用户 uid；新库直接带上，旧库自动补列）
const userColumns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('sso_uid')) {
  db.exec('ALTER TABLE users ADD COLUMN sso_uid INTEGER');
  console.log('Added users.sso_uid column for unified authentication');
}

module.exports = db;
