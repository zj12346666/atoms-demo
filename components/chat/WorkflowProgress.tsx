/**
 * 工作流进度显示组件
 * 实时显示 VIP Agent 的执行进度（打字机效果）
 * 纯展示组件，进度数据由 ChatPanel 通过 SSE 收集后通过 props 传入
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { WorkflowProgressEvent } from '@/lib/websocket-client';

interface WorkflowProgressProps {
  progress: WorkflowProgressEvent | null;
  visible: boolean;
}

export function WorkflowProgress({ progress, visible }: WorkflowProgressProps) {
  const [displayedText, setDisplayedText] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const targetTextRef = useRef<string>('');
  const displayedTextRef = useRef<string>('');

  // 打字机效果函数
  const typeText = (targetText: string) => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    targetTextRef.current = targetText;
    const currentDisplayed = displayedTextRef.current;

    if (targetText === currentDisplayed) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);

    const isExtension = targetText.startsWith(currentDisplayed);
    const startIndex = isExtension ? currentDisplayed.length : 0;

    if (!isExtension) {
      setDisplayedText('');
      displayedTextRef.current = '';
    }

    let currentIndex = startIndex;

    const type = () => {
      if (currentIndex < targetText.length && targetTextRef.current === targetText) {
        const newText = targetText.slice(0, currentIndex + 1);
        setDisplayedText(newText);
        displayedTextRef.current = newText;
        currentIndex++;
        typingTimeoutRef.current = setTimeout(type, 20);
      } else {
        setIsTyping(false);
      }
    };

    type();
  };

  // 当 progress prop 变化时触发打字机效果
  useEffect(() => {
    if (!visible || !progress) {
      // 隐藏时重置
      setDisplayedText('');
      displayedTextRef.current = '';
      targetTextRef.current = '';
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      return;
    }

    const targetText = progress.details
      ? `${progress.message}\n\n${progress.details}`
      : progress.message;

    if (targetText !== targetTextRef.current) {
      typeText(targetText);
    }
  }, [progress, visible]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  if (!visible || !progress) {
    return null;
  }

  const stateIcons: Record<string, string> = {
    idle: '⏸️',
    intent_retrieval: '🧠',
    code_generation: '✍️',
    validation: '🔬',
    fixing: '🔧',
    reviewing: '🔍',
    persistence: '💾',
    reindexing: '🔄',
    completed: '✅',
    failed: '❌',
  };

  const icon = stateIcons[progress.state] || '⚙️';

  return (
    <div className="px-4 py-3">
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 text-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{icon}</span>
            <span className="text-xs opacity-75">AI 助手</span>
            <span className="text-xs opacity-50">{progress.progress}%</span>
          </div>
          <div className="text-sm whitespace-pre-wrap">
            {displayedText}
            {isTyping && (
              <span className="inline-block w-2 h-4 bg-gray-600 ml-1 animate-pulse" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
