# PasteBin

简约不失优美的代码分享平台

<p align="center">
  <img src="public/favicon.svg" alt="PasteBin Logo" width="64" height="64">
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3">
  </a>
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js">
  </a>
</p>

## 项目简介

PasteBin 是一个面向开发者的轻量级代码分享平台，采用 **Bootstrap 5** 架构，秉承"简约不失优美，实用美学主义"的设计理念。

**在线演示**: https://wenyinos.com

## 功能特性

- ✅ 用户注册/登录（JWT 认证，24小时有效）
- ✅ 代码保存与分享
- ✅ 公开访问短链接（8位十六进制码）
- ✅ 26 种编程语言语法高亮（Prism.js）
- ✅ 验证码登录保护（数学运算题，5分钟过期）
- ✅ 响应式设计，移动端友好
- ✅ 精美 UI 设计（渐变色、卡片阴影、动画效果）
- ✅ 自定义 Favicon 图标
- ✅ 用户可删除自己的代码片段
- ✅ 阻止搜索引擎爬虫

## 技术栈

| 分类 | 技术 |
|------|------|
| **前端** | Bootstrap 5.3, Prism.js 1.29, Bootstrap Icons 1.11 |
| **后端** | Node.js, Express.js 4.18 |
| **数据库** | better-sqlite3 9.2 |
| **认证** | jsonwebtoken 9.0, bcryptjs 2.4 |
| **其他** | cors 2.8, crypto (内置) |

## UI 设计

### 配色方案

| 颜色 | HEX 值 | 用途 |
|------|--------|------|
| 主题紫 | `#667eea` → `#764ba2` | 导航栏渐变 |
| 主题绿 | `#5cb85c` | 主按钮、链接 |
| 背景灰 | `#fafafa` | 页面背景 |
| 文字色 | `#333` | 主文本 |
| 次要文字 | `#6c757d` | 辅助文本 |

### 设计特点

- 🎨 渐变色导航栏
- 📦 圆角卡片（8px）带柔和阴影
- ✨ 悬停动画效果（卡片上浮 + 阴影加深）
- 🎭 淡入加载动画
- 📱 完全响应式布局

### 导航栏布局

| 左侧 | 中间 | 右侧 |
|------|------|------|
| PasteBin 品牌 | 新建代码片段按钮（仅登录） | 登录/注册、用户名、退出、项目主页 |

## 快速开始

```bash
# 克隆项目
git clone <repository-url>
cd PasteBin

# 安装依赖
npm install

# 启动服务
npm start

# 访问地址
http://localhost:3000
```

## API 接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/pastes/all` | 获取所有分享（最新50条） | ❌ |
| GET | `/api/paste/:code` | 获取单个分享 | ❌ |
| POST | `/api/register` | 用户注册 | ❌ |
| POST | `/api/login` | 用户登录 | ❌ |
| POST | `/api/pastes` | 创建分享 | ✅ |
| DELETE | `/api/pastes/:id` | 删除分享 | ✅ |
| GET | `/api/captcha` | 获取验证码 | ❌ |

### 请求示例

**注册**
```json
POST /api/register
{
  "username": "user123",
  "password": "pass123",
  "captchaKey": "abc123",
  "captchaAnswer": "15"
}
```

**登录**
```json
POST /api/login
{
  "username": "user123",
  "password": "pass123",
  "captchaKey": "abc123",
  "captchaAnswer": "15"
}
```

**创建代码片段**
```json
POST /api/pastes
Authorization: Bearer <token>
{
  "content": "console.log('Hello World')",
  "language": "javascript"
}
```

## 数据库结构

### users 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| username | TEXT | 用户名，唯一 |
| password | TEXT | 密码（bcrypt 加密） |

### pastes 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| user_id | INTEGER | 外键，关联 users.id |
| short_code | TEXT | 短链接码，8位十六进制 |
| content | TEXT | 代码内容 |
| language | TEXT | 编程语言，默认 plaintext |
| created_at | DATETIME | 创建时间 |

## 目录结构

```
PasteBin/
├── public/
│   ├── index.html         # 前端页面
│   ├── favicon.png        # PNG 图标 (64x64)
│   ├── favicon.svg        # SVG 矢量图标
│   └── robots.txt         # 阻止搜索引擎
├── db.js                  # SQLite 数据库初始化
├── server.js              # Express 后端服务
├── package.json           # 项目配置
├── package-lock.json      # 依赖锁定文件
├── .gitignore             # Git 忽略配置
└── README.md              # 项目文档
```

## 使用指南

### 1. 注册/登录
- 点击右上角的"注册"按钮创建账号
- 需要通过验证码验证（简单数学题）

### 2. 创建代码片段
- 登录后点击顶部中间的"新建代码片段"按钮
- 选择编程语言（支持26种语言）
- 输入内容并保存

### 3. 分享代码
- 保存后自动生成短链接
- 可通过 `?s=短码` 访问公开内容

### 4. 删除代码
- 用户只能删除自己的代码片段
- 点击"删除"按钮确认后即可删除

## 支持的语言

纯文本, JavaScript, TypeScript, Python, Java, C#, C++, C, Go, Rust, PHP, Ruby, Swift, Kotlin, HTML, CSS, SCSS, JSON, XML, YAML, Markdown, SQL, Bash, PowerShell, Dockerfile

## 安全特性

- 🔒 密码使用 bcrypt 加密存储
- 🔑 JWT Token 认证，24小时过期
- 🛡️ 验证码保护，防止暴力破解
- 🔐 数据库访问限制，阻止直接访问 .sqlite 文件
- 🚫 CORS 配置

## 浏览器兼容性

| 浏览器 | 版本 |
|--------|------|
| Chrome | 90+ |
| Firefox | 88+ |
| Safari | 14+ |
| Edge | 90+ |

## 许可证

本项目基于 GPL v3 许可证发布

Copyright © 2026 wenyinos. All rights reserved.

## 联系方式

- 邮箱: ruojiner@hotmail.com
- 项目主页: https://wenyinos.com
