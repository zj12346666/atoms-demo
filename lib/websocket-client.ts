/**
 * SSE 客户端包装 - 前端接收工作流进度和文件更新
 * 统一通过 PostgreSQL SSE 轮询实现
 */

import { getSSEClient, SSEClient } from './sse-client';

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
  private sseClient: SSEClient;
  private handlers: WebSocketEventHandler = {};
  private subscribedSessions: Set<string> = new Set();

  constructor(serverUrl?: string) {
    const baseUrl = serverUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    this.sseClient = getSSEClient(baseUrl);
  }

  connect(): void {
    // SSE 无需显式建立连接，subscribe 时自动启动
  }

  disconnect(): void {
    this.sseClient.disconnect();
    this.subscribedSessions.clear();
  }

  subscribe(sessionId: string): void {
    this.sseClient.subscribe(sessionId);
    this.sseClient.setHandlers({
      onWorkflowProgress: (event) => this.handlers.onWorkflowProgress?.(event),
      onFileUpdate: (event) => this.handlers.onFileUpdate?.(event),
      onFileUpdates: (events) => this.handlers.onFileUpdates?.(events),
      onConnect: () => { this.handlers.onConnect?.(); },
      onDisconnect: () => { this.handlers.onDisconnect?.(); },
      onError: (error) => this.handlers.onError?.(error),
    });
    this.subscribedSessions.add(sessionId);
  }

  unsubscribe(sessionId: string): void {
    this.sseClient.unsubscribe(sessionId);
    this.subscribedSessions.delete(sessionId);
  }

  setHandlers(handlers: WebSocketEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  getConnected(): boolean {
    return this.sseClient.getConnected();
  }

  getSubscribedSessions(): string[] {
    return Array.from(this.subscribedSessions);
  }
}

let _instance: WebSocketClient | null = null;

export function getWebSocketClient(serverUrl?: string): WebSocketClient {
  if (!_instance) {
    _instance = new WebSocketClient(serverUrl);
  }
  return _instance;
}
