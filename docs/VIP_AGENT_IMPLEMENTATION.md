# VIP Code Agent 核心工作流实现总结

## ✅ 已完成的功能

### 1. 数据库Schema更新 ✅

**文件**: `prisma/schema.prisma`

**更新内容**:
- **Symbol表**:
  - 新增 `signature` 字段：存储函数签名或接口定义
  - 新增 `fileId` 字段：关联File表（可选）
  - 新增 `updatedAt` 字段：更新时间戳
  - 新增索引：`fileId`, `file`

- **File表**:
  - 新增 `projectId` 字段：项目ID（从Session获取）
  - 新增唯一约束：`@@unique([sessionId, path])` 确保路径唯一
  - 新增索引：`projectId`

**迁移文件**: `prisma/migrations/add_symbol_signature/migration.sql`

---

### 2. WorkflowManager 状态机 ✅

**文件**: `lib/workflow-manager.ts`

**核心状态流程**:
```
idle → intent_retrieval → code_generation → validation → fixing → persistence → reindexing → completed
```

**主要功能**:
- ✅ **Intent & Retrieval**: 提取关键词，在symbols表中检索相关符号
- ✅ **MultiFileCodeGen**: 生成XML格式代码，支持多文件修改
- ✅ **Validation Loop**: 在内存虚拟文件系统中运行 `tsc --noEmit`，自动修复（最多3次）
- ✅ **Persistence**: 原子写入文件到PostgreSQL
- ✅ **Reindex**: Tree-sitter扫描并更新symbol_index

**关键方法**:
- `execute()`: 主工作流入口
- `intentAndRetrieval()`: 关键词提取和符号检索
- `generateCode()`: XML格式代码生成
- `parseXmlFileChanges()`: 解析XML文件变更
- `validateCode()`: 内存中TypeScript验证
- `persistFiles()`: 事务批量写入
- `reindexSymbols()`: 符号索引更新

---

### 3. SandboxService - TypeScript验证 ✅

**文件**: `lib/sandbox-service.ts`

**功能**:
- ✅ 创建临时项目目录
- ✅ 在内存虚拟文件系统中写入文件
- ✅ 运行 `tsc --noEmit` 验证
- ✅ 解析stderr，提取行号和错误描述
- ✅ 返回结构化的验证结果

**关键方法**:
- `validateTypeScript()`: 主验证方法
- `parseTscErrors()`: 解析tsc错误输出
- `createDefaultTsConfig()`: 创建默认tsconfig.json

**错误格式解析**:
```
file.ts(行号,列号): error TS错误码: 错误描述
file.ts(行号,列号): warning TS错误码: 警告描述
```

---

### 4. SymbolExtractor - 符号提取 ✅

**文件**: `lib/symbol-extractor.ts`

**功能**:
- ✅ 提取export函数（带签名）
- ✅ 提取interface定义
- ✅ 提取type定义
- ✅ 提取class定义
- ✅ 提取React组件
- ✅ 提取关键词用于检索

**当前实现**:
- 使用正则表达式提取（fallback）
- 支持Tree-sitter集成（预留接口）

**提取的符号类型**:
- `function`: 函数（带签名）
- `interface`: 接口定义
- `type`: 类型别名
- `class`: 类定义
- `variable`: 变量
- `event`: 事件

---

### 5. WebSocketManager - 实时同步 ✅

**文件**: `lib/websocket-manager.ts`

**功能**:
- ✅ 管理WebSocket连接
- ✅ 按sessionId订阅/取消订阅
- ✅ 发送文件更新事件
- ✅ 批量发送文件更新

**事件类型**:
- `FILE_UPDATED`: 文件更新
- `FILE_CREATED`: 文件创建
- `FILE_DELETED`: 文件删除

**使用方式**:
```typescript
// 初始化
const io = new SocketIOServer(server);
WebSocketManager.getInstance().initialize(io);

// 发送更新
wsManager.emitFileUpdates([{
  type: 'FILE_UPDATED',
  sessionId: 'uuid',
  path: 'src/components/Button.tsx',
  content: '...',
}]);
```

---

### 6. VIP Agent API ✅

**文件**: `app/api/vip-agent/route.ts`

**功能**:
- ✅ 接收prompt和sessionId
- ✅ 执行WorkflowManager工作流
- ✅ 发送WebSocket通知
- ✅ 返回结果和进度

**API端点**: `POST /api/vip-agent`

---

## 📋 XML输出格式规范

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

**Action类型**:
- `CREATE`: 创建新文件
- `UPDATE`: 更新现有文件（支持diff）
- `DELETE`: 删除文件

---

## 🔄 工作流程详解

### 阶段1: Intent & Retrieval

1. **提取关键词**:
   ```typescript
   const keywords = extractKeywords(prompt);
   // 结果: ['create', 'button', 'component', 'react']
   ```

2. **检索符号**:
   ```sql
   SELECT * FROM symbols 
   WHERE projectId = ? 
   AND (name IN (?) OR keywords && ARRAY[?])
   ```

3. **返回符号上下文**:
   - 函数签名
   - Interface定义
   - 相关组件代码

### 阶段2: MultiFileCodeGen

1. **构建提示**:
   - 用户需求
   - 检索到的符号上下文
   - 当前文件内容
   - 之前的修改（如果有）

2. **调用LLM生成XML**:
   - 使用GLM-4-Plus模型
   - Temperature: 0.3（较低，确保准确性）
   - Max tokens: 8000

3. **解析XML**:
   - 提取 `<plan>` 内容
   - 提取所有 `<file_change>` 节点
   - 解析action和code

### 阶段3: Validation Loop

1. **创建虚拟文件系统**:
   ```typescript
   const virtualFs = new Map<string, string>();
   // 加载现有文件
   // 应用文件变更
   ```

2. **运行tsc验证**:
   ```bash
   npx tsc --noEmit
   ```

3. **解析错误**:
   - 提取文件路径、行号、列号
   - 提取错误码和描述
   - 分类为errors和warnings

4. **自动修复**（如果失败）:
   - 构建修复提示（包含错误信息）
   - 重新生成代码
   - 重新验证（最多3次）

### 阶段4: Persistence

1. **事务批量写入**:
   ```typescript
   await prisma.$transaction(async (tx) => {
     for (const change of fileChanges) {
       if (change.action === 'DELETE') {
         await tx.file.deleteMany({...});
       } else {
         // CREATE 或 UPDATE
         await tx.file.upsert({...});
       }
     }
   });
   ```

2. **原子性保证**:
   - 使用Prisma事务
   - 要么全部成功，要么全部回滚

### 阶段5: Reindex

1. **提取符号**:
   ```typescript
   const symbols = await symbolExtractor.extractFromFile(path, content);
   ```

2. **更新数据库**:
   ```typescript
   // 删除旧符号
   await prisma.symbol.deleteMany({
     where: { projectId, file: { in: filePaths } }
   });
   
   // 插入新符号
   await prisma.symbol.createMany({
     data: symbols.map(s => ({...}))
   });
   ```

3. **实时索引**:
   - 立即更新，保证下一轮对话的"记忆"是实时的

---

## 🚀 使用示例

### 1. 调用VIP Agent API

```typescript
const response = await fetch('/api/vip-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: '创建一个登录表单组件，包含用户名和密码输入框',
    sessionId: 'your-session-id',
    userId: 'your-user-id',
  }),
});

const result = await response.json();
// {
//   success: true,
//   fileChanges: [...],
//   validation: { success: true, attempts: 1 },
//   progress: [...]
// }
```

### 2. 前端监听WebSocket

```typescript
import io from 'socket.io-client';

const socket = io();

// 订阅session
socket.emit('subscribe', sessionId);

// 监听文件更新
socket.on('file_updates', (events) => {
  events.forEach(event => {
    switch (event.type) {
      case 'FILE_UPDATED':
        // 更新Monaco编辑器
        monacoEditor.setValue(event.content);
        break;
      case 'FILE_CREATED':
        // 刷新文件树
        refreshFileTree();
        break;
      case 'FILE_DELETED':
        // 移除文件
        removeFileFromTree(event.path);
        break;
    }
  });
});
```

---

## 📝 待完成的任务

### 1. 数据库迁移
```bash
npx prisma migrate dev --name add_symbol_signature
```

### 2. WebSocket集成到Next.js

需要在自定义服务器中初始化Socket.IO：

**选项A**: 使用Next.js自定义服务器
**选项B**: 使用API Route + Server-Sent Events (SSE)

### 3. Tree-sitter集成（可选）

安装Tree-sitter相关包：
```bash
npm install tree-sitter tree-sitter-typescript
```

然后在 `SymbolExtractor` 中实现 `extractWithTreeSitter()` 方法。

### 4. 改进代码合并算法

当前使用简单的字符串替换，可以改进为：
- 使用diff算法（如diff-match-patch）
- 更智能的代码块识别
- 支持多段保留标记

### 5. 错误处理优化

- 更详细的错误分类
- 错误优先级排序
- 智能错误修复策略

---

## 🎯 核心优势

1. **精确检索**: 基于关键词的符号检索，拒绝盲目向量搜索
2. **多文件支持**: 一次任务可修改多个关联文件
3. **自动验证**: TypeScript编译验证，确保代码质量
4. **自动修复**: 最多3次自动修复循环
5. **实时同步**: WebSocket推送，前端实时更新
6. **索引自进化**: 写入后立即更新符号索引

---

## 📚 相关文档

- `docs/CODE_GENERATION_FLOW.md`: 代码生成流程文档
- `docs/STATE_DIAGRAM.md`: 状态图文档
- `lib/vip-agent-integration.md`: 集成指南
