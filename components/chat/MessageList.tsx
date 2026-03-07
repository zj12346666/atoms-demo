'use client';

import { useEffect, useRef } from 'react';
import { MessageItem } from './MessageItem';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  createdAt?: Date;
  code?: { html: string; css: string; js: string; description: string };
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-gray-400">
          <svg
            className="w-16 h-16 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <p className="text-lg font-medium">开始你的创作</p>
          <p className="text-sm mt-2">描述你想要创建的应用，AI 会帮你生成代码</p>
        </div>
      ) : (
        <>
          {messages
            .filter((message) => message.role !== 'system') // 过滤掉系统消息
            .map((message) => (
              <MessageItem
                key={message.id}
                role={message.role as 'user' | 'assistant'}
                content={message.content}
                images={message.images}
                timestamp={message.createdAt}
              />
            ))}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  );
}
