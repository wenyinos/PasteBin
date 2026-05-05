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
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3331
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET not set, using random value (tokens will be invalidated on restart)');
}
const captchaStore = new Map();

function trimCaptchaStore(maxSize = 10000, targetSize = 9000) {
  if (captchaStore.size <= maxSize) return;
  while (captchaStore.size > targetSize) {
    const oldestKey = captchaStore.keys().next().value;
    if (!oldestKey) break;
    captchaStore.delete(oldestKey);
  }
}

function generateCaptcha() {
  trimCaptchaStore();
  const ops = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;

  switch (op) {
    case '+':
      a = Math.floor(Math.random() * 50) + 1;
      b = Math.floor(Math.random() * 50) + 1;
      answer = a + b;
      break;
    case '-':
      a = Math.floor(Math.random() * 50) + 10;
      b = Math.floor(Math.random() * a) + 1;
      answer = a - b;
      break;
    case '×':
      a = Math.floor(Math.random() * 12) + 2;
      b = Math.floor(Math.random() * 12) + 2;
      answer = a * b;
      break;
  }

  const key = crypto.randomBytes(8).toString('hex');
  captchaStore.set(key, { answer, attempts: 0 });
  setTimeout(() => captchaStore.delete(key), 300000);
  return { key, question: `${a} ${op} ${b} = ?` };
}

function generateShortCode() {
  return crypto.randomBytes(8).toString('hex');
}

// 安全头 - 手动设置（避免 helmet 对 CSP 的限制）
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; " +
    "script-src-attr 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; " +
    "font-src 'self' cdn.jsdelivr.net data:; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "base-uri 'self'; " +
    "form-action 'self'; " +
    "frame-ancestors 'self'; " +
    "object-src 'none'"
  );
  next();
});

// CORS 配置 - 限制允许的来源
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3331').split(',');
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '512kb' }));

// 速率限制 - 认证接口防暴力破解
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '请求过于频繁，请稍后再试' }
});
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

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
  const entry = captchaStore.get(key);
  if (!entry) return false;

  entry.attempts += 1;
  const ok = parseInt(answer, 10) === entry.answer;
  if (ok || entry.attempts >= 5) captchaStore.delete(key);
  return ok;
};

app.post('/api/register', async (req, res) => {
  const { username, password, captchaKey, captchaAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 32) {
    return res.status(400).json({ error: '用户名长度需在3-32个字符之间' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: '密码至少需要8个字符' });
  }
  if (!captchaKey || !captchaAnswer || !verifyCaptcha(captchaKey, captchaAnswer)) {
    return res.status(400).json({ error: '验证码错误' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username.trim(), hashed);
    res.json({ message: '注册成功', userId: result.lastInsertRowid });
  } catch (err) {
    // 统一错误消息，防止用户名枚举
    res.status(400).json({ error: '注册失败，请稍后重试' });
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
  const allowedLanguages = ['plaintext', 'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'c', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'markdown', 'sql', 'bash', 'powershell', 'dockerfile'];
  if (!content || typeof content !== 'string') return res.status(400).json({ error: '内容不能为空' });
  if (content.length > 100000) return res.status(400).json({ error: '内容不能超过100KB' });
  if (!allowedLanguages.includes(language)) return res.status(400).json({ error: '不支持的语言类型' });
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

// 全局错误处理 (Express v5)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
