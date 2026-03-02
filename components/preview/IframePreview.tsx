'use client';

import { useEffect, useRef, useState } from 'react';

interface IframePreviewProps {
  html: string;
  css: string;
  js: string;
}

export function IframePreview({ html, css, js }: IframePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [consoleOutput, setConsoleOutput] = useState<
    Array<{ level: string; message: string }>
  >([]);

  useEffect(() => {
    if (!iframeRef.current) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    // 检测是否使用了 Tailwind 类名
    const usesTailwind = html.includes('class=') && (
      html.includes('flex') || 
      html.includes('grid') || 
      html.includes('bg-') || 
      html.includes('text-') ||
      html.includes('p-') ||
      html.includes('m-')
    );
    
    // 如果使用了 Tailwind，使用内联的基础样式（避免 COEP 问题）
    // 注意：由于 COEP 限制，无法加载外部 CDN，只能使用内联样式
    const tailwindStyles = usesTailwind 
      ? `<style>
        /* Tailwind CSS 基础样式 - 简化版（避免 COEP 限制） */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .flex { display: flex; }
        .grid { display: grid; }
        .hidden { display: none; }
        .block { display: block; }
        .inline-block { display: inline-block; }
        .items-center { align-items: center; }
        .justify-center { justify-content: center; }
        .justify-between { justify-content: space-between; }
        .flex-col { flex-direction: column; }
        .flex-row { flex-direction: row; }
        .flex-wrap { flex-wrap: wrap; }
        .gap-1 { gap: 0.25rem; }
        .gap-2 { gap: 0.5rem; }
        .gap-4 { gap: 1rem; }
        .p-1 { padding: 0.25rem; }
        .p-2 { padding: 0.5rem; }
        .p-4 { padding: 1rem; }
        .px-4 { padding-left: 1rem; padding-right: 1rem; }
        .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
        .m-2 { margin: 0.5rem; }
        .mb-2 { margin-bottom: 0.5rem; }
        .mt-2 { margin-top: 0.5rem; }
        .text-center { text-align: center; }
        .text-sm { font-size: 0.875rem; }
        .text-lg { font-size: 1.125rem; }
        .font-bold { font-weight: 700; }
        .rounded { border-radius: 0.25rem; }
        .rounded-lg { border-radius: 0.5rem; }
        .bg-white { background-color: white; }
        .bg-gray-100 { background-color: #f3f4f6; }
        .bg-blue-500 { background-color: #3b82f6; }
        .text-white { color: white; }
        .text-gray-600 { color: #4b5563; }
        .border { border-width: 1px; }
        .border-gray-200 { border-color: #e5e7eb; }
        .w-full { width: 100%; }
        .h-full { height: 100%; }
        .cursor-pointer { cursor: pointer; }
        .hover\\:bg-gray-100:hover { background-color: #f3f4f6; }
      </style>`
      : '';

    const fullHTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${tailwindStyles}
  <style>${css}</style>
</head>
<body>
  ${html}
  <script>
    // 捕获控制台输出
    (function() {
      const originalLog = console.log;
      const originalError = console.error;
      const originalWarn = console.warn;
      
      console.log = (...args) => {
        window.parent.postMessage({ 
          type: 'console', 
          level: 'log', 
          message: args.map(a => String(a)).join(' ') 
        }, '*');
        originalLog.apply(console, args);
      };
      
      console.error = (...args) => {
        window.parent.postMessage({ 
          type: 'console', 
          level: 'error', 
          message: args.map(a => String(a)).join(' ') 
        }, '*');
        originalError.apply(console, args);
      };
      
      console.warn = (...args) => {
        window.parent.postMessage({ 
          type: 'console', 
          level: 'warn', 
          message: args.map(a => String(a)).join(' ') 
        }, '*');
        originalWarn.apply(console, args);
      };
      
      // 捕获错误
      window.addEventListener('error', (e) => {
        window.parent.postMessage({ 
          type: 'console', 
          level: 'error', 
          message: \`Error: \${e.message} at line \${e.lineno}\${e.filename ? ' in ' + e.filename : ''}\`
        }, '*');
      });
      
      // 捕获未处理的 Promise 拒绝
      window.addEventListener('unhandledrejection', (e) => {
        window.parent.postMessage({ 
          type: 'console', 
          level: 'error', 
          message: \`Unhandled Promise Rejection: \${e.reason}\`
        }, '*');
      });
    })();
    
    // 用户代码
    try {
      ${js}
    } catch (e) {
      console.error('Execution error:', e.message);
      if (e.stack) {
        console.error('Stack trace:', e.stack);
      }
    }
  </script>
</body>
</html>`;

    doc.open();
    doc.write(fullHTML);
    doc.close();

    // 清空控制台
    setConsoleOutput([]);
  }, [html, css, js]);

  // 监听 iframe 消息
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === 'console') {
        setConsoleOutput((prev) => [
          ...prev.slice(-50), // 只保留最后 50 条
          { level: e.data.level, message: e.data.message },
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Preview iframe */}
      <div className="flex-1 relative bg-white">
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-0"
          title="Preview"
        />
      </div>

      {/* Console output */}
      {consoleOutput.length > 0 && (
        <div className="h-32 bg-gray-900 text-green-400 text-xs p-2 overflow-auto font-mono border-t border-gray-700">
          <div className="flex items-center justify-between mb-2 text-gray-400">
            <span>Console</span>
            <button
              onClick={() => setConsoleOutput([])}
              className="text-xs hover:text-white"
            >
              Clear
            </button>
          </div>
          {consoleOutput.map((log, i) => (
            <div
              key={i}
              className={`mb-1 ${
                log.level === 'error'
                  ? 'text-red-400'
                  : log.level === 'warn'
                  ? 'text-yellow-400'
                  : 'text-green-400'
              }`}
            >
              [{log.level}] {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
