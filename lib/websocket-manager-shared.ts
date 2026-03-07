/**
 * SSE Event Manager - 统一通过 PostgreSQL SSE 表推送事件
 * 替代原来的 WebSocketManager（已移除 Socket.IO 依赖）
 */

import { logger } from './logger';

// 动态导入 SSE 函数（避免循环依赖）
let sendSSEEvent: ((sessionId: string, event: any) => Promise<boolean>) | null = null;

async function getSSESender() {
  if (!sendSSEEvent) {
    try {
      const sseModule = await import('./sse-manager');
      sendSSEEvent = sseModule.sendSSEEvent;
    } catch (error) {
      logger.warn('⚠️ 无法加载 SSE 模块:', error);
      return null;
    }
  }
  return sendSSEEvent;
}

export interface FileUpdateEvent {
  type: 'FILE_UPDATED' | 'FILE_CREATED' | 'FILE_DELETED';
  sessionId: string;
  path: string;
  content?: string;
}

export interface WorkflowProgressEvent {
  type: 'WORKFLOW_PROGRESS';
  sessionId: string;
  state: string;
  message: string;
  progress: number;
  details?: string;
}

const MANAGER_VERSION = 'sse-only-v2';

declare global {
  // eslint-disable-next-line no-var
  var __sseEventManager: WebSocketManager | undefined;
  // eslint-disable-next-line no-var
  var __sseEventManagerVersion: string | undefined;
}

export class WebSocketManager {
  private constructor() {}

  static getInstance(): WebSocketManager {
    if (process.env.NODE_ENV === 'development') {
      if (!global.__sseEventManager || global.__sseEventManagerVersion !== MANAGER_VERSION) {
        global.__sseEventManager = new WebSocketManager();
        global.__sseEventManagerVersion = MANAGER_VERSION;
      }
      return global.__sseEventManager;
    }
    if (!(WebSocketManager as any)._instance) {
      (WebSocketManager as any)._instance = new WebSocketManager();
    }
    return (WebSocketManager as any)._instance;
  }

  /** 发送单个文件更新事件 */
  async emitFileUpdate(event: FileUpdateEvent): Promise<void> {
    const sseSender = await getSSESender();
    if (!sseSender) return;
    const sent = await sseSender(event.sessionId, { ...event, type: 'file_update' });
    if (sent) {
      logger.info(`📤 [SSE] 文件更新 (session:${event.sessionId}): ${event.type} ${event.path}`);
    }
  }

  /** 批量发送文件更新事件 */
  async emitFileUpdates(events: FileUpdateEvent[]): Promise<void> {
    const sseSender = await getSSESender();
    if (!sseSender) return;

    const bySession = new Map<string, FileUpdateEvent[]>();
    for (const e of events) {
      if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
      bySession.get(e.sessionId)!.push(e);
    }
    for (const [sessionId, evts] of bySession) {
      const sent = await sseSender(sessionId, { type: 'file_updates', events: evts });
      if (sent) logger.info(`📤 [SSE] 批量文件更新 ${evts.length} 个 (session:${sessionId})`);
    }
  }

  /** 发送工作流进度事件 */
  async emitWorkflowProgress(event: WorkflowProgressEvent): Promise<void> {
    const sseSender = await getSSESender();
    if (!sseSender) return;
    const sent = await sseSender(event.sessionId, { ...event, type: 'workflow_progress' });
    if (sent) {
      logger.info(`📊 [SSE] 进度 (session:${event.sessionId}): [${event.state}] ${event.message} (${event.progress}%)`);
    }
  }
}
