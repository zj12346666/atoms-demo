// 聊天记录 API

import { NextRequest, NextResponse } from 'next/server';
import { ChatMessageManager } from '@/lib/chat-message-manager';
import { SessionManager } from '@/lib/session-manager';
import { logger } from '@/lib/logger';

const chatMessageManager = new ChatMessageManager();
const sessionManager = new SessionManager();

// GET /api/chat?sessionId=xxx&userId=xxx - 获取聊天记录
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      );
    }

    // 验证 userId 和 session 的所有权
    if (userId) {
      const isOwner = await sessionManager.verifySessionOwnership(sessionId, userId);
      if (!isOwner) {
        logger.warn(`⚠️ 用户 ${userId} 尝试访问不属于自己的聊天记录 ${sessionId}`);
        return NextResponse.json(
          { success: false, error: 'Access denied: Session does not belong to this user' },
          { status: 403 }
        );
      }
    } else {
      logger.warn('⚠️ userId 未提供，跳过所有权验证（仅用于开发调试）');
    }

    // 获取聊天记录（按时间排序）
    const messages = await chatMessageManager.getConversation(sessionId);

    return NextResponse.json({
      success: true,
      messages: messages.map(m => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        context: m.context,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    logger.error('❌ Get chat messages error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/chat - 保存聊天消息（用于手动保存，通常由 generate API 自动保存）
export async function POST(req: NextRequest) {
  try {
    const { sessionId, userId, context, isAI } = await req.json();

    if (!sessionId || !context) {
      return NextResponse.json(
        { success: false, error: 'sessionId and context are required' },
        { status: 400 }
      );
    }

    // 验证 userId 和 session 的所有权（仅对用户消息验证）
    if (!isAI && userId) {
      const isOwner = await sessionManager.verifySessionOwnership(sessionId, userId);
      if (!isOwner) {
        logger.warn(`⚠️ 用户 ${userId} 尝试保存不属于自己的聊天消息 ${sessionId}`);
        return NextResponse.json(
          { success: false, error: 'Access denied: Session does not belong to this user' },
          { status: 403 }
        );
      }
    }

    // 保存消息
    const message = isAI
      ? await chatMessageManager.saveAIMessage(sessionId, context)
      : await chatMessageManager.saveUserMessage(sessionId, userId || 'anonymous', context);

    return NextResponse.json({
      success: true,
      message: {
        id: message.id,
        sessionId: message.sessionId,
        userId: message.userId,
        context: message.context,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error('❌ Save chat message error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
