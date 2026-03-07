/**
 * 🔨 EsbuildCompileSkill
 * 用 esbuild 对暂存文件做 bundle 编译检查。
 * 比 tsc --noEmit 更真实：能检测出缺失文件、错误的 import 路径、CSS 导入等问题。
 *
 * 在 VIPWorkflowManager 中作为验证环的最后一步使用：
 *   SandboxValidation（tsc）→ WebContainerCompatibility → EsbuildCompile（打包检查）
 *
 * 当 esbuild 发现错误时，将错误以结构化格式返回，
 * VIPWorkflowManager 会把错误追加到下一轮生成 prompt，让 AI 修复后重新生成。
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../logger';

export interface CompileError {
  file: string;
  line: number;
  column: number;
  message: string;
  /** 原始 esbuild 错误文本 */
  raw: string;
}

export interface CompileReport {
  success: boolean;
  errors: CompileError[];
  warnings: CompileError[];
  /** 自动补全（但未能修复）的缺失文件列表 */
  autoCreatedFiles: string[];
  summary: string;
}

export class EsbuildCompileSkill {
  /**
   * 对一组源文件运行 esbuild bundle 检查。
   *
   * @param stagedFiles  path → content 的 Map（路径为相对路径，如 "src/App.tsx"）
   * @returns CompileReport
   */
  async compileAndCheck(stagedFiles: Map<string, string>): Promise<CompileReport> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atoms-esbuild-'));
    const autoCreatedFiles: string[] = [];

    try {
      // ── 1. 将所有文件写入临时目录 ──────────────────────────────────────
      for (const [relPath, content] of stagedFiles.entries()) {
        const absPath = path.join(tmpDir, relPath.replace(/^[./]+/, ''));
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, content, 'utf8');
      }

      // ── 2. 自动补全缺失的 CSS 文件（空文件，避免 esbuild 因此报错） ────
      const cssImportRe = /import\s+['"]([^'"]+\.css)['"]/g;
      const existingNorm = new Set(
        Array.from(stagedFiles.keys()).map(p => p.replace(/^[./]+/, '').replace(/\/+/g, '/'))
      );

      for (const content of stagedFiles.values()) {
        let m: RegExpExecArray | null;
        while ((m = cssImportRe.exec(content)) !== null) {
          const cssRel = m[1]; // e.g. "./App.css"
          // 解析成规范相对路径
          const norm = cssRel.replace(/^[./]+/, '').replace(/\/+/g, '/');
          // 候选落地路径：src/App.css 或 App.css
          const candidates = [norm, `src/${norm}`];
          if (candidates.every(c => !existingNorm.has(c))) {
            const target = cssRel.startsWith('./') || cssRel.startsWith('../') ? norm : `src/${norm}`;
            const absTarget = path.join(tmpDir, target);
            if (!fs.existsSync(absTarget)) {
              fs.mkdirSync(path.dirname(absTarget), { recursive: true });
              fs.writeFileSync(absTarget, '/* auto-generated empty CSS */', 'utf8');
              autoCreatedFiles.push(target);
              logger.info(`  🎨 [EsbuildCompileSkill] 自动补全空 CSS: ${target}`);
            }
          }
        }
      }

      // ── 3. 确定入口文件 ───────────────────────────────────────────────
      const priorityList = [
        'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
        'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
        'main.tsx', 'main.jsx', 'main.ts', 'main.js',
        'index.tsx', 'index.jsx', 'index.ts', 'index.js',
        'src/App.tsx', 'src/App.jsx',
        'App.tsx', 'App.jsx',
      ];

      let entryFile: string | null = null;
      for (const candidate of priorityList) {
        const abs = path.join(tmpDir, candidate);
        if (fs.existsSync(abs)) {
          entryFile = abs;
          break;
        }
      }

      // fallback: 取第一个 .tsx/.jsx 文件
      if (!entryFile) {
        for (const relPath of stagedFiles.keys()) {
          if (relPath.endsWith('.tsx') || relPath.endsWith('.jsx')) {
            entryFile = path.join(tmpDir, relPath.replace(/^[./]+/, ''));
            break;
          }
        }
      }

      if (!entryFile) {
        return {
          success: false,
          errors: [{
            file: 'unknown',
            line: 0,
            column: 0,
            message: '找不到入口文件（main.tsx / App.tsx 等）',
            raw: '找不到入口文件',
          }],
          warnings: [],
          autoCreatedFiles,
          summary: '❌ 找不到入口文件',
        };
      }

      // ── 4. 若入口没有 ReactDOM 挂载逻辑，自动生成包装入口 ─────────────
      const entryContent = fs.readFileSync(entryFile, 'utf8');
      const hasMount = entryContent.includes('ReactDOM') || entryContent.includes('createRoot');
      let actualEntry = entryFile;

      if (!hasMount) {
        const appName = path.basename(entryFile).replace(/\.(tsx|jsx|ts|js)$/, '');
        const wrapperPath = path.join(tmpDir, 'src', '__esbuild_entry__.tsx');
        fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
        fs.writeFileSync(wrapperPath, [
          `import React from 'react';`,
          `import ReactDOM from 'react-dom/client';`,
          `import App from './${appName}';`,
          `ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);`,
        ].join('\n'), 'utf8');
        actualEntry = wrapperPath;
      }

      // ── 5. 运行 esbuild ───────────────────────────────────────────────
      logger.info(`🔨 [EsbuildCompileSkill] 编译检查入口: ${actualEntry.replace(tmpDir + '/', '')}`);

      const result = await esbuild.build({
        entryPoints: [actualEntry],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2017',
        jsx: 'automatic',
        jsxImportSource: 'react',
        external: ['react', 'react-dom'],
        loader: {
          '.ts': 'ts', '.tsx': 'tsx',
          '.js': 'js', '.jsx': 'jsx',
          '.css': 'css',
          '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.gif': 'dataurl',
        },
        define: { 'process.env.NODE_ENV': '"production"' },
        absWorkingDir: tmpDir,
        logLevel: 'silent', // 我们自己处理错误，不让 esbuild 打印
      });

      const errors = this.mapMessages(result.errors, tmpDir);
      const warnings = this.mapMessages(result.warnings, tmpDir);

      const success = errors.length === 0;
      const summary = success
        ? `✅ esbuild 编译通过${warnings.length > 0 ? `，${warnings.length} 个警告` : ''}`
        : `❌ esbuild 编译失败，发现 ${errors.length} 个错误`;

      logger.info(`[EsbuildCompileSkill] ${summary}`);

      return { success, errors, warnings, autoCreatedFiles, summary };
    } catch (err: any) {
      // esbuild.build 在 logLevel 非 'silent' 时会 throw；也可能是其他异常
      const errors = this.parseThrowErrors(err, tmpDir);
      const summary = `❌ esbuild 编译异常：${errors.map(e => e.message).join('; ')}`;
      logger.error(`[EsbuildCompileSkill] ${summary}`);
      return { success: false, errors, warnings: [], autoCreatedFiles, summary };
    } finally {
      // 清理临时目录
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ─── 辅助：将 esbuild Message[] 转为 CompileError[] ─────────────────────
  private mapMessages(
    messages: esbuild.Message[],
    tmpDir: string
  ): CompileError[] {
    return messages.map(m => ({
      file: m.location?.file
        ? m.location.file.replace(tmpDir + '/', '').replace(tmpDir, '')
        : 'unknown',
      line: m.location?.line ?? 0,
      column: m.location?.column ?? 0,
      message: m.text,
      raw: `${m.location?.file ?? ''}:${m.location?.line ?? 0}:${m.location?.column ?? 0} - ${m.text}`,
    }));
  }

  // ─── 辅助：解析 esbuild throw 异常中的 errors ───────────────────────────
  private parseThrowErrors(err: any, tmpDir: string): CompileError[] {
    if (err?.errors && Array.isArray(err.errors)) {
      return this.mapMessages(err.errors as esbuild.Message[], tmpDir);
    }
    return [{
      file: 'unknown',
      line: 0,
      column: 0,
      message: String(err?.message || err),
      raw: String(err?.message || err),
    }];
  }

  /**
   * 将 CompileError[] 格式化成给 AI 的 fix prompt 片段
   */
  formatErrorsForPrompt(errors: CompileError[], autoCreated: string[]): string {
    const lines: string[] = ['### esbuild 编译错误（必须修复）\n'];

    if (autoCreated.length > 0) {
      lines.push(
        `⚠️ 以下 CSS 文件在生成代码中缺失，已临时创建空文件，但你应该在源码中正确处理：`,
        ...autoCreated.map(f => `  - ${f}`),
        ''
      );
    }

    lines.push(
      ...errors.map(e => `• ${e.file}:${e.line}:${e.column}  ${e.message}`)
    );

    lines.push(
      '',
      '请修复上述 esbuild 编译错误。常见原因：',
      '1. import 了不存在的文件（如 CSS/图片）→ 创建该文件，或删除该 import',
      '2. 使用了错误的导入路径 → 修正路径大小写或文件名',
      '3. 语法错误 → 修复对应代码行',
    );

    return lines.join('\n');
  }
}
