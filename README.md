# Atoms Demo - AI 驱动的应用生成平台

这是一个类似 [Atoms](https://atoms.dev/) 的 AI 驱动代码生成平台 Demo，通过对话方式快速生成可运行的网页应用。

## ✨ 功能特性

- 🤖 **AI 智能对话**：通过自然语言描述需求，AI 自动生成代码
- 🎨 **实时预览**：即时查看生成的应用效果
- 📱 **响应式设计**：支持桌面、平板、移动端三种预览模式
- 🐛 **Console 监控**：实时捕获并显示应用运行日志和错误
- ⚡ **快速生成**：基于 GPT-4o 的强大代码生成能力

## 🛠️ 技术栈

- **前端框架**: Next.js 16 (App Router) + React 19
- **样式方案**: Tailwind CSS 4
- **AI 服务**: Groq (Llama 3.3 70B) - 超快速度，免费额度
- **语言**: TypeScript
- **部署**: Vercel (推荐)

## 📦 安装步骤

### 1. 克隆项目

```bash
git clone <your-repo-url>
cd atoms-demo
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

创建 `.env.local` 文件：

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入你的 Groq API Key：

```env
# Groq API Key
GROQ_API_KEY=gsk-your-actual-api-key-here

# Database (SQLite)
DATABASE_URL="file:./dev.db"
```

> 💡 **如何获取 Groq API Key**：
> 1. 访问 [console.groq.com](https://console.groq.com/)
> 2. 注册/登录账号（支持 Google 登录）
> 3. 进入 API Keys 页面
> 4. 点击 "Create API Key"
> 5. 复制生成的 key（格式：`gsk-...`）
> 
> **为什么选择 Groq？**
> - ⚡ 超快速度（比 OpenAI 快 10-20 倍）
> - 💰 免费额度充足
> - 🎯 Llama 3.3 70B 模型质量优秀

### 4. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 🚀 使用方法

1. **输入需求**：在左侧聊天框中描述你想要创建的应用
   
   示例提示词：
   - "创建一个待办事项应用，支持添加、删除和标记完成"
   - "制作一个计数器，有增加、减少和重置按钮"
   - "做一个简单的计算器"

2. **等待生成**：AI 会自动生成 HTML、CSS 和 JavaScript 代码

3. **实时预览**：右侧会立即显示生成的应用效果

4. **切换设备**：使用顶部按钮切换不同设备尺寸的预览

5. **查看 Console**：底部控制台会显示应用的运行日志

## 📁 项目结构

```
atoms-demo/
├── app/                        # Next.js App Router
│   ├── page.tsx               # 主页面
│   ├── layout.tsx             # 布局
│   └── api/
│       └── generate/
│           └── route.ts       # AI 代码生成 API
├── components/
│   ├── chat/                  # 聊天相关组件
│   │   ├── ChatPanel.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   └── ChatInput.tsx
│   ├── preview/               # 预览相关组件
│   │   ├── PreviewPanel.tsx
│   │   └── IframePreview.tsx
│   └── ui/                    # 基础 UI 组件
│       ├── Button.tsx
│       └── Input.tsx
├── lib/
│   ├── db.ts                  # 数据库配置 (Prisma)
│   └── prompts.ts             # AI Prompt 工程
├── prisma/
│   └── schema.prisma          # 数据库模型
└── package.json
```

## 🎯 核心实现

### 1. AI Prompt 工程

位于 `lib/prompts.ts`，精心设计的 System Prompt 确保 AI 输出格式化的 JSON 代码：

```typescript
{
  "html": "HTML 内容",
  "css": "CSS 样式",
  "js": "JavaScript 代码",
  "description": "功能说明"
}
```

### 2. 沙箱预览

使用 iframe + sandbox 属性实现安全隔离：
- `allow-scripts`: 允许运行 JavaScript
- `allow-same-origin`: 允许访问同源资源
- 通过 `postMessage` 捕获控制台输出

### 3. 响应式设计

支持三种设备尺寸：
- Desktop: 100% 宽度
- Tablet: 768px
- Mobile: 375px

## 🔧 核心 API

### POST /api/generate

生成代码的核心接口。

**请求参数：**
```json
{
  "prompt": "用户的需求描述",
  "projectId": "项目ID"
}
```

**响应示例：**
```json
{
  "success": true,
  "code": {
    "html": "...",
    "css": "...",
    "js": "...",
    "description": "功能说明"
  }
}
```

## 📝 开发日志

### 已实现功能

- ✅ 左右分栏布局
- ✅ AI 对话界面
- ✅ 实时代码生成
- ✅ iframe 沙箱预览
- ✅ 多设备响应式预览
- ✅ Console 输出捕获
- ✅ 错误处理和提示

### 待扩展功能

- ⏳ 代码编辑器（Monaco Editor）
- ⏳ 项目保存和历史记录
- ⏳ 代码版本管理
- ⏳ 代码导出功能
- ⏳ 多项目管理
- ⏳ 用户认证系统

## 🌐 部署到 Vercel

### 方式一：通过 Vercel Dashboard

1. 将代码推送到 GitHub
2. 访问 [vercel.com](https://vercel.com)
3. 导入你的 GitHub 仓库
4. 配置环境变量 `OPENAI_API_KEY`
5. 点击部署

### 方式二：通过 Vercel CLI

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel --prod
```

记得在 Vercel Dashboard 中设置环境变量！

## 🐛 故障排除

### 1. API Key 错误

**错误**：`401 Unauthorized` 或 `Missing credentials`

**解决**：检查 `.env.local` 中的 `GROQ_API_KEY` 是否正确配置。

### 2. 生成失败

**错误**：代码生成失败或格式不正确

**解决**：
- 检查网络连接
- 确认 API Key 有足够额度
- 尝试更详细地描述需求

### 3. 预览不显示

**错误**：右侧预览区域空白

**解决**：
- 打开浏览器控制台查看错误
- 检查生成的代码是否有语法错误
- 查看 iframe Console 输出

## 📄 许可证

MIT License

## 🙏 致谢

- [Atoms](https://atoms.dev/) - 灵感来源
- [Next.js](https://nextjs.org/) - 全栈框架
- [Groq](https://groq.com/) - 超快 AI 推理
- [Tailwind CSS](https://tailwindcss.com/) - 样式方案

---

## 🆚 与主流 Coding Agent 的横向对比

下表以 **v0.dev**、**Bolt.new**、**Lovable**、**Devin** 作为参照系，逐维度评估本项目的实现程度。

### 对比维度总览

| 能力维度 | v0.dev | Bolt.new | Lovable | Devin | **本项目** |
|---------|--------|----------|---------|-------|-----------|
| 对话式代码生成 | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| 实时预览 | ✅ 完整 | ✅ WebContainer | ✅ 完整 | ❌ 无 UI | ✅ iframe + WebContainer(部分) |
| 多文件工程生成 | ✅ | ✅ | ✅ | ✅ | ✅ 完整 |
| 多架构支持 | React | 全栈 | React | 任意 | React-TS / Vue3-TS / Vanilla-TS / HTML |
| TypeScript 验证 | ✅ | ✅ | ✅ | ✅ | ✅ tsc --noEmit 自动修复循环 |
| 自愈式错误修复 | ❌ | ✅ 基础 | ✅ 基础 | ✅ 强 | ✅ 3次自动修复 + 终端错误捕获 |
| 符号索引 / 上下文检索 | ❌ | ❌ | ❌ | ✅ | ✅ 关键词索引 + Symbol 表 |
| 代码审查 Skill | ❌ | ❌ | ❌ | ✅ | ✅ CodeReviewSkill |
| 数据持久化 | ✅ 云端 | ✅ 云端 | ✅ 云端 | ✅ | ✅ PostgreSQL + Prisma |
| 用户认证 | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ | ⚠️ 基础（用户名/密码） |
| 实时推送（SSE/WS） | ✅ | ✅ WebSocket | ✅ | ✅ | ✅ SSE（适配 Vercel Serverless） |
| 代码版本管理 / 回滚 | ✅ | ✅ | ✅ | ✅ | ⚠️ 数据表已建，UI 未完成 |
| 代码编辑器（Monaco） | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ | ⚠️ 仅代码查看，不支持编辑 |
| 导出 / 分享 / 一键部署 | ✅ | ✅ | ✅ | ✅ | ❌ 未实现 |
| 多人协作 | ❌ | ❌ | ❌ | ❌ | ❌ 未实现 |

---

### 各功能模块详细实现程度

#### ✅ 完整实现（达到或超越主流产品）

**1. VIP Agent 状态机工作流（核心亮点）**

业界产品大多是「一次生成 → 用户反馈 → 再生成」的简单循环，本项目实现了完整的 8 阶段串行状态机：

```
Intent & Retrieval
  → MultiFileCodeGen（XML 格式多文件）
  → Validation Loop（tsc --noEmit，最多 3 次自动修复）
  → WebContainer Compatibility Check（文件名大小写、路径格式）
  → EsbuildCompile Check（检测缺失文件、错误 import）
  → Code Review（质量审查）
  → Persistence（事务原子写入 PostgreSQL）
  → Reindex（符号索引自更新）
```

**2. 符号索引与关键词检索**

- 维护 `symbols` 表，存储函数签名、interface、class、React 组件
- 用户每次提 prompt，先提取关键词 → 检索相关符号 → 注入上下文
- 效果：Agent 修改已有代码时能「看到」相关函数签名，避免重复定义
- 业界对比：Devin 有类似能力，v0/Bolt/Lovable 均无此机制

**3. 自愈式错误修复**

- `WebContainerHealer`：监听 WebContainer 的 stdout/stderr，正则匹配运行时错误（Module not found、SyntaxError、TypeError 等），自动去重后送回 Agent
- `WebContainerHotReload`：WebSocket 监听文件更新，检测 `package.json` 变化时静默执行 `npm install`，0 延迟同步文件到 WebContainer
- `/api/fix-errors`：专用错误修复 API，最多尝试 3 次

**4. 多架构代码生成**

支持 4 种前端架构的完整模板和规范：
- `react-ts`：React 18 + TypeScript + Vite + Tailwind
- `vue3-ts`：Vue 3 Composition API + TypeScript + Vite
- `vanilla-ts`：原生 TypeScript + Vite
- `html-only`：纯 HTML/CSS/JS（单文件）

每种架构都有完整的代码生成指令、禁止扩展名约束和必须文件列表。

**5. SSE 实时推送（适配 Serverless）**

- 使用数据库表 `sse_events` 作为 SSE 消息队列，解决 Vercel Serverless 多实例隔离导致内存 SSE 失效的问题
- `/api/events/[sessionId]`：长轮询 SSE 端点，前端订阅 Agent 进度和文件更新

**6. 完整数据库 Schema**

包含 8 张核心表：`projects`、`messages`、`code_versions`、`symbols`、`users`、`sessions`、`files`、`sse_events`、`chat_messages`，覆盖项目管理、符号索引、会话管理、文件存储全链路。

---

#### ⚠️ 部分实现（代码存在但有局限）

**1. WebContainer 集成（约 60% 完整度）**

- ✅ 已实现：`WebContainerPreview.tsx`（1465 行）、`webcontainer/` 子模块（9 个文件）、热更新、错误修复
- ⚠️ 限制：需要服务器设置 `COOP`/`COEP` HTTP 头，Vercel 默认不支持，导致生产环境中该功能无法正常使用
- 未实现：完整的终端 UI 展示（类 Bolt.new 体验）

**2. 用户认证（约 40% 完整度）**

- ✅ 已实现：`LoginForm.tsx` + `CreateProjectForm.tsx` + `/api/auth`，基于用户名/密码（MD5 加盐），雪花算法 ID
- ⚠️ 缺失：JWT/Session Cookie 管理、路由守卫、登出逻辑、OAuth 登录
- 未实现：登录态在页面刷新后无法保持

**3. 代码版本管理（约 30% 完整度）**

- ✅ 已实现：数据库 `code_versions` 表结构（含 html/css/js/version 字段）
- ⚠️ 缺失：版本列表 UI、版本对比（diff 视图）、一键回滚功能

**4. Monaco 代码编辑器（约 20% 完整度）**

- ✅ 已实现：文件树展示、代码查看（带语法高亮）
- ⚠️ 缺失：编辑后实时触发重新预览、保存到数据库、diff 视图

**5. workflow-v1 模块（约 70% 完整度）**

- ✅ 已实现：`intent-analyzer`、`code-generator`、`context-builder`、`file-writer`、`ast-validator`、`runtime-executor`（均含对应 test 文件）
- ⚠️ 与 VIP Agent 的集成未完全打通，目前两套流程并存

---

#### ❌ 未实现（对标主流产品缺失）

| 功能 | 主流产品如何实现 | 本项目状态 |
|------|----------------|-----------|
| **代码导出 / ZIP 下载** | v0/Bolt/Lovable 均支持一键下载完整项目 | 无任何导出入口 |
| **分享链接** | 生成公开 URL，任何人可预览 | 未实现 |
| **一键部署到 Vercel/Netlify** | Bolt.new 有 Deploy to Vercel 按钮 | 未实现 |
| **代码 Diff 展示** | 多数产品展示每次修改的 diff | 未实现 |
| **模板库** | v0 有组件库、Lovable 有项目模板 | 未实现 |
| **多人协作** | 无主流产品实现（均为单人） | 未实现 |
| **图片 / 资源上传** | v0/Bolt 支持上传图片作为参考 | `/api/images` 路由存在但前端入口缺失 |

---

### 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **Agent 架构深度** | ⭐⭐⭐⭐⭐ | 状态机 + 8大 Skill 模块 + 自愈，在同类 Demo 中少见 |
| **核心预览体验** | ⭐⭐⭐⭐ | iframe 完整可用；WebContainer 受部署限制 |
| **数据持久化** | ⭐⭐⭐⭐ | Schema 完整，连接实际 PostgreSQL |
| **用户系统** | ⭐⭐ | 基础骨架，登录态持久化未完成 |
| **编辑器体验** | ⭐⭐ | 只读查看，无编辑能力 |
| **导出 / 分享** | ⭐ | 几乎未实现 |
| **整体完成度** | **~65%** | 相对于完整商业产品 |

> **核心判断**：本项目在 **Agent 工作流设计**（符号检索、多阶段验证、自愈循环）上投入了超出 Demo 水位的工程深度，接近工业级 coding agent 的内核架构；但在**用户体验层**（编辑器、导出、分享、完整认证）上尚有较大差距，这是时间有限下有意识的取舍。

---

**Made with ❤️ for ROOT AI Native 全栈岗位笔试**
