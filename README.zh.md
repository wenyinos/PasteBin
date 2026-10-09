# Code PasteBin

简洁实用的代码片段分享平台（单文件后端 + 单页前端）。

登录鉴权交由社区统一认证中心处理，本站**不保存任何本地密码**。

## 功能特性

### 内容

- 创建时可填**标题**、**语言**，并选择**有效期**（永不 / 10 分钟 / 1 小时 / 1 天 / 1 周 / 1 个月 / 1 年，可用环境变量配置）
- **可见性三级**：公开（进列表）、仅链接可见、仅自己
- **阅后即焚**：非作者首次查看需先确认，确认后内容即被销毁；作者本人查看不会触发销毁
- **客户端加密**：内容在浏览器内用 AES-GCM + PBKDF2 加密后才上传，服务器只存密文。解密密钥放在 URL 的 `#` 片段中——浏览器不会把片段发给服务器
- **Markdown 渲染**（经消毒，支持 GFM 表格、任务列表、代码块）；外部图片一律剥离
- 原始文本视图 `/raw/:code` 与文件下载 `/dl/:code`，方便 `curl` 与工具链调用
- 浏览量统计（作者本人的访问不计入）

### 界面

- Prism.js 语法高亮（25+ 语言），超大内容自动降级为纯文本
- 明暗主题切换（记忆偏好，默认跟随系统）
- 详情页快捷键：`r` 原始视图、`c` 复制内容、`y` 复制链接、`q` 二维码、`m` 渲染视图、`n` 返回列表、`?` 帮助
- 二维码（手机扫码打开）
- 行范围链接 `?s=CODE&hl=10-20` 可定位并高亮指定行
- 列表支持「最新 / 我的」切换、搜索与分页
- 保存前进行敏感信息提示（本地正则检查密钥、令牌、私钥、证件号等；仅提示，不上报、不阻断）
- 紫色设计体系，所有静态资源（字体 / CSS / JS）均自托管，不依赖 CDN

### 访问

- 统一认证登录（SSO），本地会话为 24 小时有效的 JWT
- **API Token** 供命令行 / 脚本使用：在导航栏创建、查看、撤销。明文只显示一次，服务端仅存 SHA-256 哈希。Token **不随统一认证登出失效**，如怀疑泄漏请手动撤销

### 社区与治理

- 每条内容详情页提供**举报**入口（同一人对同一内容的重复举报会合并为一条待处理记录）
- **管理面板**（仅对认证中心组标识命中 `PASTE_ADMIN_BBS_GID`（默认 `1`）的账号显示）：用量统计、待处理举报（忽略 / 删除内容）、全部内容列表与删除
- **审计留痕**：删除（作者 / 管理员 / 过期清扫）、阅后即焚的读取、举报均写入 `audit_log`
- **按用户清空内容**接口，用于处理账号注销等请求
- **定时备份**（配置 `PASTE_BACKUP_DIR` 后启用），使用 SQLite 在线备份 API，滚动保留最近 N 份

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 WY_SSO_* 配置
npm start              # 默认 http://localhost:3331
npm test               # 端到端 API 测试（使用临时库，可安全运行）
```

## 配置

运行配置均通过环境变量读取（若存在 `.env` 会在启动时加载）：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PORT` | HTTP 监听端口 | `3331` |
| `WY_SSO_*` | 统一认证中心连接参数（见 `.env.example`） | — |
| `JWT_SECRET` | JWT 签名密钥；未设置时自动生成并写入 `.jwt-secret` | 随机 |
| `ALLOWED_ORIGINS` | CORS 白名单，逗号分隔 | `http://localhost:3331` |
| `PASTE_DB_PATH` | SQLite 文件路径 | `./database.sqlite` |
| `PASTE_EXPIRATIONS` | 有效期选项（秒，`0` 表示永不），逗号分隔 | `0,600,3600,86400,604800,2592000,31536000` |
| `PASTE_RATE_LIMIT_MAX` | 每用户 10 分钟内可创建的次数 | `20` |
| `PASTE_PURGE_INTERVAL_MS` | 过期内容清扫间隔 | `3600000` |
| `PASTE_TOKEN_TTL_DAYS` | API Token 有效期（天） | `90` |
| `PASTE_ADMIN_BBS_GID` | 视为本站管理员的认证中心组标识 | `1` |
| `PASTE_BACKUP_DIR` | 定时备份目录（留空则不启用） | — |
| `PASTE_BACKUP_KEEP` | 备份保留份数 | `7` |
| `PASTE_BACKUP_INTERVAL_MS` | 备份间隔 | `86400000` |

## 接口一览

需要鉴权的接口同时接受浏览器 JWT 与 API Token（`paste_…`），经 `Authorization: Bearer` 传递。

| 方法 | 路径 | 鉴权 |
|--------|------|------|
| GET | `/healthz` | 否 |
| GET | `/api/config` | 否（功能开关、有效期选项） |
| GET | `/api/sso` | 否（中心票据兑换本地 JWT，需 `wy_auth` cookie） |
| POST | `/api/pastes` | 是 |
| GET | `/api/pastes` | 是（本人全部可见性级别的内容） |
| GET | `/api/pastes/all` | 否（公开流，支持 `?q=` `?lang=` `?page=` `?limit=`） |
| GET | `/api/paste/:shortCode` | 否（private / unlisted 需作者身份） |
| POST | `/api/paste/:shortCode/burn` | 否（确认读取阅后即焚内容） |
| GET | `/raw/:shortCode` | 否 |
| GET | `/dl/:shortCode` | 否 |
| DELETE | `/api/pastes/:id` | 是（仅作者） |
| GET / POST | `/api/tokens` | 是（创建仅限浏览器会话） |
| DELETE | `/api/tokens/:id` | 是（仅本人） |
| POST | `/api/reports` | 是 |
| GET | `/api/admin/stats` | 管理员 |
| GET | `/api/admin/pastes` | 管理员 |
| DELETE | `/api/admin/pastes/:id` | 管理员 |
| GET | `/api/admin/reports` | 管理员 |
| POST | `/api/admin/reports/:id/resolve` | 管理员 |
| POST | `/api/admin/users/:id/purge` | 管理员 |

## 架构

- 后端：`server.js` —— Express 5，全部路由与服务逻辑；带 HMAC 签名的认证中心客户端
- 数据库：`db.js` —— SQLite 建表与幂等补列迁移；首次运行自动创建 `database.sqlite`
- 前端：`public/index.html`（结构）、`public/js/app.js`（页面逻辑）、`public/css/theme.css`（设计体系）、`public/js/vendor/`（自托管的 marked / DOMPurify / qrcode-generator）

## 安全

- 统一认证，不保存本地密码
- 单点登出：写操作每 30 分钟重新校验中心票据
- API Token 仅存 SHA-256 哈希，明文只返回一次
- 客户端加密使服务端即使库被拖走也无法读取加密内容
- 创建接口与认证兑换接口均有速率限制
- CSP、`nosniff`、`X-Frame-Options`、严格 Referrer 策略；数据库文件禁止 HTTP 访问
- 输入校验与体积限制（单条 100KB）
- 敏感内容检查完全在浏览器内完成

## 部署要点

1. `npm install` 安装依赖。
2. 由 `.env.example` 生成 `.env`，填入认证中心签发的凭据。
3. 生产环境务必显式设置 `JWT_SECRET`，否则重启后会话失效。
4. 置于 TLS 反向代理之后，并确保转发 `X-Forwarded-For`（限速依赖真实客户端 IP）。
5. 需要 Node.js 20.12 或更高版本（使用了 `process.loadEnvFile`）。
6. 升级前备份 `database.sqlite`；建表与补列在启动时自动完成。

## 技术栈

| 类别 | 技术 |
|----------|-----------|
| 前端 | Bootstrap 5、Prism.js、marked + DOMPurify、自托管 woff2 字体 |
| 后端 | Node.js、Express 5 |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | jsonwebtoken + 社区统一认证中心（SSO） |
| 测试 | `node:test`（无额外依赖） |

## 许可证

GPL v3 © 2026 wenyinos
