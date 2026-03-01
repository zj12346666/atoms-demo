'use client';

import { useState } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PreviewPanel } from '@/components/preview/PreviewPanel';

export default function Home() {
  const [code, setCode] = useState<{
    html: string;
    css: string;
    js: string;
    description?: string;
  } | null>(null);

  const handleCodeGenerated = (newCode: {
    html: string;
    css: string;
    js: string;
    description: string;
  }) => {
    setCode(newCode);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Atoms Demo</h1>
              <p className="text-xs text-gray-500">AI 驱动的应用生成平台</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://atoms.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              访问 Atoms 官网 →
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left: Chat Panel */}
        <div className="w-2/5 border-r border-gray-200">
          <ChatPanel projectId="demo-project" onCodeGenerated={handleCodeGenerated} />
        </div>

        {/* Right: Preview Panel */}
        <div className="w-3/5">
          <PreviewPanel code={code || undefined} />
        </div>
      </main>
    </div>
  );
}
