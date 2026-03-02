# 代码生成流程文档

## 整体架构

```
用户输入 → API 入口 → 7阶段Agent生成 → 后端验证 → 自动修复循环 → 返回结果
```

## 详细流程

### 阶段 0: API 入口处理 (`app/api/generate/route.ts`)

**文件**: `app/api/generate/route.ts`

**步骤**:
1. **接收请求**
   - 接收 `prompt`（用户需求）
   - 接收 `sessionId`（可选，会话ID）
   - 接收 `userId`（用户ID）

2. **会话管理**
   - 如果 `sessionId` 存在，尝试获取现有会话
   - 如果会话不存在或过期，创建新会话
   - 记录实际使用的 `sessionId` 和 `userId`

3. **保存用户消息**
   - 将用户消息添加到会话历史
   - 保存到聊天记录（ChatMessage）

4. **初始化 Agent**
   - 创建 `FrontendAgent` 实例
   - 配置 LLM API（GLM-4-Plus）

---

### 阶段 1-7: Agent 代码生成 (`lib/frontend-agent.ts`)

**文件**: `lib/frontend-agent.ts`

#### 阶段 1: 意图解析 (Intent Analysis)

**方法**: `analyzeIntent()`

**功能**:
- 分析用户输入的意图
- 提取关键词
- 识别动作（创建、修改、删除等）
- 识别目标组件（如果有）

**输出**: `IntentAnalysis`
```typescript
{
  keywords: string[];
  action: string;
  targetComponent?: string;
  complexity: 'simple' | 'medium' | 'complex';
}
```

---

#### 阶段 2: 符号检索 (Symbolic Retrieval)

**方法**: `retrieveSymbols()` / `storage.getProjectSkeleton()`

**功能**:
- 检索项目中的组件和符号
- 如果项目骨架不存在，初始化项目骨架
- 建立符号索引（函数、组件、类型等）

**输出**: `ProjectSkeleton`
- 项目结构
- 符号索引
- 组件列表

---

#### 阶段 3: 上下文组装 (Context Assembly)

**方法**: `assembleContext()`

**功能**:
- 组装项目骨架信息
- 检索相关组件代码
- 收集依赖信息
- 准备代码生成所需的上下文

**输出**: `ContextBundle`
```typescript
{
  skeleton: string;
  relatedComponents: string;
  dependencies: string;
  recentSymbols: string[];
}
```

---

#### 阶段 4: 实现方案规划 (Planning)

**方法**: `createImplementationPlan()`

**功能**:
- 根据需求和上下文制定实现方案
- 规划模块结构
- 规划文件组织
- 为每个文件制定生成计划

**输出**: `ImplementationPlan`
```typescript
{
  description: string;
  modules: Array<{
    name: string;
    description: string;
    files: Array<{
      path: string;
      type: string;
      description: string;
    }>;
  }>;
}
```

---

#### 阶段 5: 分文件代码生成 (Code Generation)

**方法**: `generateFileCode()`

**功能**:
- 按照规划逐个生成文件
- 每个文件生成时考虑：
  - 用户需求
  - 文件计划
  - 实现方案
  - 上下文信息
  - 已生成的文件（用于导入）

**流程**:
```
for each module in plan.modules:
  for each file in module.files:
    1. 生成文件代码
    2. 验证代码格式
    3. 添加到已生成文件列表
```

**输出**: `FileGenerationResult[]`
```typescript
Array<{
  path: string;
  content: string;
  type: string;
  description: string;
}>
```

---

#### 阶段 6: 沙箱验证 (Sandbox Validation)

**方法**: `validateAllFiles()`

**功能**:
- 验证所有生成的文件
- 检查语法错误
- 检查导入/导出错误
- 检查类型错误

**输出**: `ValidationResult`
```typescript
{
  success: boolean;
  error?: string;
}
```

**注意**: 此阶段的验证是静态的，不运行代码

---

#### 阶段 7: 持久化与索引更新 (Persistence)

**方法**: `persistAndUpdateIndex()`

**功能**:
- 保存生成的文件到存储
- 更新符号索引
- 更新项目骨架

**输出**: 无（副作用操作）

---

### 阶段 8: 后端验证和自动修复循环 (`app/api/generate/route.ts`)

**文件**: `app/api/generate/route.ts` (第136-271行)

**循环逻辑**:
```typescript
while (validationAttempts < maxValidationAttempts) {
  1. 保存代码到数据库
  2. 准备验证文件列表
  3. 执行后端验证
  4. 如果验证成功 → 退出循环
  5. 如果验证失败 → 调用修复 API
  6. 更新代码
  7. 重新验证
}
```

#### 8.1 后端验证 (`lib/code-validator.ts`)

**类**: `CodeValidator`

**步骤**:
1. **创建临时项目目录**
   - 路径: `.temp-projects/{sessionId}/`
   - 确保目录存在

2. **写入文件**
   - 将所有生成的文件写入临时目录
   - 保持目录结构

3. **创建 package.json**（如果不存在）
   - 检测是否为 React 项目
   - 自动创建合适的 `package.json`
   - 配置依赖和脚本

4. **安装依赖**
   - 运行 `npm install`
   - 检测安装错误
   - 超时: 60秒

5. **构建项目**
   - 运行 `npm run build`
   - 检测构建错误（语法错误、模块错误等）
   - 如果构建脚本不存在，跳过（不算错误）

6. **启动开发服务器**
   - 运行 `npm run dev`
   - 监听输出，检测编译错误
   - 超时: 10秒

**输出**: `ValidationResult`
```typescript
{
  success: boolean;
  errors: string[];
  warnings: string[];
  buildOutput?: string;
  runtimeOutput?: string;
}
```

#### 8.2 自动修复 (`app/api/fix-errors/route.ts`)

**触发条件**: 验证失败且未达到最大尝试次数

**步骤**:
1. **收集错误信息**
   - 获取验证失败的错误列表
   - 获取当前文件内容

2. **调用 LLM 修复**
   - 构建修复提示（包含错误信息和文件内容）
   - 调用 GLM-4-Plus API
   - 解析修复后的文件内容

3. **保存修复后的文件**
   - 更新数据库中的文件
   - 返回修复后的文件列表

**输出**: 
```typescript
{
  success: boolean;
  message: string;
  files: string[]; // 文件路径列表
  fixedFiles: Array<{ path: string; content: string }>; // 完整文件内容
}
```

#### 8.3 更新代码并重新验证

**步骤**:
1. 使用修复 API 返回的文件内容更新 `finalCode`
2. 等待文件保存完成（1秒）
3. 重新进入验证循环

**最大尝试次数**: 3次

---

### 阶段 9: 最终处理和返回 (`app/api/generate/route.ts`)

**步骤**:
1. **保存最终代码**
   - 保存到会话（Session）
   - 兼容新旧格式（files数组 vs html/css/js）

2. **添加 AI 响应**
   - 生成完成消息
   - 包含文件列表
   - 包含验证状态

3. **保存到聊天记录**
   - 保存 AI 消息到 ChatMessage

4. **返回结果**
   ```typescript
   {
     success: true;
     code: {
       html: string;
       css: string;
       js: string;
       description: string;
       files: FileGenerationResult[];
       plan: ImplementationPlan;
     };
     validation: {
       success: boolean;
       attempts: number;
       errors: string[];
       warnings: string[];
     };
     sessionId: string;
     projectId: string;
     progress: AgentProgress[];
   }
   ```

---

## 数据流图

```
用户输入 (prompt)
    ↓
[API 入口] POST /api/generate
    ↓
[会话管理] 获取/创建 Session
    ↓
[Agent 生成] 7阶段工作流
    ├─ 阶段1: 意图解析
    ├─ 阶段2: 符号检索
    ├─ 阶段3: 上下文组装
    ├─ 阶段4: 实现方案规划
    ├─ 阶段5: 分文件代码生成
    ├─ 阶段6: 沙箱验证（静态）
    └─ 阶段7: 持久化与索引更新
    ↓
[后端验证循环] (最多3次)
    ├─ 保存代码到数据库
    ├─ 创建临时项目
    ├─ npm install
    ├─ npm run build
    ├─ npm run dev (检测错误)
    ├─ [如果失败] 调用修复 API
    │   ├─ 收集错误
    │   ├─ LLM 修复
    │   └─ 保存修复后的文件
    └─ 重新验证
    ↓
[返回结果] 包含代码和验证状态
```

---

## 关键组件

### 1. FrontendAgent (`lib/frontend-agent.ts`)
- 负责7阶段代码生成
- 管理 LLM 调用
- 管理项目骨架和符号索引

### 2. CodeValidator (`lib/code-validator.ts`)
- 后端代码验证
- 创建临时项目并运行
- 检测构建和运行时错误

### 3. FileManager (`lib/file-manager.ts`)
- 文件存储和检索
- 支持数据库和内存存储（降级）

### 4. SessionManager (`lib/session-manager.ts`)
- 会话管理
- 消息历史管理

### 5. ChatMessageManager (`lib/chat-message-manager.ts`)
- 聊天记录管理
- 用户和 AI 消息存储

---

## 错误处理

### Agent 生成阶段错误
- 文件生成失败：继续生成其他文件，不中断流程
- 验证失败：记录警告，但不阻止返回结果

### 后端验证错误
- 依赖安装失败：返回错误，触发修复
- 构建失败：返回错误，触发修复
- 运行时错误：返回错误，触发修复

### 修复失败
- 修复 API 失败：记录错误，停止循环
- 达到最大尝试次数：返回当前代码和错误信息

---

## 性能优化

1. **并发处理**: 文件生成可以并发（当前是串行）
2. **缓存**: 项目骨架和符号索引可以缓存
3. **超时控制**: 验证步骤都有超时限制
4. **降级处理**: 数据库不可用时降级到内存存储

---

## 未来改进

1. **并发文件生成**: 支持并行生成多个文件
2. **增量验证**: 只验证修改的文件
3. **更智能的修复**: 使用更详细的错误上下文
4. **缓存优化**: 缓存验证结果，避免重复验证
5. **WebContainer 集成**: 使用 WebContainer 进行更真实的验证
