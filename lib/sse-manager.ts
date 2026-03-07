/**
 * SSE Manager - 基于 PostgreSQL 的事件存储
 *
 * 解决 Vercel Serverless 多实例隔离问题：
 *   旧方案：事件写入内存 global.__sseActiveConnections → 跨实例不可见
 *   新方案：事件写入 PostgreSQL sse_events 表 → 所有实例共享同一数据库
 *
 * 事件流程：
 *   写端（/api/vip-agent 等）   → sendSSEEvent() → INSERT INTO sse_events
 *   读端（/api/events 轮询）    → getSSEEvents()  → SELECT FROM sse_events WHERE id > lastId
 *   清理                        → cleanupSSEEvents() → DELETE WHERE createdAt < now - 30min
 */

import { logger } from './logger';
import { prisma } from './db';

/**
 * 写入 SSE 事件到 PostgreSQL
 */
export async function sendSSEEvent(sessionId: string, event: any): Promise<boolean> {
  if (!prisma) {
    logger.warn(`⚠️ [SSE] 数据库不可用，无法写入事件 (session:${sessionId})`);
    return false;
  }
  try {
    await (prisma as any).sseEvent.create({
      data: {
        sessionId,
        payload: JSON.stringify(event),
      },
    });
    logger.debug(`📤 [SSE] 写入事件到 DB (session:${sessionId}): ${event.type}`);
    return true;
  } catch (error: any) {
    logger.error(`❌ [SSE] 写入事件失败 (session:${sessionId}):`, error.message);
    return false;
  }
}

/**
 * 从 PostgreSQL 拉取指定 session 的新事件（since 为上次获取到的最大 id）
 */
export async function getSSEEvents(
  sessionId: string,
  sinceId: number
): Promise<{ id: number; payload: string }[]> {
  if (!prisma) return [];
  try {
    const events = await (prisma as any).sseEvent.findMany({
      where: {
        sessionId,
        id: { gt: sinceId },
      },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, payload: true },
    });
    return events;
  } catch (error: any) {
    logger.error(`❌ [SSE] 读取事件失败 (session:${sessionId}):`, error.message);
    return [];
  }
}

/**
 * 清理过期事件（超过 30 分钟的记录）
 * 在每次轮询时顺带触发（低频，避免每次都清理）
 */
export async function cleanupSSEEvents(): Promise<void> {
  if (!prisma) return;
  try {
    const expireTime = new Date(Date.now() - 30 * 60 * 1000);
    await (prisma as any).sseEvent.deleteMany({
      where: { createdAt: { lt: expireTime } },
    });
  } catch {
    // 清理失败不影响主流程
  }
}
