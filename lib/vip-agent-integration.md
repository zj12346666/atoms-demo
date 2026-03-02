# VIP Code Agent 集成指南

## 概述

VIP Code Agent 是一个全自动化的前端代码生成系统，具备以下核心特性：

1. **基于关键词的符号检索**：拒绝盲目向量搜索，使用精确的关键词匹配
2. **多文件代码生成**：支持XML格式，一次任务可修改多个关联文件
3. **TypeScript验证循环**：在内存虚拟文件系统中运行 `tsc --noEmit`，自动修复错误
4. **符号索引自进化**：写入后立即更新 symbol_index 表
5. **实时前端同步**：通过WebSocket推送文件更新

## 核心组件

### 1. WorkflowManager (`lib/workflow-manager.ts`)

**状态机流程**：
```
idle → intent_retrieval → code_generation → validation → fixing → persistence → reindexing → completed
```

**主要方法**：
- `execute()`: 主工作流入口
- `intentAndRetrieval()`: 提取关键词并检索符号
- `generateCode()`: 生成XML格式代码
- `validateCode()`: 在内存中验证TypeScript
- `persistFiles()`: 原子写入PostgreSQL
- `reindexSymbols()`: 更新符号索引

### 2. SandboxService (`lib/sandbox-service.ts`)

**功能**：
- 在临时目录创建虚拟文件系统
- 运行 `tsc --noEmit` 验证
- 解析错误输出，提取行号和错误描述

**关键方法**：
- `validateTypeScript()`: 验证代码
- `parseTscErrors()`: 解析tsc错误输出

### 3. SymbolExtractor (`lib/symbol-extractor.ts`)

**功能**：
- 提取TypeScript/JavaScript符号
- 支持：export函数、interface、type、class、React组件
- 提取函数签名和接口定义

**关键方法**：
- `extractFromFile()`: 从文件内容提取符号
- `extractWithRegex()`: 使用正则表达式提取（fallback）

### 4. WebSocketManager (`lib/websocket-manager.ts`)

**功能**：
- 管理WebSocket连接
- 发送文件更新事件到前端
- 支持按sessionId订阅

**关键方法**：
- `initialize()`: 初始化WebSocket服务器
- `emitFileUpdate()`: 发送单个文件更新
- `emitFileUpdates()`: 批量发送文件更新

## API端点

### POST `/api/vip-agent`

**请求体**：
```json
{
  "prompt": "创建一个React组件，包含按钮和输入框",
  "sessionId": "uuid",
  "userId": "user-id"
}
```

**响应**：
```json
{
  "success": true,
  "fileChanges": [
    {
      "path": "src/components/MyComponent.tsx",
      "action": "CREATE",
      "code": "...",
      "isDiff": false
    }
  ],
  "validation": {
    "success": true,
    "attempts": 1,
    "errors": [],
    "warnings": []
  },
  "sessionId": "uuid",
  "projectId": "project-id",
  "progress": [...]
}
```

## XML输出格式

Agent必须严格按照以下格式输出：

```xml
<plan>
  简述本次修改的逻辑步骤
</plan>

<file_change path="src/components/MyComponent.tsx">
  <action>UPDATE</action>
  <code>
    // 完整代码或增量代码
    // 使用 // ... existing code ... 标记保留的部分
  </code>
</file_change>

<file_change path="src/styles/MyComponent.css">
  <action>CREATE</action>
  <code>
    /* CSS代码 */
  </code>
</file_change>
```

## 数据库Schema更新

### Symbol表新增字段：
- `signature`: 函数签名或接口定义
- `fileId`: 关联的File ID（可选）
- `updatedAt`: 更新时间

### File表新增字段：
- `projectId`: 项目ID（从Session获取）
- 唯一约束：`@@unique([sessionId, path])`

## WebSocket事件

### 客户端订阅：
```javascript
socket.emit('subscribe', sessionId);
```

### 服务器推送：
```javascript
{
  type: 'FILE_UPDATED' | 'FILE_CREATED' | 'FILE_DELETED',
  sessionId: 'uuid',
  path: 'src/components/Button.tsx',
  content: '...' // 可选
}
```

## 使用示例

### 1. 初始化WebSocket（Next.js）

在 `app/api/socket/route.ts` 或自定义服务器中：

```typescript
import { Server as SocketIOServer } from 'socket.io';
import { WebSocketManager } from '@/lib/websocket-manager';

// 初始化Socket.IO服务器
const io = new SocketIOServer(server);
WebSocketManager.getInstance().initialize(io);
```

### 2. 调用VIP Agent API

```typescript
const response = await fetch('/api/vip-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '创建一个登录表单组件',
    sessionId: 'your-session-id',
    userId: 'your-user-id',
  }),
});

const result = await response.json();
```

### 3. 前端监听WebSocket

```typescript
import io from 'socket.io-client';

const socket = io();

socket.emit('subscribe', sessionId);

socket.on('file_updates', (events) => {
  events.forEach(event => {
    if (event.type === 'FILE_UPDATED') {
      // 更新Monaco编辑器内容
      updateEditor(event.path, event.content);
    }
  });
  
  // 刷新文件树
  refreshFileTree();
});
```

## 验证流程

1. **创建虚拟文件系统**：将所有文件加载到内存Map
2. **应用文件变更**：合并diff或替换完整代码
3. **写入临时目录**：创建临时项目目录
4. **运行tsc**：执行 `tsc --noEmit`
5. **解析错误**：提取行号和错误描述
6. **返回结果**：如果失败，返回错误列表供修复

## 符号索引更新

1. **提取符号**：使用SymbolExtractor从变更的文件中提取
2. **删除旧符号**：删除这些文件的旧符号记录
3. **插入新符号**：批量插入新提取的符号
4. **更新索引**：PostgreSQL自动更新索引

## 注意事项

1. **Tree-sitter集成**：当前使用正则表达式作为fallback，可以后续集成Tree-sitter提升准确性
2. **代码合并**：diff合并逻辑较简单，可以改进为更智能的diff算法
3. **错误解析**：tsc错误解析可能需要处理更多边界情况
4. **WebSocket集成**：需要在Next.js自定义服务器中初始化Socket.IO

## 下一步

1. 运行数据库迁移：`npx prisma migrate dev`
2. 集成WebSocket到Next.js服务器
3. 测试完整工作流
4. 优化错误处理和用户体验
