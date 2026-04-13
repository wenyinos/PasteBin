# Code PasteBin

简约不失优美的代码分享平台

<p align="center">
  <img src="public/favicon/favicon-32x32.png" alt="Code PasteBin Logo" width="64" height="64">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js"></a>
</p>

**在线演示**: https://paste.wenyinos.com

## 功能特性

- ✅ 用户注册/登录（JWT 认证，24小时有效）
- ✅ 代码保存与分享，公开访问短链接
- ✅ 26 种编程语言语法高亮（Prism.js）
- ✅ 验证码登录保护（数学运算题，5分钟过期）
- ✅ 响应式设计，移动端友好

## 快速开始

```bash
npm install
npm start
# 访问 http://localhost:3331
```

## 技术栈

| 分类 | 技术 |
|------|------|
| **前端** | Bootstrap 5.3, Prism.js 1.29 |
| **后端** | Node.js, Express.js 5.2 |
| **数据库** | better-sqlite3 12.8 |
| **认证** | jsonwebtoken 9.0, bcryptjs 3.0 |

## 目录结构

```
PasteBin/
├── public/
│   ├── index.html         # 前端单页面应用
│   ├── robots.txt         # 阻止搜索引擎
│   └── favicon/           # Favicon 图标目录
├── db.js                  # SQLite 数据库初始化
├── server.js              # Express 后端服务
└── package.json           # 项目依赖配置
```

## 支持的语言

纯文本, JavaScript, TypeScript, Python, Java, C#, C++, C, Go, Rust, PHP, Ruby, Swift, Kotlin, HTML, CSS, SCSS, JSON, XML, YAML, Markdown, SQL, Bash, PowerShell, Dockerfile

## 许可证

GPL v3 © 2026 wenyinos

## 联系方式

- 邮箱: ruojiner@hotmail.com
- 项目主页: https://wenyinos.com
