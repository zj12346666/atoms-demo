'use client';

import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { getLanguageFromPath } from '@/lib/file-tree-utils';

interface MonacoCodeViewerProps {
  sessionId: string;
  filePath?: string;
}

export function MonacoCodeViewer({ sessionId, filePath }: MonacoCodeViewerProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setContent('');
      setError(null);
      return;
    }

    const loadFile = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/files?sessionId=${sessionId}&path=${encodeURIComponent(filePath)}`);
        const data = await response.json();

        if (data.success && data.file) {
          setContent(data.file.content || '');
        } else {
          setError('文件不存在');
          setContent('');
        }
      } catch (err: any) {
        setError(err.message || '加载文件失败');
        setContent('');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [sessionId, filePath]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 bg-gray-50">
        <div className="text-center">
          <p className="text-sm mb-2">选择一个文件查看代码</p>
          <p className="text-xs text-gray-400">文件树在左侧</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-2"></div>
          <p className="text-sm text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500 bg-gray-50">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  const language = getLanguageFromPath(filePath);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-2 bg-white">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-600 font-mono truncate flex-1">{filePath}</p>
          <span className="text-xs text-gray-400 ml-2">{language}</span>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          value={content}
          theme="vs-dark"
          options={{
            readOnly: true,
            domReadOnly: true,
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            // 禁用所有编辑功能
            contextmenu: false,
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            acceptSuggestionOnEnter: 'off',
            tabCompletion: 'off',
            wordBasedSuggestions: 'off',
            // 禁用移动端虚拟键盘
            readOnlyMessage: { value: '只读模式' },
          }}
          loading={
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400"></div>
            </div>
          }
        />
      </div>
    </div>
  );
}
