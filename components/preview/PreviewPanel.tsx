'use client';

import { useState, useEffect } from 'react';
import { IframePreview } from './IframePreview';
import { WebContainerPreview } from './WebContainerPreview';
import { ServerCompiledPreview } from './ServerCompiledPreview';
import { Button } from '../ui/Button';

interface PreviewPanelProps {
  code?: {
    html: string;
    css: string;
    js: string;
    description?: string;
  };
  sessionId?: string;
}

type DeviceType = 'desktop' | 'tablet' | 'mobile';
type PreviewMode = 'simple' | 'server' | 'webcontainer';

export function PreviewPanel({ code, sessionId }: PreviewPanelProps) {
  const [device, setDevice] = useState<DeviceType>('desktop');
  // 有 sessionId 时默认使用服务端预览（生成流程会自动完成 esbuild 编译校验）
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    sessionId ? 'server' : 'simple'
  );

  // sessionId 首次出现时自动切换到服务端预览
  useEffect(() => {
    if (sessionId && previewMode === 'simple') {
      setPreviewMode('server');
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deviceSizes = {
    desktop: 'w-full',
    tablet: 'w-[768px] mx-auto',
    mobile: 'w-[375px] mx-auto',
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">🖥️ 实时预览</h2>
            <p className="text-xs text-gray-500 mt-1">
              {code?.description || '生成的应用将在这里显示'}
              {code && ' • 代码已自动更新'}
            </p>
          </div>

          {/* Preview mode selector */}
          <div className="flex items-center gap-2">
            <div className="flex gap-1 border border-gray-200 rounded-lg p-1">
              {/* 仅无 sessionId 时才显示「简单预览」（html/css/js 直接渲染） */}
              {!sessionId && (
                <button
                  onClick={() => setPreviewMode('simple')}
                  className={`px-2 py-1 text-xs rounded ${
                    previewMode === 'simple'
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  简单预览
                </button>
              )}
              <button
                onClick={() => setPreviewMode('server')}
                className={`px-2 py-1 text-xs rounded ${
                  previewMode === 'server'
                    ? 'bg-green-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                disabled={!sessionId}
                title={
                  !sessionId
                    ? '需要先生成代码（需要 sessionId）'
                    : '用服务端编译结果预览（React/TS 项目推荐）'
                }
              >
                React 预览
              </button>
              <button
                onClick={() => setPreviewMode('webcontainer')}
                className={`px-2 py-1 text-xs rounded ${
                  previewMode === 'webcontainer'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                disabled={!sessionId}
                title={
                  !sessionId
                    ? '需要先生成代码（需要 sessionId）'
                    : '在浏览器内运行完整 Vite 开发服务器'
                }
              >
                WebContainer
              </button>
            </div>
          </div>

          {/* Device selector —— 仅简单预览模式下显示 */}
          {previewMode === 'simple' && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={device === 'desktop' ? 'primary' : 'secondary'}
                onClick={() => setDevice('desktop')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </Button>
              <Button
                size="sm"
                variant={device === 'tablet' ? 'primary' : 'secondary'}
                onClick={() => setDevice('tablet')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </Button>
              <Button
                size="sm"
                variant={device === 'mobile' ? 'primary' : 'secondary'}
                onClick={() => setDevice('mobile')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto p-4">
        {previewMode === 'webcontainer' && sessionId ? (
          <div className="h-full border border-gray-300 rounded-lg shadow-lg overflow-hidden bg-white">
            <WebContainerPreview sessionId={sessionId} />
          </div>
        ) : previewMode === 'server' && sessionId ? (
          <div className="h-full border border-gray-300 rounded-lg shadow-lg overflow-hidden bg-white">
            <ServerCompiledPreview sessionId={sessionId} />
          </div>
        ) : code ? (
          <div className={`${deviceSizes[device]} h-full transition-all duration-300`}>
            <div className="h-full border border-gray-300 rounded-lg shadow-lg overflow-hidden bg-white">
              <IframePreview html={code.html} css={code.css} js={code.js} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">等待生成</p>
            <p className="text-sm mt-2">在左侧输入你的需求，开始创建应用</p>
          </div>
        )}
      </div>
    </div>
  );
}
