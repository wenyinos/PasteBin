/**
 * PasteBin - Simple pastebin application (wenyinos unified authentication)
 * Copyright (c) 2026 wenyinos. All rights reserved.
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 统一认证配置（WY_SSO_*；密钥走 .env，不入库；无 .env 时可用环境变量）
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { /* 无 .env 文件时忽略 */ }
const SSO = {
  enabled: (process.env.WY_SSO_ENABLED || 'true').toLowerCase() !== 'false',
  apiUrl: process.env.WY_SSO_API_URL || '',
  appId: process.env.WY_SSO_APP_ID || 'paste',
  secret: process.env.WY_SSO_SECRET || '',
  timeout: parseInt(process.env.WY_SSO_TIMEOUT || '3', 10),
  loginUrl: process.env.WY_SSO_LOGIN_URL || '',
  logoutUrl: process.env.WY_SSO_LOGOUT_URL || '',
};

const app = express();
const PORT = parseInt(process.env.PORT || '3331', 10);

// JWT Secret: 环境变量 > 持久化文件 > 自动生成并保存
const JWT_SECRET_FILE = path.join(__dirname, '.jwt-secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  try {
    JWT_SECRET = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
  } catch {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(JWT_SECRET_FILE, JWT_SECRET);
    console.log('Generated new JWT_SECRET and saved to .jwt-secret');
  }
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
    "script-src 'self' 'unsafe-inline'; " +
    "script-src-attr 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "font-src 'self' data:; " +
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

// 速率限制 - SSO 兑换接口防滥用
const ssoLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: '请求过于频繁，请稍后再试' }
});
app.use('/api/sso', ssoLimiter);

// Block database access
app.use((req, res, next) => {
  if (req.path.endsWith('.sqlite') || req.path.includes('database.sqlite')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// ======================== 统一认证（wenyinos auth center） ========================

// 调用中心 API；HMAC-SHA256 签名，格式与认证中心 /auth/api.php 验签一致
// 返回解析后的响应对象；网络不可达/超时返回 null（降级语义）
async function ssoApi(action, data) {
  if (!SSO.apiUrl || !SSO.secret) return null;
  const body = JSON.stringify({ action, data });
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(8).toString('hex');
  const sign = crypto.createHmac('sha256', SSO.secret)
    .update(`${SSO.appId}|${action}|${crypto.createHash('md5').update(body).digest('hex')}|${timestamp}|${nonce}`)
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SSO.timeout * 1000);
  try {
    const res = await fetch(SSO.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wy-App': SSO.appId,
        'X-Wy-Timestamp': String(timestamp),
        'X-Wy-Nonce': nonce,
        'X-Wy-Sign': sign,
      },
      body,
      signal: controller.signal,
    });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 读取请求 cookie（零依赖；wy_auth 为中心票据，HttpOnly 仅服务端可读）
function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

// 用户 upsert（中心权威）：按中心 uid 找到或存量用户按用户名绑定；不存在则建档
function ssoUpsertUser(data) {
  let user = db.prepare('SELECT * FROM users WHERE sso_uid = ?').get(data.uid);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(data.username);
    if (user) db.prepare('UPDATE users SET sso_uid = ? WHERE id = ?').run(data.uid, user.id);
  }
  if (!user) {
    const result = db.prepare('INSERT INTO users (username, password, sso_uid) VALUES (?, ?, ?)').run(data.username, '', data.uid);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }
  return user;
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
}

// 单点登出轻量校验（M-2）：写操作每 30 分钟校验一次中心票据有效性
// 返回：0=有效；1xxx=业务拒绝（未开通等，需定向中心）；-1=票据失效（本地登出）；null=无票据/中心不可达（静默放行）
const lastTicketCheck = new Map();
async function checkTicket(req) {
  const ticket = getCookie(req, 'wy_auth');
  if (!ticket) return null;
  const resp = await ssoApi('ticket', { ticket });
  if (resp === null) return null;
  const code = parseInt(resp.code, 10);
  if (code === 0) return 0;
  if (code > 0 && code < 2000) return code;
  return -1;
}

// Auth middleware
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).id;
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (SSO.enabled && ['POST', 'DELETE', 'PUT'].includes(req.method)) {
    const now = Date.now();
    if (now - (lastTicketCheck.get(req.userId) || 0) > 30 * 60 * 1000) {
      lastTicketCheck.set(req.userId, now);
      const t = await checkTicket(req);
      if (t !== null && t !== 0) {
        lastTicketCheck.delete(req.userId);
        if (t > 0) return res.status(403).json({ error: '该账号未开通本站访问', loginUrl: SSO.loginUrl });
        return res.status(401).json({ error: '登录已失效，请重新登录', relogin: true });
      }
    }
  }
  next();
};

// ======================== Routes ========================

// 前端配置（登录/退出跳转地址；SSO 是否启用）
app.get('/api/config', (req, res) => {
  res.json({ ssoEnabled: SSO.enabled, loginUrl: SSO.loginUrl, logoutUrl: SSO.logoutUrl });
});

// 统一认证：票据兑换（服务端读 wy_auth cookie → 中心 ticket API → 签发本地 JWT）
app.get('/api/sso', async (req, res) => {
  if (!SSO.enabled || !SSO.apiUrl || !SSO.secret) return res.status(403).json({ error: '统一认证未启用' });

  const ticket = getCookie(req, 'wy_auth');
  if (!ticket) return res.status(401).json({ error: '无登录票据' });

  const resp = await ssoApi('ticket', { ticket });
  if (resp === null) return res.status(503).json({ error: '认证中心不可达，请稍后重试' });

  const code = parseInt(resp.code, 10);
  if (code !== 0) {
    if (code > 0 && code < 2000) return res.status(403).json({ error: '该账号未开通本站访问', loginUrl: SSO.loginUrl });
    return res.status(401).json({ error: '票据无效或已过期' });
  }

  const user = ssoUpsertUser(resp.data);
  res.json({ token: signToken(user), username: user.username });
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
