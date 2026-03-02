'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/Button';

export interface SessionItem {
  sessionId: string;
  projectId: string;
  projectName: string;
  status: 'active' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface SessionListProps {
  userId: string;
  currentSessionId: string | null;
  onSelectSession: (session: SessionItem) => void;
  onCreateNew: () => void;
}

export function SessionList({ userId, currentSessionId, onSelectSession, onCreateNew }: SessionListProps) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!userId) {
      setSessions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/session?userId=${userId}`);
      const data = await response.json();
      if (data.success) {
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSessions();
    // 定期刷新 session 列表（降低频率，减少不必要的请求）
    const interval = setInterval(loadSessions, 60000); // 每60秒刷新一次（从30秒改为60秒）
    return () => clearInterval(interval);
  }, [loadSessions]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'failed':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-blue-100 text-blue-700';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      default:
        return '进行中';
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-800">📁 项目列表</h2>
        </div>
        <Button
          onClick={onCreateNew}
          className="w-full"
          size="sm"
        >
          ➕ 创建新项目
        </Button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-gray-500">加载中...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 px-4">
            <p className="text-sm text-gray-500 text-center mb-2">还没有项目</p>
            <p className="text-xs text-gray-400 text-center">点击上方按钮创建第一个项目</p>
          </div>
        ) : (
          <div className="p-2">
            {sessions.map((session) => (
              <div
                key={session.sessionId}
                onClick={() => onSelectSession(session)}
                className={`
                  p-3 mb-2 rounded-lg border cursor-pointer transition-all
                  ${
                    currentSessionId === session.sessionId
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }
                `}
              >
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-sm font-medium text-gray-900 truncate flex-1">
                    {session.projectName || '未命名项目'}
                  </h3>
                  <span
                    className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(
                      session.status
                    )}`}
                  >
                    {getStatusText(session.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                  <span>{session.messageCount} 条消息</span>
                  <span>{formatDate(session.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
