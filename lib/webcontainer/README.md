# WebContainer Runtime 模块

生产级的 WebContainer 运行时系统，用于在浏览器中运行 LLM 生成的前端项目。

## 快速开始

### 基本使用

```typescript
import { runProject } from '@/lib/webcontainer';

// LLM 返回的扁平文件结构
const flatFiles = {
  'index.html': '<!DOCTYPE html>...',
  'package.json': '{ "name": "my-app", ... }',
  'src/App.tsx': 'import React from "react"; ...',
  'src/components/SnakeGame.tsx': 'export function SnakeGame() { ... }',
};

// 运行项目
const result = await runProject(flatFiles, {
  sessionId: 'session-123',
  cacheEnabled: true,
});

console.log('预览 URL:', result.url);

// 清理资源
await result.cleanup();
```

### 在 React 组件中使用

```typescript
'use client';

import { useEffect, useState } from 'react';
import { runProject } from '@/lib/webcontainer';

export function ProjectPreview({ flatFiles }: { flatFiles: Record<string, string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cleanup: (() => Promise<void>) | null = null;

    const init = async () => {
      try {
        setLoading(true);
        const result = await runProject(flatFiles, {
          sessionId: 'current-session',
          cacheEnabled: true,
        });
        setUrl(result.url);
        cleanup = result.cleanup;
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    init();

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [flatFiles]);

  if (loading) return <div>加载中...</div>;
  if (error) return <div>错误: {error}</div>;
  if (!url) return null;

  return <iframe src={url} className="w-full h-full" />;
}
```

## 模块说明

### 1. FileTreeBuilder

将扁平文件结构转换为 WebContainer 树形结构。

```typescript
import { fileTreeBuilder } from '@/lib/webcontainer';

const flatFiles = {
  'src/App.tsx': '...',
  'package.json': '...',
};

const tree = fileTreeBuilder.build(flatFiles);
// 结果: { "src": { directory: { "App.tsx": { file: { contents: "..." } } } } }
```

### 2. TemplateCompleter

自动补全缺失的关键文件。

```typescript
import { templateCompleter } from '@/lib/webcontainer';

const incompleteFiles = {
  'src/App.tsx': '...',
  // 缺少 index.html, package.json, vite.config.ts
};

const completed = templateCompleter.complete(incompleteFiles);
// 自动添加缺失的文件
```

### 3. WebContainerRuntime

完整的 WebContainer 生命周期管理。

```typescript
import { WebContainerRuntime } from '@/lib/webcontainer';

const runtime = new WebContainerRuntime();
const result = await runtime.initialize(flatFiles, {
  sessionId: 'session-123',
  skipInstall: false,
  cacheEnabled: true,
  timeout: 60000,
});
```

### 4. PerformanceOptimizer

性能优化和缓存管理。

```typescript
import { performanceOptimizer } from '@/lib/webcontainer';

// 检查是否应该跳过安装
const shouldSkip = await performanceOptimizer.shouldSkipInstall(flatFiles, sessionId);

// 标记已安装
await performanceOptimizer.markInstalled(flatFiles, sessionId);

// 清除缓存
await performanceOptimizer.clearCache();
```

## API 参考

### `runProject(flatFiles, options?)`

运行项目的便捷函数。

**参数：**
- `flatFiles: Record<string, string>` - 扁平文件结构
- `options?: RuntimeOptions` - 运行时选项
  - `sessionId?: string` - 会话 ID（用于缓存）
  - `skipInstall?: boolean` - 是否跳过依赖安装
  - `cacheEnabled?: boolean` - 是否启用缓存
  - `timeout?: number` - 超时时间（毫秒）

**返回：**
```typescript
{
  url: string;              // 预览 URL
  webcontainer: WebContainer; // WebContainer 实例
  cleanup: () => Promise<void>; // 清理函数
}
```

## 特性

### ✅ 自动模板补全
- 自动检测项目类型（React/Vue/Vanilla）
- 生成最小可用的 Vite 配置
- 补全缺失的关键文件

### ✅ 路径规范化
- 自动处理相对路径
- 防止路径遍历攻击
- 文件名大小写修正

### ✅ 性能优化
- 依赖安装缓存（基于 package.json hash）
- node_modules 快照（IndexedDB）
- 冷启动加速

### ✅ 错误处理
- 详细的错误日志
- 自动恢复机制
- 超时保护

### ✅ 生产级
- 完整的类型定义
- 结构化日志
- 资源清理
- 内存管理

## 注意事项

### 1. Cross-Origin Isolation

WebContainer 需要 Cross-Origin Isolation。确保服务器设置了正确的响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

### 2. 文件大小限制

建议单文件大小 < 10MB，总文件数 < 1000。

### 3. 内存管理

使用完毕后务必调用 `cleanup()` 释放资源。

### 4. 缓存策略

缓存基于 `package.json` 的 hash。如果依赖变化，缓存会自动失效。

## 故障排除

### 问题：文件系统挂载失败

**可能原因：**
- 文件路径包含特殊字符
- 文件名大小写冲突
- 路径包含 `..`

**解决方案：**
- 检查文件路径是否规范
- 查看日志中的详细错误信息

### 问题：依赖安装失败

**可能原因：**
- 网络问题
- package.json 格式错误
- 版本冲突

**解决方案：**
- 检查 package.json 格式
- 查看 npm install 输出日志
- 尝试清除缓存后重试

### 问题：开发服务器启动超时

**可能原因：**
- 服务器启动时间过长
- 端口冲突
- 代码错误

**解决方案：**
- 增加 timeout 选项
- 检查代码是否有语法错误
- 查看开发服务器输出日志

## 性能指标

- **冷启动时间**：< 5 秒（首次运行）
- **热启动时间**：< 2 秒（使用缓存）
- **文件挂载时间**：< 1 秒（100 个文件）
- **依赖安装时间**：< 30 秒（首次），< 1 秒（缓存命中）

## 更新日志

### v1.0.0
- ✅ 初始版本
- ✅ 文件树构建
- ✅ 模板补全
- ✅ 性能优化
- ✅ 错误处理
