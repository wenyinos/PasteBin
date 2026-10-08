# Code PasteBin

简洁实用的代码粘贴与分享平台（单文件后端 + 单页前端）。

在线演示: https://paste.wenyinos.com

## 功能特性

- 使用玟茵统一账号登录（认证中心 SSO）；本地会话采用 JWT（24 小时过期）
- 创建代码片段并生成短链接（16 位十六进制 short code）
- 公开查看最新 50 条代码片段
- Prism.js 语法高亮（25+ 语言）
- 日间/夜间主题切换（记忆偏好，默认跟随系统）
- 紫色主题设计（参照玟茵开源社区）
- 单点登出（写操作自动校验中心票据有效性）
- 响应式页面，移动端可用
- 资源全本地托管（字体/CSS/JS），无 CDN 依赖，可离线运行

## 统一认证

登录 / 注册 / 退出全部由[玟茵认证中心](https://wenyinos.com/auth)处理，**本地不保存任何密码**。在 `.env` 中配置中心连接（模板：`.env.example`）：

- `WY_SSO_API_URL` / `WY_SSO_APP_ID`（`paste`）/ `WY_SSO_SECRET` —— 由认证中心后台「应用密钥」页签发
- `WY_SSO_LOGIN_URL` / `WY_SSO_LOGOUT_URL` —— 中心登录 / 退出页地址

浏览器携带中心的 HttpOnly `wy_auth` 票据 cookie，后端经 `GET /api/sso` 兑换为本地 JWT。**账号未开通本站时自动定向回认证中心**（面板显示未开通原因）；中心不可达时仅公开浏览可用（无本地密码兜底）。

## 快速开始

```bash
npm install
cp .env.example .env   # 填写 WY_SSO_* 配置
npm start
```

默认地址: `http://localhost:3331`

## 架构说明

- 后端: `server.js`（Express 5.2，所有 API 与服务逻辑；含 HMAC 签名的中心 API 客户端）
- 数据库: `db.js` 初始化 SQLite schema（`users.sso_uid` 映射中心用户 ID），`database.sqlite` 首次启动自动创建
- 前端: `public/index.html`（页面结构与脚本）、`public/css/theme.css`（主题设计系统）、`public/js/theme.js`（主题切换）

## API 一览

| Method | Path | Auth |
|--------|------|------|
| GET | /api/config | No（登录/退出地址） |
| GET | /api/sso | No（中心票据兑换本地 JWT；需携带 `wy_auth` cookie） |
| POST | /api/pastes | JWT |
| GET | /api/pastes | JWT |
| GET | /api/pastes/all | No |
| GET | /api/paste/:shortCode | No |
| DELETE | /api/pastes/:id | JWT（仅本人） |

## 安全特性

- 统一认证 —— 本地不保存密码（原生注册/登录已移除）
- 单点登出：写操作（POST/DELETE）每 30 分钟校验一次中心票据
- HMAC-SHA256 签名的中心 API 调用（时间窗 + 一次性 nonce 防重放）
- SSO 兑换接口速率限制
- JWT secret 未设置时自动生成（重启后 token 失效）
- CSP 安全头，支持内联脚本
- 输入验证与大小限制（每条 paste 最大 100KB）

## 技术栈

| 分类 | 技术 |
|------|------|
| 前端 | Bootstrap 5, Prism.js, Bootstrap Icons, 本地 woff2 字体 |
| 后端 | Node.js, Express 5.2 |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | jsonwebtoken + 玟茵认证中心（SSO） |

## 许可证

GPL v3 © 2026 wenyinos
