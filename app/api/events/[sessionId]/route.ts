/**
 * Server-Sent Events (SSE) API 路由
 * 用于 Vercel 环境下的实时进度推送（替代 WebSocket）
 */

import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { registerSSEConnection, unregisterSSEConnection } from '@/lib/sse-manager';

/**
 * GET /api/events/[sessionId]
 * 建立 SSE 连接，用于接收实时进度更新
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return new Response('Session ID is required', { status: 400 });
  }

  logger.info(`📡 新的 SSE 连接: sessionId=${sessionId}`);

  // 创建 SSE 流
  const stream = new ReadableStream({
    start(controller) {
      // 发送初始连接消息
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`));

      // 注册连接
      registerSSEConnection(sessionId, controller);

      // 处理客户端断开连接
      req.signal.addEventListener('abort', () => {
        logger.info(`📡 SSE 连接断开: sessionId=${sessionId}`);
        unregisterSSEConnection(sessionId, controller);
        try {
          controller.close();
        } catch (e) {
          // 连接可能已经关闭
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
    },
  });
}
