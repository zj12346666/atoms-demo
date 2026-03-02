'use client';

import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface CreateProjectFormProps {
  userId: string;
  onSuccess: (sessionId: string, projectId: string, projectName: string) => void;
}

export function CreateProjectForm({ userId, onSuccess }: CreateProjectFormProps) {
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          projectName: projectName.trim() || '我的项目',
          userId: userId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        onSuccess(
          data.session.sessionId,
          data.session.projectId,
          data.session.projectName
        );
      } else {
        setError(data.error || '创建项目失败');
      }
    } catch (err: any) {
      setError(err.message || '网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">创建新项目</h2>
        <p className="text-sm text-gray-500">为你的应用起个名字，开始 AI 生成之旅</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-2">
            项目名称
          </label>
          <Input
            id="projectName"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="例如：贪吃蛇游戏、待办清单、计算器..."
            disabled={loading}
            className="w-full"
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-500">
            不填写将使用默认名称"我的项目"
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="w-full"
        >
          {loading ? '创建中...' : '创建项目'}
        </Button>
      </form>

      <p className="mt-4 text-xs text-center text-gray-500">
        💡 提示：创建项目后，你可以在对话中告诉 AI 你想要实现的功能
      </p>
    </div>
  );
}
