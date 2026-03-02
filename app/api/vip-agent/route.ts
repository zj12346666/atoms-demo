/**
 * VIP Code Agent API
 * 集成WorkflowManager的核心工作流
 */

import { NextRequest, NextResponse } from 'next/server';
import { VIPWorkflowManager, WorkflowProgress } from '@/lib/vip-workflow-manager';
import { SessionManager } from '@/lib/session-manager';
import { WebSocketManager } from '@/lib/websocket-manager';
import { logger } from '@/lib/logger';
import { ensureConnection, isDatabaseAvailable } from '@/lib/db';
import { Server as SocketIOServer } from 'socket.io';

const sessionManager = new SessionManager();
const wsManager = WebSocketManager.getInstance();

// 尝试从全局获取 Socket.IO 实例（由 server.js 设置）
if (typeof global !== 'undefined' && (global as any).__socketIO) {
  const socketIO = (global as any).__socketIO;
  // 直接调用 setIO 方法（如果存在）
  if (wsManager && typeof (wsManager as any).setIO === 'function') {
    (wsManager as any).setIO(socketIO);
    logger.info('✅ WebSocketManager 已连接到 Socket.IO 服务器');
  } else {
    logger.warn('⚠️ WebSocketManager.setIO 方法不可用');
  }
}

export async function POST(req: NextRequest) {
  try {
    // 检查数据库连接状态
    const dbAvailable = isDatabaseAvailable();
    if (!dbAvailable) {
      logger.warn('⚠️ 数据库不可用，但继续执行（将使用降级模式）');
    }

    const { prompt, sessionId, userId } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    logger.info('🚀 VIP Code Agent 开始工作流...');
    logger.info('📝 用户输入:', prompt);
    logger.info('🔑 Session ID:', sessionId || '未提供');

    // 确保数据库连接
    await ensureConnection();

    // 获取或创建会话
    let session = sessionId ? await sessionManager.getSession(sessionId) : null;
    let actualSessionId = sessionId;

    if (!session) {
      if (sessionId) {
        logger.warn(`⚠️ Session ${sessionId} 不存在，将创建新 Session`);
      }
      session = await sessionManager.createSession(prompt.substring(0, 50), userId);
      actualSessionId = session.sessionId;
      logger.info(`✅ 新 Session 创建成功: ${actualSessionId}`);
    }

    // 添加用户消息
    await sessionManager.addMessage(actualSessionId, {
      role: 'user',
      content: prompt,
    });

    // 初始化VIPWorkflowManager
    const workflow = new VIPWorkflowManager(
      'c7e235af6a364f07bdc5affc2c95e77c.tBJn3fOeeETiGBH0',
      'https://open.bigmodel.cn/api/paas/v4'
    );

    // 收集进度信息
    const progressLog: WorkflowProgress[] = [];

    // 注入项目上下文到 Prompt（自动注入 package.json 和 tsconfig.json）
    const { agentPromptInjector } = await import('@/lib/agent-prompt-injector');
    const enhancedPrompt = await agentPromptInjector.enhancePrompt(actualSessionId, prompt);

    // 执行工作流（实时推送进度到WebSocket）
    const result = await workflow.execute(
      enhancedPrompt,
      actualSessionId,
      session.projectId,
      (progress) => {
        progressLog.push(progress);
        logger.info(`[${progress.state}] ${progress.message}`);
        if (progress.details) {
          logger.info(`💭 ${progress.details}`);
        }
        
        // 实时推送进度到WebSocket
        wsManager.emitWorkflowProgress({
          type: 'WORKFLOW_PROGRESS',
          sessionId: actualSessionId,
          state: progress.state,
          message: progress.message,
          progress: progress.progress,
          details: progress.details,
        });
      }
    );

    // 发送WebSocket通知
    if (result.success && result.fileChanges.length > 0) {
      const events = result.fileChanges.map(fc => ({
        type: fc.action === 'CREATE' ? 'FILE_CREATED' as const :
              fc.action === 'DELETE' ? 'FILE_DELETED' as const :
              'FILE_UPDATED' as const,
        sessionId: actualSessionId,
        path: fc.path,
        content: fc.action !== 'DELETE' ? fc.code : undefined,
      }));

      wsManager.emitFileUpdates(events);
    }

    // 添加AI响应
    const planInfo = result.plan ? `\n\n**实现方案：**\n${result.plan}` : '';
    const fileSummary = result.fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n');
    const validationInfo = result.validationAttempts 
      ? `\n\n**验证：** ${result.validationAttempts} 次尝试后通过`
      : '';
    const errorInfo = result.errors && result.errors.length > 0
      ? `\n\n**错误：** ${result.errors.slice(0, 3).join('; ')}`
      : '';

    const aiResponse = `✅ VIP Code Agent 完成！${planInfo}\n\n**文件变更**（共 ${result.fileChanges.length} 个）：\n${fileSummary}${validationInfo}${errorInfo}`;

    await sessionManager.addMessage(actualSessionId, {
      role: 'assistant',
      content: aiResponse,
      stage: result.success ? 'completed' : 'failed',
    });

    // 返回结果
    return NextResponse.json({
      success: result.success,
      plan: result.plan,
      fileChanges: result.fileChanges,
      validation: {
        success: result.success,
        attempts: result.validationAttempts || 0,
        errors: result.errors || [],
        warnings: result.warnings || [],
      },
      sessionId: actualSessionId,
      projectId: session.projectId,
      progress: progressLog,
    });

  } catch (error: any) {
    logger.error('❌ VIP Agent error:', error);
    logger.error('错误堆栈:', error.stack);
    
    // 确保返回 JSON 格式的错误响应
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'VIP Agent execution failed',
        details: error.toString(),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}
