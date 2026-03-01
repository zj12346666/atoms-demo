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

    const fullHTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
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
          message: \`Error: \${e.message} at line \${e.lineno}\`
        }, '*');
      });
    })();
    
    // 用户代码
    try {
      ${js}
    } catch (e) {
      console.error('Execution error:', e.message);
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
