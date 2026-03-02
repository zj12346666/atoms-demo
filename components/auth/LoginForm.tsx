'use client';

import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface LoginFormProps {
  onSuccess: (userId: string, username: string, action: 'login' | 'register') => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      // 检查响应状态
      if (!response.ok) {
        // 尝试解析 JSON 错误响应
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          setError(errorData.error || `请求失败 (${response.status})`);
        } else {
          // 如果不是 JSON，可能是 HTML 错误页面
          const text = await response.text();
          setError(`服务器错误 (${response.status})。请检查服务器日志或稍后重试。`);
          console.error('API 返回了非 JSON 响应:', text.substring(0, 200));
        }
        return;
      }

      // 检查 Content-Type 确保是 JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        setError('服务器返回了非 JSON 响应，请检查服务器配置');
        console.error('API 返回了非 JSON 响应:', text.substring(0, 200));
        return;
      }

      const data = await response.json();

      if (data.success) {
        onSuccess(data.userId, data.username, data.action);
      } else {
        setError(data.error || '认证失败');
      }
    } catch (err: any) {
      // 处理 JSON 解析错误
      if (err.message && err.message.includes('JSON')) {
        setError('服务器响应格式错误，请稍后重试');
        console.error('JSON 解析错误:', err);
      } else {
        setError(err.message || '网络错误，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">欢迎使用 Atoms Demo</h2>
        <p className="text-sm text-gray-500">输入密码即可开始</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
            用户名
          </label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名（3-20个字符，字母、数字、下划线）"
            disabled={loading}
            required
            className="w-full"
            pattern="[a-zA-Z0-9_]{3,20}"
            title="用户名只能包含字母、数字和下划线，长度3-20个字符"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
            密码
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            disabled={loading}
            required
            className="w-full"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          disabled={loading || !username.trim() || !password.trim()}
          className="w-full"
        >
          {loading ? '处理中...' : '开始使用'}
        </Button>
      </form>

      <p className="mt-4 text-xs text-center text-gray-500">
        首次使用将自动注册，后续使用相同用户名和密码即可登录
      </p>
    </div>
  );
}
