import { NextRequest, NextResponse } from 'next/server';
import { FrontendAgent, AgentProgress } from '@/lib/frontend-agent';
import { SessionManager } from '@/lib/session-manager';
import { FileManager } from '@/lib/file-manager';
import { ChatMessageManager } from '@/lib/chat-message-manager';
import { CodeValidator } from '@/lib/code-validator';
import { prisma, isDatabaseAvailable } from '@/lib/db';
import { logger } from '@/lib/logger';
import path from 'path';

const sessionManager = new SessionManager();
const fileManager = new FileManager();
const chatMessageManager = new ChatMessageManager();

export async function POST(req: NextRequest) {
  try {
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

    logger.info('🚀 开始 7 阶段 Agent 工作流（分模块分文件生成）...');
    logger.info('📝 用户输入:', prompt);
    logger.info('👤 用户ID:', userId);
    logger.info('🔑 Session ID:', sessionId || '未提供，将创建新 Session');

    // 获取或创建会话
    let session = sessionId ? await sessionManager.getSession(sessionId) : null;
    let actualSessionId = sessionId; // 实际使用的 sessionId
    let actualUserId = userId; // 实际使用的 userId
    
    if (!session) {
      if (sessionId) {
        // Session 不存在或已过期
        logger.warn(`⚠️ Session ${sessionId} 不存在或已过期，将创建新 Session`);
      } else {
        logger.info('📦 未提供 SessionId，创建新 Session...');
      }
      
      try {
        // 如果 sessionId 不存在或过期，自动创建新 session
        session = await sessionManager.createSession(prompt.substring(0, 50), actualUserId);
        actualSessionId = session.sessionId; // 更新为新的 sessionId
        logger.info(`✅ 新 Session 创建成功: ${actualSessionId}`);
      } catch (error: any) {
        logger.error('❌ Session 创建失败:', error);
        return NextResponse.json(
          { 
            success: false, 
            error: `Session 创建失败: ${error.message || 'Unknown error'}`,
            hint: '请检查 PostgreSQL 数据库连接是否正常',
          },
          { status: 500 }
        );
      }
    } else {
      logger.info(`✅ Session 存在: ${actualSessionId}`);
      // 如果 session 存在，从数据库获取 userId（如果数据库中有）
      if (isDatabaseAvailable() && prisma) {
        try {
          const dbSession = await (prisma as any).session.findUnique({
            where: { sessionId: actualSessionId },
            select: { userId: true },
          });
          if (dbSession?.userId) {
            actualUserId = dbSession.userId;
            logger.debug(`✅ 从数据库获取 userId: ${actualUserId}`);
          }
        } catch (error) {
          logger.warn('⚠️ 从数据库获取 userId 失败，使用传入的 userId:', error);
          // 忽略错误，使用传入的 userId
        }
      }
    }

    // 添加用户消息到会话（使用实际有效的 sessionId）
    await sessionManager.addMessage(actualSessionId, {
      role: 'user',
      content: prompt,
    });

    // 保存用户消息到聊天记录
    try {
      await chatMessageManager.saveUserMessage(actualSessionId, actualUserId, prompt);
      logger.debug(`💬 用户消息已保存到聊天记录: ${actualSessionId}`);
    } catch (error) {
      logger.warn('⚠️ 保存用户消息到聊天记录失败（非致命）:', error);
    }
    
    // 初始化 Agent
    const agent = new FrontendAgent(
      'c7e235af6a364f07bdc5affc2c95e77c.tBJn3fOeeETiGBH0',
      'https://open.bigmodel.cn/api/paas/v4'
    );
    
    const projectRoot = path.join(process.cwd());
    
    // 收集所有进度信息
    const progressLog: AgentProgress[] = [];
    
    // 执行 7 阶段生成（包含规划阶段和分文件生成）
    const code = await agent.generate(
      prompt,
      session.projectId,
      projectRoot,
      (progress) => {
        progressLog.push(progress);
        logger.info(`[${progress.stage}] ${progress.message}`);
        if (progress.thinking) {
          logger.info(`💭 ${progress.thinking}`);
        }
        
        // 将进度信息保存到会话（使用实际有效的 sessionId）
        sessionManager.addMessage(actualSessionId, {
          role: 'system',
          content: progress.message,
          stage: progress.stage,
          thinking: progress.thinking,
        }).catch(err => logger.warn('Failed to save progress:', err));
      }
    );
    
    logger.info('✅ 代码生成成功（7 阶段工作流）');
    
    // 阶段 8: 后端验证和自动修复循环
    let finalCode = code;
    let validationAttempts = 0;
    const maxValidationAttempts = 3;
    let validationResult = null;

    while (validationAttempts < maxValidationAttempts) {
      validationAttempts++;
      
      // 保存当前代码到数据库
      try {
        await fileManager.saveGeneratedCode(actualSessionId, finalCode);
        logger.info(`✅ [验证 ${validationAttempts}/${maxValidationAttempts}] 文件已保存到数据库`);
      } catch (error) {
        logger.warn('⚠️ 文件保存失败（非致命错误）:', error);
      }

      // 准备验证文件列表
      const filesToValidate = finalCode.files && finalCode.files.length > 0
        ? finalCode.files.map(f => ({ path: f.path, content: f.content }))
        : [
            { path: 'index.html', content: finalCode.html || '' },
            { path: 'style.css', content: finalCode.css || '' },
            { path: 'main.js', content: finalCode.js || '' },
          ].filter(f => f.content);

      if (filesToValidate.length === 0) {
        logger.warn('⚠️ 没有文件需要验证，跳过验证步骤');
        break;
      }

      // 执行验证
      const progressCallback = (progress: AgentProgress) => {
        progressLog.push(progress);
        logger.info(`[${progress.stage}] ${progress.message}`);
        if (progress.thinking) {
          logger.info(`💭 ${progress.thinking}`);
        }
        sessionManager.addMessage(actualSessionId, {
          role: 'system',
          content: progress.message,
          stage: progress.stage,
          thinking: progress.thinking,
        }).catch(err => logger.warn('Failed to save progress:', err));
      };

      progressCallback({
        stage: 'validation',
        message: `🔬 验证代码可运行性... (${validationAttempts}/${maxValidationAttempts})`,
        thinking: `正在后端运行项目并检测错误...`,
      });

      const validator = new CodeValidator();
      validationResult = await validator.validateCode(actualSessionId, filesToValidate);

      if (validationResult.success) {
        logger.info(`✅ [验证 ${validationAttempts}/${maxValidationAttempts}] 代码验证通过！`);
        progressCallback({
          stage: 'validation',
          message: '✅ 代码验证通过！',
          thinking: '代码可以成功运行，准备返回结果。',
        });
        break;
      } else {
        logger.warn(`⚠️ [验证 ${validationAttempts}/${maxValidationAttempts}] 代码验证失败`);
        logger.warn(`错误信息:`, validationResult.errors);
        
        if (validationAttempts < maxValidationAttempts) {
          // 尝试修复
          progressCallback({
            stage: 'fixing',
            message: `🔧 自动修复错误... (${validationAttempts}/${maxValidationAttempts})`,
            thinking: `检测到 ${validationResult.errors.length} 个错误，正在使用 AI 修复...`,
          });

          // 调用修复 API（直接调用函数而不是 HTTP 请求）
          try {
            // 导入修复函数
            const { fixErrors } = await import('@/app/api/fix-errors/route');
            
            // 创建修复请求
            const fixRequest = new Request(`${req.nextUrl.origin}/api/fix-errors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: actualSessionId,
                errors: validationResult.errors.slice(0, 10), // 只发送前10个错误
                files: filesToValidate,
              }),
            });

            const fixResponse = await fetch(fixRequest);

            const fixData = await fixResponse.json();
            
            if (fixData.success && fixData.fixedFiles) {
              // 使用修复 API 返回的完整文件内容
              const fixedFiles = fixData.fixedFiles as Array<{ path: string; content: string }>;

              // 更新 finalCode
              if (finalCode.files) {
                finalCode = {
                  ...finalCode,
                  files: finalCode.files.map(f => {
                    const fixed = fixedFiles.find(ff => ff.path === f.path);
                    return fixed ? { ...f, content: fixed.content } : f;
                  }),
                };
              } else {
                // 旧格式，需要转换
                const htmlFile = fixedFiles.find(f => f.path.endsWith('.html'));
                const cssFile = fixedFiles.find(f => f.path.endsWith('.css'));
                const jsFile = fixedFiles.find(f => f.path.endsWith('.js') || f.path.endsWith('.tsx') || f.path.endsWith('.ts'));
                
                finalCode = {
                  ...finalCode,
                  html: htmlFile?.content || finalCode.html || '',
                  css: cssFile?.content || finalCode.css || '',
                  js: jsFile?.content || finalCode.js || '',
                };
              }

              logger.info(`✅ [修复 ${validationAttempts}] 已修复 ${fixData.files.length} 个文件，准备重新验证...`);
              progressCallback({
                stage: 'fixing',
                message: `✅ 已修复 ${fixData.files.length} 个文件`,
                thinking: '准备重新验证修复后的代码...',
              });
              
              // 等待一下让文件保存完成
              await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
              logger.error(`❌ [修复 ${validationAttempts}] 修复失败:`, fixData.error);
              break; // 修复失败，退出循环
            }
          } catch (fixError: any) {
            logger.error(`❌ [修复 ${validationAttempts}] 修复过程出错:`, fixError);
            break; // 修复过程出错，退出循环
          }
        } else {
          // 达到最大尝试次数
          logger.error(`❌ 已达到最大修复尝试次数 (${maxValidationAttempts})，停止修复`);
          progressCallback({
            stage: 'validation',
            message: '⚠️ 代码验证失败',
            thinking: `经过 ${maxValidationAttempts} 次尝试后仍有错误。错误信息：${validationResult.errors.join('; ')}`,
          });
        }
      }
    }

    // 保存最终代码到会话（使用实际有效的 sessionId）
    // 兼容新旧格式
    const codeForSession = finalCode.files && finalCode.files.length > 0
      ? {
          html: finalCode.files.find(f => f.path.endsWith('.html'))?.content || '',
          css: finalCode.files.find(f => f.path.endsWith('.css'))?.content || '',
          js: finalCode.files.find(f => f.path.endsWith('.js') || f.path.endsWith('.tsx') || f.path.endsWith('.ts'))?.content || '',
          description: finalCode.description,
        }
      : {
          html: finalCode.html || '',
          css: finalCode.css || '',
          js: finalCode.js || '',
          description: finalCode.description,
        };
    await sessionManager.saveGeneratedCode(actualSessionId, codeForSession);
    
    // 添加 AI 响应到会话（使用实际有效的 sessionId）
    const fileSummary = finalCode.files && finalCode.files.length > 0
      ? `\n\n**生成的文件**（共 ${finalCode.files.length} 个）：\n${finalCode.files.map(f => `- ${f.path}`).join('\n')}`
      : '';
    const validationStatus = validationResult?.success 
      ? '✅ 代码已验证，可以成功运行！'
      : validationResult 
        ? `⚠️ 代码验证未完全通过（${validationAttempts} 次尝试）\n错误：${validationResult.errors.slice(0, 3).join('; ')}`
        : '';
    const aiResponse = `✅ 代码生成完成！\n\n**描述**：${finalCode.description || '应用已生成'}${fileSummary}\n\n${validationStatus}`;
    await sessionManager.addMessage(actualSessionId, {
      role: 'assistant',
      content: aiResponse,
      stage: 'completed',
    });

    // 保存AI消息到聊天记录
    try {
      await chatMessageManager.saveAIMessage(actualSessionId, aiResponse);
      logger.debug(`💬 AI消息已保存到聊天记录: ${actualSessionId}`);
    } catch (error) {
      logger.warn('⚠️ 保存AI消息到聊天记录失败（非致命）:', error);
    }
    
    // 返回结果（包含实际使用的 sessionId，可能是新创建的）
    // 使用格式化后的 codeForSession（含 html/css/js 字段），避免前端收到 undefined
    return NextResponse.json({
      success: true,
      code: {
        ...codeForSession,
        files: finalCode.files || code.files,   // 使用最终修复后的文件
        plan: finalCode.plan || code.plan,
      },
      validation: validationResult ? {
        success: validationResult.success,
        attempts: validationAttempts,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
      } : undefined,
      sessionId: actualSessionId, // 返回实际使用的 sessionId（可能是新创建的）
      projectId: session.projectId,
      mode: '7-stage-workflow',
      progress: progressLog, // 返回完整的思考过程
      features: {
        intentAnalysis: true,
        symbolicRetrieval: true,
        contextAssembly: true,
        planning: true,        // 新增：实现方案规划
        multiFileGeneration: true, // 新增：分文件生成
        sandboxValidation: true,
        persistence: true,
      },
    });
  } catch (error: any) {
    logger.error('❌ Generate error:', error);
    logger.error('错误堆栈:', error.stack);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Code generation failed',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
