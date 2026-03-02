# Skills 模块使用指南

本文档介绍 5 大核心 Skill 模块的使用方法。

## 📋 模块概览

1. **🔍 SymbolicDiscoverySkill** - 符号导航与检索
2. **📝 MultiFileEngineeringSkill** - 原子化多文件生成
3. **🧪 SandboxValidationSkill** - 自动化沙箱校验
4. **💾 PersistenceSkill** - 确定性持久化
5. **📡 EnvironmentSyncSkill** - 环境感知与通知

## 🔍 SymbolicDiscoverySkill - 符号导航与检索

### 职责
解决"上下文拼装"问题。Agent 不看全量代码，只看它需要的"定义"。

### 主要方法

#### `searchSymbols(keywords, projectId, options?)`
在 PostgreSQL 的 `symbols` 表中进行关键词匹配。

```typescript
import { SymbolicDiscoverySkill } from '@/lib/skills';

const skill = new SymbolicDiscoverySkill();

// 搜索符号
const results = await skill.searchSymbols(
  ['Button', 'Component'],
  'project-123',
  {
    limit: 20,
    type: 'function', // 可选：'function' | 'variable' | 'class' | 'interface' | 'type' | 'event'
  }
);

// 结果包含：名称、文件路径、代码行号、函数签名
results.forEach(symbol => {
  console.log(`${symbol.name} (${symbol.type})`);
  console.log(`  文件: ${symbol.file}:${symbol.line}`);
  console.log(`  签名: ${symbol.signature}`);
});
```

#### `getComponentProps(componentName, projectId, sessionId?)`
专门针对前端，提取特定组件的 interface Props。

```typescript
const props = await skill.getComponentProps(
  'Button',
  'project-123',
  'session-456' // 可选
);

if (props) {
  console.log(`组件: ${props.componentName}`);
  console.log(`文件: ${props.file}`);
  console.log(`Props Interface:\n${props.propsInterface}`);
  props.propsDetails.forEach(prop => {
    console.log(`  - ${prop.name}: ${prop.type} ${prop.required ? '(required)' : '(optional)'}`);
  });
}
```

## 📝 MultiFileEngineeringSkill - 原子化多文件生成

### 职责
解决"脏代码入库"和"多文件协同"问题。支持在验证通过前，数据库里的"正式代码"保持不动。

### 主要方法

#### `stageCodeChanges(changes, sessionId)`
暂存代码变更到内存虚拟文件系统。

```typescript
import { MultiFileEngineeringSkill, FileChange } from '@/lib/skills';

const skill = new MultiFileEngineeringSkill();

const changes: FileChange[] = [
  {
    path: 'src/components/Button.tsx',
    action: 'UPDATE',
    code: `
      export function Button({ onClick, children }: ButtonProps) {
        return <button onClick={onClick}>{children}</button>;
      }
      // ... existing code ...
    `,
    isDiff: true, // 标记为增量更新
  },
  {
    path: 'src/styles/Button.css',
    action: 'CREATE',
    code: `
      .button {
        padding: 8px 16px;
        border-radius: 4px;
      }
    `,
  },
];

const result = await skill.stageCodeChanges(changes, 'session-456');
console.log(`暂存了 ${result.stagedFiles.length} 个文件`);
```

#### `getFileSkeleton(path, sessionId?)`
获取文件骨架（类名、函数名），隐藏具体实现。

```typescript
const skeleton = await skill.getFileSkeleton(
  'src/components/Button.tsx',
  'session-456'
);

if (skeleton) {
  console.log(`文件: ${skeleton.path}`);
  console.log(`类: ${skeleton.classes.map(c => c.name).join(', ')}`);
  console.log(`函数: ${skeleton.functions.map(f => f.name).join(', ')}`);
  console.log(`接口: ${skeleton.interfaces.map(i => i.name).join(', ')}`);
  console.log(`导入: ${skeleton.imports.join(', ')}`);
  console.log(`导出: ${skeleton.exports.join(', ')}`);
}
```

## 🧪 SandboxValidationSkill - 自动化沙箱校验

### 职责
VIP 方案的"护城河"，实现自愈循环。在内存中对暂存的代码运行类型检查和 AST 检查。

### 主要方法

#### `validateInSandbox(stagedFiles)`
在沙箱中验证代码。

```typescript
import { SandboxValidationSkill } from '@/lib/skills';
import { MultiFileEngineeringSkill } from '@/lib/skills';

const multiFileSkill = new MultiFileEngineeringSkill();
const validationSkill = new SandboxValidationSkill();

// 1. 先暂存代码
await multiFileSkill.stageCodeChanges(changes, sessionId);

// 2. 获取暂存的文件
const stagedFiles = multiFileSkill.getAllStagedFiles();

// 3. 验证
const report = await validationSkill.validateInSandbox(stagedFiles);

if (report.success) {
  console.log('✅ 验证通过');
} else {
  console.log(`❌ 发现 ${report.errors.length} 个错误`);
  report.errors.forEach(error => {
    console.log(`${error.file}:${error.line}:${error.column} - ${error.message}`);
    if (error.contextCode) {
      console.log(`上下文:\n${error.contextCode}`);
    }
  });
}
```

#### `previewRenderCheck(stagedFiles)`
AST 解析检查，检测循环引用、未定义变量等。

```typescript
const astErrors = await validationSkill.previewRenderCheck(stagedFiles);
// 返回 ValidationError[] 数组
```

## 💾 PersistenceSkill - 确定性持久化

### 职责
解决"记忆同步"问题。将暂存的代码正式写入 PostgreSQL，并更新符号索引。

### 主要方法

#### `commitStagedChanges(sessionId, projectId, stagedFiles)`
提交暂存的变更到数据库（使用事务确保原子性）。

```typescript
import { PersistenceSkill } from '@/lib/skills';

const skill = new PersistenceSkill();

const result = await skill.commitStagedChanges(
  'session-456',
  'project-123',
  stagedFiles // 从 MultiFileEngineeringSkill 获取
);

if (result.success) {
  console.log(`✅ 已持久化 ${result.persistedFiles.length} 个文件`);
} else {
  console.log(`❌ 持久化失败:`, result.errors);
}
```

#### `refreshSymbolIndex(filePaths, sessionId, projectId)`
刷新符号索引。

```typescript
const reindexResult = await skill.refreshSymbolIndex(
  ['src/components/Button.tsx', 'src/styles/Button.css'],
  'session-456',
  'project-123'
);

console.log(`✅ 已更新 ${reindexResult.updatedSymbols} 个符号索引`);
```

#### `commitAndRefresh(sessionId, projectId, stagedFiles)`
一次性完成持久化和索引更新。

```typescript
const { persistence, reindex } = await skill.commitAndRefresh(
  'session-456',
  'project-123',
  stagedFiles
);

console.log(`持久化: ${persistence.success ? '成功' : '失败'}`);
console.log(`索引更新: ${reindex.updatedSymbols} 个符号`);
```

## 📡 EnvironmentSyncSkill - 环境感知与通知

### 职责
解决"用户体验"和"状态同步"问题。通过 WebSocket 向前端发送刷新指令。

### 主要方法

#### `syncWebIdeView(sessionId, filePaths?, action?)`
同步 Web IDE 视图。

```typescript
import { EnvironmentSyncSkill } from '@/lib/skills';

const skill = new EnvironmentSyncSkill();

// 刷新所有文件
await skill.syncWebIdeView('session-456');

// 刷新特定文件
await skill.syncWebIdeView(
  'session-456',
  ['src/components/Button.tsx'],
  'UPDATE'
);
```

#### `getProjectMap(sessionId, projectId?)`
获取项目文件夹层级树。

```typescript
const projectMap = await skill.getProjectMap('session-456', 'project-123');

if (projectMap) {
  console.log(`项目根: ${projectMap.name}`);
  console.log(`子节点: ${projectMap.children?.length || 0} 个`);
  
  // 递归遍历
  function traverse(node: ProjectMapNode, indent = 0) {
    const prefix = '  '.repeat(indent);
    console.log(`${prefix}${node.name} (${node.type})`);
    if (node.children) {
      node.children.forEach(child => traverse(child, indent + 1));
    }
  }
  
  traverse(projectMap);
}
```

#### `emitWorkflowProgress(sessionId, state, message, progress, details?)`
发送工作流进度更新。

```typescript
skill.emitWorkflowProgress(
  'session-456',
  'code_generation',
  '正在生成代码...',
  50,
  '已生成 3/6 个文件'
);
```

## 🔄 完整工作流示例

```typescript
import {
  SymbolicDiscoverySkill,
  MultiFileEngineeringSkill,
  SandboxValidationSkill,
  PersistenceSkill,
  EnvironmentSyncSkill,
} from '@/lib/skills';

async function executeWorkflow(
  prompt: string,
  sessionId: string,
  projectId: string
) {
  // 1. 符号检索
  const discovery = new SymbolicDiscoverySkill();
  const symbols = await discovery.searchSymbols(
    ['Button', 'Component'],
    projectId
  );

  // 2. 生成代码变更
  const multiFile = new MultiFileEngineeringSkill();
  const changes: FileChange[] = [
    // ... 生成代码变更
  ];
  
  // 3. 暂存变更
  await multiFile.stageCodeChanges(changes, sessionId);
  const stagedFiles = multiFile.getAllStagedFiles();

  // 4. 验证
  const validation = new SandboxValidationSkill();
  const report = await validation.validateInSandbox(stagedFiles);

  if (!report.success) {
    console.log('验证失败，需要修复错误');
    return;
  }

  // 5. 持久化
  const persistence = new PersistenceSkill();
  const { persistence: persistResult, reindex } = 
    await persistence.commitAndRefresh(sessionId, projectId, stagedFiles);

  if (!persistResult.success) {
    console.log('持久化失败');
    return;
  }

  // 6. 同步前端
  const sync = new EnvironmentSyncSkill();
  await sync.syncWebIdeView(
    sessionId,
    Array.from(stagedFiles.keys()),
    'UPDATE'
  );

  console.log('✅ 工作流完成');
}
```

## 📝 注意事项

1. **事务保证**：`PersistenceSkill.commitStagedChanges` 使用事务，确保多文件同步更新。
2. **虚拟文件系统**：`MultiFileEngineeringSkill` 使用内存虚拟文件系统，验证通过前不会写入数据库。
3. **符号索引**：每次文件更新后，记得调用 `refreshSymbolIndex` 更新符号索引。
4. **WebSocket 连接**：`EnvironmentSyncSkill` 需要 WebSocket 服务器已初始化。
5. **错误处理**：所有方法都包含错误处理，建议检查返回的 `success` 字段。

## 🚀 最佳实践

1. **先暂存，再验证，最后持久化**：确保代码质量。
2. **批量操作**：使用批量方法提高性能。
3. **错误收集**：收集所有错误信息，一次性修复。
4. **进度通知**：使用 `EnvironmentSyncSkill.emitWorkflowProgress` 实时通知用户。
