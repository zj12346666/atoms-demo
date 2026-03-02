'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { LoginForm } from '@/components/auth/LoginForm';
import { CreateProjectForm } from '@/components/auth/CreateProjectForm';
import { SessionList, SessionItem } from '@/components/session/SessionList';
import { ProjectFiles } from '@/components/files/ProjectFiles';

export default function Home() {
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [code, setCode] = useState<{
    html: string;
    css: string;
    js: string;
    description?: string;
  } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filesRefreshTrigger, setFilesRefreshTrigger] = useState(0); // 文件列表刷新触发器

  // 检查本地存储的用户ID和session信息
  useEffect(() => {
    const savedUserId = localStorage.getItem('atoms_user_id');
    if (savedUserId) {
      // 验证用户是否存在
      fetch(`/api/auth?userId=${savedUserId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUserId(savedUserId);
            // 尝试恢复 session
            const savedSessionId = localStorage.getItem('atoms_session_id');
            const savedProjectId = localStorage.getItem('atoms_project_id');
            const savedProjectName = localStorage.getItem('atoms_project_name');
            
            if (savedSessionId && savedProjectId) {
              // 验证 session 是否仍然有效
              fetch(`/api/session?sessionId=${savedSessionId}`)
                .then(res => res.json())
                .then(sessionData => {
                  if (sessionData.success) {
                    setSessionId(savedSessionId);
                    setProjectId(savedProjectId);
                    setProjectName(savedProjectName || '');
                    console.log('✅ Session 恢复成功');
                  } else {
                    // Session 已过期，清除
                    localStorage.removeItem('atoms_session_id');
                    localStorage.removeItem('atoms_project_id');
                    localStorage.removeItem('atoms_project_name');
                  }
                })
                .catch(() => {
                  localStorage.removeItem('atoms_session_id');
                  localStorage.removeItem('atoms_project_id');
                  localStorage.removeItem('atoms_project_name');
                });
            }
          } else {
            localStorage.removeItem('atoms_user_id');
            localStorage.removeItem('atoms_session_id');
            localStorage.removeItem('atoms_project_id');
            localStorage.removeItem('atoms_project_name');
          }
        })
        .catch(() => {
          localStorage.removeItem('atoms_user_id');
          localStorage.removeItem('atoms_session_id');
          localStorage.removeItem('atoms_project_id');
          localStorage.removeItem('atoms_project_name');
        });
    }
  }, []);

  const handleAuthSuccess = (newUserId: string, username: string, action: 'login' | 'register') => {
    setUserId(newUserId);
    localStorage.setItem('atoms_user_id', newUserId);
    localStorage.setItem('atoms_username', username);
    // 登录成功后，清除之前的 session 信息
    setSessionId(null);
    setProjectId(null);
    setProjectName('');
    setShowCreateForm(false);
  };

  const handleProjectCreated = (newSessionId: string, newProjectId: string, newProjectName: string) => {
    setSessionId(newSessionId);
    setProjectId(newProjectId);
    setProjectName(newProjectName);
    setShowCreateForm(false);
    localStorage.setItem('atoms_session_id', newSessionId);
    localStorage.setItem('atoms_project_id', newProjectId);
    localStorage.setItem('atoms_project_name', newProjectName);
    console.log('✅ 项目创建成功:', newProjectName, newSessionId);
  };

  const handleSelectSession = (session: SessionItem) => {
    setSessionId(session.sessionId);
    setProjectId(session.projectId);
    setProjectName(session.projectName);
    setShowCreateForm(false);
    localStorage.setItem('atoms_session_id', session.sessionId);
    localStorage.setItem('atoms_project_id', session.projectId);
    localStorage.setItem('atoms_project_name', session.projectName);
    // 清空当前代码预览，等待加载 session 的代码
    setCode(null);
  };

  const handleCreateNew = () => {
    setShowCreateForm(true);
    setSessionId(null);
    setProjectId(null);
    setProjectName('');
    setCode(null);
  };

  const handleCodeGenerated = useCallback((newCode: {
    html: string;
    css: string;
    js: string;
    description: string;
  }) => {
    setCode(newCode);
  }, []);

  const handleFilesUpdated = () => {
    // 触发文件列表刷新
    setFilesRefreshTrigger(prev => prev + 1);
  };

  // 如果未登录，显示登录界面
  if (!userId) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-purple-50">
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
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <LoginForm onSuccess={handleAuthSuccess} />
        </main>
      </div>
    );
  }

  // 如果已登录但需要创建项目，显示创建项目界面
  if (showCreateForm) {
    return (
      <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-purple-50">
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
              <span className="text-xs text-gray-500">用户ID: {userId.substring(0, 8)}...</span>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                返回
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('atoms_user_id');
                  localStorage.removeItem('atoms_session_id');
                  localStorage.removeItem('atoms_project_id');
                  localStorage.removeItem('atoms_project_name');
                  setUserId(null);
                  setSessionId(null);
                  setProjectId(null);
                  setProjectName('');
                  setShowCreateForm(false);
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                退出
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <CreateProjectForm userId={userId} onSuccess={handleProjectCreated} />
        </main>
      </div>
    );
  }

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
            <span className="text-xs text-gray-500">用户ID: {userId.substring(0, 8)}...</span>
            <button
              onClick={() => {
                localStorage.removeItem('atoms_user_id');
                localStorage.removeItem('atoms_session_id');
                localStorage.removeItem('atoms_project_id');
                localStorage.removeItem('atoms_project_name');
                setUserId(null);
                setSessionId(null);
                setProjectId(null);
                setProjectName('');
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              退出
            </button>
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
        {/* Left: Session List */}
        <div className="w-48 border-r border-gray-200 bg-white">
          <SessionList
            userId={userId}
            currentSessionId={sessionId}
            onSelectSession={handleSelectSession}
            onCreateNew={handleCreateNew}
          />
        </div>

        {/* Second: Project Files & Preview (合并) */}
        {sessionId ? (
          <div className="flex-1 border-r border-gray-200 bg-white">
            <ProjectFiles 
              sessionId={sessionId} 
              userId={userId || undefined} 
              refreshTrigger={filesRefreshTrigger}
              code={code || undefined}
            />
          </div>
        ) : (
          <div className="flex-1 border-r border-gray-200 flex items-center justify-center bg-gray-50">
            <div className="text-center p-8">
              <p className="text-sm text-gray-400">选择一个项目查看文件</p>
            </div>
          </div>
        )}

        {/* Right: Chat Panel */}
        {sessionId && projectId ? (
          <div className="w-96">
            <ChatPanel 
              projectId={projectId} 
              sessionId={sessionId}
              userId={userId}
              projectName={projectName}
              onCodeGenerated={handleCodeGenerated}
              onSessionIdChange={(newSessionId) => {
                setSessionId(newSessionId);
                localStorage.setItem('atoms_session_id', newSessionId);
              }}
              onFilesUpdated={handleFilesUpdated}
            />
          </div>
        ) : (
          <div className="w-96 flex items-center justify-center bg-gray-50">
            <div className="text-center p-8">
              <p className="text-gray-500 mb-2">选择一个项目开始对话</p>
              <p className="text-sm text-gray-400">或点击左侧按钮创建新项目</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
