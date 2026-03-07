# WebContainer Runtime 系统设计方案

## 一、架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    LLM 生成阶段                              │
│  { "src/App.tsx": "...", "package.json": "..." }            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              文件结构转换层 (FileTreeBuilder)                 │
│  - 扁平路径 → WebContainer 树形结构                         │
│  - 路径规范化                                                │
│  - 文件名大小写修正                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              模板补全层 (TemplateCompleter)                   │
│  - 检测缺失的关键文件                                        │
│  - 自动生成最小 Vite React 模板                             │
│  - package.json 验证和补全                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              WebContainer 运行时层 (WebContainerRuntime)      │
│  - WebContainer 初始化                                       │
│  - 文件系统挂载                                              │
│  - 依赖安装（带缓存）                                        │
│  - 开发服务器启动                                            │
│  - 错误处理和恢复                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              性能优化层 (PerformanceOptimizer)               │
│  - node_modules 缓存                                        │
│  - 依赖安装去重                                              │
│  - 冷启动加速                                                │
└─────────────────────────────────────────────────────────────┘
```

## 二、模块划分

### 1. `lib/webcontainer/file-tree-builder.ts`
**职责**：将扁平文件结构转换为 WebContainer 树形结构

**核心功能**：
- `buildFileTree(flatFiles: Record<string, string>): WebContainerFileTree`
- 路径规范化（移除 `..`、处理相对路径）
- 文件名大小写修正（React 组件文件）
- 导入语句自动修正

**输入格式**：
```typescript
{
  "index.html": "<!DOCTYPE html>...",
  "package.json": "{...}",
  "src/main.tsx": "import React...",
  "src/components/SnakeGame.tsx": "..."
}
```

**输出格式**：
```typescript
{
  "index.html": { file: { contents: "..." } },
  "package.json": { file: { contents: "..." } },
  "src": {
    directory: {
      "main.tsx": { file: { contents: "..." } },
      "components": {
        directory: {
          "SnakeGame.tsx": { file: { contents: "..." } }
        }
      }
    }
  }
}
```

### 2. `lib/webcontainer/template-completer.ts`
**职责**：自动补全缺失的关键文件

**核心功能**：
- `completeTemplate(flatFiles: Record<string, string>): Record<string, string>`
- 检测项目类型（React/Vue/Vanilla）
- 生成最小 Vite 配置
- 补全 package.json（确保 scripts.dev 存在）
- 生成入口文件（src/main.tsx）

**补全规则**：
- 如果缺失 `index.html` → 生成标准 Vite HTML
- 如果缺失 `package.json` → 生成最小 package.json
- 如果缺失 `vite.config.ts` → 根据项目类型生成
- 如果缺失 `src/main.tsx` → 自动查找 App 组件并生成入口

### 3. `lib/webcontainer/webcontainer-runtime.ts`
**职责**：WebContainer 生命周期管理

**核心功能**：
- `class WebContainerRuntime`
  - `async initialize(flatFiles: Record<string, string>): Promise<RuntimeResult>`
  - `async mount(fileTree: WebContainerFileTree): Promise<void>`
  - `async installDependencies(): Promise<void>`
  - `async startDevServer(): Promise<string>` // 返回 URL
  - `async teardown(): Promise<void>`

**流程**：
1. 启动 WebContainer（使用全局管理器）
2. 构建文件树（调用 FileTreeBuilder）
3. 补全模板（调用 TemplateCompleter）
4. 挂载文件系统（严格 await）
5. 安装依赖（带缓存检查）
6. 启动开发服务器
7. 监听 server-ready 事件
8. 返回预览 URL

### 4. `lib/webcontainer/performance-optimizer.ts`
**职责**：性能优化和缓存管理

**核心功能**：
- `class PerformanceOptimizer`
  - `shouldSkipInstall(packageJsonHash: string): boolean`
  - `async cacheNodeModules(sessionId: string): Promise<void>`
  - `async restoreNodeModules(sessionId: string): Promise<boolean>`
  - `getInstallCacheKey(files: Record<string, string>): string`

**优化策略**：
1. **依赖安装缓存**：
   - 计算 package.json 的 hash
   - 如果 hash 未变化，跳过 npm install
   - 使用 IndexedDB 存储 node_modules 快照

2. **冷启动加速**：
   - 预加载常用依赖（react, vite 等）
   - 使用 Service Worker 缓存
   - 并行初始化（文件挂载 + WebContainer 启动）

3. **增量更新**：
   - 只重新挂载变化的文件
   - 热更新时跳过完整重装

### 5. `lib/webcontainer/error-handler.ts`
**职责**：错误处理和自动恢复

**核心功能**：
- `class WebContainerErrorHandler`
  - `handleMountError(error: Error, fileTree: WebContainerFileTree): Promise<FixedFileTree>`
  - `handleInstallError(error: Error): Promise<void>`
  - `handleRuntimeError(error: Error): Promise<void>`

**错误类型**：
- 文件系统错误（无效路径、大小写冲突）
- 依赖安装错误（网络问题、版本冲突）
- 运行时错误（语法错误、导入错误）

## 三、实现步骤

### Phase 1: 核心转换层
1. ✅ 实现 `FileTreeBuilder` - 扁平 → 树形转换
2. ✅ 实现路径规范化逻辑
3. ✅ 实现文件名大小写修正

### Phase 2: 模板补全层
4. ✅ 实现 `TemplateCompleter` - 自动补全缺失文件
5. ✅ 实现项目类型检测
6. ✅ 实现最小模板生成

### Phase 3: 运行时核心
7. ✅ 实现 `WebContainerRuntime` - 完整生命周期
8. ✅ 集成文件树构建和模板补全
9. ✅ 实现错误处理和日志

### Phase 4: 性能优化
10. ✅ 实现依赖安装缓存
11. ✅ 实现 node_modules 缓存
12. ✅ 实现冷启动优化

### Phase 5: 集成和测试
13. ✅ 集成到现有 WebContainerPreview 组件
14. ✅ 添加单元测试
15. ✅ 性能基准测试

## 四、关键设计决策

### 1. 文件结构转换
- **问题**：扁平路径 `"src/components/App.tsx"` 需要转换为嵌套结构
- **方案**：递归构建目录树，每层使用 `{ directory: {} }` 包装

### 2. 路径规范化
- **规则**：
  - 移除开头的 `/`
  - 移除 `./` 前缀
  - 禁止 `..` 路径遍历
  - 禁止控制字符

### 3. 文件名大小写
- **问题**：WebContainer 对大小写敏感，但 LLM 可能生成全小写文件名
- **方案**：
  - 检测 React 组件文件（`.tsx`, `.jsx`）
  - 自动转换为 PascalCase
  - 同步更新所有导入语句

### 4. 模板补全策略
- **检测顺序**：
  1. 检查是否有 React 文件（`.tsx`, `.jsx`）
  2. 检查是否有 Vue 文件（`.vue`）
  3. 默认为 Vanilla JS
- **补全优先级**：
  1. 用户提供的文件（不覆盖）
  2. 自动生成的模板（最小可用）

### 5. 依赖安装优化
- **缓存键**：`package.json` 内容的 SHA-256 hash
- **存储**：IndexedDB（浏览器本地存储）
- **失效策略**：package.json 变化时清除缓存

## 五、API 设计

### 主要入口函数

```typescript
/**
 * 运行项目（完整流程）
 */
async function runProject(
  flatFiles: Record<string, string>,
  options?: {
    sessionId?: string;
    skipInstall?: boolean;
    cacheEnabled?: boolean;
  }
): Promise<{
  url: string;
  webcontainer: WebContainer;
  cleanup: () => Promise<void>;
}>
```

### 内部模块接口

```typescript
// FileTreeBuilder
interface FileTreeBuilder {
  build(flatFiles: Record<string, string>): WebContainerFileTree;
  normalizePath(path: string): string | null;
  fixFileNameCase(path: string, content: string): string;
}

// TemplateCompleter
interface TemplateCompleter {
  complete(flatFiles: Record<string, string>): Record<string, string>;
  detectProjectType(files: Record<string, string>): 'react' | 'vue' | 'vanilla';
  generateMinimalTemplate(type: string): Record<string, string>;
}

// WebContainerRuntime
interface WebContainerRuntime {
  initialize(flatFiles: Record<string, string>): Promise<RuntimeResult>;
  mount(fileTree: WebContainerFileTree): Promise<void>;
  installDependencies(): Promise<void>;
  startDevServer(): Promise<string>;
  teardown(): Promise<void>;
}
```

## 六、错误处理策略

### 1. 挂载错误
- **检测**：文件路径无效、大小写冲突
- **恢复**：自动修正路径，重新挂载

### 2. 安装错误
- **检测**：网络错误、版本冲突
- **恢复**：重试 3 次，降级依赖版本

### 3. 运行时错误
- **检测**：语法错误、导入错误
- **恢复**：发送给 AI Agent 自动修复

## 七、性能指标

### 目标指标
- **冷启动时间**：< 5 秒（首次运行）
- **热启动时间**：< 2 秒（使用缓存）
- **文件挂载时间**：< 1 秒（100 个文件）
- **依赖安装时间**：< 30 秒（首次），< 1 秒（缓存命中）

### 优化目标
- 减少 80% 的重复 npm install
- 减少 50% 的冷启动时间
- 支持 1000+ 文件的项目

## 八、生产级注意事项

### 1. 内存管理
- 及时释放 WebContainer 实例
- 限制文件大小（单文件 < 10MB）
- 使用流式处理大文件

### 2. 错误边界
- 所有异步操作包装 try-catch
- 提供降级方案（简单预览模式）
- 详细的错误日志

### 3. 安全性
- 路径遍历防护
- 文件大小限制
- 恶意代码检测（可选）

### 4. 可观测性
- 结构化日志
- 性能指标收集
- 错误追踪

## 九、测试策略

### 单元测试
- FileTreeBuilder 路径转换
- TemplateCompleter 模板生成
- 路径规范化逻辑

### 集成测试
- 完整运行流程
- 错误恢复机制
- 性能优化验证

### E2E 测试
- 真实项目运行
- 多文件项目
- 错误场景
