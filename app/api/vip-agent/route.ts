/**
 * VIP Code Agent API
 * 集成WorkflowManager的核心工作流
 */

import { NextRequest, NextResponse } from 'next/server';
import { VIPWorkflowManager, WorkflowProgress } from '@/lib/vip-workflow-manager';
import { SessionManager } from '@/lib/session-manager';
import { WebSocketManager } from '@/lib/websocket-manager-shared';
import { logger } from '@/lib/logger';
import { ensureConnection, isDatabaseAvailable } from '@/lib/db';

const sessionManager = new SessionManager();
const wsManager = WebSocketManager.getInstance();
// 注意：不再注入 Socket.IO，统一使用 SSE 模式推送进度

export async function POST(req: NextRequest) {
  try {
    // 检查数据库连接状态
    const dbAvailable = isDatabaseAvailable();
    if (!dbAvailable) {
      logger.warn('⚠️ 数据库不可用，但继续执行（将使用降级模式）');
    }

    const { prompt, images, sessionId, userId, requestId } = await req.json();

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
    logger.info('📡 Request ID (SSE channel):', requestId || '未提供');

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

    // 初始化VIPWorkflowManager（API key 从环境变量读取，回退到默认值）
    const zhipuApiKey = process.env.ZHIPUAI_API_KEY || 'c7e235af6a364f07bdc5affc2c95e77c.tBJn3fOeeETiGBH0';
    const zhipuBaseURL = process.env.ZHIPUAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
    const workflow = new VIPWorkflowManager(zhipuApiKey, zhipuBaseURL);

    // 收集进度信息
    const progressLog: WorkflowProgress[] = [];

    // 注入项目上下文到 Prompt（自动注入 package.json 和 tsconfig.json）
    const { agentPromptInjector } = await import('@/lib/agent-prompt-injector');
    let enhancedPrompt = await agentPromptInjector.enhancePrompt(actualSessionId, prompt);

    // 如果用户附带了图片，将图片数量说明追加到 prompt 中，供 AI 参考
    if (images && Array.isArray(images) && images.length > 0) {
      enhancedPrompt = `${enhancedPrompt}\n\n[用户附带了 ${images.length} 张参考图片，请根据图片内容生成对应的 UI/功能]`;
      logger.info(`🖼️ 用户附带 ${images.length} 张图片`);
    }

    // SSE 推送频道：优先使用 requestId（客户端提前订阅的频道），否则用 actualSessionId
    const sseChannelId = requestId || actualSessionId;
    logger.info(`📡 SSE 进度推送频道: ${sseChannelId}`);

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
        
        // 实时推送进度到 SSE 频道（用 requestId 保证客户端能收到）
        const emitPromise = wsManager.emitWorkflowProgress({
          type: 'WORKFLOW_PROGRESS',
          sessionId: sseChannelId,  // ← 推到 requestId 频道
          state: progress.state,
          message: progress.message,
          progress: progress.progress,
          details: progress.details,
        });
        if (emitPromise && typeof emitPromise.catch === 'function') {
          emitPromise.catch(err => logger.warn('Failed to emit workflow progress:', err));
        }
      }
    );

    // 发送WebSocket通知
    if (result.success && result.fileChanges.length > 0) {
      const events = result.fileChanges.map(fc => ({
        type: fc.action === 'CREATE' ? 'FILE_CREATED' as const :
              fc.action === 'DELETE' ? 'FILE_DELETED' as const :
              'FILE_UPDATED' as const,
        sessionId: sseChannelId,  // ← 同样推到 requestId 频道
        path: fc.path,
        content: fc.action !== 'DELETE' ? fc.code : undefined,
      }));

      const emitPromise = wsManager.emitFileUpdates(events);
      if (emitPromise && typeof emitPromise.catch === 'function') {
        emitPromise.catch(err => logger.warn('Failed to emit file updates:', err));
      }
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
