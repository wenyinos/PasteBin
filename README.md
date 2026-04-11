# PasteBin

简约不失优美的代码分享平台

<p align="center">
  <img src="public/favicon.svg" alt="PasteBin Logo" width="64" height="64">
</p>

## 项目简介

PasteBin 是一个面向开发者的轻量级代码分享平台，采用 **Bootstrap 5** 架构，秉承"简约不失优美，实用美学主义"的设计理念。

## 功能特性

- ✅ 用户注册/登录（JWT 认证）
- ✅ 代码保存与分享
- ✅ 公开访问短链接
- ✅ 26 种编程语言语法高亮
- ✅ 验证码登录保护
- ✅ 响应式设计，移动端友好
- ✅ 精美 UI 设计（渐变色、卡片阴影、动画效果）
- ✅ 自定义 Favicon 图标

## 技术栈

| 分类 | 技术 |
|------|------|
| **前端** | Bootstrap 5, Prism.js, Bootstrap Icons |
| **后端** | Node.js, Express.js |
| **数据库** | SQLite |
| **认证** | JWT (jsonwebtoken), bcrypt.js |

## UI 设计

### 配色方案

| 颜色 | HEX 值 | 用途 |
|------|--------|------|
| 主题紫 | `#667eea` → `#764ba2` | 导航栏渐变 |
| 主题绿 | `#5cb85c` | 按钮、链接 |
| 背景灰 | `#fafafa` | 页面背景 |
| 文字色 | `#333` | 主文本 |

### 设计特点

- 🎨 渐变色导航栏
- 📦 圆角卡片（8px）带柔和阴影
- ✨ 悬停动画效果
- 🎭 淡入加载动画
- 📱 完全响应式布局

## 快速开始

```bash
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
| GET | `/api/pastes/all` | 获取所有分享 | ❌ |
| GET | `/api/paste/:code` | 获取单个分享 | ❌ |
| POST | `/api/register` | 用户注册 | ❌ |
| POST | `/api/login` | 用户登录 | ❌ |
| POST | `/api/pastes` | 创建分享 | ✅ |
| DELETE | `/api/pastes/:id` | 删除分享 | ✅ |
| GET | `/api/captcha` | 获取验证码 | ❌ |

## 目录结构

```
├── public/
│   ├── index.html         # 前端页面
│   ├── favicon.png        # PNG 图标 (64x64)
│   ├── favicon.svg        # SVG 矢量图标
│   └── robots.txt         # 爬虫配置
├── db.js                  # 数据库初始化
├── server.js              # 后端服务
├── package.json           # 项目配置
└── README.md              # 项目文档
```

## 使用指南

### 1. 注册/登录
- 点击右上角的"注册"按钮创建账号
- 需要通过验证码验证

### 2. 创建代码片段
- 登录后点击顶部的"新建代码片段"按钮
- 选择编程语言
- 输入内容并保存

### 3. 分享代码
- 保存后自动生成短链接
- 可通过 `?s=短码` 访问公开内容

## 许可证

Copyleft © 玟茵开源社区 2013-2026

## 联系方式

- 邮箱: ruojiner@hotmail.com
- 项目主页: https://wenyinos.com
