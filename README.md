# Code PasteBin

简洁实用的代码粘贴与分享平台（单文件后端 + 单页前端）。

<p align="center">
  <img src="public/favicon/favicon-32x32.png" alt="Code PasteBin Logo" width="64" height="64">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js"></a>
</p>

在线演示: https://paste.wenyinos.com

## 功能特性

- 用户注册/登录（JWT，24 小时过期）
- 创建代码片段并生成短链接（8 位十六进制 short code）
- 公开查看最新 50 条代码片段
- Prism.js 语法高亮（多语言）
- 图形验证码（数学题）保护注册/登录
- 响应式页面，移动端可用

## 快速开始

```bash
npm install
npm start
# 或
node server.js
```

默认地址: `http://localhost:3331`

## 可用命令

- 安装依赖: `npm install`
- 启动服务: `npm start`
- 直接启动: `node server.js`

说明: 当前项目未配置测试套件、linter、typecheck。

## 架构说明

- 后端: `server.js`（Express 5.2，所有 API 与服务逻辑都在此文件）
- 数据库: `db.js` 初始化 SQLite schema，`database.sqlite` 首次启动自动创建
- 前端: `public/index.html`（单页应用，内含 HTML/CSS/JS）
- 构建: 无 build step，静态文件直接由 Express 提供

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

## 数据库结构

`users`
- `id`, `username`(unique), `password`, `created_at`

`pastes`
- `id`, `user_id`, `short_code`(unique), `content`, `language`, `created_at`

## 前端开发注意事项

- 语言下拉框使用 `id="pasteLanguage"`，展示标签使用 `id="displayPasteLanguage"`，不要复用同一个 id。
- `updateNav()` 解析 JWT 时必须做 `try...catch`，否则本地 token 异常会导致页面脚本中断。
- `loadPublicPaste` 与 `loadAllPastes` 必须都显式切换 `#mainSection` 和 `#publicView` 显示状态。
- Prism 代码块高亮推荐先清空 `code` 的 `className`，再用 `classList.add('language-{lang}')`。
- 分享链接需包含 `window.location.pathname`，不能只拼 `origin`，否则子路径部署会失效。

## 技术栈

| 分类 | 技术 |
|------|------|
| 前端 | Bootstrap 5, Prism.js, Bootstrap Icons |
| 后端 | Node.js, Express 5.2 |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | jsonwebtoken, bcryptjs |

## 目录结构

```text
PasteBin/
├── public/              # 单页前端资源
├── db.js                # SQLite 初始化
├── server.js            # 后端服务与 API
├── package.json         # 依赖与脚本
└── database.sqlite      # 运行后自动生成（已 gitignore）
```

## 安全与约束

- JWT 过期时间: 24h
- 密码哈希: `bcryptjs`
- 服务器显式阻止直接访问 `.sqlite` 数据库文件
- Express v5 路由/错误处理语义与 v4 有差异，扩展路由时需注意

## 许可证

GPL v3 © 2026 wenyinos

