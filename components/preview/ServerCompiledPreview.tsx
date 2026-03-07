'use client';

/**
 * ServerCompiledPreview
 * 调用 /api/compile 服务端编译接口，把 TypeScript/React 源码在服务端用 esbuild
 * 打包成单一 HTML 文档，再通过 srcdoc 注入 iframe 预览。
 *
 * 优点：
 *  - 不依赖 WebContainer（不需要 Cross-Origin Isolation）
 *  - 能正确处理 import './App.css' 等缺失文件（服务端会自动补全）
 *  - 与简单预览模式兼容，均通过 iframe srcdoc 渲染
 */

import { useEffect, useRef, useState } from 'react';

interface ServerCompiledPreviewProps {
  sessionId: string;
}

type Status = 'idle' | 'compiling' | 'ready' | 'error';

export function ServerCompiledPreview({ sessionId }: ServerCompiledPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    // 每次 sessionId 变化时重新编译
    let cancelled = false;

    const compile = async () => {
      setStatus('compiling');
      setError(null);
      setHtml(null);

      try {
        console.log(`🔨 [ServerCompiledPreview] 开始编译 sessionId=${sessionId}`);
        const res = await fetch(`/api/compile?sessionId=${encodeURIComponent(sessionId)}`);

        if (cancelled) return;

        if (res.headers.get('Content-Type')?.includes('text/html')) {
          // 成功：拿到编译后的 HTML
          const compiledHtml = await res.text();
          if (!cancelled) {
            setHtml(compiledHtml);
            setStatus('ready');
            console.log(`✅ [ServerCompiledPreview] 编译成功，HTML 大小: ${compiledHtml.length} bytes`);
          }
        } else {
          // 失败：JSON 错误响应
          const data = await res.json();
          if (!cancelled) {
            setError(data.error || '编译失败');
            setStatus('error');
            console.error('❌ [ServerCompiledPreview] 编译失败:', data.error);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || '网络请求失败');
          setStatus('error');
          console.error('❌ [ServerCompiledPreview] 请求失败:', err);
        }
      }
    };

    compile();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 把编译好的 HTML 注入 iframe srcdoc
  useEffect(() => {
    if (html && iframeRef.current) {
      iframeRef.current.srcdoc = html;
    }
  }, [html]);

  const handleRetry = () => {
    // 重置，触发重新编译
    setStatus('idle');
    setHtml(null);
    setError(null);
    // 用 timeout 让 state 刷新后再触发 compile effect
    setTimeout(() => setStatus('compiling'), 0);
    // 直接重新发请求
    fetch(`/api/compile?sessionId=${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        if (res.headers.get('Content-Type')?.includes('text/html')) {
          const compiledHtml = await res.text();
          setHtml(compiledHtml);
          setStatus('ready');
        } else {
          const data = await res.json();
          setError(data.error || '编译失败');
          setStatus('error');
        }
      })
      .catch((err) => {
        setError(err.message || '网络请求失败');
        setStatus('error');
      });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 状态栏 */}
      <div className="bg-gray-800 text-white px-4 py-2 text-xs flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            status === 'ready'
              ? 'bg-green-400'
              : status === 'error'
              ? 'bg-red-400'
              : 'bg-yellow-400 animate-pulse'
          }`}
        />
        <span>
          {status === 'idle' && '等待中...'}
          {status === 'compiling' && '服务端编译中...'}
          {status === 'ready' && '✅ 编译完成，预览运行中'}
          {status === 'error' && '❌ 编译出错'}
        </span>
        {status === 'ready' && (
          <button
            onClick={handleRetry}
            className="ml-auto text-gray-400 hover:text-white text-xs underline"
          >
            重新编译
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex-1 relative bg-white overflow-hidden">
        {/* 加载中 */}
        {status === 'compiling' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-50 z-10">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-4" />
            <p className="text-sm font-medium">服务端编译中...</p>
            <p className="text-xs text-gray-400 mt-1">使用 esbuild 编译 TypeScript / React 代码</p>
          </div>
        )}

        {/* 错误 */}
        {status === 'error' && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-gray-50 z-10">
            <div className="text-red-500 mb-4">
              <svg className="w-14 h-14 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-800 mb-2">编译失败</h3>
            <p className="text-xs text-gray-600 mb-4 max-w-md text-center">{error}</p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            >
              重新编译
            </button>
          </div>
        )}

        {/* iframe 预览 */}
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title="Server Compiled Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          // srcdoc 由 useEffect 注入
        />
      </div>
    </div>
  );
}
