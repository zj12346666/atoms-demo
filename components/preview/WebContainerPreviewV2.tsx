/**
 * WebContainerPreviewV2 - 使用新的 WebContainer Runtime 系统
 * 
 * 特性：
 * - 直接使用扁平文件结构
 * - 自动模板补全
 * - 性能优化（缓存）
 * - 简化的错误处理
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { runProject } from '@/lib/webcontainer';
import { getFlatFilesFromSession } from '@/lib/webcontainer/api-adapter';
import { logger } from '@/lib/logger';

interface WebContainerPreviewV2Props {
  sessionId: string;
  /**
   * 可选的扁平文件结构（如果提供，将直接使用，不通过 API 获取）
   */
  flatFiles?: Record<string, string>;
}

export function WebContainerPreviewV2({
  sessionId,
  flatFiles: providedFlatFiles,
}: WebContainerPreviewV2Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'installing' | 'starting' | 'ready' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setStatus('loading');
        setError(null);
        setProgress('正在初始化...');

        // 检查浏览器支持
        if (!window.crossOriginIsolated) {
          const errorMsg =
            'WebContainer 需要 Cross-Origin Isolation。请确保服务器设置了正确的响应头：Cross-Origin-Opener-Policy: same-origin 和 Cross-Origin-Embedder-Policy: require-corp';
          throw new Error(errorMsg);
        }

        // 获取扁平文件结构
        let flatFiles: Record<string, string>;

        if (providedFlatFiles) {
          // 使用提供的文件
          flatFiles = providedFlatFiles;
          setProgress('使用提供的文件...');
        } else {
          // 从 API 获取
          setProgress('正在加载文件...');
          flatFiles = await getFlatFilesFromSession(sessionId);
        }

        if (!mounted) return;

        if (Object.keys(flatFiles).length === 0) {
          throw new Error('项目文件为空，请先生成代码');
        }

        setProgress('正在启动 WebContainer...');
        setStatus('installing');

        // 运行项目（使用新的 runtime 系统）
        const result = await runProject(flatFiles, {
          sessionId,
          cacheEnabled: true,
          timeout: 60000,
        });

        if (!mounted) {
          await result.cleanup();
          return;
        }

        setUrl(result.url);
        setStatus('ready');
        setProgress('运行中');
        cleanupRef.current = result.cleanup;

        logger.info(`✅ [WebContainerPreviewV2] 初始化成功: ${result.url}`);
      } catch (err: any) {
        if (!mounted) return;

        logger.error('❌ [WebContainerPreviewV2] 初始化失败:', err);
        setError(err.message || 'WebContainer 初始化失败');
        setStatus('error');
        setProgress('');
      }
    };

    init();

    return () => {
      mounted = false;
      if (cleanupRef.current) {
        cleanupRef.current().catch((error) => {
          logger.warn('⚠️ [WebContainerPreviewV2] 清理失败:', error);
        });
      }
    };
  }, [sessionId, providedFlatFiles]);

  // 错误显示
  if (status === 'error' && error) {
    const isCoepError =
      error.includes('Cross-Origin') ||
      error.includes('COEP') ||
      error.includes('NotSameOriginAfterDefaultedToSameOriginByCoep');

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <div className="text-red-500 mb-4">
          <svg
            className="w-16 h-16 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          WebContainer 初始化失败
        </h3>
        <p className="text-sm text-gray-600 mb-4 max-w-md">{error}</p>
        {isCoepError && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 max-w-md">
            <p className="text-sm text-yellow-800 mb-2">
              <strong>💡 建议：</strong>WebContainer 需要严格的 Cross-Origin
              Isolation，某些资源可能不支持。
            </p>
            <p className="text-xs text-yellow-700">
              请尝试切换到 <strong>"简单预览"</strong> 模式，它不需要
              Cross-Origin Isolation，可以正常预览你的应用。
            </p>
          </div>
        )}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md">
          <p className="text-xs text-blue-800 mb-2">
            <strong>📋 调试信息：</strong>
          </p>
          <p className="text-xs text-blue-700 font-mono text-left break-all">
            {error}
          </p>
          <p className="text-xs text-blue-600 mt-2">
            查看浏览器控制台获取更多详细信息
          </p>
        </div>
      </div>
    );
  }

  // 加载状态
  if (status !== 'ready') {
    return (
      <div className="flex flex-col h-full">
        {/* Status bar */}
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
            {status === 'loading' && '加载文件...'}
            {status === 'installing' && '安装依赖...'}
            {status === 'starting' && '启动服务器...'}
            {status === 'ready' && `运行中 ${url ? `(${url})` : ''}`}
            {progress && ` - ${progress}`}
          </span>
        </div>

        {/* Loading content */}
        <div className="flex items-center justify-center h-full text-gray-400">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
            <p className="text-sm">{progress || '正在初始化 WebContainer...'}</p>
          </div>
        </div>
      </div>
    );
  }

  // 预览 iframe
  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="bg-gray-800 text-white px-4 py-2 text-xs flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <span>运行中 {url ? `(${url})` : ''}</span>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 relative bg-white">
        {url && (
          <iframe
            ref={iframeRef}
            src={url}
            className="w-full h-full border-0"
            title="WebContainer Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );
}
