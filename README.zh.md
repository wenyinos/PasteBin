# Code PasteBin

简洁实用的代码粘贴与分享平台（单文件后端 + 单页前端）。

在线演示: https://paste.wenyinos.com

## 功能特性

- 用户注册/登录（JWT，24 小时过期）
- 创建代码片段并生成短链接（16 位十六进制 short code）
- 公开查看最新 50 条代码片段
- Prism.js 语法高亮（25+ 语言）
- 图形验证码（算术题）保护注册/登录
- 响应式页面，移动端可用

## 快速开始

```bash
npm install
npm start
```

默认地址: `http://localhost:3331`

## 架构说明

- 后端: `server.js`（Express 5.2，所有 API 与服务逻辑）
- 数据库: `db.js` 初始化 SQLite schema，`database.sqlite` 首次启动自动创建
- 前端: `public/index.html`（单页应用，内含 HTML/CSS/JS）

## API 一览

| Method | Path | Auth |
|------|------|------|
| POST | /api/register | No（需 CAPTCHA） |
| POST | /api/login | No（需 CAPTCHA） |
| GET | /api/captcha | No |
| POST | /api/pastes | JWT |
| GET | /api/pastes | JWT |
| GET | /api/pastes/all | No |
| GET | /api/paste/:shortCode | No |
| DELETE | /api/pastes/:id | JWT（仅本人） |

## 安全特性

- JWT secret 未设置时自动生成（重启后 token 失效）
- 密码复杂度校验（至少 8 字符）
- 认证接口速率限制（15 分钟内最多 10 次）
- CSP 安全头，支持内联脚本
- CSRF 防护（Origin 校验）
- 输入验证与大小限制（每条 paste 最大 100KB）

## 技术栈

| 分类 | 技术 |
|------|------|
| 前端 | Bootstrap 5, Prism.js, Bootstrap Icons |
| 后端 | Node.js, Express 5.2 |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | jsonwebtoken, bcryptjs |

## 许可证

GPL v3 © 2026 wenyinos
