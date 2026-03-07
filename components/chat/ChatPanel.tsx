'use client';

import { useState, useEffect, useRef } from 'react';
import { ChatInput } from './ChatInput';
import { MessageList } from './MessageList';
import { WorkflowProgress } from './WorkflowProgress';
import { getWebSocketClient, FileUpdateEvent, WorkflowProgressEvent } from '@/lib/websocket-client';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  createdAt: Date;
  code?: { html: string; css: string; js: string; description: string }; // 附带代码数据
}

interface ChatPanelProps {
  projectId: string;
  sessionId: string;
  userId: string;
  projectName?: string;
  onCodeGenerated: (code: { html: string; css: string; js: string; description: string }) => void;
  onSessionIdChange?: (newSessionId: string) => void;
  onFilesUpdated?: () => void; // 文件更新回调
}

export function ChatPanel({ projectId, sessionId, userId, projectName, onCodeGenerated, onSessionIdChange, onFilesUpdated }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [workflowProgress, setWorkflowProgress] = useState<WorkflowProgressEvent | null>(null);
  const lastLoadedSessionIdRef = useRef<string | null>(null); // 跟踪已加载的 sessionId，避免重复请求
  const actualSessionIdRef = useRef<string | null>(sessionId); // 跟踪实际 sessionId（含新建后的）
  const currentRequestIdRef = useRef<string | null>(null); // 当前请求的 SSE 频道 ID
  
  // 初始化 SSE 客户端连接
  useEffect(() => {
    const wsClient = getWebSocketClient();
    if (!wsClient.getConnected()) {
      wsClient.connect();
    }
  }, []);

  // 加载会话历史记录
  useEffect(() => {
    const loadSessionHistory = async () => {
      if (!sessionId) {
        setMessages([]);
        lastLoadedSessionIdRef.current = null;
        return;
      }

      // 如果已经加载过这个 session，跳过（避免重复请求）
      if (lastLoadedSessionIdRef.current === sessionId) {
        return;
      }

      try {
        setLoadingHistory(true);
        const response = await fetch(`/api/session?sessionId=${sessionId}`);
        const data = await response.json();

        if (data.success && data.session) {
          // 标记已加载
          lastLoadedSessionIdRef.current = sessionId;

          // 转换会话历史为消息格式
          const historyMessages: Message[] = data.session.conversationHistory
            ?.filter((msg: any) => msg.role !== 'system') // 过滤掉系统消息（思考过程）
            .map((msg: any) => ({
              id: msg.id || `msg-${msg.timestamp}`,
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: msg.content,
              createdAt: new Date(msg.timestamp),
              code: msg.code,
            })) || [];

          setMessages(historyMessages);

          // 如果有生成的代码，自动加载预览
          if (data.session.generatedCode && onCodeGenerated) {
            onCodeGenerated(data.session.generatedCode);
          }
        }
      } catch (error) {
        console.error('Failed to load session history:', error);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadSessionHistory();
    // 只在 sessionId 变化时加载，移除 onCodeGenerated 依赖避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleSend = async (content: string, images?: string[]) => {
    // 添加用户消息
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      images,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);
    setShowProgress(true); // 显示进度条
    setWorkflowProgress(null); // 重置进度

    try {
      // ✅ 关键修复：客户端生成唯一 requestId 作为 SSE 推送频道
      // 这样无论 sessionId 是否存在，都能在 API 调用前建立好 SSE 连接
      const requestId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const wsClient = getWebSocketClient();

      // 先订阅 requestId 频道，再发 API 请求（避免错过早期 SSE 事件）
      wsClient.subscribe(requestId);
      wsClient.setHandlers({
        onWorkflowProgress: (event: WorkflowProgressEvent) => {
          // 接受 requestId 频道 或 sessionId 频道 的事件
          if (event.sessionId === requestId ||
              event.sessionId === sessionId ||
              event.sessionId === actualSessionIdRef.current) {
            setWorkflowProgress(event);
          }
        },
        onFileUpdates: (events: FileUpdateEvent[]) => {
          if (onFilesUpdated) {
            console.log('📝 收到文件更新事件，刷新文件列表');
            setTimeout(() => { onFilesUpdated(); }, 500);
          }
        },
      });

      currentRequestIdRef.current = requestId;
      console.log(`📡 SSE 订阅频道: ${requestId}`);

      // 调用 VIP Agent API，传入 requestId 让服务端向此频道推送进度
      const response = await fetch('/api/vip-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: content, images, sessionId, userId, requestId }),
      });

      const data = await response.json();

      if (data.success) {
        // 更新 sessionId（如果 API 返回了新的 sessionId）
        const actualSessionId = data.sessionId || sessionId;
        actualSessionIdRef.current = actualSessionId;
        if (actualSessionId && actualSessionId !== sessionId && onSessionIdChange) {
          onSessionIdChange(actualSessionId);
          console.log('✅ Session ID 已更新:', actualSessionId);
        }

        // VIP Agent 返回的是 fileChanges，不是 code
        // 添加 AI 响应
        const planInfo = data.plan ? `\n\n**实现方案：**\n${data.plan}` : '';
        const fileSummary = data.fileChanges?.map((fc: any) => `- ${fc.path} (${fc.action})`).join('\n') || '';
        const validationInfo = data.validation?.attempts 
          ? `\n\n**验证：** ${data.validation.attempts} 次尝试后通过`
          : '';
        
        const aiMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `✅ VIP Code Agent 完成！${planInfo}\n\n**文件变更**（共 ${data.fileChanges?.length || 0} 个）：\n${fileSummary}${validationInfo}\n\n文件已自动更新，你可以继续提出新的需求进行调整。`,
          createdAt: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);

        // 文件更新会通过 WebSocket 自动触发刷新
        if (onFilesUpdated) {
          setTimeout(() => {
            console.log('🔄 触发文件列表刷新...');
            onFilesUpdated();
          }, 1000);
        }
      } else {
        // API 返回了错误
        const errorMsg = data.error || '生成失败';
        const hint = data.hint || '';
        throw new Error(errorMsg + (hint ? `\n\n💡 ${hint}` : ''));
      }
    } catch (error: any) {
      console.error('Generate error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `❌ **抱歉，生成代码时出错**\n\n${error.message || '未知错误'}\n\n如果问题持续存在，请检查：\n1. PostgreSQL 数据库连接是否正常\n2. Session 是否已过期\n3. 网络连接是否正常`,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      // 取消订阅 requestId 频道
      if (currentRequestIdRef.current) {
        getWebSocketClient().unsubscribe(currentRequestIdRef.current);
        currentRequestIdRef.current = null;
      }
      setLoading(false);
      setShowProgress(false); // 隐藏进度条
      setWorkflowProgress(null); // 清空进度
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-800">💬 AI 对话</h2>
        <p className="text-xs text-gray-500 mt-1">
          {projectName ? `项目：${projectName}` : '告诉 AI 你想要创建什么应用'}
        </p>
      </div>

      {/* Messages */}
      {loadingHistory ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">加载聊天记录...</p>
        </div>
      ) : (
        <MessageList messages={messages} />
      )}

      {/* Workflow Progress */}
      <WorkflowProgress progress={workflowProgress} visible={showProgress && loading} />

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        sessionId={actualSessionIdRef.current || sessionId}
        projectId={projectId}
        disabled={loading}
      />
    </div>
  );
}
