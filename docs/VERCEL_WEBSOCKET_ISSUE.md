# Vercel 部署 WebSocket 问题分析与解决方案

## 🔍 问题根源

### 为什么 WebSocket 在 Vercel 上无法工作？

1. **Vercel 使用 Serverless Functions**
   - Vercel 将 Next.js API 路由部署为无状态的 Serverless Functions
   - 每个请求都是独立的函数调用，没有持久化的服务器进程
   - `server.js` 自定义服务器**不会在 Vercel 上运行**

2. **WebSocket 需要持久连接**
   - Socket.IO 需要长期保持的 TCP 连接
   - Serverless Functions 是无状态的，无法维持持久连接
   - 每次函数调用结束后，连接就会断开

3. **当前代码的问题**
   ```typescript
   // server.js 只在本地/自托管时运行
   const io = new Server(httpServer);  // ❌ Vercel 不会执行这段代码
   wsManager.initialize(io);           // ❌ 永远不会被调用
   
   // API 路由中
   if (!this.io) {
     logger.warn('⚠️ WebSocket服务器未初始化，跳过进度通知');  // ✅ 这就是你看到的警告
     return;
   }
   ```

## 📊 架构对比

### 本地开发/自托管
```
┌─────────────┐
│  server.js  │ ← 启动 HTTP 服务器 + Socket.IO
└──────┬──────┘
       │
       ├─→ Next.js 应用
       └─→ WebSocket 服务器 (持久连接)
```

### Vercel 部署
```
┌─────────────────┐
│  Vercel Edge    │
└────────┬────────┘
         │
         ├─→ Serverless Function 1 (请求1)
         ├─→ Serverless Function 2 (请求2)
         └─→ Serverless Function 3 (请求3)
         
❌ 没有持久化的服务器进程
❌ 无法维持 WebSocket 连接
```

## ✅ 解决方案

### 方案 1: Server-Sent Events (SSE) - **推荐**

**优点：**
- ✅ Vercel 原生支持
- ✅ 实现简单，无需第三方服务
- ✅ 适合单向推送（进度更新、文件更新）
- ✅ 自动重连机制

**缺点：**
- ❌ 只能单向通信（服务器 → 客户端）
- ❌ 不支持双向实时通信

**实现步骤：**
1. 创建 SSE API 路由 (`/api/events/[sessionId]/route.ts`)
2. 修改 WebSocketManager 支持 SSE
3. 前端使用 EventSource 替代 Socket.IO 客户端

### 方案 2: 第三方 WebSocket 服务

**推荐服务：**
- **Pusher** - 简单易用，有免费套餐
- **Ably** - 功能强大，有免费套餐
- **Upstash Redis** - 使用 Redis Pub/Sub

**优点：**
- ✅ 支持双向实时通信
- ✅ 可扩展性强
- ✅ 有免费套餐

**缺点：**
- ❌ 需要第三方依赖
- ❌ 可能有额外成本（超出免费额度）

### 方案 3: 混合方案（开发/生产分离）

**策略：**
- 开发环境：使用 `server.js` + Socket.IO（本地）
- 生产环境（Vercel）：使用 SSE 或第三方服务

**优点：**
- ✅ 开发体验不受影响
- ✅ 生产环境适配 Vercel

### 方案 4: 自托管（不使用 Vercel）

**平台选择：**
- Railway
- Render
- DigitalOcean App Platform
- AWS EC2 / ECS
- Google Cloud Run（支持 WebSocket）

**优点：**
- ✅ 完全控制服务器
- ✅ 支持 WebSocket
- ✅ 可以使用 `server.js`

**缺点：**
- ❌ 需要自己管理服务器
- ❌ 可能需要更多配置

## 🚀 推荐实施方案：SSE (Server-Sent Events)

### 为什么选择 SSE？

1. **Vercel 原生支持** - 无需额外配置
2. **实现简单** - 只需修改少量代码
3. **满足需求** - 你的场景主要是单向推送（进度、文件更新）
4. **零成本** - 不需要第三方服务

### 实施计划

#### 步骤 1: 创建 SSE API 路由

创建 `/app/api/events/[sessionId]/route.ts`：
```typescript
export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  // 返回 SSE 流
}
```

#### 步骤 2: 修改 WebSocketManager

添加 SSE 支持，在 Vercel 环境下使用 SSE，本地使用 WebSocket。

#### 步骤 3: 修改前端客户端

使用 EventSource 替代 Socket.IO 客户端（在 Vercel 环境下）。

## 📝 下一步

请选择你想要的方案，我可以帮你实现：

1. **方案 1 (SSE)** - 推荐，最简单
2. **方案 2 (第三方服务)** - 如果需要双向通信
3. **方案 3 (混合方案)** - 保持开发体验
4. **方案 4 (自托管)** - 完全控制

或者我可以直接实现**方案 1 (SSE)**，这是最适合 Vercel 的解决方案。
