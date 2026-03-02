/**
 * WebSocket 客户端 - 用于前端实时接收工作流进度和文件更新
 */

import { io, Socket } from 'socket.io-client';

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
  private handlers: WebSocketEventHandler = {};
  private isConnected: boolean = false;
  private subscribedSessions: Set<string> = new Set();

  constructor(private serverUrl?: string) {
    // 默认使用当前页面的 origin
    this.serverUrl = serverUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  /**
   * 连接到 WebSocket 服务器
   */
  connect(): void {
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

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.subscribedSessions.clear();
      console.log('🔌 WebSocket 客户端已断开');
    }
  }

  /**
   * 订阅 session 的更新
   */
  subscribe(sessionId: string): void {
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

  /**
   * 取消订阅 session
   */
  unsubscribe(sessionId: string): void {
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
