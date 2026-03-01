'use client';

import { useState } from 'react';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

interface ChatPanelProps {
  projectId: string;
  onCodeGenerated: (code: { html: string; css: string; js: string; description: string }) => void;
}

export function ChatPanel({ projectId, onCodeGenerated }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSend = async (content: string) => {
    // 添加用户消息
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      // 调用 API 生成代码
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: content, projectId }),
      });

      const data = await response.json();

      if (data.success) {
        // 添加 AI 响应
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.code.description || '代码已生成，请查看右侧预览',
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);

        // 触发代码预览
        onCodeGenerated(data.code);
      } else {
        throw new Error(data.error || '生成失败');
      }
    } catch (error: any) {
      console.error('Generate error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `抱歉，生成代码时出错：${error.message}\n\n${(error as any).hint || ''}`,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-800">💬 AI 对话</h2>
        <p className="text-xs text-gray-500 mt-1">告诉 AI 你想要创建什么应用</p>
      </div>

      {/* Messages */}
      <MessageList messages={messages} />

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
