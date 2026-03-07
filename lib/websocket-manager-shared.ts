/**
 * WebSocket Manager - 共享实例（用于 server.js 和 API 路由）
 * 这个文件确保 server.js 和 API 路由使用同一个 WebSocketManager 实例
 * 
 * 支持两种模式：
 * 1. WebSocket (Socket.IO) - 本地开发/自托管
 * 2. SSE (Server-Sent Events) - Vercel 部署
 */

import { Server as SocketIOServer } from 'socket.io';
import { logger } from './logger';

// 动态导入 SSE 函数（避免循环依赖）
let sendSSEEvent: ((sessionId: string, event: any) => boolean) | null = null;

// 延迟加载 SSE 模块（仅在需要时）
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

// 版本号：每次修改 emit 逻辑时递增，强制热重载后重建实例
const MANAGER_VERSION = 'sse-only-v1';

// 全局单例（在 Node.js 进程中共享）
declare global {
  // eslint-disable-next-line no-var
  var __websocketManager: WebSocketManager | undefined;
  // eslint-disable-next-line no-var
  var __websocketManagerVersion: string | undefined;
}

export class WebSocketManager {
  private io: SocketIOServer | null = null;

  private constructor() {}

  static getInstance(): WebSocketManager {
    // 在开发环境中，使用全局变量避免热重载时创建新实例
    // 但若版本号不匹配（代码有改动），强制重建
    if (process.env.NODE_ENV === 'development') {
      if (!global.__websocketManager || global.__websocketManagerVersion !== MANAGER_VERSION) {
        global.__websocketManager = new WebSocketManager();
        global.__websocketManagerVersion = MANAGER_VERSION;
        logger.info(`🔄 WebSocketManager 实例已重建 (version: ${MANAGER_VERSION})`);
      }
      return global.__websocketManager;
    }
    
    // 生产环境使用模块级单例
    if (!(WebSocketManager as any).instance) {
      (WebSocketManager as any).instance = new WebSocketManager();
    }
    return (WebSocketManager as any).instance;
  }

  /**
   * 初始化WebSocket服务器
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
    
    io.on('connection', (socket) => {
      logger.info(`🔌 WebSocket客户端连接: ${socket.id}`);

      // 订阅session
      socket.on('subscribe', (sessionId: string) => {
        socket.join(`session:${sessionId}`);
        logger.info(`📡 客户端 ${socket.id} 订阅session: ${sessionId}`);
      });

      // 取消订阅
      socket.on('unsubscribe', (sessionId: string) => {
        socket.leave(`session:${sessionId}`);
        logger.info(`📡 客户端 ${socket.id} 取消订阅session: ${sessionId}`);
      });

      socket.on('disconnect', () => {
        logger.info(`🔌 WebSocket客户端断开: ${socket.id}`);
      });
    });

    logger.info('✅ WebSocket服务器已初始化');
  }

  /**
   * 设置 IO 实例（用于 API 路由）
   */
  setIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * 获取 IO 实例
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * 发送文件更新事件（强制 SSE 模式）
   */
  async emitFileUpdate(event: FileUpdateEvent): Promise<void> {
    const sseSender = await getSSESender();
    if (sseSender) {
      const sent = sseSender(event.sessionId, { ...event, type: 'file_update' });
      if (sent) {
        logger.info(`📤 [SSE] 发送文件更新到 session:${event.sessionId}: ${event.type} ${event.path}`);
        return;
      }
    }
    logger.warn(`⚠️ [SSE] 无活跃连接 (session:${event.sessionId})，跳过文件更新通知`);
  }

  /**
   * 批量发送文件更新事件（强制 SSE 模式）
   */
  async emitFileUpdates(events: FileUpdateEvent[]): Promise<void> {
    const sseSender = await getSSESender();
    if (!sseSender) {
      logger.warn('⚠️ [SSE] 无法加载 SSE 模块，跳过文件更新通知');
      return;
    }

    // 按 sessionId 分组
    const eventsBySession = new Map<string, FileUpdateEvent[]>();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId)!.push(event);
    }

    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const sent = sseSender(sessionId, { type: 'file_updates', events: sessionEvents });
      if (sent) {
        logger.info(`📤 [SSE] 批量发送 ${sessionEvents.length} 个文件更新到 session:${sessionId}`);
      } else {
        logger.warn(`⚠️ [SSE] 无活跃连接 (session:${sessionId})，跳过批量文件更新`);
      }
    }
  }

  /**
   * 发送工作流进度事件（强制 SSE 模式）
   */
  async emitWorkflowProgress(event: WorkflowProgressEvent): Promise<void> {
    const sseSender = await getSSESender();
    if (sseSender) {
      const sent = sseSender(event.sessionId, { ...event, type: 'workflow_progress' });
      if (sent) {
        logger.info(`📊 [SSE] → session:${event.sessionId}: [${event.state}] ${event.message} (${event.progress}%)`);
        return;
      }
    }
    logger.warn(`⚠️ [SSE] 无活跃连接 (session:${event.sessionId})，跳过进度通知`);
  }

  /**
   * 批量发送工作流进度事件（强制 SSE 模式）
   */
  async emitWorkflowProgresses(events: WorkflowProgressEvent[]): Promise<void> {
    const sseSender = await getSSESender();
    if (!sseSender) {
      logger.warn('⚠️ [SSE] 无法加载 SSE 模块，跳过进度通知');
      return;
    }

    // 按 sessionId 分组
    const eventsBySession = new Map<string, WorkflowProgressEvent[]>();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId)!.push(event);
    }

    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const sent = sseSender(sessionId, { type: 'workflow_progresses', events: sessionEvents });
      if (sent) {
        logger.info(`📊 [SSE] 批量发送 ${sessionEvents.length} 个进度事件到 session:${sessionId}`);
      } else {
        logger.warn(`⚠️ [SSE] 无活跃连接 (session:${sessionId})，跳过批量进度通知`);
      }
    }
  }
}
