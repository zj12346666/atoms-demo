/**
 * SSE Manager - 管理 Server-Sent Events 连接
 * 用于 Vercel 环境下的实时推送
 */

import { logger } from './logger';

// ✅ 使用 global 存储活跃连接，防止 Next.js HMR 模块重载导致不同 API 路由
// 拿到不同模块实例（/api/events 注册连接，/api/vip-agent 发送时找不到连接的问题）
declare global {
  // eslint-disable-next-line no-var
  var __sseActiveConnections: Map<string, ReadableStreamDefaultController[]> | undefined;
}

if (!global.__sseActiveConnections) {
  global.__sseActiveConnections = new Map<string, ReadableStreamDefaultController[]>();
}

// 始终引用 global 上的同一个 Map
const activeConnections = global.__sseActiveConnections;

/**
 * 注册 SSE 连接
 */
export function registerSSEConnection(sessionId: string, controller: ReadableStreamDefaultController): void {
  if (!activeConnections.has(sessionId)) {
    activeConnections.set(sessionId, []);
  }
  activeConnections.get(sessionId)!.push(controller);
  logger.info(`📡 注册 SSE 连接: sessionId=${sessionId}, 总连接数=${activeConnections.get(sessionId)!.length}`);
}

/**
 * 取消注册 SSE 连接
 */
export function unregisterSSEConnection(sessionId: string, controller: ReadableStreamDefaultController): void {
  const controllers = activeConnections.get(sessionId);
  if (controllers) {
    const index = controllers.indexOf(controller);
    if (index > -1) {
      controllers.splice(index, 1);
      logger.info(`📡 取消注册 SSE 连接: sessionId=${sessionId}, 剩余连接数=${controllers.length}`);
    }
    if (controllers.length === 0) {
      activeConnections.delete(sessionId);
    }
  }
}

/**
 * 向指定 session 的所有连接发送事件
 */
export function sendSSEEvent(sessionId: string, event: any): boolean {
  const controllers = activeConnections.get(sessionId);
  if (!controllers || controllers.length === 0) {
    return false;
  }

  const encoder = new TextEncoder();
  const data = `data: ${JSON.stringify(event)}\n\n`;

  // 向所有连接发送
  const validControllers: ReadableStreamDefaultController[] = [];
  controllers.forEach((controller) => {
    try {
      controller.enqueue(encoder.encode(data));
      validControllers.push(controller);
    } catch (error) {
      // 连接已关闭，跳过
      logger.debug(`⚠️ SSE 连接发送失败，跳过: sessionId=${sessionId}`);
    }
  });

  // 更新有效连接
  if (validControllers.length !== controllers.length) {
    activeConnections.set(sessionId, validControllers);
    if (validControllers.length === 0) {
      activeConnections.delete(sessionId);
    }
  }

  return validControllers.length > 0;
}

/**
 * 获取活跃连接数
 */
export function getActiveConnectionsCount(sessionId?: string): number {
  if (sessionId) {
    return activeConnections.get(sessionId)?.length || 0;
  }
  return Array.from(activeConnections.values()).reduce((sum, controllers) => sum + controllers.length, 0);
}
