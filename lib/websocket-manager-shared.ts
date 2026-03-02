/**
 * WebSocket Manager - 共享实例（用于 server.js 和 API 路由）
 * 这个文件确保 server.js 和 API 路由使用同一个 WebSocketManager 实例
 */

import { Server as SocketIOServer } from 'socket.io';
import { logger } from './logger';

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

// 全局单例（在 Node.js 进程中共享）
declare global {
  // eslint-disable-next-line no-var
  var __websocketManager: WebSocketManager | undefined;
}

export class WebSocketManager {
  private io: SocketIOServer | null = null;

  private constructor() {}

  static getInstance(): WebSocketManager {
    // 在开发环境中，使用全局变量避免热重载时创建新实例
    if (process.env.NODE_ENV === 'development') {
      if (!global.__websocketManager) {
        global.__websocketManager = new WebSocketManager();
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
   * 发送文件更新事件
   */
  emitFileUpdate(event: FileUpdateEvent): void {
    if (!this.io) {
      logger.warn('⚠️ WebSocket服务器未初始化，跳过文件更新通知');
      return;
    }

    const room = `session:${event.sessionId}`;
    this.io.to(room).emit('file_update', event);
    logger.info(`📤 发送文件更新事件到 ${room}: ${event.type} ${event.path}`);
  }

  /**
   * 批量发送文件更新事件
   */
  emitFileUpdates(events: FileUpdateEvent[]): void {
    if (!this.io) {
      logger.warn('⚠️ WebSocket服务器未初始化，跳过文件更新通知');
      return;
    }

    // 按sessionId分组
    const eventsBySession = new Map<string, FileUpdateEvent[]>();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId)!.push(event);
    }

    // 发送到对应的房间
    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const room = `session:${sessionId}`;
      this.io.to(room).emit('file_updates', sessionEvents);
      logger.info(`📤 批量发送 ${sessionEvents.length} 个文件更新事件到 ${room}`);
    }
  }

  /**
   * 发送工作流进度事件
   */
  emitWorkflowProgress(event: WorkflowProgressEvent): void {
    if (!this.io) {
      logger.warn('⚠️ WebSocket服务器未初始化，跳过进度通知');
      return;
    }

    const room = `session:${event.sessionId}`;
    this.io.to(room).emit('workflow_progress', event);
    logger.debug(`📊 发送工作流进度到 ${room}: [${event.state}] ${event.message} (${event.progress}%)`);
  }

  /**
   * 批量发送工作流进度事件
   */
  emitWorkflowProgresses(events: WorkflowProgressEvent[]): void {
    if (!this.io) {
      logger.warn('⚠️ WebSocket服务器未初始化，跳过进度通知');
      return;
    }

    // 按sessionId分组
    const eventsBySession = new Map<string, WorkflowProgressEvent[]>();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId)!.push(event);
    }

    // 发送到对应的房间
    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const room = `session:${sessionId}`;
      this.io.to(room).emit('workflow_progresses', sessionEvents);
      logger.info(`📊 批量发送 ${sessionEvents.length} 个进度事件到 ${room}`);
    }
  }
}
