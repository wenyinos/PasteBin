/**
 * PasteBin - Simple pastebin application
 * Copyright (c) 2026 wenyinos. All rights reserved.
 */

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const path = require('path');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'pastebin-secret-key-2024';
const captchaStore = new Map();

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const op = Math.random() > 0.5 ? '+' : '-';
  const answer = op === '+' ? a + b : a - b;
  const key = crypto.randomBytes(8).toString('hex');
  captchaStore.set(key, answer);
  setTimeout(() => captchaStore.delete(key), 300000);
  return { key, question: `${a} ${op} ${b} = ?` };
}

function generateShortCode() {
  return crypto.randomBytes(4).toString('hex');
}

app.use(cors());
app.use(express.json());

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Block database access
app.use((req, res, next) => {
  if (req.path.endsWith('.sqlite') || req.path.includes('database.sqlite')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/api/captcha', (req, res) => {
  const captcha = generateCaptcha();
  res.json({ key: captcha.key, question: captcha.question });
});

// Verify captcha
const verifyCaptcha = (key, answer) => {
  const stored = captchaStore.get(key);
  if (!stored) return false;
  return parseInt(answer) === stored;
};

app.post('/api/register', async (req, res) => {
  const { username, password, captchaKey, captchaAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!captchaKey || !captchaAnswer || !verifyCaptcha(captchaKey, captchaAnswer)) {
    return res.status(400).json({ error: 'Invalid captcha' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashed);
    res.json({ message: 'User created', userId: result.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') res.status(400).json({ error: 'Username already exists' });
    else res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password, captchaKey, captchaAnswer } = req.body;
  if (!captchaKey || !captchaAnswer || !verifyCaptcha(captchaKey, captchaAnswer)) {
    return res.status(400).json({ error: 'Invalid captcha' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  res.json({ token: jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' }), username: user.username });
});

app.get('/api/pastes', authenticate, (req, res) => {
  res.json(db.prepare('SELECT id, short_code, content, language, created_at FROM pastes WHERE user_id = ? ORDER BY created_at DESC').all(req.userId));
});

app.get('/api/pastes/all', (req, res) => {
  res.json(db.prepare(`SELECT p.id, p.short_code, p.content, p.language, p.created_at, u.username FROM pastes p JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 50`).all());
});

app.post('/api/pastes', authenticate, (req, res) => {
  const { content, language = 'plaintext' } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const shortCode = generateShortCode();
  const result = db.prepare('INSERT INTO pastes (user_id, short_code, content, language) VALUES (?, ?, ?, ?)').run(req.userId, shortCode, content, language);
  res.json({ id: result.lastInsertRowid, short_code: shortCode, content, language, created_at: new Date().toISOString() });
});

app.get('/api/paste/:shortCode', (req, res) => {
  const paste = db.prepare(`SELECT p.id, p.short_code, p.content, p.language, p.created_at, u.username FROM pastes p JOIN users u ON p.user_id = u.id WHERE p.short_code = ?`).get(req.params.shortCode);
  if (!paste) return res.status(404).json({ error: 'Paste not found' });
  res.json(paste);
});

app.delete('/api/pastes/:id', authenticate, (req, res) => {
  const result = db.prepare('DELETE FROM pastes WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Paste not found' });
  res.json({ message: 'Deleted' });
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));