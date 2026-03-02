# WebSocket 集成指南

## ✅ 已完成的工作

### 1. 服务器端

#### ✅ 自定义服务器 (`server.js`)
- 创建了 Next.js 自定义服务器
- 集成 Socket.IO 服务器
- 初始化 WebSocketManager

#### ✅ WebSocketManager (`lib/websocket-manager.ts` & `lib/websocket-manager.cjs`)
- TypeScript 版本（用于 API 路由）
- CommonJS 版本（用于 server.js）
- 支持工作流进度推送
- 支持文件更新推送

### 2. 客户端

#### ✅ WebSocket 客户端 (`lib/websocket-client.ts`)
- Socket.IO 客户端封装
- 自动重连机制
- Session 订阅/取消订阅
- 事件处理器设置

#### ✅ 工作流进度组件 (`components/chat/WorkflowProgress.tsx`)
- 实时显示工作流进度
- 进度条可视化
- 状态图标和颜色
- 进度历史记录

#### ✅ ChatPanel 集成
- 集成 WebSocket 客户端
- 实时接收工作流进度
- 自动刷新文件列表

### 3. API 集成

#### ✅ VIP Agent API (`app/api/vip-agent/route.ts`)
- 实时推送工作流进度到 WebSocket
- 推送文件更新事件

## 🚀 使用方式

### 1. 安装依赖

```bash
npm install socket.io socket.io-client
```

### 2. 启动服务器

```bash
# 开发环境
npm run dev

# 生产环境
npm run build
npm start
```

### 3. 前端使用

WebSocket 客户端会自动连接，ChatPanel 组件会自动：
- 连接 WebSocket
- 订阅当前 session
- 接收工作流进度
- 接收文件更新

## 📊 事件类型

### 工作流进度事件

```typescript
{
  type: 'WORKFLOW_PROGRESS',
  sessionId: string,
  state: 'intent_retrieval' | 'code_generation' | 'validation' | 'fixing' | 'persistence' | 'reindexing' | 'completed' | 'failed',
  message: string,
  progress: number, // 0-100
  details?: string
}
```

### 文件更新事件

```typescript
{
  type: 'FILE_UPDATED' | 'FILE_CREATED' | 'FILE_DELETED',
  sessionId: string,
  path: string,
  content?: string
}
```

## 🔧 配置

### 环境变量

无需额外配置，WebSocket 会自动使用当前页面的 origin。

### CORS 配置

在 `server.js` 中已配置：

```javascript
cors: {
  origin: dev ? ['http://localhost:3000'] : '*',
  methods: ['GET', 'POST'],
  credentials: true,
}
```

## 📝 工作流程

1. **用户发送消息** → ChatPanel 调用 `/api/vip-agent`
2. **API 开始执行** → VIPWorkflowManager 开始工作流
3. **进度推送** → 每个阶段通过 WebSocket 推送进度
4. **前端显示** → WorkflowProgress 组件实时显示进度
5. **文件更新** → 文件变更通过 WebSocket 推送
6. **自动刷新** → 文件列表自动刷新

## ⚠️ 注意事项

1. **开发环境**：需要运行 `npm run dev`（使用自定义服务器）
2. **生产环境**：需要先运行 `npm run build`，然后 `npm start`
3. **WebSocket 连接**：客户端会自动重连，无需手动处理
4. **Session 订阅**：ChatPanel 会自动订阅当前 session

## 🐛 故障排除

### WebSocket 连接失败

1. 检查服务器是否正常运行
2. 检查 `server.js` 是否正确加载
3. 检查浏览器控制台是否有错误

### 进度不显示

1. 检查 WebSocket 是否连接成功
2. 检查 sessionId 是否正确订阅
3. 检查浏览器控制台是否有事件接收

### 文件更新不刷新

1. 检查 `onFilesUpdated` 回调是否正确设置
2. 检查 WebSocket 事件是否正常接收
3. 检查文件更新事件格式是否正确

## ✅ 验证清单

- [x] Socket.IO 服务器初始化
- [x] WebSocketManager 实现
- [x] WebSocket 客户端实现
- [x] 工作流进度组件
- [x] ChatPanel 集成
- [x] API 进度推送
- [x] 文件更新推送
- [ ] 完整测试（需要运行服务器）

## 🎉 总结

WebSocket 集成已完成！现在用户可以：
- ✅ 实时查看工作流执行进度
- ✅ 实时接收文件更新通知
- ✅ 自动刷新文件列表
- ✅ 看到详细的状态和进度信息

系统已准备好进行测试！
