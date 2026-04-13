# Code PasteBin - 项目上下文

## 项目概述

Code PasteBin 是一个面向开发者的轻量级代码分享平台，秉承"简约不失优美，实用美学主义"的设计理念。项目采用前后端分离架构（但部署在同一服务中），提供代码保存、分享、查看和删除等核心功能。

**在线演示**: https://paste.wenyinos.com

### 核心功能

- ✅ 用户注册/登录（JWT 认证，24小时有效）
- ✅ 代码保存与分享
- ✅ 公开访问短链接（8位十六进制码）
- ✅ 26 种编程语言语法高亮（Prism.js）
- ✅ 验证码登录保护（数学运算题，5分钟过期）
- ✅ 响应式设计，移动端友好
- ✅ 用户可删除自己的代码片段
- ✅ 阻止搜索引擎爬虫

## 技术栈

| 分类 | 技术 |
|------|------|
| **前端** | Bootstrap 5.3, Prism.js 1.29, Bootstrap Icons 1.11 |
| **后端** | Node.js, Express.js 5.2 |
| **数据库** | better-sqlite3 12.8 |
| **认证** | jsonwebtoken 9.0, bcryptjs 3.0 |
| **其他** | cors 2.8, crypto (内置) |

## 项目结构

```
PasteBin/
├── public/
│   ├── index.html         # 前端单页面应用
│   ├── robots.txt         # 阻止搜索引擎
│   └── favicon/           # Favicon 图标目录
├── db.js                  # SQLite 数据库初始化（users, pastes 表）
├── server.js              # Express 后端服务（API 路由、认证、中间件）
├── package.json           # 项目依赖配置
├── .gitignore             # Git 忽略配置
└── database.sqlite        # SQLite 数据库文件（运行时生成，已忽略）
```

## 数据库结构

### users 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| username | TEXT | 用户名，唯一 |
| password | TEXT | 密码（bcrypt 加密） |
| created_at | DATETIME | 创建时间 |

### pastes 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 外键，关联 users.id |
| short_code | TEXT | 短链接码，8位十六进制，唯一 |
| content | TEXT | 代码内容 |
| language | TEXT | 编程语言，默认 plaintext |
| created_at | DATETIME | 创建时间 |

## API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/captcha` | 获取验证码 | ❌ |
| POST | `/api/register` | 用户注册 | ❌ |
| POST | `/api/login` | 用户登录 | ❌ |
| GET | `/api/pastes` | 获取当前用户的所有分享 | ✅ |
| GET | `/api/pastes/all` | 获取所有公开分享（最新50条） | ❌ |
| POST | `/api/pastes` | 创建代码分享 | ✅ |
| GET | `/api/paste/:shortCode` | 获取单个分享 | ❌ |
| DELETE | `/api/pastes/:id` | 删除分享（仅作者） | ✅ |

## 构建与运行

```bash
# 安装依赖
npm install

# 启动服务（默认端口 3331）
npm start

# 访问地址
http://localhost:3331
```

## 开发约定

### 后端
- 使用 Express.js 构建 RESTful API
- JWT 认证通过 `authenticate` 中间件实现
- 验证码存储在内存 Map 中，5分钟自动过期
- 密码使用 bcrypt 加密（salt rounds: 10）
- 数据库使用 better-sqlite3 同步操作
- CORS 配置允许所有来源（`Access-Control-Allow-Origin: *`）
- 阻止对 `.sqlite` 文件的直接访问

### 前端
- 单页面应用（SPA），使用原生 JavaScript + Bootstrap 5
- 通过 CDN 引入 Bootstrap、Prism.js 等依赖
- 使用 CSS 变量管理主题色
- 代码高亮使用 Prism.js，支持 26 种编程语言
- 认证 token 存储在 localStorage

### 安全特性
- 🔒 密码使用 bcrypt 加密存储
- 🔑 JWT Token 认证，24小时过期
- 🛡️ 验证码保护，防止暴力破解
- 🔐 数据库访问限制，阻止直接访问 .sqlite 文件
- 🚫 CORS 配置

## 配色方案

| 颜色 | HEX 值 | 用途 |
|------|--------|------|
| 主题紫 | `#667eea` → `#764ba2` | 导航栏渐变 |
| 主题绿 | `#5cb85c` | 主按钮、链接 |
| 背景灰 | `#fafafa` | 页面背景 |
| 文字色 | `#333` | 主文本 |
| 次要文字 | `#6c757d` | 辅助文本 |

## 支持的语言

纯文本, JavaScript, TypeScript, Python, Java, C#, C++, C, Go, Rust, PHP, Ruby, Swift, Kotlin, HTML, CSS, SCSS, JSON, XML, YAML, Markdown, SQL, Bash, PowerShell, Dockerfile

## 注意事项

- 项目使用硬编码的 JWT_SECRET (`pastebin-secret-key-2024`)，生产环境应改为环境变量
- 验证码存储在内存中，不适用于分布式部署
- 端口固定为 3331，可在 `server.js` 中修改
- 数据库文件 `database.sqlite` 在首次运行时自动创建
