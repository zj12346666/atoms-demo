'use client';

import { useState, useEffect } from 'react';

interface CodeViewerProps {
  sessionId: string;
  filePath?: string;
}

export function CodeViewer({ sessionId, filePath }: CodeViewerProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setContent('');
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
        }
      } catch (err: any) {
        setError(err.message || '加载文件失败');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [sessionId, filePath]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <p className="text-sm">选择一个文件查看代码</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-500">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-500">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-gray-200 px-4 py-2 bg-gray-50">
        <p className="text-xs text-gray-600 font-mono">{filePath}</p>
      </div>
      <div className="flex-1 overflow-auto">
        <pre className="p-4 text-xs font-mono bg-gray-900 text-gray-100 h-full">
          <code>{content}</code>
        </pre>
      </div>
    </div>
  );
}
