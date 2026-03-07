/**
 * SSE 轮询 API 路由（替代长连接 SSE）
 *
 * 解决 Vercel Serverless 多实例问题：
 *   - 旧方案：客户端保持 EventSource 长连接 → Serverless 跨实例内存不共享
 *   - 新方案：客户端定时 GET 轮询，服务端从 PostgreSQL 读取新事件返回
 *
 * GET /api/events/[sessionId]?since=<lastEventId>
 *   - since: 上一次拿到的最大事件 id（初次传 0）
 *   - 返回: { events: [{ id, payload }], lastId: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getSSEEvents, cleanupSSEEvents } from '@/lib/sse-manager';

// 简单的清理计数器：每 200 次请求清理一次过期事件
let cleanupCounter = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
  }

  // 解析 since 参数（上次拿到的最大事件 id）
  const sinceParam = req.nextUrl.searchParams.get('since');
  const sinceId = sinceParam ? parseInt(sinceParam, 10) : 0;

  // 读取新事件
  const events = await getSSEEvents(sessionId, isNaN(sinceId) ? 0 : sinceId);

  const lastId = events.length > 0 ? events[events.length - 1].id : sinceId;

  logger.debug(`📡 [SSE轮询] session:${sessionId}, since:${sinceId}, 返回 ${events.length} 个事件`);

  // 低频清理过期事件
  cleanupCounter++;
  if (cleanupCounter >= 200) {
    cleanupCounter = 0;
    cleanupSSEEvents().catch(() => {});
  }

  return NextResponse.json(
    { events, lastId },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
