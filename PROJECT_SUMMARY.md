# Atoms Demo 项目总结

## 📋 项目概述

**Atoms Demo** 是一个 AI 驱动的应用生成平台，通过自然语言对话快速生成可运行的网页应用。类似 [Atoms.dev](https://atoms.dev/) 的实现，支持实时预览、多设备响应式展示和代码生成。

## 🎯 核心功能

### 1. AI 智能代码生成
- 通过自然语言描述需求，AI 自动生成 HTML、CSS、JavaScript 代码
- 基于 Groq (Llama 3.3 70B) 模型，响应速度快
- 支持结构化 JSON 格式输出

### 2. 实时预览系统
- iframe 沙箱隔离预览
- 支持桌面、平板、移动端三种设备尺寸
- 实时捕获 Console 输出和错误信息

### 3. 对话式交互
- 左右分栏布局（聊天 + 预览）
- 消息历史记录
- 工作流进度展示

### 4. 项目管理
- 项目创建和管理
- 会话管理
- 文件树展示
- 代码查看器（Monaco Editor）

## 🛠️ 技术架构

### 前端技术栈
- **框架**: Next.js 16 (App Router) + React 19
- **样式**: Tailwind CSS 4
- **语言**: TypeScript
- **编辑器**: Monaco Editor

### 后端技术栈
- **AI 服务**: Groq API (Llama 3.3 70B)
- **数据库**: Prisma + SQLite
- **API**: Next.js API Routes

### 核心特性
- **沙箱预览**: iframe + sandbox 属性实现安全隔离
- **WebSocket**: 实时通信支持（可选）
- **WebContainer**: 浏览器内运行 Node.js 环境（可选）

## 📁 项目结构

```
atoms-demo/
├── app/                    # Next.js App Router
│   ├── api/               # API 路由
│   │   ├── generate/      # 代码生成
│   │   ├── chat/          # 聊天接口
│   │   ├── vip-agent/     # VIP Agent 工作流
│   │   └── webcontainer/  # WebContainer 集成
│   ├── page.tsx           # 主页面
│   └── layout.tsx         # 布局
├── components/            # React 组件
│   ├── chat/             # 聊天组件
│   ├── preview/          # 预览组件
│   ├── files/            # 文件管理组件
│   └── ui/               # 基础 UI 组件
├── lib/                  # 核心库
│   ├── vip-workflow-manager.ts  # VIP 工作流管理
│   ├── session-manager.ts       # 会话管理
│   └── skills/           # AI 技能模块
├── prisma/               # 数据库
│   └── schema.prisma    # 数据模型
└── docs/                # 技术文档
```

## 🚀 快速开始

### 1. 环境要求
- Node.js 18+
- npm/pnpm

### 2. 安装步骤

```bash
# 克隆项目
git clone <repo-url>
cd atoms-demo

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入 GROQ_API_KEY

# 初始化数据库
npx prisma migrate dev

# 启动开发服务器
npm run dev
```

### 3. 环境变量配置

```env
# Groq API Key
GROQ_API_KEY=gsk-your-api-key-here

# Database
DATABASE_URL="file:./dev.db"
```

## ✨ 核心实现

### 1. AI Prompt 工程
- 精心设计的 System Prompt 确保输出格式
- JSON 结构化输出：`{ html, css, js, description }`
- 错误处理和重试机制

### 2. 沙箱预览
- iframe sandbox 属性实现安全隔离
- `postMessage` API 捕获控制台输出
- 支持动态代码注入和更新

### 3. VIP Agent 工作流
- 多步骤代码生成流程
- 错误自动修复（Self-healing）
- 代码审查和优化

### 4. 会话管理
- 项目级别的会话隔离
- 消息历史持久化
- 状态管理

## 📊 项目状态

### ✅ 已实现功能
- [x] AI 对话界面
- [x] 实时代码生成
- [x] iframe 沙箱预览
- [x] 多设备响应式预览
- [x] Console 输出捕获
- [x] 项目管理
- [x] 会话管理
- [x] VIP Agent 工作流
- [x] 代码审查技能
- [x] 错误自动修复

### 🔄 待扩展功能
- [ ] 代码编辑器集成（Monaco Editor 完整功能）
- [ ] 代码版本管理
- [ ] 代码导出功能
- [ ] 用户认证系统
- [ ] 多用户协作
- [ ] WebContainer 完整集成

## 🔧 核心 API

### POST /api/generate
生成代码的核心接口

**请求**:
```json
{
  "prompt": "用户需求描述",
  "projectId": "项目ID"
}
```

**响应**:
```json
{
  "success": true,
  "code": {
    "html": "...",
    "css": "...",
    "js": "...",
    "description": "..."
  }
}
```

### POST /api/vip-agent
VIP Agent 工作流接口

### POST /api/chat
聊天消息接口

## 📚 相关文档

项目包含详细的技术文档，位于 `docs/` 目录：

- `QUICKSTART.md` - 快速开始指南
- `IMPLEMENTATION.md` - 实现细节
- `VIP_AGENT_IMPLEMENTATION.md` - VIP Agent 实现
- `WEBSOCKET_INTEGRATION.md` - WebSocket 集成
- `DEPLOYMENT.md` - 部署指南

## 🌐 部署

### Vercel 部署（推荐）

1. 推送代码到 GitHub
2. 在 Vercel Dashboard 导入仓库
3. 配置环境变量：
   - `GROQ_API_KEY`
   - `DATABASE_URL`
4. 部署

### 环境变量配置
确保在生产环境配置所有必要的环境变量。

## 🐛 常见问题

### API Key 错误
- 检查 `.env.local` 中的 `GROQ_API_KEY` 配置
- 确认 API Key 有效且有足够额度

### 预览不显示
- 检查浏览器控制台错误
- 查看生成的代码语法
- 检查 iframe Console 输出

### 数据库错误
- 运行 `npx prisma migrate dev` 初始化数据库
- 检查 `DATABASE_URL` 配置

## 📄 许可证

MIT License

## 🙏 致谢

- [Atoms](https://atoms.dev/) - 灵感来源
- [Next.js](https://nextjs.org/) - 全栈框架
- [Groq](https://groq.com/) - 超快 AI 推理
- [Tailwind CSS](https://tailwindcss.com/) - 样式方案

---

**项目类型**: AI 代码生成平台  
**开发状态**: 持续开发中  
**最后更新**: 2026-03-02
