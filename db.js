/**
 * PasteBin - Database initialization
 * Copyright (c) 2026 wenyinos. All rights reserved.
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.PASTE_DB_PATH || path.join(__dirname, 'database.sqlite');
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
    title TEXT,
    visibility TEXT NOT NULL DEFAULT 'public',
    expires_at DATETIME,
    burn_after_reading INTEGER NOT NULL DEFAULT 0,
    encrypted INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    hash TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    expires_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paste_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    handled_at DATETIME,
    handled_by INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`);

// 旧库补列：新增列统一在此登记，幂等执行（新库建表时已带，跳过）。
// 注意 ADD COLUMN 带 NOT NULL 必须给 DEFAULT，旧行读取时取该默认值。
const MIGRATIONS = [
  ['users', 'sso_uid', 'INTEGER'],
  ['users', 'bbs_gid', 'INTEGER'],
  ['pastes', 'title', 'TEXT'],
  ['pastes', 'visibility', "TEXT NOT NULL DEFAULT 'public'"],
  ['pastes', 'expires_at', 'DATETIME'],
  ['pastes', 'burn_after_reading', 'INTEGER NOT NULL DEFAULT 0'],
  ['pastes', 'encrypted', 'INTEGER NOT NULL DEFAULT 0'],
  ['pastes', 'views', 'INTEGER NOT NULL DEFAULT 0'],
];

for (const [table, column, type] of MIGRATIONS) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`[schema] 已补列 ${table}.${column}`);
  }
}

// 索引必须在补列之后创建：旧库的 pastes 表此时才拥有 visibility / expires_at 列
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_pastes_visibility_created ON pastes(visibility, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at);
`);

module.exports = db;
