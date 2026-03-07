/**
 * 服务端编译 API
 * 读取 session 中的文件，使用 esbuild 在服务端编译 React/TypeScript 代码，
 * 返回可直接在 iframe 中运行的完整 HTML 文档。
 */

import { NextRequest, NextResponse } from 'next/server';
import { FileManager } from '@/lib/file-manager';
import { logger } from '@/lib/logger';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const fileManager = new FileManager();

// GET /api/compile?sessionId=xxx  — 编译并返回 HTML 文档
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
  }

  // 临时目录，用于写入源文件供 esbuild 读取
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `atoms-compile-${sessionId}-`));

  try {
    // 1. 从数据库获取所有文件
    const files = await fileManager.getFiles(sessionId);
    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: '项目文件为空，请先生成代码' }, { status: 404 });
    }

    // 2. 获取每个文件的内容并写入临时目录
    const fileContents: Record<string, string> = {};
    for (const file of files) {
      if (file.type !== 'text') continue;
      const detail = await fileManager.getFile(sessionId, file.path);
      if (!detail?.content) continue;
      fileContents[file.path] = detail.content;
    }

    // 规范化路径（去掉开头 '/' 或 './'）
    const normalize = (p: string) => p.replace(/^[./]+/, '').replace(/\/+/g, '/');

    // 写入所有源文件到临时目录
    for (const [filePath, content] of Object.entries(fileContents)) {
      const normalizedPath = normalize(filePath);
      const absPath = path.join(tmpDir, normalizedPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
    }

    // 3. 检测缺失的 CSS 文件（扫描所有 JS/TS 文件中的 CSS import）
    const cssImportRegex = /import\s+['"]([^'"]+\.css)['"]/g;
    const existingPaths = new Set(Object.keys(fileContents).map(normalize));

    for (const content of Object.values(fileContents)) {
      let match: RegExpExecArray | null;
      while ((match = cssImportRegex.exec(content)) !== null) {
        const cssImport = match[1];
        // 将相对路径解析为可能的规范路径
        const possiblePaths = [
          normalize(cssImport),
          `src/${normalize(cssImport)}`,
        ];
        const isMissing = possiblePaths.every(p => !existingPaths.has(p));
        if (isMissing) {
          // 创建空的 CSS 文件（先尝试放在 src/ 下，再放在根目录）
          const targetPath = cssImport.startsWith('./') || cssImport.startsWith('../')
            ? normalize(cssImport)
            : `src/${normalize(cssImport)}`;
          const absPath = path.join(tmpDir, targetPath);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          if (!fs.existsSync(absPath)) {
            fs.writeFileSync(absPath, '/* auto-generated empty CSS */', 'utf8');
            logger.info(`  🎨 [compile] 自动创建缺失的 CSS 文件: ${targetPath}`);
          }
        }
      }
    }

    // 4. 确定入口文件（优先 src/main.tsx > src/index.tsx > src/App.tsx > 任意 .tsx）
    const entryPriority = [
      'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
      'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
      'main.tsx', 'main.jsx', 'main.ts', 'main.js',
      'index.tsx', 'index.jsx', 'index.ts', 'index.js',
      'src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js',
      'App.tsx', 'App.jsx', 'App.ts', 'App.js',
    ];

    let entryFile: string | null = null;
    for (const candidate of entryPriority) {
      if (fs.existsSync(path.join(tmpDir, candidate))) {
        entryFile = path.join(tmpDir, candidate);
        break;
      }
    }

    // 如果没有找到，使用第一个 .tsx 或 .ts 文件
    if (!entryFile) {
      const allWritten = Object.keys(fileContents).map(normalize);
      const tsxFile = allWritten.find(p => p.endsWith('.tsx') || p.endsWith('.jsx'));
      if (tsxFile) entryFile = path.join(tmpDir, tsxFile);
    }

    if (!entryFile) {
      return NextResponse.json({ success: false, error: '找不到入口文件' }, { status: 400 });
    }

    // 5. 检查是否需要创建 src/main.tsx 入口（如果入口是 App.tsx 但没有挂载逻辑）
    const entryContent = fs.readFileSync(entryFile, 'utf8');
    const hasReactDOMRender = entryContent.includes('ReactDOM') || entryContent.includes('createRoot');
    if (!hasReactDOMRender) {
      // 生成挂载入口文件
      const appFileName = path.basename(entryFile).replace(/\.(tsx|jsx|ts|js)$/, '');
      const mainEntry = path.join(tmpDir, 'src', '__atoms_main__.tsx');
      fs.mkdirSync(path.dirname(mainEntry), { recursive: true });
      fs.writeFileSync(mainEntry, [
        `import React from 'react';`,
        `import ReactDOM from 'react-dom/client';`,
        `import App from './${appFileName}';`,
        ``,
        `const rootEl = document.getElementById('root') ?? document.body;`,
        `ReactDOM.createRoot(rootEl).render(<React.StrictMode><App /></React.StrictMode>);`,
      ].join('\n'), 'utf8');
      entryFile = mainEntry;
      logger.info(`  📄 [compile] 自动生成挂载入口: src/__atoms_main__.tsx`);
    }

    logger.info(`🔨 [compile] 使用 esbuild 编译，入口文件: ${entryFile.replace(tmpDir, '')}`);

    // 6. 使用 esbuild 打包
    let bundledJs = '';
    let bundledCss = '';
    let buildErrors: string[] = [];

    try {
      const result = await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2017',
        jsx: 'automatic',
        jsxImportSource: 'react',
        loader: {
          '.ts': 'ts',
          '.tsx': 'tsx',
          '.js': 'js',
          '.jsx': 'jsx',
          '.css': 'css',
          '.png': 'dataurl',
          '.jpg': 'dataurl',
          '.svg': 'dataurl',
          '.gif': 'dataurl',
        },
        define: {
          'process.env.NODE_ENV': '"production"',
        },
        absWorkingDir: tmpDir,
        // Inline React from CDN URLs via an alias plugin — we use the global from the HTML instead
        // so mark react/react-dom as external and inject globals
        external: ['react', 'react-dom'],
        globalName: '__bundle__',
      });

      for (const output of result.outputFiles) {
        if (output.path.endsWith('.js') || output.path.endsWith('.js.map')) {
          if (!output.path.endsWith('.map')) bundledJs = output.text;
        } else if (output.path.endsWith('.css')) {
          bundledCss = output.text;
        }
      }

      if (result.errors.length > 0) {
        buildErrors = result.errors.map(e => `${e.location?.file}:${e.location?.line} - ${e.text}`);
        logger.warn('⚠️ [compile] esbuild 有错误:', buildErrors);
      }
    } catch (buildErr: any) {
      buildErrors = buildErr.errors
        ? buildErr.errors.map((e: any) => `${e.location?.file || ''}:${e.location?.line || ''} - ${e.text}`)
        : [String(buildErr.message)];
      logger.error('❌ [compile] esbuild 构建失败:', buildErrors);
    }

    // 7. 从原始文件中提取 CSS（收集所有 .css 文件内容）
    for (const [filePath, content] of Object.entries(fileContents)) {
      if (filePath.endsWith('.css')) {
        bundledCss += '\n' + content;
      }
    }

    // 8. 读取 index.html（如有）
    const htmlFilePath = Object.keys(fileContents).find(p => normalize(p) === 'index.html' || p.endsWith('/index.html'));
    let bodyContent = '<div id="root"></div>';
    let htmlTitle = 'Preview';
    if (htmlFilePath && fileContents[htmlFilePath]) {
      const rawHtml = fileContents[htmlFilePath];
      // 提取 title
      const titleMatch = rawHtml.match(/<title>(.*?)<\/title>/i);
      if (titleMatch) htmlTitle = titleMatch[1];
      // 提取 body 内容（去掉 script 标签）
      const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        bodyContent = bodyMatch[1]
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .trim() || bodyContent;
      }
    }

    // 9. 组装完整 HTML 文档（React 从 CDN 加载）
    const errorBanner = buildErrors.length > 0
      ? `<div id="__atoms_error__" style="background:#fff3cd;border:1px solid #ffc107;padding:12px 16px;font-family:monospace;font-size:13px;white-space:pre-wrap;position:fixed;top:0;left:0;right:0;z-index:9999;max-height:40vh;overflow:auto">
⚠️ 编译时出现警告/错误（已尝试继续运行）：\n${buildErrors.join('\n')}
</div>`
      : '';

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlTitle}</title>
  <!-- React & ReactDOM from CDN (UMD) -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script>
    // esbuild externals: expose React globals for IIFE bundle
    window.React = window.React;
    window.ReactDOM = window.ReactDOM;
  </script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  </style>
  ${bundledCss ? `<style>\n${bundledCss}\n</style>` : ''}
</head>
<body>
  ${errorBanner}
  ${bodyContent}
  ${bundledJs ? `<script>\n${bundledJs}\n</script>` : '<!-- No JS bundle generated -->'}
</body>
</html>`;

    logger.info(`✅ [compile] 编译完成，HTML 大小: ${fullHtml.length} bytes`);

    return new NextResponse(fullHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    logger.error('❌ [compile] 编译出错:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }
  }
}
