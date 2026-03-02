/**
 * WebContainer 错误反馈 API
 * 接收前端捕获的错误，自动触发 Agent 修复流程
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { VIPWorkflowManager } from '@/lib/vip-workflow-manager';
import { SessionManager } from '@/lib/session-manager';
import { webSocketManager } from '@/lib/websocket-manager-shared';

const sessionManager = new SessionManager();
const workflowManager = new VIPWorkflowManager();

export async function POST(req: NextRequest) {
  try {
    const { sessionId, errors } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      );
    }

    if (!errors || errors.length === 0) {
      return NextResponse.json(
        { success: false, error: 'errors are required' },
        { status: 400 }
      );
    }

    logger.info(`🔧 [ErrorFeedback] 收到错误反馈 (session: ${sessionId}, 错误数: ${errors.length})`);

    // 获取会话信息
    const session = await sessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Session not found' },
        { status: 404 }
      );
    }

    // 格式化错误信息
    const errorMessages = errors.map((err: any) => {
      if (typeof err === 'string') return err;
      return `${err.type || 'error'}: ${err.message || err}\n${err.file ? `文件: ${err.file}` : ''}${err.line ? `:${err.line}` : ''}`;
    }).join('\n\n');

    // 构建修复 Prompt
    const fixPrompt = `检测到运行时错误，请自动修复以下问题：

${errorMessages}

请分析错误原因并修复代码，确保：
1. 所有导入路径正确
2. 类型定义完整
3. 语法错误已修复
4. 依赖项已正确安装`;

    // 发送进度通知
    webSocketManager.emitWorkflowProgress({
      type: 'WORKFLOW_PROGRESS',
      sessionId,
      state: 'fixing',
      message: '🔧 检测到运行时错误，正在自动修复...',
      progress: 50,
      details: `发现 ${errors.length} 个错误，正在使用 AI 修复`,
    });

    // 执行修复工作流（静默模式：不通知用户）
    const result = await workflowManager.execute(
      fixPrompt,
      sessionId,
      session.projectId,
      (progress) => {
        // 实时推送进度
        webSocketManager.emitWorkflowProgress({
          type: 'WORKFLOW_PROGRESS',
          sessionId,
          state: progress.state as any,
          message: progress.message,
          progress: progress.progress,
          details: progress.details,
        });
      }
    );

    if (result.success) {
      logger.info(`✅ [ErrorFeedback] 错误修复成功 (session: ${sessionId})`);
      
      // 发送文件更新通知
      if (result.fileChanges.length > 0) {
        const events = result.fileChanges.map(fc => ({
          type: fc.action === 'CREATE' ? 'FILE_CREATED' as const :
                fc.action === 'DELETE' ? 'FILE_DELETED' as const :
                'FILE_UPDATED' as const,
          sessionId,
          path: fc.path,
          content: fc.action !== 'DELETE' ? fc.code : undefined,
        }));

        webSocketManager.emitFileUpdates(events);
      }

      return NextResponse.json({
        success: true,
        message: '错误已修复',
        filesFixed: result.fileChanges.length,
        fileChanges: result.fileChanges.map(fc => ({
          path: fc.path,
          action: fc.action,
        })),
      });
    } else {
      logger.warn(`⚠️ [ErrorFeedback] 错误修复失败 (session: ${sessionId})`);
      return NextResponse.json({
        success: false,
        error: '修复失败',
        errors: result.errors,
        validationAttempts: result.validationAttempts,
      }, { status: 500 });
    }
  } catch (error: any) {
    logger.error('❌ [ErrorFeedback] 处理错误反馈失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
