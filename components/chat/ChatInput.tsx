'use client';

import { useState } from 'react';
import { Button } from '../ui/Button';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim()) {
      onSend(message);
      setMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-200 p-4 bg-white">
      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="描述你想要创建的应用..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-900 placeholder:text-gray-400"
          rows={3}
          disabled={disabled}
        />
        <Button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          className="self-end"
        >
          {disabled ? '生成中...' : '发送'}
        </Button>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        提示：详细描述你的需求，比如"创建一个待办事项应用"
      </p>
    </div>
  );
}
