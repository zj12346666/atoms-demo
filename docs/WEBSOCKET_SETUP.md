# WebSocket 集成设置指南

## ✅ 已完成的工作

### 1. 服务器端
- ✅ 自定义服务器 (`server.js`) - 支持 Socket.IO
- ✅ WebSocketManager (`lib/websocket-manager-shared.ts`) - 共享单例
- ✅ WebSocketManager CommonJS (`lib/websocket-manager.cjs`) - 用于 server.js
- ✅ API 路由集成 (`app/api/vip-agent/route.ts`) - 实时推送进度

### 2. 客户端
- ✅ WebSocket 客户端 (`lib/websocket-client.ts`)
- ✅ 工作流进度组件 (`components/chat/WorkflowProgress.tsx`)
- ✅ ChatPanel 集成 - 自动连接和订阅

## 🚀 安装和启动步骤

### 步骤 1: 安装依赖

```bash
npm install socket.io socket.io-client
```

### 步骤 2: 启动服务器

```bash
# 开发环境（使用自定义服务器）
npm run dev

# 生产环境
npm run build
npm start
```

### 步骤 3: 验证 WebSocket

1. 打开浏览器开发者工具
2. 查看 Console，应该看到：
   ```
   ✅ WebSocket 连接成功
   📡 订阅 session: <session-id>
   ```

3. 发送一条消息，应该看到：
   ```
   📊 收到工作流进度: [intent_retrieval] 🧠 解析意图并检索符号...
   📊 收到工作流进度: [code_generation] ✍️ 生成代码...
   ...
   ```

## 📋 文件结构

```
├── server.js                          # Next.js 自定义服务器
├── lib/
│   ├── websocket-manager-shared.ts    # WebSocketManager 共享实现
│   ├── websocket-manager.ts           # TypeScript 导出
│   ├── websocket-manager.cjs          # CommonJS 版本（用于 server.js）
│   └── websocket-client.ts            # 前端 WebSocket 客户端
├── components/
│   └── chat/
│       └── WorkflowProgress.tsx       # 工作流进度显示组件
└── app/
    └── api/
        └── vip-agent/
            └── route.ts               # VIP Agent API（已集成 WebSocket）
```

## 🔧 工作原理

### 服务器端流程

1. **server.js 启动**
   - 创建 HTTP 服务器
   - 初始化 Socket.IO
   - 初始化 WebSocketManager
   - 将 io 实例存储到 `global.__socketIO`

2. **API 路由执行**
   - 从 `global.__socketIO` 获取 io 实例
   - 设置到 WebSocketManager
   - 工作流执行时推送进度

### 客户端流程

1. **页面加载**
   - ChatPanel 组件挂载
   - WebSocket 客户端自动连接
   - 订阅当前 session

2. **用户发送消息**
   - 调用 `/api/vip-agent`
   - 显示进度条
   - 实时接收进度更新

3. **工作流完成**
   - 接收文件更新事件
   - 自动刷新文件列表
   - 隐藏进度条

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

## ⚠️ 注意事项

1. **开发环境**：必须使用 `npm run dev`（使用自定义服务器）
2. **生产环境**：必须先运行 `npm run build`，然后 `npm start`
3. **WebSocket 连接**：客户端会自动重连，无需手动处理
4. **Session 订阅**：ChatPanel 会自动订阅当前 session，无需手动调用

## 🐛 故障排除

### WebSocket 连接失败

**症状**：浏览器控制台显示连接错误

**解决方案**：
1. 检查服务器是否正常运行
2. 检查 `server.js` 是否正确加载
3. 检查 Socket.IO 依赖是否已安装
4. 检查端口是否被占用

### 进度不显示

**症状**：发送消息后没有进度显示

**解决方案**：
1. 检查浏览器控制台是否有 WebSocket 连接成功消息
2. 检查 sessionId 是否正确订阅
3. 检查 Network 标签页是否有 WebSocket 连接
4. 检查服务器日志是否有进度推送

### 文件更新不刷新

**症状**：代码生成后文件列表没有更新

**解决方案**：
1. 检查 `onFilesUpdated` 回调是否正确设置
2. 检查 WebSocket 事件是否正常接收
3. 检查浏览器控制台是否有文件更新事件日志

## ✅ 验证清单

- [ ] Socket.IO 依赖已安装
- [ ] 服务器正常启动（使用 `npm run dev`）
- [ ] WebSocket 连接成功（浏览器控制台）
- [ ] Session 订阅成功
- [ ] 进度实时显示
- [ ] 文件更新自动刷新

## 🎉 完成！

WebSocket 集成已完成！现在用户可以：
- ✅ 实时查看工作流执行进度
- ✅ 看到详细的状态信息（意图检索、代码生成、验证等）
- ✅ 实时接收文件更新通知
- ✅ 自动刷新文件列表

系统已准备好进行测试！
