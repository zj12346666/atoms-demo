# Atoms Demo 部署指南

## 🚀 快速部署到 Vercel

### 方式一：通过 Vercel Dashboard（推荐）

1. **准备工作**
   - 确保代码已推送到 GitHub 仓库
   - 准备好 OpenAI API Key

2. **导入项目**
   - 访问 [vercel.com/new](https://vercel.com/new)
   - 点击 "Import Project"
   - 选择你的 GitHub 仓库

3. **配置环境变量**
   
   在 Vercel 项目设置中添加环境变量：
   
   | Name | Value |
   |------|-------|
   | `OPENAI_API_KEY` | `sk-your-actual-api-key` |
   | `DATABASE_URL` | `file:./dev.db` (可选) |

4. **部署**
   - 点击 "Deploy"
   - 等待构建完成（约 1-2 分钟）
   - 获取部署链接：`https://your-project.vercel.app`

### 方式二：通过 Vercel CLI

```bash
# 1. 安装 Vercel CLI
npm install -g vercel

# 2. 登录
vercel login

# 3. 首次部署
vercel

# 4. 配置环境变量
vercel env add OPENAI_API_KEY

# 5. 生产环境部署
vercel --prod
```

## 🔧 环境变量配置

### 必需的环境变量

```env
# OpenAI API Key（必需）
OPENAI_API_KEY=sk-your-actual-api-key-here
```

### 可选的环境变量

```env
# 数据库连接（未来扩展）
DATABASE_URL="file:./dev.db"
```

### 如何获取 OpenAI API Key

1. 访问 [platform.openai.com](https://platform.openai.com/)
2. 注册/登录账号
3. 进入 API Keys 页面
4. 点击 "Create new secret key"
5. 复制生成的 key（格式：`sk-...`）

## 📦 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

创建 `.env.local` 文件：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
OPENAI_API_KEY=sk-your-actual-api-key
DATABASE_URL="file:./dev.db"
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

### 4. 构建生产版本

```bash
npm run build
npm run start
```

## ✅ 部署检查清单

- [ ] 代码已推送到 GitHub
- [ ] OpenAI API Key 已准备好
- [ ] 环境变量已在 Vercel 配置
- [ ] 构建成功（`npm run build`）
- [ ] 本地测试通过
- [ ] 部署链接可访问
- [ ] API 调用正常工作

## 🐛 常见部署问题

### 1. 构建失败

**错误**：TypeScript 类型错误

**解决**：
```bash
npm run build
# 检查错误信息，修复类型问题
```

### 2. API Key 未配置

**错误**：`Missing credentials`

**解决**：在 Vercel Dashboard → Settings → Environment Variables 添加 `OPENAI_API_KEY`

### 3. 运行时错误

**错误**：页面空白或 500 错误

**解决**：
- 查看 Vercel 函数日志
- 检查 API Key 是否正确
- 确认 API 额度是否充足

## 📊 性能优化

### 1. Vercel Edge Functions（可选）

将 API Route 改为 Edge Runtime：

```typescript
// app/api/generate/route.ts
export const runtime = 'edge';
```

### 2. 缓存策略

添加适当的缓存头：

```typescript
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  },
});
```

## 🌐 自定义域名

### 1. 在 Vercel 添加域名

- 进入项目设置
- Domains → Add Domain
- 输入你的域名
- 按照提示配置 DNS

### 2. 配置 DNS

添加 A 记录或 CNAME 记录：

```
Type: CNAME
Name: @
Value: cname.vercel-dns.com
```

## 📈 监控和分析

### Vercel Analytics

在项目中启用 Vercel Analytics：

```bash
npm install @vercel/analytics
```

```tsx
// app/layout.tsx
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

## 🔒 安全建议

1. **API Key 保护**
   - 永远不要在客户端暴露 API Key
   - 使用环境变量
   - 定期轮换 Key

2. **Rate Limiting**
   - 考虑添加请求频率限制
   - 防止 API 滥用

3. **CORS 配置**
   - 如需跨域，正确配置 CORS 头

## 📝 部署后验证

访问部署的应用，测试以下功能：

1. ✅ 页面正常加载
2. ✅ 可以输入消息
3. ✅ AI 能正常响应
4. ✅ 预览区域正常显示
5. ✅ 设备切换功能正常
6. ✅ Console 输出正常

## 🎉 部署成功！

现在你的 Atoms Demo 已经成功部署，可以分享给其他人使用了！

部署链接格式：`https://your-project-name.vercel.app`

---

**有问题？** 查看 [Vercel 文档](https://vercel.com/docs) 或 [Next.js 文档](https://nextjs.org/docs)
