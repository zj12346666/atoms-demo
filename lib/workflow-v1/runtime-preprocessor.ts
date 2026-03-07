/**
 * RuntimePreprocessor - LLM 代码生成后、WebContainer 启动前的预处理与修复
 *
 * 在代码写入 WebContainer 之前，对 LLM 生成的扁平文件结构进行全面预处理：
 *
 *  1. 路径规范化          - 移除非法字符、统一分隔符
 *  2. React/JSX 修复     - 补全缺失的 React 命名空间导入
 *  3. 导入扩展名修复      - 移除 .ts/.tsx 后缀（Vite 自动解析）
 *  4. tsconfig.json 生成 - 若项目有 TS 文件但缺少配置
 *  5. 模板文件补全        - package.json / index.html / vite.config.ts
 */

import { templateCompleter } from '../webcontainer/template-completer';
import { fileTreeBuilder } from '../webcontainer/file-tree-builder';
import { logger } from '../logger';
import type {
  IRuntimePreprocessor,
  RuntimePreprocessorInput,
  RuntimePreprocessorOutput,
  FlatFileStructure,
} from './types';

export class RuntimePreprocessor implements IRuntimePreprocessor {
  /**
   * 执行全量预处理
   */
  async preprocess(
    input: RuntimePreprocessorInput
  ): Promise<RuntimePreprocessorOutput> {
    const startTime = Date.now();
    const { files } = input;
    const fixes: string[] = [];

    logger.info('🔧 [RuntimePreprocessor] 开始预处理...');

    let processed = { ...files };

    // Step 1 ─ 路径规范化
    processed = this.normalizeFilePaths(processed, fixes);

    // Step 2 ─ 修复 React 命名空间导入（React.xxx 但无 import React）
    processed = this.fixReactImports(processed, fixes);

    // Step 3 ─ 移除显式 .ts/.tsx 扩展名（Vite/bundler 自动处理）
    processed = this.fixImportExtensions(processed, fixes);

    // Step 4 ─ 补全 tsconfig.json
    processed = this.ensureTsConfig(processed, fixes);

    // Step 5 ─ 模板文件补全（package.json / index.html / vite.config.ts / src/main.tsx）
    const beforeCount = Object.keys(processed).length;
    processed = templateCompleter.complete(processed);
    const added = Object.keys(processed).filter((k) => !(k in files));
    if (added.length > 0) {
      fixes.push(`补全模板文件: ${added.join(', ')}`);
    }

    // 文件树合法性校验（仅警告，不阻断）
    const tree = fileTreeBuilder.build(processed);
    const validation = fileTreeBuilder.validate(tree);
    if (!validation.valid) {
      logger.warn(
        `⚠️ [RuntimePreprocessor] 文件树校验警告: ${validation.errors.join('; ')}`
      );
    }

    const projectType = templateCompleter.detectProjectType(processed);

    logger.info(
      `✅ [RuntimePreprocessor] 预处理完成 ` +
        `(${Date.now() - startTime}ms, 类型: ${projectType}, ` +
        `修复: ${fixes.length}, 文件: ${Object.keys(processed).length})`
    );

    return { files: processed, fixes, projectType };
  }

  // ─────────────────────────────────────────────────────────
  // 私有方法
  // ─────────────────────────────────────────────────────────

  /**
   * 路径规范化
   * - 移除开头的 `/` 或 `./`
   * - 统一使用 `/` 分隔符
   * - 跳过包含非法字符的路径
   */
  private normalizeFilePaths(
    files: FlatFileStructure,
    fixes: string[]
  ): FlatFileStructure {
    const result: FlatFileStructure = {};

    for (const [path, content] of Object.entries(files)) {
      const normalized = fileTreeBuilder.normalizePath(path);
      if (!normalized) {
        logger.warn(`⚠️ [RuntimePreprocessor] 跳过无效路径: ${path}`);
        fixes.push(`跳过无效路径: ${path}`);
        continue;
      }
      if (normalized !== path) {
        fixes.push(`路径规范化: ${path} → ${normalized}`);
      }
      result[normalized] = content;
    }

    return result;
  }

  /**
   * 修复 React 命名空间缺失
   * 场景：文件中使用了 React.useState / React.FC 等，但没有 import React
   * 注意：Vite 默认开启自动 JSX transform，不需要 import React 用于 JSX；
   *       但若代码显式引用了 React.xxx，仍需导入。
   */
  private fixReactImports(
    files: FlatFileStructure,
    fixes: string[]
  ): FlatFileStructure {
    const result: FlatFileStructure = {};

    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.tsx') && !path.endsWith('.jsx')) {
        result[path] = content;
        continue;
      }

      const usesReactNamespace = /\bReact\.[A-Za-z]/.test(content);
      const hasReactImport =
        /import\s+React\b/.test(content) ||
        /import\s*\*\s*as\s+React\b/.test(content);

      if (usesReactNamespace && !hasReactImport) {
        result[path] = `import React from 'react';\n${content}`;
        fixes.push(`补全 React 导入: ${path}`);
      } else {
        result[path] = content;
      }
    }

    return result;
  }

  /**
   * 移除 import 语句中的 .ts / .tsx 扩展名
   * Vite 及大多数 bundler 不需要（也不推荐）在导入路径中写扩展名
   */
  private fixImportExtensions(
    files: FlatFileStructure,
    fixes: string[]
  ): FlatFileStructure {
    const result: FlatFileStructure = {};

    for (const [path, content] of Object.entries(files)) {
      if (!path.match(/\.(ts|tsx|js|jsx)$/)) {
        result[path] = content;
        continue;
      }

      // 只处理相对路径导入中的 .ts/.tsx 后缀
      const fixed = content.replace(
        /from\s+(['"])(\.{1,2}\/[^'"]+)\.(ts|tsx)(['"])/g,
        (_match, q1, importPath, _ext, q2) => {
          return `from ${q1}${importPath}${q2}`;
        }
      );

      if (fixed !== content) {
        fixes.push(`移除导入扩展名: ${path}`);
      }
      result[path] = fixed;
    }

    return result;
  }

  /**
   * 若项目有 TypeScript 文件且缺少 tsconfig.json，自动生成一份宽松配置
   * strict: false —— 避免 LLM 生成代码中常见的类型警告中断构建
   */
  private ensureTsConfig(
    files: FlatFileStructure,
    fixes: string[]
  ): FlatFileStructure {
    const hasTsFiles = Object.keys(files).some(
      (p) => p.endsWith('.ts') || p.endsWith('.tsx')
    );

    if (!hasTsFiles || 'tsconfig.json' in files) {
      return files;
    }

    const hasReact = Object.keys(files).some((p) => p.endsWith('.tsx'));

    const tsConfig = {
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        lib: hasReact ? ['ES2020', 'DOM', 'DOM.Iterable'] : ['ES2020'],
        module: 'ESNext',
        skipLibCheck: true,
        moduleResolution: 'bundler',
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        ...(hasReact ? { jsx: 'react-jsx' } : {}),
        // 宽松模式：避免 LLM 生成代码的严格类型检查中断构建
        strict: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
      include: ['src'],
    };

    fixes.push('自动生成 tsconfig.json（宽松模式）');

    return {
      ...files,
      'tsconfig.json': JSON.stringify(tsConfig, null, 2),
    };
  }
}
