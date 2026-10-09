/**
 * 端到端 API 测试（node:test，零第三方测试依赖）
 * 运行：npm test
 *
 * 铁律：测试一律使用 PASTE_DB_PATH 指向的临时库，绝不触碰开发/生产 database.sqlite。
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST_DB = path.join(os.tmpdir(), `paste-test-${process.pid}-${Date.now()}.sqlite`);

// 必须在 require('../server.js') 之前设置：server.js 在模块加载时即绑定端口
process.env.PASTE_DB_PATH = TEST_DB;
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret-for-node-test-only';
process.env.PASTE_RATE_LIMIT_MAX = '1000';

const { server } = require('../server.js');
const db = require('../db');
const jwt = require('jsonwebtoken');

let BASE = '';
let TOKEN = '';
let USER_ID = 0;

const authHeaders = (extra = {}) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${TOKEN}`,
  ...extra,
});

const post = (body, headers = authHeaders()) =>
  fetch(`${BASE}/api/pastes`, { method: 'POST', headers, body: JSON.stringify(body) });

before(async () => {
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  BASE = `http://127.0.0.1:${server.address().port}`;
  const info = db.prepare("INSERT INTO users (username, password) VALUES ('tester', '')").run();
  USER_ID = Number(info.lastInsertRowid);
  TOKEN = jwt.sign({ id: USER_ID, username: 'tester' }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

after(() => {
  server.close();
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* 不存在则忽略 */ }
  }
});

test('创建：写入标题、可见性、过期与响应字段', async () => {
  const res = await post({ content: 'hello', language: 'python', title: ' 带空格 ', visibility: 'unlisted', expires_in: 600 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.title, '带空格', '标题应被 trim');
  assert.equal(data.visibility, 'unlisted');
  assert.equal(data.expires_in, 600);
  assert.match(data.short_code, /^[A-Za-z0-9]{8}$/, 'short_code 应为 8 位 base62');
});

test('创建：非法输入被拒绝', async () => {
  assert.equal((await post({ content: '' })).status, 400);
  assert.equal((await post({ content: 'x', visibility: 'hacker' })).status, 400);
  assert.equal((await post({ content: 'x', expires_in: 999999999 })).status, 400);
  assert.equal((await post({ content: 'x', title: 'T'.repeat(121) })).status, 400);
  assert.equal((await post({ content: 'x', language: 'brainfuck' })).status, 400);
  assert.equal((await post({ content: 'x' }, { 'Content-Type': 'application/json' })).status, 401, '无凭据应 401');
});

test('可见性：private 匿名返回 404 且不出现在公开流；作者可读', async () => {
  const created = await (await post({ content: 'secret body', visibility: 'private' })).json();

  const anon = await fetch(`${BASE}/api/paste/${created.short_code}`);
  assert.equal(anon.status, 404, '越权读取必须回 404 而非 403，避免泄漏存在性');

  const mine = await fetch(`${BASE}/api/paste/${created.short_code}`, { headers: authHeaders() });
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).content, 'secret body');

  const all = await (await fetch(`${BASE}/api/pastes/all`)).json();
  assert.ok(!all.items.some((p) => p.short_code === created.short_code), 'private 不得出现在公开流');
});

test('可见性：unlisted 不进任何列表但可按 code 直读', async () => {
  const created = await (await post({ content: 'unlisted body', visibility: 'unlisted' })).json();

  const all = await (await fetch(`${BASE}/api/pastes/all`)).json();
  assert.ok(!all.items.some((p) => p.short_code === created.short_code));

  const anon = await fetch(`${BASE}/api/paste/${created.short_code}`);
  assert.equal(anon.status, 200);
});

test('过期：到期后读取 404 且记录被懒删除', async () => {
  const created = await (await post({ content: 'short lived', expires_in: 1 })).json();

  db.prepare("UPDATE pastes SET expires_at = datetime('now', '-1 hour') WHERE short_code = ?").run(created.short_code);

  const res = await fetch(`${BASE}/api/paste/${created.short_code}`);
  assert.equal(res.status, 404);
  const row = db.prepare('SELECT COUNT(*) AS c FROM pastes WHERE short_code = ?').get(created.short_code);
  assert.equal(row.c, 0, '过期记录应被即时删除');
});

test('过期：仍有效的记录可读且公开流可见', async () => {
  const created = await (await post({ content: 'still valid', expires_in: 3600 })).json();
  assert.equal((await fetch(`${BASE}/api/paste/${created.short_code}`)).status, 200);
  const all = await (await fetch(`${BASE}/api/pastes/all`)).json();
  assert.ok(all.items.some((p) => p.short_code === created.short_code));
});

test('焚毁：作者可重复读，非作者需确认且仅一次', async () => {
  const created = await (await post({ content: 'burn me', burn_after_reading: true })).json();

  const owner1 = await (await fetch(`${BASE}/api/paste/${created.short_code}`, { headers: authHeaders() })).json();
  assert.equal(owner1.content, 'burn me', '作者访问不应触发销毁');
  const owner2 = await (await fetch(`${BASE}/api/paste/${created.short_code}`, { headers: authHeaders() })).json();
  assert.equal(owner2.content, 'burn me', '作者可重复读');

  const anon = await (await fetch(`${BASE}/api/paste/${created.short_code}`)).json();
  assert.equal(anon.needs_confirmation, true);
  assert.ok(!('content' in anon), '确认前不得返回正文');

  const burn = await fetch(`${BASE}/api/paste/${created.short_code}/burn`, { method: 'POST' });
  assert.equal(burn.status, 200);
  const burned = await burn.json();
  assert.equal(burned.content, 'burn me');
  assert.equal(burned.burned, true);

  assert.equal((await fetch(`${BASE}/api/paste/${created.short_code}`)).status, 404, '销毁后不可再读');
});

test('焚毁：并发确认只有一个成功', async () => {
  const created = await (await post({ content: 'race', burn_after_reading: true })).json();
  const results = await Promise.all(
    [1, 2, 3, 4].map(() => fetch(`${BASE}/api/paste/${created.short_code}/burn`, { method: 'POST' }))
  );
  const ok = results.filter((r) => r.status === 200).length;
  assert.equal(ok, 1, `并发下应只有 1 次成功，实际 ${ok}`);
});

test('焚毁：不进公开流，但进作者列表', async () => {
  const created = await (await post({ content: 'hidden burn', burn_after_reading: true })).json();
  const all = await (await fetch(`${BASE}/api/pastes/all`)).json();
  assert.ok(!all.items.some((p) => p.short_code === created.short_code));
  const mine = await (await fetch(`${BASE}/api/pastes?page=1`, { headers: authHeaders() })).json();
  assert.ok(mine.items.some((p) => p.short_code === created.short_code));
});

test('raw / 下载：内容与 RFC 5987 文件名', async () => {
  const created = await (await post({ content: 'raw content', language: 'python', title: '中文标题' })).json();

  const raw = await fetch(`${BASE}/raw/${created.short_code}`);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-type'), /^text\/plain/, 'Content-Type 必须是 text/plain（带 subtype）');
  assert.equal(await raw.text(), 'raw content');

  const dl = await fetch(`${BASE}/dl/${created.short_code}`);
  assert.equal(dl.status, 200);
  const cd = dl.headers.get('content-disposition');
  assert.match(cd, /^attachment; filename\*=UTF-8''/, '应使用 RFC 5987 编码');
  assert.equal(decodeURIComponent(cd.split("''")[1]), '中文标题.py', '扩展名应按语言补全');

  assert.equal((await fetch(`${BASE}/raw/notexist1`)).status, 404);
});

test('raw：不计数浏览量（避免 CI 轮询刷高）', async () => {
  const created = await (await post({ content: 'view test' })).json();
  db.prepare('UPDATE pastes SET views = 0 WHERE short_code = ?').run(created.short_code);
  await fetch(`${BASE}/raw/${created.short_code}`);
  await fetch(`${BASE}/dl/${created.short_code}`);
  const views = db.prepare('SELECT views FROM pastes WHERE short_code = ?').get(created.short_code).views;
  assert.equal(views, 0);
});

test('加密：服务端只存密文，列表以占位展示', async () => {
  const blob = Buffer.from('ciphertext-blob').toString('base64');
  const created = await (await post({ content: blob, encrypted: true, title: '加了密' })).json();

  const all = await (await fetch(`${BASE}/api/pastes/all`)).json();
  const item = all.items.find((p) => p.short_code === created.short_code);
  assert.equal(item.preview, '[已加密]', '加密内容不得泄漏到列表');

  const detail = await (await fetch(`${BASE}/api/paste/${created.short_code}`)).json();
  assert.equal(detail.encrypted, true);
  assert.equal(detail.content, blob, '服务端原样返回密文，不做解密');
});

test('API Token：创建、使用、撤销与越权', async () => {
  const created = await (
    await fetch(`${BASE}/api/tokens`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: 'CI' }) })
  ).json();
  assert.ok(created.token.startsWith('paste_'));

  // 用需要认证的接口验证 Token 生效（公开接口无论有无凭据都返回 200，不能作判据）
  const viaToken = await fetch(`${BASE}/api/tokens`, { headers: { Authorization: `Bearer ${created.token}` } });
  assert.equal(viaToken.status, 200, 'Token 应可用于受保护接口');

  const madeByToken = await post({ content: 'via token' }, { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` });
  assert.equal(madeByToken.status, 200);

  const list = await (await fetch(`${BASE}/api/tokens`, { headers: authHeaders() })).json();
  const meta = list.find((t) => t.id === created.id);
  assert.ok(meta.last_used_at, '应记录最近使用时间');
  assert.ok(!('token' in meta) && !('hash' in meta), '列表不得返回明文或哈希');

  const row = db.prepare('SELECT hash FROM api_tokens WHERE id = ?').get(created.id);
  assert.match(row.hash, /^[a-f0-9]{64}$/, '库中只应存 sha256');

  const chained = await fetch(`${BASE}/api/tokens`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.token}` }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(chained.status, 403, 'Token 不得再创建 Token');

  assert.equal((await fetch(`${BASE}/api/tokens`, { headers: { Authorization: 'Bearer paste_bogus' } })).status, 401, '无效 Token 应 401');

  await fetch(`${BASE}/api/tokens/${created.id}`, { method: 'DELETE', headers: authHeaders() });
  assert.equal((await fetch(`${BASE}/api/tokens`, { headers: { Authorization: `Bearer ${created.token}` } })).status, 401, '撤销后立即失效');
});

test('搜索结果与分页信封', async () => {
  await post({ content: 'a', title: '唯一关键词XYZ' });
  for (let i = 0; i < 3; i++) await post({ content: 'filler ' + i, title: '填充 ' + i });

  const hit = await (await fetch(`${BASE}/api/pastes/all?q=${encodeURIComponent('唯一关键词XYZ')}`)).json();
  assert.equal(hit.items.length, 1);

  const paged = await (await fetch(`${BASE}/api/pastes/all?limit=2&page=1`)).json();
  assert.equal(paged.items.length, 2);
  assert.equal(paged.hasMore, true);
  assert.ok(Array.isArray(paged.items), '响应应为 {items, hasMore} 信封');
});

test('健康检查不泄漏内部信息', async () => {
  const res = await fetch(`${BASE}/healthz`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.deepEqual(Object.keys(data).sort(), ['status', 'uptime', 'version']);
});

test('数据库文件不可通过 HTTP 访问', async () => {
  const res = await fetch(`${BASE}/database.sqlite`);
  assert.equal(res.status, 403);
});

test('举报：提交、幂等与自身限制', async () => {
  const own = await (await post({ content: 'mine' })).json();
  const selfReport = await fetch(`${BASE}/api/reports`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ short_code: own.short_code, reason: 'x' }),
  });
  assert.equal(selfReport.status, 400, '不能举报自己的内容');

  // 造一条属于他人、可见性公开的内容
  const other = db.prepare("INSERT INTO users (username, password) VALUES ('reportee', '')").run();
  const otherUid = Number(other.lastInsertRowid);
  const target = await (await post({ content: 'someone else content', visibility: 'public' })).json();
  db.prepare('UPDATE pastes SET user_id = ? WHERE short_code = ?').run(otherUid, target.short_code);

  const r1 = await fetch(`${BASE}/api/reports`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ short_code: target.short_code, reason: '含明文口令' }),
  });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${BASE}/api/reports`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ short_code: target.short_code, reason: '重复举报' }),
  });
  assert.equal(r2.status, 200, '重复举报应成功但不重复入库');

  const count = db.prepare('SELECT COUNT(*) AS c FROM reports WHERE paste_id = (SELECT id FROM pastes WHERE short_code = ?)').get(target.short_code).c;
  assert.equal(count, 1, '同一人对同一内容只应有一条待处理举报');

  const missing = await fetch(`${BASE}/api/reports`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ short_code: 'nope1234' }),
  });
  assert.equal(missing.status, 404);
});

test('管理：非管理员被拒，管理员可统计与删除（含审计留痕）', async () => {
  assert.equal((await fetch(`${BASE}/api/admin/stats`, { headers: authHeaders() })).status, 403, '非管理员必须 403');

  db.prepare('UPDATE users SET bbs_gid = 1 WHERE id = ?').run(USER_ID);

  const stats = await (await fetch(`${BASE}/api/admin/stats`, { headers: authHeaders() })).json();
  assert.ok(stats.pastes > 0);
  assert.equal(typeof stats.sizeBytes, 'number');
  assert.ok(!('dbPath' in stats) && !('path' in stats), '统计不得泄漏文件路径');

  const listed = await (await fetch(`${BASE}/api/admin/pastes?limit=5`, { headers: authHeaders() })).json();
  assert.equal(listed.items.length, 5, '管理列表不受可见性限制');
  assert.ok(listed.items.some((p) => p.visibility !== undefined));

  const victim = await (await post({ content: 'to be removed', visibility: 'private' })).json();
  const del = await fetch(`${BASE}/api/admin/pastes/${victim.id}`, { method: 'DELETE', headers: authHeaders() });
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pastes WHERE short_code = ?').get(victim.short_code).c, 0);

  const row = db.prepare("SELECT * FROM audit_log WHERE action = 'admin_delete_paste' ORDER BY id DESC LIMIT 1").get();
  assert.ok(row, '管理删除必须留下审计记录');
  assert.equal(row.actor_id, USER_ID);
});

test('管理：按用户清空内容', async () => {
  db.prepare('UPDATE users SET bbs_gid = 1 WHERE id = ?').run(USER_ID);
  const target = db.prepare("INSERT INTO users (username, password) VALUES ('purge-victim', '')").run();
  const tid = Number(target.lastInsertRowid);
  for (let i = 0; i < 3; i++) {
    const p = await (await post({ content: 'purge ' + i })).json();
    db.prepare('UPDATE pastes SET user_id = ? WHERE short_code = ?').run(tid, p.short_code);
  }
  const res = await (await fetch(`${BASE}/api/admin/users/${tid}/purge`, { method: 'POST', headers: authHeaders() })).json();
  assert.equal(res.deleted, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pastes WHERE user_id = ?').get(tid).c, 0);
});

test('管理：举报处理（删除内容并关闭举报）', async () => {
  db.prepare('UPDATE users SET bbs_gid = 1 WHERE id = ?').run(USER_ID);
  const reports = await (await fetch(`${BASE}/api/admin/reports`, { headers: authHeaders() })).json();
  assert.ok(reports.length >= 1, '应存在待处理举报');

  const rep = reports[0];
  const resolved = await fetch(`${BASE}/api/admin/reports/${rep.id}/resolve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'delete' }),
  });
  assert.equal(resolved.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM pastes WHERE short_code = ?').get(rep.short_code).c, 0, '判定为真时应删除内容');
  assert.equal(db.prepare('SELECT status FROM reports WHERE id = ?').get(rep.id).status, 'deleted');

  const after = await (await fetch(`${BASE}/api/admin/reports`, { headers: authHeaders() })).json();
  assert.ok(!after.some((r) => r.id === rep.id), '已处理举报不应再出现在待处理列表');

  const bad = await fetch(`${BASE}/api/admin/reports/${rep.id}/resolve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ action: 'nonsense' }),
  });
  assert.equal(bad.status, 400, '未知动作应被拒绝');
});

test('审计：作者删除与焚毁读取都会留痕', async () => {
  const own = await (await post({ content: 'audit me' })).json();
  await fetch(`${BASE}/api/pastes/${own.id}`, { method: 'DELETE', headers: authHeaders() });
  const delRow = db.prepare("SELECT * FROM audit_log WHERE action = 'delete_paste' AND target = ? ORDER BY id DESC LIMIT 1").get(own.short_code);
  assert.ok(delRow, '作者删除应留痕');

  const burn = await (await post({ content: 'burn audit', burn_after_reading: true })).json();
  await fetch(`${BASE}/api/paste/${burn.short_code}/burn`, { method: 'POST' });
  const burnRow = db.prepare("SELECT * FROM audit_log WHERE action = 'burn_read' AND target = ? ORDER BY id DESC LIMIT 1").get(burn.short_code);
  assert.ok(burnRow, '焚毁读取应留痕');
});
