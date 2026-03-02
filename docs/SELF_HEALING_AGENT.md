# 自愈式前端 Code Agent 实现文档

## 概述

本系统实现了一套完整的、具备工业级自愈能力的前端 Code Agent 方案。核心特性包括：

1. **静默重装**：只有当 package.json 发生变化时，才自动执行 npm install
2. **终端错误捕获器（The Healer）**：监听 WebContainer 控制台输出，自动捕获运行时错误
3. **热更新管道**：WebSocket 监听文件更新，0 延迟自动同步到 WebContainer
4. **Prompt 注入**：自动注入 package.json 和 tsconfig.json 到 Agent 上下文
5. **错误反馈循环**：捕获的错误自动发送回 Agent 的 Fixing 状态

## 架构设计

### 核心组件

#### 1. WebContainerHealer (`lib/webcontainer-healer.ts`)

终端错误捕获器，负责监听 WebContainer 的输出流并自动捕获错误。

**功能特性：**
- 监听 `npm run dev` 的 stdout/stderr 输出流
- 使用正则表达式匹配常见运行时错误：
  - 模块未找到：`Module not found: Error: Can't resolve '(.*)'`
  - 语法错误：`SyntaxError: (.*)`
  - 类型错误：`Property '(.*)' does not exist on type`
  - 构建错误：`Failed to compile`
  - 运行时错误：`ReferenceError`, `TypeError`
- 自动去重（5秒内相同错误只捕获一次）
- 静默模式：不通知用户，直接发送给 Agent

**使用示例：**
```typescript
await webContainerHealer.startMonitoring(webcontainer, async (errors) => {
  // 自动发送错误给 Agent 修复
  await fetch('/api/webcontainer/errors', {
    method: 'POST',
    body: JSON.stringify({ sessionId, errors }),
  });
});

await webContainerHealer.monitorDevProcess(devProcess);
```

#### 2. WebContainerHotReload (`lib/webcontainer-hot-reload.ts`)

热更新管理器，负责监听 WebSocket 文件更新事件并自动同步到 WebContainer。

**功能特性：**
- 监听 WebSocket `file_updates` 事件
- 自动检测 package.json 变化（通过 hash 比较）
- 静默重装：package.json 变化时自动执行 `npm install`
- 0 延迟文件同步：使用 `webcontainer.fs.writeFile` 直接更新文件
- 支持全量同步和增量更新

**使用示例：**
```typescript
await webContainerHotReload.initialize(
  webcontainer,
  sessionId,
  async () => {
    // package.json 变化时的回调
    await webcontainer.spawn('npm', ['install']);
  }
);
```

#### 3. AgentPromptInjector (`lib/agent-prompt-injector.ts`)

Prompt 注入器，自动注入项目配置到 Agent 上下文。

**功能特性：**
- 自动加载 package.json、tsconfig.json、vite.config
- 解析路径别名（从 tsconfig.json）
- 构建增强的 Prompt，包含项目环境配置
- 强制 Agent 遵守路径别名规范

**使用示例：**
```typescript
const enhancedPrompt = await agentPromptInjector.enhancePrompt(sessionId, originalPrompt);
// enhancedPrompt 包含 package.json、tsconfig.json 等配置信息
```

### 数据库增强

#### File 表新增字段

```sql
ALTER TABLE "files" 
ADD COLUMN "symbolHash" TEXT,  -- 代码内容 Hash，用于判断是否需要重新索引符号
ADD COLUMN "lastValidation" JSONB;  -- 存储上次沙箱校验的结果
```

**用途：**
- `symbolHash`: 检测代码变化，决定是否需要重新索引符号
- `lastValidation`: 存储 tsc 编译错误等信息，用于快速诊断

### API 端点

#### `/api/webcontainer/errors` (POST)

接收前端捕获的错误，自动触发 Agent 修复流程。

**请求体：**
```json
{
  "sessionId": "xxx",
  "errors": [
    {
      "type": "module_not_found",
      "message": "Module not found: Error: Can't resolve './Button'",
      "file": "src/components/App.tsx",
      "line": 10,
      "column": 5
    }
  ]
}
```

**响应：**
```json
{
  "success": true,
  "message": "错误已修复",
  "filesFixed": 2,
  "fileChanges": [
    { "path": "src/components/App.tsx", "action": "UPDATE" }
  ]
}
```

## 工作流程

### 完整流程

```
用户输入需求
    ↓
Agent 生成代码（自动注入 package.json/tsconfig.json）
    ↓
代码保存到 PostgreSQL
    ↓
WebSocket 发送文件更新事件
    ↓
WebContainerHotReload 自动同步到 WebContainer
    ↓
检测 package.json 变化 → 静默执行 npm install
    ↓
启动 npm run dev
    ↓
WebContainerHealer 监听输出流
    ↓
捕获运行时错误
    ↓
自动发送给 Agent 修复（/api/webcontainer/errors）
    ↓
Agent 修复代码 → 保存到 PostgreSQL
    ↓
循环直到无错误
    ↓
WebContainer 触发 server-ready 事件
    ↓
任务完成 ✅
```

### 错误捕获流程

```
npm run dev 输出流
    ↓
WebContainerHealer.processOutput()
    ↓
正则匹配错误模式
    ↓
捕获错误（去重）
    ↓
调用 onErrorCallback
    ↓
POST /api/webcontainer/errors
    ↓
VIPWorkflowManager.execute() (state: 'fixing')
    ↓
生成修复代码
    ↓
保存到 PostgreSQL
    ↓
WebSocket 通知文件更新
    ↓
WebContainerHotReload 自动同步
    ↓
Vite 自动热重载
    ↓
错误已修复 ✅
```

## 集成指南

### 1. 在 WebContainerPreview 中集成

```typescript
// 初始化热更新系统
await webContainerHotReload.initialize(
  webcontainer,
  sessionId,
  async () => {
    // package.json 变化时的回调
    await webcontainer.spawn('npm', ['install']);
  }
);

// 启动错误捕获器
await webContainerHealer.startMonitoring(webcontainer, async (errors) => {
  await fetch('/api/webcontainer/errors', {
    method: 'POST',
    body: JSON.stringify({ sessionId, errors }),
  });
});

// 监听 dev 进程
const devProcess = await webcontainer.spawn('npm', ['run', 'dev']);
await webContainerHealer.monitorDevProcess(devProcess);
```

### 2. 在 VIPWorkflowManager 中集成 Prompt 注入

```typescript
// 在 generateCode 前注入项目上下文
const enhancedPrompt = await agentPromptInjector.enhancePrompt(sessionId, prompt);
const generatedXml = await this.generateCode(enhancedPrompt, ...);
```

### 3. 数据库迁移

```bash
# 运行迁移
npx prisma migrate dev --name add_file_metadata

# 或直接执行 SQL
psql -d your_database -f prisma/migrations/add_file_metadata/migration.sql
```

## 成功标准

系统达到以下标准时，认为任务完成：

1. ✅ WebContainer 触发 `server-ready` 事件（端口 3000 已挂载）
2. ✅ 无运行时错误（Healer 未捕获到错误）
3. ✅ 所有文件已同步到 WebContainer
4. ✅ 依赖已正确安装（package.json 变化时自动重装）

## 效果演示

### 用户视角
```
输入需求 → 进度条滚动 → 右侧预览窗口直接弹出运行结果
```

### 底层视角
```
Agent 写代码 
  → 存入 PostgreSQL 
  → 自动同步到浏览器内存 
  → 发现 Vite 报错 
  → Agent 收到报错默默修复 
  → 修复成功 
  → 预览刷新 ✅
```

## 技术亮点

1. **0 延迟热重载**：使用 WebSocket + `webcontainer.fs.writeFile` 实现即时同步
2. **智能错误捕获**：正则表达式匹配 + 去重机制，避免重复修复
3. **静默重装**：Hash 比较 package.json，只在变化时安装依赖
4. **上下文感知**：自动注入项目配置，强制 Agent 遵守规范
5. **自愈循环**：错误 → 修复 → 验证 → 循环，直到成功

## 注意事项

1. **Cross-Origin Isolation**：WebContainer 需要正确的响应头设置
2. **错误去重**：5秒内相同错误只捕获一次，避免频繁修复
3. **修复次数限制**：最多尝试 3 次修复，避免无限循环
4. **文件路径规范**：确保文件路径使用正确的相对路径，符合 tsconfig.json 配置

## 未来优化

1. **增量安装**：只安装新增的依赖，而不是全量重装
2. **错误优先级**：根据错误类型和严重程度排序修复
3. **缓存优化**：缓存 package.json hash，减少不必要的重装
4. **性能监控**：记录修复时间和成功率，持续优化
