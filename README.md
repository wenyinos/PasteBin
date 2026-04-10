# PasteBin

简单代码分享应用

## 功能特性

- 用户注册/登录（JWT认证）
- 代码保存与分享
- 公开访问短链接
- 26种编程语言语法高亮
- 验证码登录保护
- 阻止搜索引擎爬虫

## 技术栈

- 前端：Bootstrap 5 + Prism.js
- 后端：Node.js + Express
- 数据库：SQLite

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

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/pastes/all | 获取所有分享 |
| GET | /api/paste/:code | 获取单个分享 |
| POST | /api/register | 用户注册 |
| POST | /api/login | 用户登录 |
| POST | /api/pastes | 创建分享 |
| DELETE | /api/pastes/:id | 删除分享 |
| GET | /api/captcha | 获取验证码 |

## 目录结构

```
├── public/
│   └── index.html    # 前端页面
├── db.js            # 数据库初始化
├── server.js        # 后端服务
└── package.json     # 项目配置
```

## 许可证

Copyright © 2026 wenyinos. All rights reserved.