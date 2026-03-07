# AI Coding Agent Runtime Workflow V1 - 模块设计

## 模块划分

### 1. IntentAnalyzer
**职责：**
- 分析用户 prompt，识别目标文件路径
- 支持基于关键词、文件树、当前文件的智能匹配
- 输出目标文件路径和置信度

**接口：**
```typescript
interface IIntentAnalyzer {
  analyze(input: IntentAnalyzerInput): Promise<IntentAnalyzerOutput>;
}
```

**输入：**
- `userPrompt`: 用户修改需求
- `projectContext`: 可选的项目上下文（文件树、当前文件）

**输出：**
- `targetFilePath`: 目标文件路径
- `confidence`: 匹配置信度 (0-1)
- `reasoning`: 可选的分析理由

---

### 2. ContextBuilder
**职责：**
- 基于文件内容和用户 prompt 构造 LLM 上下文
- 格式化 prompt 模板
- 提取文件元信息（语言、行数等）

**接口：**
```typescript
interface IContextBuilder {
  build(input: ContextBuilderInput): Promise<ContextBuilderOutput>;
}
```

**输入：**
- `filePath`: 目标文件路径
- `fileContent`: 文件完整内容
- `userPrompt`: 用户修改需求
- `projectContext`: 可选的相关文件上下文

**输出：**
- `llmPrompt`: 格式化后的 LLM prompt
- `metadata`: 文件元信息

---

### 3. CodeGenerator
**职责：**
- 调用 LLM 生成完整文件代码
- 管理 LLM 配置（模型、温度、token 限制）
- 处理 LLM 响应和错误

**接口：**
```typescript
interface ICodeGenerator {
  generate(input: CodeGeneratorInput): Promise<CodeGeneratorOutput>;
}
```

**输入：**
- `llmPrompt`: LLM 上下文 prompt
- `modelConfig`: 可选的模型配置

**输出：**
- `generatedCode`: 生成的完整文件代码
- `metadata`: 生成元信息（模型、token 使用量）

---

### 4. ASTValidator
**职责：**
- 使用 TypeScript Compiler API 或 Babel 解析代码
- 检测语法错误（Syntax Error）
- 格式化错误信息（行号、列号、错误消息）

**接口：**
```typescript
interface IASTValidator {
  validate(input: ASTValidatorInput): Promise<ASTValidatorOutput>;
}
```

**输入：**
- `code`: 待验证的代码字符串
- `filePath`: 文件路径（用于错误定位）
- `language`: 可选的语言类型（typescript/javascript）

**输出：**
- `isValid`: 是否有语法错误
- `errors`: 语法错误列表
- `warnings`: 可选的警告列表

---

### 5. FileWriter
**职责：**
- 将生成的代码写入 WebContainer 文件系统
- 处理文件编码
- 返回写入状态和错误信息

**接口：**
```typescript
interface IFileWriter {
  write(input: FileWriterInput): Promise<FileWriterOutput>;
}
```

**输入：**
- `filePath`: 目标文件路径
- `content`: 文件内容
- `encoding`: 可选的编码格式

**输出：**
- `success`: 写入是否成功
- `error`: 可选的错误信息
- `bytesWritten`: 写入的字节数

---

### 6. RuntimeExecutor
**职责：**
- 在 WebContainer 中执行项目运行命令
- 收集运行日志（stdout/stderr）
- 捕获运行时错误
- 分类错误类型（syntax/runtime/type/build）

**接口：**
```typescript
interface IRuntimeExecutor {
  execute(input: RuntimeExecutorInput): Promise<RuntimeExecutorOutput>;
}
```

**输入：**
- `projectPath`: 项目根路径
- `command`: 可选的运行命令（默认根据项目类型推断）
- `timeout`: 可选的超时时间

**输出：**
- `success`: 执行是否成功
- `logs`: 运行日志列表
- `errors`: 运行时错误列表
- `exitCode`: 退出码
- `executionTime`: 执行时间（毫秒）

---

### 7. ErrorContextBuilder
**职责：**
- 基于错误信息和文件内容构造修复 prompt
- 分析错误类型和可能原因
- 生成针对性的修复建议

**接口：**
```typescript
interface IErrorContextBuilder {
  build(input: ErrorContextBuilderInput): Promise<ErrorContextBuilderOutput>;
}
```

**输入：**
- `error`: 错误信息（RuntimeError 或 SyntaxError）
- `filePath`: 文件路径
- `fileContent`: 当前文件内容
- `originalPrompt`: 可选的原始用户 prompt
- `executionLogs`: 可选的执行日志

**输出：**
- `fixPrompt`: 修复用的 LLM prompt
- `errorAnalysis`: 可选的错误分析（类型、原因、建议）

---

### 8. WorkflowOrchestrator
**职责：**
- 编排整个工作流执行顺序
- 管理重试逻辑
- 记录每个步骤的状态和结果
- 处理错误和异常

**接口：**
```typescript
interface IWorkflowOrchestrator {
  run(input: WorkflowInput): Promise<WorkflowOutput>;
}
```

**输入：**
- `userPrompt`: 用户修改需求
- `projectPath`: 项目路径
- `maxRetries`: 可选的最大重试次数

**输出：**
- `success`: 工作流是否成功
- `finalFilePath`: 最终修改的文件路径
- `finalCode`: 最终生成的代码
- `steps`: 工作流步骤列表
- `totalRetries`: 总重试次数
- `executionTime`: 总执行时间

---

## 工作流执行顺序

```
1. IntentAnalyzer.analyze()
   ↓
2. ContextBuilder.build()
   ↓
3. CodeGenerator.generate()
   ↓
4. ASTValidator.validate()
   ↓ (如果验证失败，进入错误修复流程)
5. FileWriter.write()
   ↓
6. RuntimeExecutor.execute()
   ↓ (如果执行失败，进入错误修复流程)
7. ErrorContextBuilder.build() (仅在错误时)
   ↓
8. 返回步骤 3，使用修复 prompt 重新生成
```

---

## 模块依赖关系

```
WorkflowOrchestrator
  ├── IntentAnalyzer
  ├── ContextBuilder
  ├── CodeGenerator
  ├── ASTValidator
  ├── FileWriter
  ├── RuntimeExecutor
  └── ErrorContextBuilder
```

所有模块都是独立的，通过接口定义交互，便于测试和替换。
