/**
 * SSE 客户端（轮询模式）
 *
 * 替代原来基于 EventSource 的长连接方式。
 * 每 1.5 秒向 GET /api/events/{sessionId}?since={lastId} 发一次请求，
 * 拿到新事件后分发给注册的 handlers。
 *
 * 接口与原 SSEClient 完全兼容，上层调用代码无需修改。
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
  private handlers: SSEEventHandler = {};
  private isConnected: boolean = false;
  private subscribedSessions: Set<string> = new Set();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventId: number = 0;
  private currentSessionId: string | null = null;
  private pollIntervalMs: number = 1500;

  constructor(private baseUrl?: string) {
    this.baseUrl = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  }

  /**
   * 连接（开始轮询）
   */
  connect(sessionId: string): void {
    if (this.isConnected && this.currentSessionId === sessionId) {
      console.warn('SSE 轮询已在运行');
      return;
    }

    this.disconnect();
    this.currentSessionId = sessionId;
    this.lastEventId = 0;

    this._startPolling(sessionId);

    console.log(`🔌 SSE 轮询启动: session=${sessionId}, interval=${this.pollIntervalMs}ms`);
  }

  /**
   * 断开连接（停止轮询）
   */
  disconnect(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.isConnected) {
      this.isConnected = false;
      this.currentSessionId = null;
      this.subscribedSessions.clear();
      this.handlers.onDisconnect?.();
      console.log('🔌 SSE 轮询已停止');
    }
  }

  /**
   * 订阅 session（兼容原接口）
   */
  subscribe(sessionId: string): void {
    if (this.subscribedSessions.has(sessionId)) {
      console.debug(`已订阅 session: ${sessionId}`);
      return;
    }
    this.subscribedSessions.add(sessionId);
    this.connect(sessionId);
    console.log(`📡 订阅 session: ${sessionId}`);
  }

  /**
   * 取消订阅
   */
  unsubscribe(sessionId: string): void {
    if (!this.subscribedSessions.has(sessionId)) return;

    this.subscribedSessions.delete(sessionId);

    if (this.subscribedSessions.size === 0) {
      this.disconnect();
    } else {
      // 切换到其他 session
      const nextSession = Array.from(this.subscribedSessions)[0];
      if (nextSession) this.connect(nextSession);
    }

    console.log(`📡 取消订阅 session: ${sessionId}`);
  }

  /**
   * 设置事件处理器
   */
  setHandlers(handlers: SSEEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  getConnected(): boolean {
    return this.isConnected;
  }

  getSubscribedSessions(): string[] {
    return Array.from(this.subscribedSessions);
  }

  // ─── 内部方法 ────────────────────────────────────────────────

  private _startPolling(sessionId: string): void {
    // 立即触发一次，然后按间隔循环
    this._poll(sessionId).then(() => {
      if (!this.isConnected) {
        // 首次 poll 成功后标记已连接
        this.isConnected = true;
        console.log(`✅ SSE 轮询已连接 session: ${sessionId}`);
        this.handlers.onConnect?.();
      }
    });

    this.pollTimer = setInterval(() => {
      this._poll(sessionId).catch((err) => {
        console.error('SSE 轮询出错:', err);
        this.handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, this.pollIntervalMs);
  }

  private async _poll(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/events/${sessionId}?since=${this.lastEventId}`;
    const res = await fetch(url, { cache: 'no-store' });

    if (!res.ok) {
      throw new Error(`SSE 轮询请求失败: ${res.status} ${res.statusText}`);
    }

    const data: { events: { id: number; payload: string }[]; lastId: number } = await res.json();

    if (data.lastId > this.lastEventId) {
      this.lastEventId = data.lastId;
    }

    for (const item of data.events) {
      try {
        const event = JSON.parse(item.payload);
        this._dispatchEvent(event);
      } catch (e) {
        console.error('解析 SSE 事件失败:', e, item.payload);
      }
    }
  }

  private _dispatchEvent(data: any): void {
    // 连接确认（忽略）
    if (data.type === 'connected') return;

    // 工作流进度
    if (data.type === 'workflow_progress' || data.type === 'WORKFLOW_PROGRESS') {
      console.debug(`📊 收到工作流进度: [${data.state}] ${data.message}`);
      this.handlers.onWorkflowProgress?.(data as WorkflowProgressEvent);
      return;
    }

    // 批量工作流进度
    if (data.type === 'workflow_progresses' && Array.isArray(data.events)) {
      console.debug(`📊 收到批量工作流进度: ${data.events.length} 个`);
      data.events.forEach((e: WorkflowProgressEvent) => {
        this.handlers.onWorkflowProgress?.(e);
      });
      return;
    }

    // 单个文件更新
    if (
      data.type === 'file_update' ||
      data.type === 'FILE_UPDATED' ||
      data.type === 'FILE_CREATED' ||
      data.type === 'FILE_DELETED'
    ) {
      console.log(`📝 收到文件更新: ${data.type} ${data.path}`);
      this.handlers.onFileUpdate?.(data as FileUpdateEvent);
      return;
    }

    // 批量文件更新
    if (data.type === 'file_updates' && Array.isArray(data.events)) {
      console.log(`📝 收到批量文件更新: ${data.events.length} 个文件`);
      this.handlers.onFileUpdates?.(data.events as FileUpdateEvent[]);
      return;
    }

    console.debug('收到未知 SSE 事件:', data);
  }
}

// 单例
let sseClientInstance: SSEClient | null = null;

export function getSSEClient(baseUrl?: string): SSEClient {
  if (!sseClientInstance) {
    sseClientInstance = new SSEClient(baseUrl);
  }
  return sseClientInstance;
}
