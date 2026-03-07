/**
 * SSE (Server-Sent Events) 客户端
 * 用于 Vercel 环境下的实时进度推送（替代 WebSocket）
 */

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

export type SSEEventHandler = {
  onWorkflowProgress?: (event: WorkflowProgressEvent) => void;
  onFileUpdate?: (event: FileUpdateEvent) => void;
  onFileUpdates?: (events: FileUpdateEvent[]) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
};

export class SSEClient {
  private eventSource: EventSource | null = null;
  private handlers: SSEEventHandler = {};
  private isConnected: boolean = false;
  private subscribedSessions: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  constructor(private baseUrl?: string) {
    // 默认使用当前页面的 origin
    this.baseUrl = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  /**
   * 连接到 SSE 服务器
   */
  connect(sessionId: string): void {
    if (this.eventSource && this.eventSource.readyState === EventSource.OPEN) {
      console.warn('SSE 已经连接');
      return;
    }

    // 关闭现有连接
    this.disconnect();

    try {
      const url = `${this.baseUrl}/api/events/${sessionId}`;
      this.eventSource = new EventSource(url);

      this.setupEventHandlers();
      console.log(`🔌 SSE 客户端连接中: ${url}`);
    } catch (error: any) {
      console.error('SSE 连接失败:', error);
      this.handlers.onError?.(error);
      this.attemptReconnect(sessionId);
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.isConnected = false;
      this.subscribedSessions.clear();
      console.log('🔌 SSE 客户端已断开');
    }
  }

  /**
   * 订阅 session 的更新
   */
  subscribe(sessionId: string): void {
    if (this.subscribedSessions.has(sessionId)) {
      console.debug(`已订阅 session: ${sessionId}`);
      return;
    }

    // SSE 连接需要 sessionId，所以直接连接
    this.connect(sessionId);
    this.subscribedSessions.add(sessionId);
    console.log(`📡 订阅 session: ${sessionId}`);
  }

  /**
   * 取消订阅 session
   */
  unsubscribe(sessionId: string): void {
    if (!this.subscribedSessions.has(sessionId)) {
      return;
    }

    this.subscribedSessions.delete(sessionId);
    
    // 如果没有其他订阅，断开连接
    if (this.subscribedSessions.size === 0) {
      this.disconnect();
    } else {
      // 如果有其他订阅，需要重新连接到新的 session
      // 注意：SSE 一次只能连接一个 session
      const firstSession = Array.from(this.subscribedSessions)[0];
      if (firstSession) {
        this.connect(firstSession);
      }
    }
    
    console.log(`📡 取消订阅 session: ${sessionId}`);
  }

  /**
   * 设置事件处理器
   */
  setHandlers(handlers: SSEEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  /**
   * 设置事件监听器
   */
  private setupEventHandlers(): void {
    if (!this.eventSource) return;

    // 连接成功
    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('✅ SSE 连接成功');
      this.handlers.onConnect?.();
    };

    // 连接错误
    this.eventSource.onerror = (error) => {
      console.error('❌ SSE 连接错误:', error);
      this.isConnected = false;
      
      // 如果连接关闭，尝试重连
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        const sessionId = Array.from(this.subscribedSessions)[0];
        if (sessionId) {
          this.attemptReconnect(sessionId);
        }
      }
      
      this.handlers.onError?.(new Error('SSE connection error'));
    };

    // 接收消息
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // 处理连接确认
        if (data.type === 'connected') {
          console.log(`✅ SSE 已连接到 session: ${data.sessionId}`);
          return;
        }

        // 处理工作流进度
        if (data.type === 'workflow_progress' || data.type === 'WORKFLOW_PROGRESS') {
          console.debug(`📊 收到工作流进度: [${data.state}] ${data.message}`);
          this.handlers.onWorkflowProgress?.(data as WorkflowProgressEvent);
          return;
        }

        // 处理批量工作流进度
        if (data.type === 'workflow_progresses' && Array.isArray(data.events)) {
          console.debug(`📊 收到批量工作流进度: ${data.events.length} 个事件`);
          data.events.forEach((event: WorkflowProgressEvent) => {
            this.handlers.onWorkflowProgress?.(event);
          });
          return;
        }

        // 处理单个文件更新
        if (data.type === 'file_update' || 
            data.type === 'FILE_UPDATED' || 
            data.type === 'FILE_CREATED' || 
            data.type === 'FILE_DELETED') {
          console.log(`📝 收到文件更新: ${data.type} ${data.path}`);
          this.handlers.onFileUpdate?.(data as FileUpdateEvent);
          return;
        }

        // 处理批量文件更新
        if (data.type === 'file_updates' && Array.isArray(data.events)) {
          console.log(`📝 收到批量文件更新: ${data.events.length} 个文件`);
          this.handlers.onFileUpdates?.(data.events as FileUpdateEvent[]);
          return;
        }

        console.debug('收到未知 SSE 事件:', data);
      } catch (error) {
        console.error('解析 SSE 消息失败:', error, event.data);
      }
    };
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(sessionId: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ SSE 重连失败，已达到最大尝试次数 (${this.maxReconnectAttempts})`);
      this.handlers.onError?.(new Error('SSE reconnection failed'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`🔄 SSE 将在 ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connect(sessionId);
    }, delay);
  }

  /**
   * 获取连接状态
   */
  getConnected(): boolean {
    return this.isConnected && this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * 获取已订阅的 sessions
   */
  getSubscribedSessions(): string[] {
    return Array.from(this.subscribedSessions);
  }
}

// 单例实例
let sseClientInstance: SSEClient | null = null;

export function getSSEClient(baseUrl?: string): SSEClient {
  if (!sseClientInstance) {
    sseClientInstance = new SSEClient(baseUrl);
  }
  return sseClientInstance;
}
