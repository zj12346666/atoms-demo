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

**Made with ❤️ for ROOT AI Native 全栈岗位笔试**
