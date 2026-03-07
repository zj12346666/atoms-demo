# Vercel WebSocket 问题解决方案

## ✅ 已完成的实现

### 问题根源
Vercel 使用 Serverless Functions，不支持传统的 WebSocket 连接。`server.js` 自定义服务器在 Vercel 上不会运行，导致 WebSocket 无法初始化。

### 解决方案：SSE (Server-Sent Events)

我们实现了一个**混合方案**，自动检测环境并选择合适的通信方式：

- **本地开发/自托管**：使用 WebSocket (Socket.IO)
- **Vercel 部署**：自动切换到 SSE (Server-Sent Events)

## 📁 新增/修改的文件

### 1. SSE 服务器端

#### `lib/sse-manager.ts` (新建)
- 管理 SSE 连接的生命周期
- 提供 `sendSSEEvent()` 函数用于发送事件

#### `app/api/events/[sessionId]/route.ts` (新建)
- SSE API 路由
- 建立 SSE 连接，接收实时进度更新

### 2. SSE 客户端

#### `lib/sse-client.ts` (新建)
- SSE 客户端实现
- 自动重连机制
- 事件处理

### 3. WebSocketManager 增强

#### `lib/websocket-manager-shared.ts` (修改)
- 添加 SSE 支持
- 自动检测 Vercel 环境
- 如果 WebSocket 不可用，自动回退到 SSE
- 所有方法改为 `async`，支持 Promise

### 4. WebSocketClient 增强

#### `lib/websocket-client.ts` (修改)
- 自动检测环境（Vercel vs 本地）
- 在 Vercel 环境下自动使用 SSE
- 保持相同的 API，无需修改前端代码

### 5. API 路由更新

更新了所有调用 WebSocketManager 的地方，添加了错误处理：
- `app/api/vip-agent/route.ts`
- `app/api/webcontainer/errors/route.ts`
- `lib/skills/environment-sync-skill.ts`

## 🚀 使用方法

### 前端代码（无需修改）

前端代码**无需任何修改**！`WebSocketClient` 会自动检测环境：

```typescript
import { getWebSocketClient } from '@/lib/websocket-client';

const wsClient = getWebSocketClient();
wsClient.connect();
wsClient.subscribe(sessionId);

// 设置事件处理器
wsClient.setHandlers({
  onWorkflowProgress: (event) => {
    console.log('收到进度:', event);
  },
  onFileUpdate: (event) => {
    console.log('文件更新:', event);
  },
});
```

### 后端代码（已自动处理）

所有后端代码**已自动更新**，支持 SSE：

```typescript
import { WebSocketManager } from '@/lib/websocket-manager-shared';

const wsManager = WebSocketManager.getInstance();

// 发送进度（自动选择 WebSocket 或 SSE）
await wsManager.emitWorkflowProgress({
  type: 'WORKFLOW_PROGRESS',
  sessionId: 'xxx',
  state: 'code_generation',
  message: '正在生成代码...',
  progress: 50,
});

// 发送文件更新（自动选择 WebSocket 或 SSE）
await wsManager.emitFileUpdates([
  {
    type: 'FILE_UPDATED',
    sessionId: 'xxx',
    path: 'src/App.tsx',
    content: '...',
  },
]);
```

## 🔍 工作原理

### 环境检测

**后端（WebSocketManager）：**
```typescript
function isVercelEnvironment(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.NEXT_PUBLIC_VERCEL_URL
  );
}
```

**前端（WebSocketClient）：**
```typescript
function isVercelEnvironment(): boolean {
  return !!(
    window.location.hostname.includes('vercel.app') ||
    window.location.hostname.includes('vercel.com') ||
    (window as any).__VERCEL_ENV
  );
}
```

### 自动回退机制

1. **WebSocketManager** 尝试使用 WebSocket
2. 如果 `this.io` 为 `null`（Vercel 环境），自动切换到 SSE
3. 调用 `sendSSEEvent()` 发送事件

### 事件流程

**本地环境：**
```
API Route → WebSocketManager → Socket.IO → WebSocket Client
```

**Vercel 环境：**
```
API Route → WebSocketManager → SSE Manager → SSE API Route → SSE Client
```

## 📊 测试

### 本地测试

```bash
npm run dev
```

应该看到：
```
🌐 使用 WebSocket 模式
✅ WebSocketManager 已初始化
✅ WebSocket 连接成功
```

### Vercel 部署测试

部署到 Vercel 后，应该看到：
```
🌐 检测到 Vercel 环境，使用 SSE 模式
📡 新的 SSE 连接: sessionId=xxx
✅ SSE 连接成功
```

## ⚠️ 注意事项

1. **SSE 限制**：
   - SSE 是单向通信（服务器 → 客户端）
   - 如果需要双向通信，考虑使用第三方服务（Pusher、Ably）

2. **连接数限制**：
   - 每个浏览器标签页最多 6 个并发 HTTP 连接
   - SSE 占用一个连接
   - 建议每个 session 只建立一个 SSE 连接

3. **重连机制**：
   - SSE 客户端有自动重连机制（最多 5 次）
   - WebSocket 客户端也有自动重连机制

## 🎯 下一步

1. **部署到 Vercel** 并测试
2. **监控日志**，确认 SSE 正常工作
3. **如果需要双向通信**，考虑集成 Pusher 或 Ably

## 📝 相关文档

- [Vercel WebSocket 问题分析](./VERCEL_WEBSOCKET_ISSUE.md)
- [WebSocket 集成指南](./WEBSOCKET_INTEGRATION.md)
