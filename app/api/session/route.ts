// Session 管理 API

import { NextRequest, NextResponse } from 'next/server';
import { SessionManager } from '@/lib/session-manager';
import { logger } from '@/lib/logger';

const sessionManager = new SessionManager();

// POST /api/session - 创建新会话
export async function POST(req: NextRequest) {
  try {
    const { projectName, userId } = await req.json();
    
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }
    
    const session = await sessionManager.createSession(projectName, userId);
    
    return NextResponse.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        projectId: session.projectId,
        projectName: session.projectName,
        createdAt: session.createdAt,
      },
    });
  } catch (error: any) {
    logger.error('❌ Create session error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET /api/session?sessionId=xxx&userId=xxx - 获取会话信息
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');
    
    if (!sessionId) {
      // 返回当前用户的所有活跃会话
      if (!userId) {
        return NextResponse.json(
          { success: false, error: 'userId is required when listing sessions' },
          { status: 400 }
        );
      }
      const sessions = await sessionManager.listActiveSessions(20, userId);
      return NextResponse.json({
        success: true,
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          projectId: s.projectId,
          projectName: s.projectName,
          status: s.status,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.metadata?.totalMessages || 0,
        })),
      });
    }
    
    const session = await sessionManager.getSession(sessionId);
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // 验证 userId 和 session 的所有权
    if (userId && session.userId) {
      // 只有在 session 有 userId 且不匹配时才拒绝
      if (session.userId !== userId) {
        logger.warn(`⚠️ 用户 ${userId} 尝试访问不属于自己的 session ${sessionId} (实际所有者: ${session.userId})`);
        return NextResponse.json(
          { success: false, error: 'Access denied: Session does not belong to this user' },
          { status: 403 }
        );
      }
    } else if (userId && !session.userId) {
      // Session 没有 userId（旧数据），允许访问
      logger.warn(`⚠️ Session ${sessionId} 没有 userId 字段（旧数据），允许访问`);
    }
    
    return NextResponse.json({
      success: true,
      session: {
        sessionId: session.sessionId,
        projectId: session.projectId,
        projectName: session.projectName,
        userId: session.userId, // 返回 userId
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        conversationHistory: session.conversationHistory,
        generatedCode: session.generatedCode,
        metadata: session.metadata,
      },
    });
  } catch (error: any) {
    logger.error('❌ Get session error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/session?sessionId=xxx - 删除会话
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      );
    }
    
    await sessionManager.deleteSession(sessionId);
    
    return NextResponse.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error: any) {
    logger.error('❌ Delete session error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
