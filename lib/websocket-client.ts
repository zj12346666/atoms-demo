/**
 * WebSocket 客户端 - 用于前端实时接收工作流进度和文件更新
 * 自动检测环境：本地使用 WebSocket，Vercel 使用 SSE
 */

import { io, Socket } from 'socket.io-client';
import { getSSEClient, SSEClient, SSEEventHandler } from './sse-client';

export interface WorkflowProgressEvent {
  type: 'WORKFLOW_PROGRESS';
  sessionId: string;
  state: string;
  message: string;
  progress: number;
  details?: string;
}

export interface FileUpdateEvent {
  type: 'FILE_UPDATED' | 'FILE_CREATED' | 'FILE_DELETED';
  sessionId: string;
  path: string;
  content?: string;
}

export type WebSocketEventHandler = {
  onWorkflowProgress?: (event: WorkflowProgressEvent) => void;
  onFileUpdate?: (event: FileUpdateEvent) => void;
  onFileUpdates?: (events: FileUpdateEvent[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
};

export class WebSocketClient {
  private socket: Socket | null = null;
  private sseClient: SSEClient | null = null;
  private handlers: WebSocketEventHandler = {};
  private isConnected: boolean = false;
  private subscribedSessions: Set<string> = new Set();
  private useSSE: boolean = false;

  constructor(private serverUrl?: string) {
    // 默认使用当前页面的 origin
    this.serverUrl = serverUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    
    // 始终使用 SSE 模式
    this.useSSE = true;
    this.sseClient = getSSEClient(this.serverUrl);
    console.log('🌐 使用 SSE 模式');
  }

  /**
   * 连接到服务器（WebSocket 或 SSE）
   */
  connect(): void {
    if (this.useSSE) {
      // 使用 SSE
      if (this.sseClient) {
        // SSE 需要 sessionId，所以这里只是初始化
        // 实际的连接在 subscribe 时进行
        console.log('🔌 SSE 客户端已准备就绪');
      }
    } else {
      // 使用 WebSocket
      if (this.socket?.connected) {
        console.warn('WebSocket 已经连接');
        return;
      }

      try {
        this.socket = io(this.serverUrl!, {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
        });

        this.setupEventHandlers();
        console.log('🔌 WebSocket 客户端连接中...');
      } catch (error: any) {
        console.error('WebSocket 连接失败:', error);
        this.handlers.onError?.(error);
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.useSSE) {
      if (this.sseClient) {
        this.sseClient.disconnect();
        this.isConnected = false;
        this.subscribedSessions.clear();
        console.log('🔌 SSE 客户端已断开');
      }
    } else {
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
        this.isConnected = false;
        this.subscribedSessions.clear();
        console.log('🔌 WebSocket 客户端已断开');
      }
    }
  }

  /**
   * 订阅 session 的更新
   */
  subscribe(sessionId: string): void {
    if (this.useSSE) {
      // 使用 SSE
      if (this.sseClient) {
        this.sseClient.subscribe(sessionId);
        // 设置 SSE 事件处理器
        this.sseClient.setHandlers({
          onWorkflowProgress: (event) => {
            this.handlers.onWorkflowProgress?.(event);
          },
          onFileUpdate: (event) => {
            this.handlers.onFileUpdate?.(event);
          },
          onFileUpdates: (events) => {
            this.handlers.onFileUpdates?.(events);
          },
          onConnect: () => {
            this.isConnected = true;
            this.handlers.onConnect?.();
          },
          onDisconnect: () => {
            this.isConnected = false;
            this.handlers.onDisconnect?.();
          },
          onError: (error) => {
            this.handlers.onError?.(error);
          },
        });
        this.subscribedSessions.add(sessionId);
      }
    } else {
      // 使用 WebSocket
      if (!this.socket?.connected) {
        console.warn('WebSocket 未连接，无法订阅');
        return;
      }

      if (this.subscribedSessions.has(sessionId)) {
        console.debug(`已订阅 session: ${sessionId}`);
        return;
      }

      this.socket.emit('subscribe', sessionId);
      this.subscribedSessions.add(sessionId);
      console.log(`📡 订阅 session: ${sessionId}`);
    }
  }

  /**
   * 取消订阅 session
   */
  unsubscribe(sessionId: string): void {
    if (this.useSSE) {
      if (this.sseClient) {
        this.sseClient.unsubscribe(sessionId);
        this.subscribedSessions.delete(sessionId);
      }
    } else {
      if (!this.socket?.connected) {
        return;
      }

      if (!this.subscribedSessions.has(sessionId)) {
        return;
      }

      this.socket.emit('unsubscribe', sessionId);
      this.subscribedSessions.delete(sessionId);
      console.log(`📡 取消订阅 session: ${sessionId}`);
    }
  }

  /**
   * 设置事件处理器
   */
  setHandlers(handlers: WebSocketEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * 设置事件监听器
   */
  private setupEventHandlers(): void {
    if (!this.socket) return;

    // 连接成功
    this.socket.on('connect', () => {
      this.isConnected = true;
      console.log('✅ WebSocket 连接成功');
      this.handlers.onConnect?.();

      // 重新订阅之前的 sessions
      for (const sessionId of this.subscribedSessions) {
        this.socket?.emit('subscribe', sessionId);
      }
    });

    // 断开连接
    this.socket.on('disconnect', () => {
      this.isConnected = false;
      console.warn('⚠️ WebSocket 断开连接');
      this.handlers.onDisconnect?.();
    });

    // 连接错误
    this.socket.on('connect_error', (error: Error) => {
      console.error('❌ WebSocket 连接错误:', error);
      this.handlers.onError?.(error);
    });

    // 工作流进度事件
    this.socket.on('workflow_progress', (event: WorkflowProgressEvent) => {
      console.debug(`📊 收到工作流进度: [${event.state}] ${event.message}`);
      this.handlers.onWorkflowProgress?.(event);
    });

    // 批量工作流进度事件
    this.socket.on('workflow_progresses', (events: WorkflowProgressEvent[]) => {
      console.debug(`📊 收到批量工作流进度: ${events.length} 个事件`);
      events.forEach(event => {
        this.handlers.onWorkflowProgress?.(event);
      });
    });

    // 单个文件更新事件
    this.socket.on('file_update', (event: FileUpdateEvent) => {
      console.log(`📝 收到文件更新: ${event.type} ${event.path}`);
      this.handlers.onFileUpdate?.(event);
    });

    // 批量文件更新事件
    this.socket.on('file_updates', (events: FileUpdateEvent[]) => {
      console.log(`📝 收到批量文件更新: ${events.length} 个文件`);
      this.handlers.onFileUpdates?.(events);
    });
  }

  /**
   * 获取连接状态
   */
  getConnected(): boolean {
    if (this.useSSE) {
      return this.sseClient?.getConnected() || false;
    }
    return this.isConnected;
  }

  /**
   * 获取已订阅的 sessions
   */
  getSubscribedSessions(): string[] {
    return Array.from(this.subscribedSessions);
  }
}

// 单例实例
let wsClientInstance: WebSocketClient | null = null;

export function getWebSocketClient(serverUrl?: string): WebSocketClient {
  if (!wsClientInstance) {
    wsClientInstance = new WebSocketClient(serverUrl);
  }
  return wsClientInstance;
}
