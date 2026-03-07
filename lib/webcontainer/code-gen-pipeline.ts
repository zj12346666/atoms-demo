/**
 * CodeGenPipeline - 代码生成全链路流水线
 *
 * 完整流程：
 *  1. LLM 生成代码（扁平文件结构）
 *  2. Runtime 预处理 & 修复
 *  3. WebContainer 启动
 *  4. 构建 & 运行
 *  5. 错误捕获
 *  6. 自动修复循环
 *  7. 预览 & 交互
 */

import OpenAI from 'openai';
import { WebContainerRuntime } from './webcontainer-runtime';
import { templateCompleter } from './template-completer';
import type { FlatFileStructure } from './file-tree-builder';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

/** 流水线步骤名称 */
export type PipelineStep =
  | 'llm_generation'
  | 'preprocessing'
  | 'webcontainer_boot'
  | 'build_run'
  | 'error_capture'
  | 'auto_fix'
  | 'preview';

/** 流水线进度回调 */
export interface PipelineProgress {
  step: PipelineStep;
  status: 'pending' | 'running' | 'success' | 'error';
  message: string;
  /** 整体进度，0–100 */
  progress: number;
  details?: string;
}

/** 流水线运行选项 */
export interface PipelineOptions {
  sessionId?: string;
  /** 最大自动修复次数，默认 3 */
  maxFixAttempts?: number;
  /** WebContainer 启动超时（毫秒），默认 60000 */
  timeout?: number;
  /** 启动后观察错误的等待时间（毫秒），默认 8000 */
  errorWaitMs?: number;
  /** 是否跳过 npm install，默认 false */
  skipInstall?: boolean;
  /** 覆盖默认模型 */
  model?: string;
}

/** 流水线运行结果 */
export interface PipelineResult {
  success: boolean;
  /** 开发服务器预览 URL */
  previewUrl?: string;
  /** 最终文件结构（含模板文件） */
  files: FlatFileStructure;
  /** 剩余未修复的错误（如果有） */
  errors?: string[];
  /** 实际执行的自动修复次数 */
  fixAttempts: number;
  /** 总耗时（毫秒） */
  totalTimeMs: number;
  /** 释放 WebContainer 资源 */
  cleanup: () => Promise<void>;
}

// ============================================================
// CodeGenPipeline
// ============================================================

export class CodeGenPipeline {
  private client: OpenAI;
  private model: string;

  constructor(options: {
    apiKey: string;
    baseURL?: string;
    /** 默认模型，默认 'glm-4-plus' */
    model?: string;
  }) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model ?? 'glm-4-plus';
  }

  // ============================================================
  // Main Entry
  // ============================================================

  /**
   * 运行完整的 7 步代码生成流水线。
   *
   * @param prompt     用户需求描述
   * @param options    流水线选项
   * @param onProgress 进度回调
   */
  async run(
    prompt: string,
    options: PipelineOptions = {},
    onProgress?: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> {
    const {
      maxFixAttempts = 3,
      sessionId,
      timeout = 60000,
      errorWaitMs = 8000,
      skipInstall = false,
      model,
    } = options;

    if (model) this.model = model;

    const startTime = Date.now();
    let files: FlatFileStructure = {};
    let fixAttempts = 0;
    const runtime = new WebContainerRuntime();

    /** 发送进度通知（同时写日志） */
    const notify = (p: PipelineProgress) => {
      logger.info(
        `[CodeGenPipeline] ${p.step} [${p.status}] (${p.progress}%) ${p.message}`
      );
      onProgress?.(p);
    };

    try {
      // ────────────────────────────────────────────────────────
      // STEP 1 · LLM 生成代码（扁平文件结构）
      // ────────────────────────────────────────────────────────
      notify({
        step: 'llm_generation',
        status: 'running',
        message: '🤖 AI 正在生成代码...',
        progress: 5,
        details: '调用大语言模型，生成项目文件结构',
      });

      files = await this.generateFlatFiles(prompt);

      notify({
        step: 'llm_generation',
        status: 'success',
        message: `✅ 代码生成完成`,
        progress: 20,
        details: `共 ${Object.keys(files).length} 个文件：${Object.keys(files).join(', ')}`,
      });

      // ────────────────────────────────────────────────────────
      // STEP 2 · Runtime 预处理 & 修复
      // ────────────────────────────────────────────────────────
      notify({
        step: 'preprocessing',
        status: 'running',
        message: '🔧 预处理文件结构...',
        progress: 22,
        details: '路径规范化 · 模板补全 · 依赖修复',
      });

      files = this.preprocessFiles(files);

      notify({
        step: 'preprocessing',
        status: 'success',
        message: `✅ 预处理完成`,
        progress: 30,
        details: `补全后共 ${Object.keys(files).length} 个文件（含模板文件）`,
      });

      // ────────────────────────────────────────────────────────
      // STEP 3 · WebContainer 启动
      // STEP 4 · 构建 & 运行
      // STEP 5 · 错误捕获
      // STEP 6 · 自动修复循环
      // ────────────────────────────────────────────────────────
      for (let attempt = 0; attempt <= maxFixAttempts; attempt++) {
        fixAttempts = attempt;
        const isFirstRun = attempt === 0;

        if (isFirstRun) {
          // ── Step 3: 启动 WebContainer ──────────────────────
          notify({
            step: 'webcontainer_boot',
            status: 'running',
            message: '🚀 启动 WebContainer...',
            progress: 32,
          });

          // ── Step 4: 构建 & 运行 ────────────────────────────
          notify({
            step: 'build_run',
            status: 'running',
            message: '📦 安装依赖并启动开发服务器...',
            progress: 38,
            details: 'npm install → npm run dev',
          });

          await runtime.initialize(files, {
            sessionId,
            skipInstall,
            cacheEnabled: true,
            timeout,
            // 预处理已完成模板补全，跳过 runtime 内部重复补全
            skipTemplateCompletion: true,
          });

          notify({
            step: 'build_run',
            status: 'success',
            message: `✅ 开发服务器已启动`,
            progress: 58,
            details: `预览地址：${runtime.getPreviewUrl() ?? '待获取'}`,
          });
        } else {
          // ── Step 6: 自动修复 → 写入更新的文件 ──────────────
          notify({
            step: 'auto_fix',
            status: 'running',
            message: `🔧 写入修复后的文件... (第 ${attempt}/${maxFixAttempts} 次)`,
            progress: 62 + attempt * 8,
          });

          await runtime.updateFiles(files);

          notify({
            step: 'auto_fix',
            status: 'running',
            message: `⏳ 等待热重载生效...`,
            progress: 64 + attempt * 8,
          });

          // 等待 Vite HMR / 重新编译
          await this.delay(3000);
        }

        // ── Step 5: 错误捕获 ───────────────────────────────
        notify({
          step: 'error_capture',
          status: 'running',
          message: `🔍 监控运行时错误 (${errorWaitMs / 1000}s)...`,
          progress: 67 + attempt * 5,
          details: '收集构建错误与运行时异常',
        });

        runtime.clearErrors();
        await this.delay(errorWaitMs);
        const capturedErrors = runtime.getErrors();

        if (capturedErrors.length === 0) {
          // ── Step 7: 预览 & 交互 ────────────────────────────
          const previewUrl = runtime.getPreviewUrl();
          notify({
            step: 'preview',
            status: 'success',
            message: `✅ 项目运行成功！${attempt > 0 ? `（经过 ${attempt} 次自动修复）` : ''}`,
            progress: 100,
            details: previewUrl ?? undefined,
          });

          return {
            success: true,
            previewUrl: previewUrl ?? undefined,
            files,
            fixAttempts: attempt,
            totalTimeMs: Date.now() - startTime,
            cleanup: () => runtime.cleanup(),
          };
        }

        // ── 仍有错误 ──────────────────────────────────────
        notify({
          step: 'error_capture',
          status: 'error',
          message: `⚠️ 捕获到 ${capturedErrors.length} 个错误`,
          progress: 70 + attempt * 5,
          details: capturedErrors.slice(0, 3).join('\n'),
        });

        if (attempt >= maxFixAttempts) {
          // 超过最大修复次数
          notify({
            step: 'auto_fix',
            status: 'error',
            message: `❌ 达到最大修复次数 (${maxFixAttempts})，仍存在错误`,
            progress: 95,
            details: capturedErrors.slice(0, 3).join('\n'),
          });

          return {
            success: false,
            previewUrl: runtime.getPreviewUrl() ?? undefined,
            files,
            errors: capturedErrors,
            fixAttempts: attempt,
            totalTimeMs: Date.now() - startTime,
            cleanup: () => runtime.cleanup(),
          };
        }

        // ── Step 6: 调用 LLM 自动修复 ────────────────────
        notify({
          step: 'auto_fix',
          status: 'running',
          message: `🤖 AI 正在分析并修复错误... (第 ${attempt + 1}/${maxFixAttempts} 次)`,
          progress: 72 + attempt * 8,
          details: '将错误上下文发送给 LLM 进行代码修复',
        });

        const fixedFiles = await this.autoFix(prompt, files, capturedErrors);
        // 合并修复：保留原文件，修复文件覆盖
        files = this.preprocessFiles({ ...files, ...fixedFiles });
      }

      // 不应抵达此处
      return {
        success: false,
        files,
        fixAttempts,
        totalTimeMs: Date.now() - startTime,
        cleanup: () => runtime.cleanup(),
      };
    } catch (error: any) {
      logger.error('❌ [CodeGenPipeline] 流水线异常:', error);
      notify({
        step: 'build_run',
        status: 'error',
        message: `❌ 流水线失败: ${error.message}`,
        progress: 0,
        details: error.stack,
      });

      return {
        success: false,
        files,
        errors: [error.message],
        fixAttempts,
        totalTimeMs: Date.now() - startTime,
        cleanup: () => runtime.cleanup(),
      };
    }
  }

  // ============================================================
  // STEP 1 · LLM 生成代码（扁平文件结构）
  // ============================================================

  /**
   * 调用 LLM，返回扁平文件结构：
   *   { "src/App.tsx": "...", "src/index.css": "..." }
   *
   * 不含 package.json / vite.config.ts / index.html（由预处理补全）。
   */
  private async generateFlatFiles(prompt: string): Promise<FlatFileStructure> {
    const systemPrompt = `你是一个专业的前端代码生成专家。根据用户需求，生成一个完整的前端项目代码。

**输出要求：**
以 JSON 格式返回扁平文件结构，key 为相对路径，value 为文件的完整内容。

\`\`\`json
{
  "src/App.tsx": "import React from 'react';\n...",
  "src/components/Button.tsx": "...",
  "src/styles/main.css": "..."
}
\`\`\`

**重要规则：**
1. 只返回 JSON 对象，不要添加额外解释
2. 无需生成 package.json / vite.config.ts / index.html（系统会自动生成）
3. 使用 React 18 + TypeScript，函数式组件 + Hooks
4. 优先使用 Tailwind CSS；如无 Tailwind 则使用内联样式或 CSS 文件
5. 导入路径使用相对路径（如 './components/Button'）
6. 所有代码语法正确，无 TypeScript 编译错误
7. 组件需要完整的 React import（import React from 'react'）`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `生成以下项目：\n${prompt}` },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    });

    const raw = response.choices[0]?.message?.content ?? '';

    // 提取 JSON 代码块
    const jsonMatch =
      raw.match(/```json\s*\n([\s\S]*?)\n```/) ||
      raw.match(/```\s*\n([\s\S]*?)\n```/) ||
      raw.match(/(\{[\s\S]*\})/);

    if (!jsonMatch) {
      throw new Error('LLM 未返回有效的 JSON 文件结构，请重试');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    } catch (e) {
      throw new Error(`解析 LLM 输出失败：${(e as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('LLM 返回格式无效，期望 JSON 对象');
    }

    return parsed as FlatFileStructure;
  }

  // ============================================================
  // STEP 2 · Runtime 预处理 & 修复
  // ============================================================

  /**
   * 对 LLM 输出的文件结构进行预处理：
   * 1. 路径规范化（移除 leading slash、./ 等）
   * 2. 模板文件补全（index.html、package.json、vite.config.ts）
   */
  preprocessFiles(files: FlatFileStructure): FlatFileStructure {
    // ① 路径规范化
    const normalized: FlatFileStructure = {};
    for (const [rawPath, content] of Object.entries(files)) {
      const cleanPath = rawPath
        .replace(/^\/+/, '')   // 移除开头的 /
        .replace(/^\.\//, '')  // 移除开头的 ./
        .replace(/\/+/g, '/'); // 合并连续斜杠

      if (!cleanPath || cleanPath.includes('..') || cleanPath.startsWith('/')) {
        logger.warn(`[CodeGenPipeline] 跳过无效路径：${rawPath}`);
        continue;
      }
      normalized[cleanPath] = content;
    }

    // ② 模板文件补全（index.html / package.json / vite.config.ts）
    return templateCompleter.complete(normalized);
  }

  // ============================================================
  // STEP 6 · 自动修复（Auto-fix）
  // ============================================================

  /**
   * 将错误信息和当前代码发送给 LLM，获取修复后的文件。
   * 只返回需要修改的文件（其余文件保持不变）。
   */
  private async autoFix(
    originalPrompt: string,
    currentFiles: FlatFileStructure,
    errors: string[]
  ): Promise<FlatFileStructure> {
    // 排除模板文件，只向 LLM 展示用户代码
    const templateFiles = new Set([
      'package.json',
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mts',
      'index.html',
      'tsconfig.json',
    ]);

    const fileContext = Object.entries(currentFiles)
      .filter(([path]) => !templateFiles.has(path))
      .map(
        ([path, content]) =>
          `\`\`\`typescript\n// === ${path} ===\n${content}\n\`\`\``
      )
      .join('\n\n');

    const fixPrompt = `你是一个专业的 TypeScript/React 代码修复专家。

**原始需求：**
${originalPrompt}

**当前代码文件：**
${fileContext}

**检测到的运行时 / 构建错误：**
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

**请修复上述错误，以 JSON 格式返回修复后的文件：**
\`\`\`json
{
  "src/App.tsx": "// 修复后的完整文件内容",
  "src/components/xxx.tsx": "..."
}
\`\`\`

**修复规则：**
1. 只返回 JSON 对象，key 为文件路径，value 为完整文件内容
2. 只包含需要修改的文件（未修改的文件不要包含）
3. 修复后代码语法正确，无 TypeScript 编译错误
4. 不要修改 package.json / vite.config.ts / index.html`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            '你是一个专业的 TypeScript/React 代码修复专家，擅长根据错误信息快速定位并修复代码问题。',
        },
        { role: 'user', content: fixPrompt },
      ],
      temperature: 0.2,
      max_tokens: 6000,
    });

    const raw = response.choices[0]?.message?.content ?? '';

    const jsonMatch =
      raw.match(/```json\s*\n([\s\S]*?)\n```/) ||
      raw.match(/```\s*\n([\s\S]*?)\n```/) ||
      raw.match(/(\{[\s\S]*\})/);

    if (!jsonMatch) {
      logger.warn('[CodeGenPipeline] Auto-fix：LLM 未返回有效 JSON，保留原始文件');
      return {};
    }

    let fixedFiles: unknown;
    try {
      fixedFiles = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
    } catch (e) {
      logger.warn('[CodeGenPipeline] Auto-fix：JSON 解析失败，保留原始文件');
      return {};
    }

    if (typeof fixedFiles !== 'object' || fixedFiles === null) {
      return {};
    }

    logger.info(
      `[CodeGenPipeline] Auto-fix：LLM 返回 ${Object.keys(fixedFiles as object).length} 个修复文件`
    );

    return fixedFiles as FlatFileStructure;
  }

  // ============================================================
  // Utilities
  // ============================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * 便捷工厂函数
 *
 * @example
 * const pipeline = createCodeGenPipeline({ apiKey: '...' });
 * const result = await pipeline.run('创建一个 Todo App');
 */
export function createCodeGenPipeline(options: {
  apiKey: string;
  baseURL?: string;
  model?: string;
}): CodeGenPipeline {
  return new CodeGenPipeline(options);
}
