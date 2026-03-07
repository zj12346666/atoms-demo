// Session 管理器 - 管理对话会话和项目生成任务（使用 PostgreSQL）

import { prisma, isDatabaseAvailable } from './db';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

// Session 数据结构
export interface Session {
  sessionId: string;
  projectId: string;
  projectName?: string;
  userId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'failed';
  conversationHistory: ConversationMessage[];
  generatedCode?: {
    html: string;
    css: string;
    js: string;
    description: string;
  };
  context?: {
    skeleton?: any;
    recentSymbols?: string[];
    userPreferences?: Record<string, any>;
  };
  metadata?: {
    totalMessages: number;
    totalGenerations: number;
    lastActivity: number;
  };
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  stage?: string; // Agent 阶段
  thinking?: string; // 思考过程
}

// 内存存储（降级方案，当 PostgreSQL 不可用时使用）
const memorySessions = new Map<string, Session>();

export class SessionManager {
  // 创建新会话
  async createSession(projectName?: string, userId?: string): Promise<Session> {
    const sessionId = uuidv4();
    const projectId = `project-${Date.now()}`;
    const now = Date.now();

    // 确保 userId 存在
    if (!userId) {
      userId = 'anonymous';
      logger.warn('⚠️ userId 未提供，使用默认值 "anonymous"');
    }

    const session: Session = {
      sessionId,
      projectId,
      projectName: projectName || 'Untitled Project',
      userId,
      createdAt: now,
      updatedAt: now,
      status: 'active',
      conversationHistory: [],
      metadata: {
        totalMessages: 0,
        totalGenerations: 0,
        lastActivity: now,
      },
    };

    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法创建 Session');
      throw new Error('Database not available. Cannot create session in PostgreSQL.');
    }

    // 保存到 PostgreSQL
    try {
      await (prisma as any).session.create({
        data: {
          sessionId,
          userId,
          projectId,
          projectName: session.projectName,
          status: session.status,
          metadata: JSON.stringify(session.metadata || {}),
          conversationHistory: JSON.stringify([]),
          generatedCode: null,
          context: null,
        },
      });
      logger.info(`✅ Session 创建成功 (PostgreSQL): ${sessionId} (${projectName}) for user ${userId}`);
    } catch (error: any) {
      logger.error('❌ PostgreSQL 保存失败:', error);
      throw new Error(`Failed to create session in PostgreSQL: ${error.message}`);
    }

    return session;
  }

  // 获取会话（直接从 PostgreSQL 读取，不使用降级方案）
  async getSession(sessionId: string): Promise<Session | null> {
    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法读取 Session');
      throw new Error('Database not available. Cannot read session from PostgreSQL.');
    }

    try {
      const dbSession = await (prisma as any).session.findUnique({
        where: { sessionId },
      });

      if (!dbSession) {
        logger.debug(`⚠️ Session 不存在: ${sessionId}`);
        return null;
      }

      // 从数据库构建 Session 对象
      const metadata = dbSession.metadata ? JSON.parse(dbSession.metadata) : {};
      const conversationHistory = dbSession.conversationHistory 
        ? JSON.parse(dbSession.conversationHistory) 
        : [];
      const generatedCode = dbSession.generatedCode 
        ? JSON.parse(dbSession.generatedCode) 
        : undefined;
      const context = dbSession.context 
        ? JSON.parse(dbSession.context) 
        : undefined;

      const session: Session = {
        sessionId: dbSession.sessionId,
        projectId: dbSession.projectId,
        projectName: dbSession.projectName || 'Untitled Project',
        userId: dbSession.userId || 'anonymous',
        createdAt: dbSession.createdAt.getTime(),
        updatedAt: dbSession.updatedAt.getTime(),
        status: dbSession.status as 'active' | 'completed' | 'failed',
        conversationHistory,
        generatedCode,
        context,
        metadata: {
          totalMessages: metadata.totalMessages || 0,
          totalGenerations: metadata.totalGenerations || 0,
          lastActivity: dbSession.updatedAt.getTime(),
        },
      };

      logger.debug(`✅ Session 从 PostgreSQL 读取: ${sessionId}`);
      return session;
    } catch (error: any) {
      logger.error(`❌ PostgreSQL 读取 Session 失败 (${sessionId}):`, error);
      throw new Error(`Failed to read session from PostgreSQL: ${error.message}`);
    }
  }

  // 更新会话
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const updatedSession: Session = {
      ...session,
      ...updates,
      updatedAt: Date.now(),
      metadata: {
        totalMessages: session.metadata?.totalMessages || 0,
        totalGenerations: session.metadata?.totalGenerations || 0,
        lastActivity: Date.now(),
        ...session.metadata,
        ...updates.metadata,
      },
    };

    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法更新 Session');
      throw new Error('Database not available. Cannot update session in PostgreSQL.');
    }

    // 更新 PostgreSQL
    try {
      const updateData: any = {
        projectName: updatedSession.projectName,
        status: updatedSession.status,
        metadata: JSON.stringify(updatedSession.metadata || {}),
        updatedAt: new Date(updatedSession.updatedAt),
      };

      // 如果更新了 conversationHistory，保存到数据库
      if (updates.conversationHistory !== undefined) {
        updateData.conversationHistory = JSON.stringify(updatedSession.conversationHistory || []);
      }

      // 如果更新了 generatedCode，保存到数据库
      if (updates.generatedCode !== undefined) {
        updateData.generatedCode = updatedSession.generatedCode 
          ? JSON.stringify(updatedSession.generatedCode) 
          : null;
      }

      // 如果更新了 context，保存到数据库
      if (updates.context !== undefined) {
        updateData.context = updatedSession.context 
          ? JSON.stringify(updatedSession.context) 
          : null;
      }

      await (prisma as any).session.update({
        where: { sessionId },
        data: updateData,
      });
      logger.debug(`✅ Session 已更新到 PostgreSQL: ${sessionId}`);
    } catch (error: any) {
      logger.error('❌ PostgreSQL 更新失败:', error);
      throw new Error(`Failed to update session in PostgreSQL: ${error.message}`);
    }
  }

  // 添加对话消息
  async addMessage(
    sessionId: string,
    message: Omit<ConversationMessage, 'id' | 'timestamp'>
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const newMessage: ConversationMessage = {
      id: uuidv4(),
      timestamp: Date.now(),
      ...message,
    };

    session.conversationHistory.push(newMessage);
    session.metadata!.totalMessages++;

    if (message.role === 'assistant' && message.stage === 'completed') {
      session.metadata!.totalGenerations++;
    }

    await this.updateSession(sessionId, {
      conversationHistory: session.conversationHistory,
      metadata: session.metadata,
    });
  }

  // 保存生成的代码
  async saveGeneratedCode(
    sessionId: string,
    code: {
      html: string;
      css: string;
      js: string;
      description: string;
    }
  ): Promise<void> {
    await this.updateSession(sessionId, {
      generatedCode: code,
      status: 'completed',
    });
    logger.info(`💾 Session ${sessionId} 代码已保存`);
  }

  // 保存上下文
  async saveContext(
    sessionId: string,
    context: {
      skeleton?: any;
      recentSymbols?: string[];
      userPreferences?: Record<string, any>;
    }
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) return;

    await this.updateSession(sessionId, {
      context: {
        ...session.context,
        ...context,
      },
    });
  }

  // 获取会话的对话历史
  async getConversationHistory(sessionId: string): Promise<ConversationMessage[]> {
    const session = await this.getSession(sessionId);
    return session?.conversationHistory || [];
  }

  // 标记会话状态
  async updateSessionStatus(
    sessionId: string,
    status: 'active' | 'completed' | 'failed'
  ): Promise<void> {
    await this.updateSession(sessionId, { status });
  }

  // 删除会话（直接从 PostgreSQL 删除）
  async deleteSession(sessionId: string): Promise<void> {
    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法删除 Session');
      throw new Error('Database not available. Cannot delete session from PostgreSQL.');
    }

    // 从数据库删除
    try {
      await (prisma as any).session.delete({
        where: { sessionId },
      });
      logger.info(`🗑️ Session 已从 PostgreSQL 删除: ${sessionId}`);
    } catch (error: any) {
      logger.error('❌ PostgreSQL 删除失败:', error);
      throw new Error(`Failed to delete session from PostgreSQL: ${error.message}`);
    }
  }

  // 列出所有活跃会话（直接从 PostgreSQL 读取）
  async listActiveSessions(limit: number = 10, userId?: string): Promise<Session[]> {
    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法列出 Session');
      throw new Error('Database not available. Cannot list sessions from PostgreSQL.');
    }

    const sessions: Session[] = [];

    // 从数据库读取
    try {
      const whereClause: any = {
        status: {
          in: ['active', 'completed'],
        },
      };
      
      // 如果提供了 userId，只查询该用户的 session
      if (userId) {
        whereClause.userId = userId;
      }

      const dbSessions = await (prisma as any).session.findMany({
          where: whereClause,
          orderBy: {
            updatedAt: 'desc',
          },
          take: limit,
        });

        for (const dbSession of dbSessions) {
          const metadata = dbSession.metadata ? JSON.parse(dbSession.metadata) : {};
          const conversationHistory = dbSession.conversationHistory 
            ? JSON.parse(dbSession.conversationHistory) 
            : [];
          const generatedCode = dbSession.generatedCode 
            ? JSON.parse(dbSession.generatedCode) 
            : undefined;

          const session: Session = {
            sessionId: dbSession.sessionId,
            projectId: dbSession.projectId,
            projectName: dbSession.projectName || 'Untitled Project',
            userId: dbSession.userId || 'anonymous',
            createdAt: dbSession.createdAt.getTime(),
            updatedAt: dbSession.updatedAt.getTime(),
            status: dbSession.status as 'active' | 'completed' | 'failed',
            conversationHistory,
            generatedCode,
            metadata: {
              totalMessages: metadata.totalMessages || 0,
              totalGenerations: metadata.totalGenerations || 0,
              lastActivity: dbSession.updatedAt.getTime(),
            },
          };

        sessions.push(session);
      }
    } catch (error: any) {
      logger.error('❌ PostgreSQL 读取失败:', error);
      throw new Error(`Failed to list sessions from PostgreSQL: ${error.message}`);
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // 验证 session 是否属于指定用户（直接从 PostgreSQL 验证）
  async verifySessionOwnership(sessionId: string, userId: string): Promise<boolean> {
    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.warn('⚠️ 数据库不可用，跳过 Session 所有权验证，允许访问');
      return true; // 数据库不可用时，允许访问（fail open）
    }

    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        // Session 不存在可能是新创建的，允许访问
        logger.warn(`⚠️ Session ${sessionId} 不存在，允许访问（可能是新创建的 session）`);
        return true;
      }
      
      if (!session.userId) {
        // 旧数据可能没有 userId，允许访问
        logger.warn(`⚠️ Session ${sessionId} 没有 userId 字段（旧数据），允许访问`);
        return true;
      }
      
      const isOwner = session.userId === userId;
      if (!isOwner) {
        logger.warn(`⚠️ Session ${sessionId} 的所有者 (${session.userId}) 与请求的 userId (${userId}) 不匹配`);
        return false; // 明确不匹配时才拒绝
      }
      
      return true;
    } catch (error: any) {
      // 数据库连接超时或其他临时错误时，允许访问（fail open）
      // 避免因数据库临时故障导致用户无法访问自己的文件
      logger.warn(`⚠️ 验证 session 所有权时数据库出错，允许访问: ${error.message}`);
      return true;
    }
  }
}
