/**
 * 工作流进度显示组件
 * 实时显示 VIP Agent 的执行进度（打字机效果）
 */

'use client';

import { useEffect, useState, useRef } from 'react';
import { getWebSocketClient, WorkflowProgressEvent } from '@/lib/websocket-client';

interface WorkflowProgressProps {
  sessionId: string | null;
  visible: boolean;
}

export function WorkflowProgress({ sessionId, visible }: WorkflowProgressProps) {
  const [displayedText, setDisplayedText] = useState<string>('');
  const [currentProgress, setCurrentProgress] = useState<WorkflowProgressEvent | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const targetTextRef = useRef<string>('');
  const displayedTextRef = useRef<string>('');

  // 打字机效果函数
  const typeText = (targetText: string) => {
    // 清除之前的定时器
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    targetTextRef.current = targetText;
    const currentDisplayed = displayedTextRef.current;
    
    // 如果目标文本与当前显示文本相同，不需要重新打字
    if (targetText === currentDisplayed) {
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    
    // 如果新文本是旧文本的扩展（追加），从旧文本长度开始
    // 否则从头开始
    const isExtension = targetText.startsWith(currentDisplayed);
    const startIndex = isExtension ? currentDisplayed.length : 0;
    
    // 如果不是扩展，先清空
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
        typingTimeoutRef.current = setTimeout(type, 20); // 每20ms打一个字
      } else {
        setIsTyping(false);
      }
    };
    
    type();
  };

  useEffect(() => {
    if (!sessionId || !visible) {
      setCurrentProgress(null);
      setDisplayedText('');
      displayedTextRef.current = '';
      targetTextRef.current = '';
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      return;
    }

    const wsClient = getWebSocketClient();
    
    // 连接 WebSocket（如果未连接）
    if (!wsClient.getConnected()) {
      wsClient.connect();
    }

    // 订阅 session
    wsClient.subscribe(sessionId);

    // 设置进度事件处理器
    wsClient.setHandlers({
      onWorkflowProgress: (event: WorkflowProgressEvent) => {
        if (event.sessionId === sessionId) {
          setCurrentProgress(event);
          // 准备打字机效果的目标文本
          const targetText = event.details 
            ? `${event.message}\n\n${event.details}`
            : event.message;
          
          // 如果文本改变，启动打字机效果
          if (targetText !== targetTextRef.current) {
            typeText(targetText);
          }
        }
      },
      onConnect: () => {
        wsClient.subscribe(sessionId);
      },
    });

    return () => {
      // 清理：取消订阅（但不断开连接，因为可能还有其他 session）
      wsClient.unsubscribe(sessionId);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [sessionId, visible]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  if (!visible || !currentProgress) {
    return null;
  }

  // 状态图标映射
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

  const icon = stateIcons[currentProgress.state] || '⚙️';

  return (
    <div className="px-4 py-3">
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 text-gray-800">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{icon}</span>
            <span className="text-xs opacity-75">AI 助手</span>
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
