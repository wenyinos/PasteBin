/**
 * PasteBin - Simple pastebin application (wenyinos unified authentication)
 * Copyright (c) 2026 wenyinos. All rights reserved.
 */

const path = require('path');

// 环境变量必须在 require('./db') 之前加载：db.js 依赖 PASTE_DB_PATH 等配置。
// 文件不存在属正常（生产可直接用真实环境变量），其它错误需暴露而非静默吞掉。
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (e) {
  if (e.code !== 'ENOENT') console.warn('[env] .env 加载失败，将仅使用进程环境变量:', e.message);
}

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const rateLimit = require('express-rate-limit');

// 统一认证配置（WY_SSO_*；密钥走 .env，不入库；无 .env 时可用环境变量）
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
// 经 nginx 反向代理部署：信任本机回环代理，按 X-Forwarded-For 识别真实客户端 IP（限速依赖）
app.set('trust proxy', 'loopback');
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

// short_code：base62 8 字符（62^8 ≈ 2.18e14，足够 2 条存量与预期增长）。
// 拒绝采样消除 256 % 62 的模偏差；>= 248 的字节丢弃重取。
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 8;
const CODE_REJECT_FROM = 248;

function generateShortCode() {
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const b of crypto.randomBytes(CODE_LENGTH)) {
      if (code.length >= CODE_LENGTH) break;
      if (b < CODE_REJECT_FROM) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

// 插入并处理 short_code 碰撞：唯一约束冲突时换码重试，最多 5 次。
// expiresIn 为秒数，0 表示永不过期；过期时间交由 SQLite 计算，
// 保证与 datetime('now') 同为 UTC 且格式一致（字符串比较才成立）。
function insertPaste({ userId, content, language, title = null, visibility = 'public', expiresIn = 0, burnAfterReading = false, encrypted = false }) {
  for (let attempt = 0; ; attempt++) {
    const shortCode = generateShortCode();
    try {
      const result = db.prepare(
        `INSERT INTO pastes (user_id, short_code, content, language, title, visibility, expires_at, burn_after_reading, encrypted)
         VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN datetime('now', '+' || ? || ' seconds') ELSE NULL END, ?, ?)`
      ).run(userId, shortCode, content, language, title, visibility, expiresIn, expiresIn, burnAfterReading ? 1 : 0, encrypted ? 1 : 0);
      return { id: result.lastInsertRowid, short_code: shortCode };
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' && attempt < 4) continue;
      throw e;
    }
  }
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

// 速率限制 - 创建接口防灌库。登录用户按 userId 计（CLI 同机批量贴不被 NAT 邻居连累），
// 未登录回退按真实 IP 计（ipKeyGenerator 归一化 IPv6 子网）。
const createLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.PASTE_RATE_LIMIT_MAX || '20', 10),
  keyGenerator: (req) => (req.userId ? `u:${req.userId}` : `ip:${rateLimit.ipKeyGenerator(req.ip)}`),
  message: { error: '创建过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
  // bbs_gid 用于本站的管理员判定（见 isAdmin）；仅作数据同步，不参与认证判定
  const bbsGid = Number.isInteger(data.bbs_gid) ? data.bbs_gid : null;

  let user = db.prepare('SELECT * FROM users WHERE sso_uid = ?').get(data.uid);
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(data.username);
    if (user) db.prepare('UPDATE users SET sso_uid = ? WHERE id = ?').run(data.uid, user.id);
  }
  if (!user) {
    const result = db.prepare('INSERT INTO users (username, password, sso_uid, bbs_gid) VALUES (?, ?, ?, ?)').run(data.username, '', data.uid, bbsGid);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  } else if (bbsGid !== null && user.bbs_gid !== bbsGid) {
    // 每次登录同步组标识：中心调整权限后，用户下次登录即生效
    db.prepare('UPDATE users SET bbs_gid = ? WHERE id = ?').run(bbsGid, user.id);
    user.bbs_gid = bbsGid;
  }
  return user;
}

function signToken(user, ticket) {
  const payload = { id: user.id, username: user.username };
  if (ticket) payload.tk = crypto.createHash('md5').update(ticket).digest('hex');   // 票据指纹（供登录态一致性比对）
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
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

// 登录态一致性校准（账号切换 / 中心退出即时生效）：
// 比对本请求 wy_auth 指纹与 JWT 内票据指纹；不一致时重兑切换 / 本地登出 / 降级保持。
// 返回 action：ok=一致（零网络开销）；switched=已切换身份；unauth=本地登出；denied=准入被撤销；keep=中心不可达（降级）
async function reconcileSession(req, payload) {
  const cur = getCookie(req, 'wy_auth');
  const curHash = cur ? crypto.createHash('md5').update(cur).digest('hex') : '';
  const recHash = payload && payload.tk ? payload.tk : '';
  if (curHash === recHash) return { action: 'ok' };

  if (!cur) return { action: 'unauth' };   // 中心票据已清除（中心已退出）

  const resp = await ssoApi('ticket', { ticket: cur });
  if (resp === null) return { action: 'keep' };   // 中心不可达 → 保持现状（降级）

  const code = parseInt(resp.code, 10);
  if (code === 0) return { action: 'switched', user: ssoUpsertUser(resp.data), ticket: cur };
  if (code > 0 && code < 2000) return { action: 'denied' };
  return { action: 'unauth' };   // 票据无效/过期（2xxx）/协议异常（3xxx）
}

// ======================== API Token（供 CLI / 脚本长期调用） ========================

const TOKEN_PREFIX = 'paste_';
const TOKEN_TTL_DAYS = parseInt(process.env.PASTE_TOKEN_TTL_DAYS || '90', 10);
const TOKEN_MAX_PER_USER = 10;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// 校验 API Token 并刷新最近使用时间，返回 user_id 或 null。
// 注意：Token 请求不带浏览器票据，无法做中心侧校验（认证中心未提供按 uid 查询的接口），
// 因此中心封禁/登出不会使其即时失效——依赖 expires_at 与用户手动撤销兜底。
function userIdFromApiToken(raw) {
  const row = db
    .prepare(`SELECT id, user_id FROM api_tokens
              WHERE hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`)
    .get(hashToken(raw));
  if (!row) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return row.user_id;
}

// Auth middleware
const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // API Token 分支：跳过 SSO 票据一致性校准（CLI 场景无 cookie）
  if (token.startsWith(TOKEN_PREFIX)) {
    const uid = userIdFromApiToken(token);
    if (uid === null) return res.status(401).json({ error: 'Token 无效或已过期' });
    req.userId = uid;
    req.viaApiToken = true;
    return next();
  }

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.userId = payload.id;

  // 账号切换 / 中心退出的一致性校准（每个请求比对；票据一致时零网络开销）
  if (SSO.enabled) {
    const r = await reconcileSession(req, payload);
    if (r.action === 'unauth') return res.status(401).json({ error: '登录已失效，请重新登录', relogin: true });
    if (r.action === 'denied') return res.status(403).json({ error: '该账号未开通本站访问', loginUrl: SSO.loginUrl });
    if (r.action === 'switched') {
      req.userId = r.user.id;
      res.setHeader('X-New-Token', signToken(r.user, r.ticket));   // 前端静默续签（含切换后的用户名）
    }
  }

  if (SSO.enabled && ['POST', 'DELETE', 'PUT'].includes(req.method)) {
    const now = Date.now();
    // 顺带清理超过 1 小时的历史条目：Map 只在写操作时写入，
    // 长期运行下不清理会随用户数无界增长，清理后下次写操作会重新校验。
    if (lastTicketCheck.size > 0) {
      const cutoff = now - 60 * 60 * 1000;
      for (const [uid, ts] of lastTicketCheck) if (ts < cutoff) lastTicketCheck.delete(uid);
    }
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

// ======================== 可见性 / 过期 辅助 ========================

const VISIBILITIES = ['public', 'unlisted', 'private'];

// 过期选项（秒），0 = 永不。.env 可覆盖，前端经 /api/config 获取
const EXPIRATION_OPTIONS = (process.env.PASTE_EXPIRATIONS || '0,600,3600,86400,604800,2592000,31536000')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 0);
const MAX_EXPIRATION = Math.max(0, ...EXPIRATION_OPTIONS);

// 可选认证：仅解析 JWT（不发网络请求，无效/缺失返回 null，供公开路由判定 private 归属）
function optionalUserId(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET).id;
  } catch {
    return null;
  }
}

// SQLite 的 CURRENT_TIMESTAMP / datetime() 是 UTC 的 'YYYY-MM-DD HH:MM:SS'。// 补 T 与 Z 转成 ISO 8601，否则前端 new Date() 会按本地时区解析（差 8 小时）。
function toIso(sqliteDatetime) {
  return sqliteDatetime ? new Date(`${sqliteDatetime.replace(' ', 'T')}Z`).toISOString() : null;
}

// 语言 → 下载文件扩展名
const LANGUAGE_EXTENSIONS = {
  plaintext: 'txt', javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
  csharp: 'cs', cpp: 'cpp', c: 'c', go: 'go', rust: 'rs', php: 'php', ruby: 'rb',
  swift: 'swift', kotlin: 'kt', html: 'html', css: 'css', scss: 'scss', json: 'json',
  xml: 'xml', yaml: 'yml', markdown: 'md', sql: 'sql', bash: 'sh', powershell: 'ps1',
  dockerfile: 'dockerfile',
};

// 生成下载文件名：优先标题，缺扩展名时按语言补全；标题来自用户输入，
// 必须剔除控制字符与路径分隔符，避免响应头注入与路径穿越。
function downloadFilename(paste) {
  const ext = LANGUAGE_EXTENSIONS[paste.language] || 'txt';
  const raw = (paste.title && paste.title.trim()) || paste.short_code;
  const safe = raw.replace(/[\x00-\x1f\x7f/\\"]/g, '_').slice(0, 150);
  return safe.includes('.') ? safe : `${safe}.${ext}`;
}

// RFC 5987 编码：encodeURIComponent 不转义 ' ( ) *，需补转义
function rfc5987Encode(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// 读取并裁决一条 paste 的可访问性：过期即懒删除后视为不存在；private 越权一律视为不存在。
// 返回行对象或 null —— 调用方统一转 404，不泄漏 code 是否存在。
function readPaste(shortCode, viewerId) {
  const row = db
    .prepare(
      `SELECT p.*, u.username,
              (p.expires_at IS NOT NULL AND p.expires_at < datetime('now')) AS is_expired
       FROM pastes p JOIN users u ON p.user_id = u.id
       WHERE p.short_code = ?`
    )
    .get(shortCode);

  if (!row) return null;

  if (row.is_expired) {
    // 懒删除：即使定时清理任务未运行，过期内容也不会被读取
    db.prepare('DELETE FROM pastes WHERE id = ?').run(row.id);
    return null;
  }

  if (row.visibility === 'private' && row.user_id !== viewerId) return null;

  return row;
}

// 阅后即焚的销毁：非作者读取时删除记录。返回 false 表示已被并发访问者抢先销毁。
// 依赖 DELETE 的受影响行数做唯一性判定，天然并发安全。
function consumeIfBurnAfterReading(paste, viewerId) {
  if (!paste.burn_after_reading || viewerId === paste.user_id) return true;
  const deleted = db.prepare('DELETE FROM pastes WHERE id = ?').run(paste.id).changes === 1;
  if (deleted) audit(viewerId, 'burn_read', paste.short_code, null);
  return deleted;
}

// ======================== 审计 / 管理员 / 备份 ========================

// 关键动作留痕。审计写入失败不应影响主流程。
function audit(actorId, action, target = null, detail = null) {
  try {
    db.prepare('INSERT INTO audit_log (actor_id, action, target, detail) VALUES (?, ?, ?, ?)')
      .run(actorId, action, target, detail);
  } catch (e) {
    console.error('[audit] 写入失败:', e.message);
  }
}

// 管理员判定：中心下发的 bbs_gid 等于阈值（默认 1 = 论坛超级管理组）。
// 阈值可用 PASTE_ADMIN_BBS_GID 覆盖，不硬编码具体用户。
const ADMIN_BBS_GID = parseInt(process.env.PASTE_ADMIN_BBS_GID || '1', 10);

function isAdmin(userId) {
  if (!userId) return false;
  const row = db.prepare('SELECT bbs_gid FROM users WHERE id = ?').get(userId);
  return !!row && row.bbs_gid === ADMIN_BBS_GID;
}

const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.userId)) return res.status(403).json({ error: '需要管理员权限' });
  next();
};

// 备份：better-sqlite3 的在线备份 API，按份数滚动保留。
// 未配置 PASTE_BACKUP_DIR 则不启用（避免在未预期的位置写文件）。
const BACKUP_DIR = process.env.PASTE_BACKUP_DIR || '';
const BACKUP_KEEP = parseInt(process.env.PASTE_BACKUP_KEEP || '7', 10);

async function runBackup() {
  if (!BACKUP_DIR) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `database-${stamp}.sqlite`);
    await db.backup(dest);

    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('database-') && f.endsWith('.sqlite'))
      .sort();
    for (const old of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      fs.unlinkSync(path.join(BACKUP_DIR, old));
    }
    console.log(`[backup] 已备份到 ${dest}（保留最近 ${BACKUP_KEEP} 份）`);
  } catch (e) {
    console.error('[backup] 备份失败:', e.message);
  }
}

// ======================== Routes ========================

// 健康检查（供容器编排 / 反代探活；不暴露库大小等内部信息）
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    version: require('./package.json').version,
    uptime: Math.floor(process.uptime()),
  });
});

// 前端配置（登录/退出跳转地址；SSO 是否启用；创建表单的过期与可见性选项）
app.get('/api/config', (req, res) => {
  res.json({
    ssoEnabled: SSO.enabled,
    loginUrl: SSO.loginUrl,
    logoutUrl: SSO.logoutUrl,
    expirationOptions: EXPIRATION_OPTIONS,
    visibilities: VISIBILITIES,
    maxContentLength: 100000,
  });
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
  res.json({ token: signToken(user, ticket), username: user.username });
});

// 列表查询的公共参数：关键词、语言、分页
const LIST_PAGE_SIZE = 20;
const LIST_MAX_PAGE_SIZE = 50;

function listQueryParams(query) {
  const q = (query.q || '').trim().slice(0, 60);
  const lang = (query.lang || '').trim().slice(0, 30);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || LIST_PAGE_SIZE, 1), LIST_MAX_PAGE_SIZE);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { q, lang, limit, offset: (page - 1) * limit };
}

// LIKE 通配符转义，避免用户输入的 % / _ 被当作模式
function likePattern(q) {
  return '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

app.get('/api/pastes', authenticate, (req, res) => {
  // 本人的全部 paste（含 private / unlisted / 阅后即焚），列表只回预览，正文点进详情取
  const { q, lang, limit, offset } = listQueryParams(req.query);
  let sql = `
    SELECT id, short_code,
           CASE WHEN encrypted = 1 THEN '[已加密]' ELSE substr(content, 1, 300) END AS preview,
           language, title, visibility, burn_after_reading, encrypted, views,
           strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
           CASE WHEN expires_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ', expires_at) END AS expires_at
    FROM pastes WHERE user_id = ?`;
  const params = [req.userId];
  if (q) { sql += " AND title LIKE ? ESCAPE '\\'"; params.push(likePattern(q)); }
  if (lang) { sql += ' AND language = ?'; params.push(lang); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit + 1, offset);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  res.json({ items: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

app.get('/api/pastes/all', (req, res) => {
  // 公开流：仅 public、未过期、非阅后即焚；正文只回前 300 字符预览，加密内容以占位替代
  const { q, lang, limit, offset } = listQueryParams(req.query);
  let sql = `
    SELECT p.id, p.short_code,
           CASE WHEN p.encrypted = 1 THEN '[已加密]' ELSE substr(p.content, 1, 300) END AS preview,
           p.language, p.title, p.user_id, u.username,
           strftime('%Y-%m-%dT%H:%M:%SZ', p.created_at) AS created_at
    FROM pastes p JOIN users u ON p.user_id = u.id
    WHERE p.visibility = 'public'
      AND p.burn_after_reading = 0
      AND (p.expires_at IS NULL OR p.expires_at >= datetime('now'))`;
  const params = [];
  if (q) { sql += " AND (p.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')"; params.push(likePattern(q), likePattern(q)); }
  if (lang) { sql += ' AND p.language = ?'; params.push(lang); }
  sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit + 1, offset);

  const rows = db.prepare(sql).all(...params);
  const hasMore = rows.length > limit;
  res.json({ items: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

app.post('/api/pastes', authenticate, createLimiter, (req, res) => {
  const { content, language = 'plaintext', title, visibility = 'public', expires_in, burn_after_reading, encrypted } = req.body;
  const allowedLanguages = ['plaintext', 'javascript', 'typescript', 'python', 'java', 'csharp', 'cpp', 'c', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'html', 'css', 'scss', 'json', 'xml', 'yaml', 'markdown', 'sql', 'bash', 'powershell', 'dockerfile'];
  if (!content || typeof content !== 'string') return res.status(400).json({ error: '内容不能为空' });
  if (content.length > 100000) return res.status(400).json({ error: '内容不能超过100KB' });
  if (!allowedLanguages.includes(language)) return res.status(400).json({ error: '不支持的语言类型' });
  if (!VISIBILITIES.includes(visibility)) return res.status(400).json({ error: '不支持的可见性' });
  if (title !== undefined && title !== null && typeof title !== 'string') return res.status(400).json({ error: '标题格式错误' });
  const trimmedTitle = typeof title === 'string' ? title.trim() : '';
  if (trimmedTitle.length > 120) return res.status(400).json({ error: '标题不能超过120字符' });

  const expiresIn = (expires_in === undefined || expires_in === null) ? 0 : parseInt(expires_in, 10);
  if (!Number.isInteger(expiresIn) || expiresIn < 0 || expiresIn > MAX_EXPIRATION) {
    return res.status(400).json({ error: '不支持的过期时长' });
  }

  const { id, short_code } = insertPaste({
    userId: req.userId,
    content,
    language,
    title: trimmedTitle || null,
    visibility,
    expiresIn,
    burnAfterReading: burn_after_reading === true,
    encrypted: encrypted === true,
  });
  res.json({ id, short_code, language, title: trimmedTitle || null, visibility, expires_in: expiresIn, burn_after_reading: burn_after_reading === true, encrypted: encrypted === true });
});

// 统一的 paste 响应体（详情 / 焚毁确认共用）
function pastePayload(paste, extra = {}) {
  return {
    id: paste.id,
    short_code: paste.short_code,
    content: paste.content,
    language: paste.language,
    title: paste.title,
    visibility: paste.visibility,
    burn_after_reading: !!paste.burn_after_reading,
    encrypted: !!paste.encrypted,
    views: paste.views,
    user_id: paste.user_id,
    username: paste.username,
    created_at: toIso(paste.created_at),
    expires_at: toIso(paste.expires_at),
    ...extra,
  };
}

app.get('/api/paste/:shortCode', (req, res) => {
  const viewerId = optionalUserId(req);
  const paste = readPaste(req.params.shortCode, viewerId);
  if (!paste) return res.status(404).json({ error: 'Paste not found' });

  const isOwner = viewerId === paste.user_id;

  // 阅后即焚：非作者首次访问只返回确认要求，正文在 POST .../burn 中交付并销毁；
  // 作者访问不触发销毁（否则作者自查一次内容就没了）。
  if (paste.burn_after_reading && !isOwner) {
    return res.json({
      burn_after_reading: true,
      needs_confirmation: true,
      short_code: paste.short_code,
      language: paste.language,
      title: paste.title,
    });
  }

  // 浏览量：仅统计非作者访问
  if (!isOwner) {
    db.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').run(paste.id);
    paste.views += 1;
  }

  res.json(pastePayload(paste));
});

// 阅后即焚的确认读取：先计数、再以 DELETE 的返回行数判定本次是否为唯一获胜者，
// 保证并发下只有一个请求拿到正文（其余返回 404）。
app.post('/api/paste/:shortCode/burn', (req, res) => {
  const viewerId = optionalUserId(req);
  const paste = readPaste(req.params.shortCode, viewerId);
  if (!paste) return res.status(404).json({ error: 'Paste not found' });

  const isOwner = viewerId === paste.user_id;

  if (!paste.burn_after_reading || isOwner) {
    if (!isOwner) {
      db.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').run(paste.id);
      paste.views += 1;
    }
    return res.json(pastePayload(paste, { burned: false }));
  }

  db.prepare('UPDATE pastes SET views = views + 1 WHERE id = ?').run(paste.id);
  paste.views += 1;

  if (!consumeIfBurnAfterReading(paste, viewerId)) {
    return res.status(404).json({ error: '内容已被其他访问者销毁' });
  }

  res.json(pastePayload(paste, { burned: true }));
});

// 原始正文：供 curl / 工具链直接取用（不计数，避免 CI 轮询刷高浏览量）。
// 焚毁类在此直接销毁——raw/dl 是显式的正文获取，没有可交互的确认环节，
// 若允许"只读不烧"反而会成为绕过销毁的后门。
app.get('/raw/:shortCode', (req, res) => {
  const viewerId = optionalUserId(req);
  const paste = readPaste(req.params.shortCode, viewerId);
  if (!paste) return res.status(404).type('text/plain').send('Paste not found');
  if (!consumeIfBurnAfterReading(paste, viewerId)) return res.status(404).type('text/plain').send('Paste not found');
  res.type('text/plain').send(paste.content);
});

// 下载：文件名优先取标题，按 RFC 5987 编码以正确处理中文与非 ASCII
app.get('/dl/:shortCode', (req, res) => {
  const viewerId = optionalUserId(req);
  const paste = readPaste(req.params.shortCode, viewerId);
  if (!paste) return res.status(404).type('text/plain').send('Paste not found');
  if (!consumeIfBurnAfterReading(paste, viewerId)) return res.status(404).type('text/plain').send('Paste not found');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${rfc5987Encode(downloadFilename(paste))}`);
  res.type('text/plain').send(paste.content);
});

app.delete('/api/pastes/:id', authenticate, (req, res) => {
  const row = db.prepare('SELECT short_code FROM pastes WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: 'Paste not found' });
  db.prepare('DELETE FROM pastes WHERE id = ?').run(req.params.id);
  audit(req.userId, 'delete_paste', row.short_code, null);
  res.json({ message: 'Deleted' });
});

// ---- 举报 ----

app.post('/api/reports', authenticate, (req, res) => {
  const { short_code, reason } = req.body || {};
  if (!short_code || typeof short_code !== 'string') return res.status(400).json({ error: '缺少内容标识' });
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

  const paste = db.prepare('SELECT id, user_id FROM pastes WHERE short_code = ?').get(short_code);
  if (!paste) return res.status(404).json({ error: '内容不存在' });
  if (paste.user_id === req.userId) return res.status(400).json({ error: '不能举报自己的内容' });

  // 同一人对同一内容只保留一条待处理记录，避免重复刷举报
  const dup = db.prepare("SELECT id FROM reports WHERE paste_id = ? AND reporter_id = ? AND status = 'open'").get(paste.id, req.userId);
  if (dup) return res.json({ message: '已收到你的举报，我们会尽快处理' });

  db.prepare('INSERT INTO reports (paste_id, reporter_id, reason) VALUES (?, ?, ?)').run(paste.id, req.userId, trimmed);
  audit(req.userId, 'report', short_code, trimmed || null);
  res.json({ message: '已收到你的举报，我们会尽快处理' });
});

// ---- 管理接口（bbs_gid 命中 PASTE_ADMIN_BBS_GID 才可访问）----

app.get('/api/admin/stats', authenticate, requireAdmin, (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(db.name).size; } catch { /* 内存库或文件不可读 */ }

  res.json({
    pastes: one('SELECT COUNT(*) AS c FROM pastes'),
    pastesToday: one("SELECT COUNT(*) AS c FROM pastes WHERE created_at >= datetime('now', '-1 day')"),
    publicPastes: one("SELECT COUNT(*) AS c FROM pastes WHERE visibility = 'public'"),
    privatePastes: one("SELECT COUNT(*) AS c FROM pastes WHERE visibility = 'private'"),
    encryptedPastes: one('SELECT COUNT(*) AS c FROM pastes WHERE encrypted = 1'),
    burnPastes: one('SELECT COUNT(*) AS c FROM pastes WHERE burn_after_reading = 1'),
    expiredPending: one("SELECT COUNT(*) AS c FROM pastes WHERE expires_at IS NOT NULL AND expires_at < datetime('now')"),
    totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) AS c FROM pastes').get().c,
    users: one('SELECT COUNT(*) AS c FROM users'),
    openReports: one("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    sizeBytes,
  });
});

app.get('/api/admin/pastes', authenticate, requireAdmin, (req, res) => {
  const { limit, offset } = listQueryParams(req.query);
  const rows = db.prepare(`
    SELECT p.id, p.short_code, p.title, p.language, p.visibility, p.views,
           p.burn_after_reading, p.encrypted, p.user_id, u.username,
           strftime('%Y-%m-%dT%H:%M:%SZ', p.created_at) AS created_at,
           CASE WHEN p.expires_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ', p.expires_at) END AS expires_at
    FROM pastes p JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(limit + 1, offset);
  const hasMore = rows.length > limit;
  res.json({ items: hasMore ? rows.slice(0, limit) : rows, hasMore });
});

app.delete('/api/admin/pastes/:id', authenticate, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT short_code, user_id FROM pastes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '内容不存在' });
  db.prepare('DELETE FROM pastes WHERE id = ?').run(req.params.id);
  audit(req.userId, 'admin_delete_paste', row.short_code, `owner=${row.user_id}`);
  res.json({ message: '已删除' });
});

app.get('/api/admin/reports', authenticate, requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT r.id, r.reason, r.status,
           strftime('%Y-%m-%dT%H:%M:%SZ', r.created_at) AS created_at,
           p.short_code, p.title, p.user_id AS paste_owner,
           ou.username AS paste_owner_name,
           ru.username AS reporter_name
    FROM reports r
    JOIN pastes p ON p.id = r.paste_id
    JOIN users ou ON ou.id = p.user_id
    JOIN users ru ON ru.id = r.reporter_id
    WHERE r.status = 'open'
    ORDER BY r.created_at DESC LIMIT 100`).all());
});

app.post('/api/admin/reports/:id/resolve', authenticate, requireAdmin, (req, res) => {
  const action = req.body?.action;
  if (!['dismiss', 'delete'].includes(action)) return res.status(400).json({ error: '不支持的处理动作' });

  const report = db.prepare("SELECT * FROM reports WHERE id = ? AND status = 'open'").get(req.params.id);
  if (!report) return res.status(404).json({ error: '举报不存在或已处理' });

  if (action === 'delete') {
    const paste = db.prepare('SELECT short_code FROM pastes WHERE id = ?').get(report.paste_id);
    db.prepare('DELETE FROM pastes WHERE id = ?').run(report.paste_id);
    if (paste) audit(req.userId, 'admin_delete_paste', paste.short_code, `via report #${report.id}`);
  }
  db.prepare('UPDATE reports SET status = ?, handled_at = CURRENT_TIMESTAMP, handled_by = ? WHERE id = ?')
    .run(action === 'delete' ? 'deleted' : 'dismissed', req.userId, report.id);
  audit(req.userId, `report_${action}`, `report#${report.id}`, null);
  res.json({ message: '已处理' });
});

// 按用户清空内容（违规处置 / 注销联动）
app.post('/api/admin/users/:id/purge', authenticate, requireAdmin, (req, res) => {
  const uid = parseInt(req.params.id, 10);
  if (!Number.isInteger(uid)) return res.status(400).json({ error: '无效的用户' });
  const info = db.prepare('DELETE FROM pastes WHERE user_id = ?').run(uid);
  audit(req.userId, 'admin_purge_user', `user#${uid}`, `删除 ${info.changes} 条内容`);
  res.json({ message: `已删除该用户的 ${info.changes} 条内容`, deleted: info.changes });
});

// ---- API Token 管理 ----

app.get('/api/tokens', authenticate, (req, res) => {
  res.json(
    db.prepare(`
      SELECT id, name,
             strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_at,
             CASE WHEN last_used_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ', last_used_at) END AS last_used_at,
             CASE WHEN expires_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%SZ', expires_at) END AS expires_at
      FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`).all(req.userId)
  );
});

app.post('/api/tokens', authenticate, (req, res) => {
  if (req.viaApiToken) return res.status(403).json({ error: '请使用浏览器登录后创建 Token' });

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 60) return res.status(400).json({ error: '请提供 1-60 字符的名称' });
  if (!Number.isInteger(TOKEN_TTL_DAYS) || TOKEN_TTL_DAYS <= 0) {
    return res.status(500).json({ error: '服务端 Token 有效期配置有误' });
  }

  const active = db.prepare(
    "SELECT COUNT(*) AS c FROM api_tokens WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
  ).get(req.userId).c;
  if (active >= TOKEN_MAX_PER_USER) {
    return res.status(400).json({ error: `有效 Token 已达上限（${TOKEN_MAX_PER_USER} 个），请先撤销不再使用的` });
  }

  const raw = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const info = db.prepare(
    "INSERT INTO api_tokens (user_id, name, hash, expires_at) VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))"
  ).run(req.userId, name, hashToken(raw), TOKEN_TTL_DAYS);

  // 明文仅在此响应中出现一次，服务端只保留 sha256
  res.json({ id: info.lastInsertRowid, name, token: raw, expires_in_days: TOKEN_TTL_DAYS });
});

app.delete('/api/tokens/:id', authenticate, (req, res) => {
  const info = db.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Token not found' });
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

const server = app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

// 过期清理任务：读取路径的懒删除只覆盖"被再次访问"的条目，
// 从未被访问的过期 paste 需定时清扫，否则库无限增长。多实例下重复执行无害（DELETE 幂等）。
const PURGE_INTERVAL_MS = parseInt(process.env.PASTE_PURGE_INTERVAL_MS || '3600000', 10);
let purgeTimer = setInterval(() => {
  try {
    const info = db.prepare("DELETE FROM pastes WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run();
    if (info.changes > 0) {
      console.log(`[purge] 清理 ${info.changes} 条过期 paste`);
      audit(null, 'purge_expired', null, `${info.changes} 条`);
    }
  } catch (e) {
    console.error('[purge] 清理失败:', e.message);
  }
}, PURGE_INTERVAL_MS);
purgeTimer.unref();

// 定时备份（未配置 PASTE_BACKUP_DIR 时不启用）
const BACKUP_INTERVAL_MS = parseInt(process.env.PASTE_BACKUP_INTERVAL_MS || '86400000', 10);
let backupTimer = BACKUP_DIR ? setInterval(runBackup, BACKUP_INTERVAL_MS) : null;
if (backupTimer) backupTimer.unref();

// 优雅关闭：停止接受新请求 → 等在途请求结束 → 清定时器 → 关数据库（触发 WAL checkpoint）
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] 收到 ${signal}，等待在途请求结束…`);
  server.close(() => {
    if (purgeTimer) clearInterval(purgeTimer);
    if (backupTimer) clearInterval(backupTimer);
    try {
      db.close();
      console.log('[shutdown] 已干净退出');
    } catch (e) {
      console.error('[shutdown] 关闭数据库失败:', e.message);
    }
    process.exit(0);
  });
  // 兜底：10 秒未收尾则强制退出，避免卡在长连接上
  setTimeout(() => {
    console.error('[shutdown] 等待超时，强制退出');
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// 供测试引用（生产入口不依赖该导出）
module.exports = { app, server, db };
