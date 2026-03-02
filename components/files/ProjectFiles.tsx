'use client';

import { useState, useEffect, useImperativeHandle, forwardRef, useCallback, useRef } from 'react';
import { FileTreeArborist } from './FileTreeArborist';
import { MonacoCodeViewer } from './MonacoCodeViewer';
import { IframePreview } from '../preview/IframePreview';
import { WebContainerPreview } from '../preview/WebContainerPreview';
import { buildFileTree, FileNode } from '@/lib/file-tree-utils';

interface ProjectFilesProps {
  sessionId: string;
  userId?: string; // 添加 userId，用于验证所有权
  refreshTrigger?: number; // 外部触发刷新的计数器
  code?: {
    html: string;
    css: string;
    js: string;
    description?: string;
  }; // 生成的代码，用于预览
}

type ViewMode = 'files' | 'preview'; // 视图模式：文件树或预览
type PreviewMode = 'simple' | 'webcontainer'; // 预览模式
type DeviceType = 'desktop' | 'tablet' | 'mobile';

export interface ProjectFilesRef {
  refresh: () => void;
}

export const ProjectFiles = forwardRef<ProjectFilesRef, ProjectFilesProps>(
  ({ sessionId, userId, refreshTrigger, code: codeProp }, ref) => {
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<ViewMode>('files'); // 默认显示文件树
    const [previewMode, setPreviewMode] = useState<PreviewMode>('simple'); // 预览模式
    const [device, setDevice] = useState<DeviceType>('desktop'); // 设备类型
    const [code, setCode] = useState<ProjectFilesProps['code']>(codeProp); // 本地代码状态
    const [leftPanelWidth, setLeftPanelWidth] = useState(33.33); // 默认 33.33% (1/3)
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const loadFiles = useCallback(async () => {
      if (!sessionId) {
        setFileTree([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log(`🔍 开始加载文件列表 (sessionId: ${sessionId}, userId: ${userId || '未提供'})`);
        // 构建 URL，如果 userId 存在则添加到查询参数
        const url = userId 
          ? `/api/files?sessionId=${sessionId}&userId=${userId}`
          : `/api/files?sessionId=${sessionId}`;
        const response = await fetch(url);
        
        // 检查 HTTP 状态码
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
          console.error(`❌ API 请求失败 (HTTP ${response.status}):`, errorData);
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('📥 API 响应:', { 
          success: data.success, 
          filesCount: data.files?.length || 0,
          hasError: !!data.error 
        });

        if (data.success && data.files) {
          if (data.files.length > 0) {
            // 将扁平文件列表转换为树结构
            const tree = buildFileTree(data.files);
            setFileTree(tree);
            console.log('✅ 文件列表加载成功:', data.files.length, '个文件');
            console.log('📁 文件路径列表:', data.files.map((f: any) => f.path));
            console.log('📁 文件树结构:', tree);
          } else {
            console.warn('⚠️ 文件列表为空');
            console.warn('  可能的原因：1) 文件未保存到数据库/内存 2) DATABASE_URL 未设置 3) 数据库连接失败');
            console.warn('  当前 sessionId:', sessionId);
            console.warn('  当前 userId:', userId || '未提供');
            setFileTree([]);
          }
        } else {
          const errorMsg = data.error || '未知错误';
          console.error('❌ 文件列表加载失败:', errorMsg);
          console.error('  API 返回的完整数据:', JSON.stringify(data, null, 2));
          console.error('  sessionId:', sessionId);
          console.error('  userId:', userId || '未提供');
          setFileTree([]);
        }
      } catch (error: any) {
        console.error('❌ 加载文件列表失败:', error);
        console.error('  错误详情:', error.message || error);
        console.error('  sessionId:', sessionId);
        console.error('  userId:', userId || '未提供');
        setFileTree([]);
      } finally {
        setLoading(false);
      }
    }, [sessionId]);

    // 暴露 refresh 方法给父组件
    useImperativeHandle(ref, () => ({
      refresh: loadFiles,
    }));

    useEffect(() => {
      loadFiles();
    }, [sessionId, userId, refreshTrigger, loadFiles]);

    // 同步外部传入的 code
    useEffect(() => {
      if (codeProp) {
        setCode(codeProp);
      }
    }, [codeProp]);

    // 当切换到预览模式时，如果没有代码，尝试从 session 加载
    useEffect(() => {
      const loadSessionCode = async () => {
        // 只在预览模式且没有代码时加载
        if (viewMode !== 'preview' || !sessionId) return;
        
        // 如果已经有代码，不需要重新加载
        const currentCode = code || codeProp;
        if (currentCode && (currentCode.html || currentCode.css || currentCode.js)) {
          return;
        }

        try {
          const url = userId 
            ? `/api/session?sessionId=${sessionId}&userId=${userId}`
            : `/api/session?sessionId=${sessionId}`;
          const response = await fetch(url);
          const data = await response.json();
          if (data.success && data.session?.generatedCode) {
            // generatedCode 可能是字符串（JSON）或对象
            const generatedCode = typeof data.session.generatedCode === 'string'
              ? JSON.parse(data.session.generatedCode)
              : data.session.generatedCode;
            
            // 确保代码格式正确
            if (generatedCode && (generatedCode.html || generatedCode.css || generatedCode.js)) {
              setCode({
                html: generatedCode.html || '',
                css: generatedCode.css || '',
                js: generatedCode.js || '',
                description: generatedCode.description || '',
              });
              console.log('✅ 从 session 加载代码成功');
            }
          }
        } catch (error) {
          console.error('❌ Failed to load session code:', error);
        }
      };

      loadSessionCode();
    }, [viewMode, sessionId, userId]); // 移除 code 和 codeProp，避免依赖数组变化

    // 处理拖拽调整大小
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        
        // 限制最小和最大宽度（20% - 60%）
        const clampedWidth = Math.max(20, Math.min(60, newWidth));
        setLeftPanelWidth(clampedWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
      };

      if (isResizing) {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }, [isResizing]);

    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-2"></div>
            <p className="text-sm text-gray-500">加载文件结构...</p>
          </div>
        </div>
      );
    }

    if (fileTree.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-gray-400 p-4">
          <p className="text-sm mb-2">还没有文件</p>
          <p className="text-xs text-center">生成代码后，文件将显示在这里</p>
        </div>
      );
    }

    const deviceSizes = {
      desktop: 'w-full',
      tablet: 'w-[768px] mx-auto',
      mobile: 'w-[375px] mx-auto',
    };

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                {viewMode === 'files' ? '📁 项目文件' : '🖥️ 实时预览'}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {viewMode === 'files' 
                  ? `${fileTree.length} 个文件/文件夹`
                  : code?.description || '点击预览按钮运行项目'
                }
              </p>
            </div>

            {/* 视图切换按钮 */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('files')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  viewMode === 'files'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                📁 文件
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  viewMode === 'preview'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
                disabled={!code && !sessionId}
                title={!code && !sessionId ? '需要生成代码后才能预览' : ''}
              >
                🖥️ 预览
              </button>
            </div>
          </div>

          {/* 预览模式选择器（仅在预览模式下显示） */}
          {viewMode === 'preview' && (
            <div className="flex items-center gap-2 mt-3">
              <div className="flex gap-1 border border-gray-200 rounded-lg p-1 bg-white">
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
                <button
                  onClick={() => setPreviewMode('webcontainer')}
                  className={`px-2 py-1 text-xs rounded ${
                    previewMode === 'webcontainer'
                      ? 'bg-blue-500 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  disabled={!sessionId}
                  title={!sessionId ? '需要 sessionId 才能使用 WebContainer' : ''}
                >
                  WebContainer
                </button>
              </div>

              {/* 设备选择器（仅在简单预览模式下显示） */}
              {previewMode === 'simple' && code && (
                <div className="flex gap-1">
                  <button
                    onClick={() => setDevice('desktop')}
                    className={`p-1.5 rounded ${
                      device === 'desktop'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                    title="桌面"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDevice('tablet')}
                    className={`p-1.5 rounded ${
                      device === 'tablet'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                    title="平板"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDevice('mobile')}
                    className={`p-1.5 rounded ${
                      device === 'mobile'
                        ? 'bg-blue-500 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                    title="手机"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        {viewMode === 'files' ? (
          <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
            {/* Left: File Tree */}
            <div 
              className="bg-white overflow-hidden"
              style={{ width: `${leftPanelWidth}%` }}
            >
              <FileTreeArborist
                data={fileTree}
                onSelect={setSelectedFile}
                selectedPath={selectedFile?.path}
              />
            </div>

            {/* Resizer */}
            <div
              className="w-1 bg-gray-200 hover:bg-blue-500 cursor-col-resize transition-colors relative group"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
            >
              {/* 拖拽指示器 */}
              <div className="absolute inset-y-0 left-1/2 transform -translate-x-1/2 w-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Right: Monaco Code Viewer */}
            <div 
              className="flex-1 overflow-hidden"
              style={{ width: `${100 - leftPanelWidth}%` }}
            >
              <MonacoCodeViewer 
                sessionId={sessionId} 
                filePath={selectedFile?.path} 
              />
            </div>
          </div>
        ) : (
          /* Preview Mode */
          <div className="flex-1 overflow-auto p-4 bg-gray-50">
            {previewMode === 'webcontainer' && sessionId ? (
              <div className="h-full border border-gray-300 rounded-lg shadow-lg overflow-hidden bg-white">
                <WebContainerPreview sessionId={sessionId} />
              </div>
            ) : code ? (
              <div className={`${deviceSizes[device]} h-full transition-all duration-300`}>
                <div className="h-full border border-gray-300 rounded-lg shadow-lg overflow-hidden bg-white">
                  <IframePreview html={code.html} css={code.css} js={code.js} />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg
                  className="w-24 h-24 mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-lg font-medium">等待生成</p>
                <p className="text-sm mt-2">在左侧输入你的需求，开始创建应用</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

ProjectFiles.displayName = 'ProjectFiles';
