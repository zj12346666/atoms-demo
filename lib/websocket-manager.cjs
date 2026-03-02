/**
 * WebSocket Manager - CommonJS 版本（用于 server.js）
 * 实时同步文件更新到前端
 */

// 简单的 logger（如果 logger.ts 不可用）
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.debug('[DEBUG]', ...args),
};

// 尝试加载 logger（如果可用）
try {
  const loggerModule = require('./logger');
  if (loggerModule && loggerModule.logger) {
    Object.assign(logger, loggerModule.logger);
  }
} catch (e) {
  // 使用默认 logger
}

class WebSocketManager {
  constructor() {
    this.io = null;
  }

  static getInstance() {
    // 在开发环境中，使用全局变量避免热重载时创建新实例
    if (process.env.NODE_ENV === 'development') {
      if (!global.__websocketManager) {
        global.__websocketManager = new WebSocketManager();
      }
      return global.__websocketManager;
    }
    
    // 生产环境使用模块级单例
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * 初始化WebSocket服务器
   */
  initialize(io) {
    this.io = io;
    
    io.on('connection', (socket) => {
      console.log(`🔌 WebSocket客户端连接: ${socket.id}`);

      // 订阅session
      socket.on('subscribe', (sessionId) => {
        socket.join(`session:${sessionId}`);
        console.log(`📡 客户端 ${socket.id} 订阅session: ${sessionId}`);
      });

      // 取消订阅
      socket.on('unsubscribe', (sessionId) => {
        socket.leave(`session:${sessionId}`);
        console.log(`📡 客户端 ${socket.id} 取消订阅session: ${sessionId}`);
      });

      socket.on('disconnect', () => {
        console.log(`🔌 WebSocket客户端断开: ${socket.id}`);
      });
    });

    console.log('✅ WebSocket服务器已初始化');
  }

  /**
   * 发送文件更新事件
   */
  emitFileUpdate(event) {
    if (!this.io) {
      console.warn('⚠️ WebSocket服务器未初始化，跳过文件更新通知');
      return;
    }

    const room = `session:${event.sessionId}`;
    this.io.to(room).emit('file_update', event);
    console.log(`📤 发送文件更新事件到 ${room}: ${event.type} ${event.path}`);
  }

  /**
   * 批量发送文件更新事件
   */
  emitFileUpdates(events) {
    if (!this.io) {
      console.warn('⚠️ WebSocket服务器未初始化，跳过文件更新通知');
      return;
    }

    // 按sessionId分组
    const eventsBySession = new Map();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId).push(event);
    }

    // 发送到对应的房间
    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const room = `session:${sessionId}`;
      this.io.to(room).emit('file_updates', sessionEvents);
      console.log(`📤 批量发送 ${sessionEvents.length} 个文件更新事件到 ${room}`);
    }
  }

  /**
   * 发送工作流进度事件
   */
  emitWorkflowProgress(event) {
    if (!this.io) {
      console.warn('⚠️ WebSocket服务器未初始化，跳过进度通知');
      return;
    }

    const room = `session:${event.sessionId}`;
    this.io.to(room).emit('workflow_progress', event);
    console.log(`📊 发送工作流进度到 ${room}: [${event.state}] ${event.message} (${event.progress}%)`);
  }

  /**
   * 批量发送工作流进度事件
   */
  emitWorkflowProgresses(events) {
    if (!this.io) {
      console.warn('⚠️ WebSocket服务器未初始化，跳过进度通知');
      return;
    }

    // 按sessionId分组
    const eventsBySession = new Map();
    for (const event of events) {
      if (!eventsBySession.has(event.sessionId)) {
        eventsBySession.set(event.sessionId, []);
      }
      eventsBySession.get(event.sessionId).push(event);
    }

    // 发送到对应的房间
    for (const [sessionId, sessionEvents] of eventsBySession.entries()) {
      const room = `session:${sessionId}`;
      this.io.to(room).emit('workflow_progresses', sessionEvents);
      console.log(`📊 批量发送 ${sessionEvents.length} 个进度事件到 ${room}`);
    }
  }
}

// 设置全局变量（用于开发环境热重载）
if (typeof global !== 'undefined' && process.env.NODE_ENV === 'development') {
  global.__websocketManager = null;
}

WebSocketManager.instance = null;

module.exports = { WebSocketManager };
