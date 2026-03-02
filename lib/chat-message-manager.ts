// 聊天记录管理器 - 管理用户和AI的聊天记录

import { prisma, isDatabaseAvailable } from './db';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

// AI 的固定 ID
export const AI_USER_ID = 'reshuffle-ai';

export interface ChatMessage {
  id: string;
  sessionId: string;
  userId: string; // 用户ID 或 AI_USER_ID
  context: string; // 消息内容
  createdAt: Date;
}

export class ChatMessageManager {
  // 保存聊天消息
  async saveMessage(
    sessionId: string,
    userId: string,
    context: string
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: uuidv4(),
      sessionId,
      userId,
      context,
      createdAt: new Date(),
    };

    if (isDatabaseAvailable() && prisma) {
      try {
        const created = await (prisma as any).chatMessage.create({
          data: {
            id: message.id,
            sessionId: message.sessionId,
            userId: message.userId,
            context: message.context,
            createdAt: message.createdAt,
          },
        });
        logger.debug(`💬 聊天消息已保存: ${sessionId} (${userId})`);
        return {
          id: created.id,
          sessionId: created.sessionId,
          userId: created.userId,
          context: created.context,
          createdAt: created.createdAt,
        };
      } catch (error) {
        logger.error('❌ 保存聊天消息失败:', error);
        throw error;
      }
    } else {
      logger.warn('⚠️ 数据库不可用，聊天消息未保存');
      return message;
    }
  }

  // 保存用户消息
  async saveUserMessage(sessionId: string, userId: string, context: string): Promise<ChatMessage> {
    return this.saveMessage(sessionId, userId, context);
  }

  // 保存AI消息
  async saveAIMessage(sessionId: string, context: string): Promise<ChatMessage> {
    return this.saveMessage(sessionId, AI_USER_ID, context);
  }

  // 获取会话的所有聊天记录（按时间排序）
  async getMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    if (!isDatabaseAvailable() || !prisma) {
      logger.warn('⚠️ 数据库不可用，无法获取聊天记录');
      return [];
    }

    try {
      const messages = await (prisma as any).chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }, // 按创建时间升序排序
      });

      return messages.map((m: any) => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        context: m.context,
        createdAt: m.createdAt,
      }));
    } catch (error) {
      logger.error('❌ 获取聊天记录失败:', error);
      return [];
    }
  }

  // 获取用户的所有聊天记录（按时间排序）
  async getMessagesByUser(userId: string, limit?: number): Promise<ChatMessage[]> {
    if (!isDatabaseAvailable() || !prisma) {
      logger.warn('⚠️ 数据库不可用，无法获取聊天记录');
      return [];
    }

    try {
      const messages = await (prisma as any).chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }, // 按创建时间降序排序（最新的在前）
        take: limit,
      });

      return messages.map((m: any) => ({
        id: m.id,
        sessionId: m.sessionId,
        userId: m.userId,
        context: m.context,
        createdAt: m.createdAt,
      }));
    } catch (error) {
      logger.error('❌ 获取用户聊天记录失败:', error);
      return [];
    }
  }

  // 获取会话中用户和AI的对话（按时间排序）
  async getConversation(sessionId: string): Promise<ChatMessage[]> {
    return this.getMessagesBySession(sessionId);
  }

  // 删除会话的所有聊天记录
  async deleteMessagesBySession(sessionId: string): Promise<void> {
    if (!isDatabaseAvailable() || !prisma) {
      return;
    }

    try {
      await (prisma as any).chatMessage.deleteMany({
        where: { sessionId },
      });
      logger.info(`🗑️ 已删除会话 ${sessionId} 的所有聊天记录`);
    } catch (error) {
      logger.error('❌ 删除聊天记录失败:', error);
    }
  }
}
