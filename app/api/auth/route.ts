// 登录/注册一体化 API

import { NextRequest, NextResponse } from 'next/server';
import { getSnowflakeId } from '@/lib/snowflake';
import { createPasswordHash, verifyPassword } from '@/lib/password';
import { prisma, isDatabaseAvailable } from '@/lib/db';
import { logger } from '@/lib/logger';

// 内存存储（降级方案，仅用于演示）
const memoryUsers = new Map<string, { id: string; username: string; passwordHash: string; salt: string }>();
const memoryUsersByUsername = new Map<string, string>(); // username -> userId

function handleAuthWithoutDB(username: string, password: string) {
  // 尝试在内存中查找用户（通过用户名）
  const userId = memoryUsersByUsername.get(username);
  if (userId) {
    const user = memoryUsers.get(userId);
    if (user && verifyPassword(password, user.salt, user.passwordHash)) {
      console.log('✅ [API] 用户登录成功（内存）:', username);
      logger.info('✅ 用户登录成功（内存）:', username);
      return NextResponse.json({
        success: true,
        action: 'login',
        userId: userId,
        username: username,
        message: '登录成功',
      });
    } else {
      return NextResponse.json(
        { success: false, error: '密码错误' },
        { status: 401 }
      );
    }
  }

  // 注册新用户
  const newUserId = getSnowflakeId();
  const { salt, hash } = createPasswordHash(password);
  
  memoryUsers.set(newUserId, {
    id: newUserId,
    username: username,
    passwordHash: hash,
    salt: salt,
  });
  memoryUsersByUsername.set(username, newUserId);

  console.log('✅ [API] 新用户注册成功（内存）:', username);
  logger.info('✅ 新用户注册成功（内存）:', username);
  return NextResponse.json({
    success: true,
    action: 'register',
    userId: newUserId,
    username: username,
    message: '注册成功',
  });
}

// POST /api/auth - 登录或注册
export async function POST(req: NextRequest) {
  // 使用 console.log 确保日志能输出（logger 可能有问题）
  console.log('🔐 [API] 收到登录/注册请求');
  
  try {
    let username: string;
    let password: string;
    
    try {
      const body = await req.json();
      username = body.username;
      password = body.password;
      console.log(`📝 [API] 解析请求: username=${username}, password=${password ? '***' : 'empty'}`);
    } catch (parseError: any) {
      console.error('❌ [API] 请求体解析失败:', parseError);
      console.error('[API] 错误堆栈:', parseError.stack);
      return NextResponse.json(
        { success: false, error: '请求格式错误，请检查请求体是否为有效的 JSON' },
        { status: 400 }
      );
    }

    // 验证输入
    if (!username || username.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: '用户名不能为空' },
        { status: 400 }
      );
    }

    if (!password || password.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: '密码不能为空' },
        { status: 400 }
      );
    }

    // 验证用户名格式（只允许字母、数字、下划线，3-20个字符）
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username.trim())) {
      return NextResponse.json(
        { success: false, error: '用户名只能包含字母、数字和下划线，长度3-20个字符' },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim();
    console.log(`🔍 [API] 开始处理认证: username=${trimmedUsername}`);

    // 如果数据库不可用，使用内存存储（降级方案）
    if (!isDatabaseAvailable() || !prisma) {
      console.warn('⚠️ [API] 数据库不可用，使用内存存储（降级模式）');
      console.log('💾 [API] 使用内存存储进行认证');
      const result = handleAuthWithoutDB(trimmedUsername, password);
      console.log('✅ [API] 内存存储认证完成');
      return result;
    }
    
    console.log('💾 [API] 使用数据库进行认证');

    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.warn('⚠️ 数据库不可用，降级到内存存储');
      return handleAuthWithoutDB(trimmedUsername, password);
    }

    try {
      logger.info('🔍 尝试从数据库查找用户...');
      // 尝试查找用户（通过用户名）
      const existingUser = await (prisma as any).user.findUnique({
        where: { username: trimmedUsername },
      });
      logger.info(`📊 数据库查询结果: ${existingUser ? '用户存在' : '用户不存在'}`);

      if (existingUser) {
        // 用户存在，验证密码
        if (verifyPassword(password, existingUser.salt, existingUser.passwordHash)) {
          // 登录成功
          logger.info('✅ 用户登录成功:', trimmedUsername);
          return NextResponse.json({
            success: true,
            action: 'login',
            userId: existingUser.id,
            username: trimmedUsername,
            message: '登录成功',
          });
        } else {
          // 密码错误
          return NextResponse.json(
            { success: false, error: '密码错误' },
            { status: 401 }
          );
        }
      } else {
        // 用户不存在，注册新用户
        const userId = getSnowflakeId();
        const { salt, hash } = createPasswordHash(password);

        const newUser = await (prisma as any).user.create({
          data: {
            id: userId,
            username: trimmedUsername,
            passwordHash: hash,
            salt: salt,
          },
        });

        logger.info('✅ 新用户注册成功:', trimmedUsername);
        return NextResponse.json({
          success: true,
          action: 'register',
          userId: newUser.id,
          username: trimmedUsername,
          message: '注册成功',
        });
      }
    } catch (dbError: any) {
      logger.error('❌ 数据库操作错误:', dbError);
      logger.error('错误代码:', dbError.code);
      logger.error('错误消息:', dbError.message);
      logger.error('错误堆栈:', dbError.stack);
      
      // 检查是否是唯一性约束错误
      if (dbError.code === 'P2002' || dbError.message?.includes('Unique constraint')) {
        logger.warn('⚠️ 用户名已存在（唯一性约束）');
        return NextResponse.json(
          { success: false, error: '用户名已存在' },
          { status: 409 }
        );
      }
      
      // 数据库操作失败，降级到内存存储
      logger.warn('⚠️ 数据库操作失败，降级到内存存储');
      logger.info('💾 使用内存存储进行认证（降级模式）');
      try {
        const result = handleAuthWithoutDB(trimmedUsername, password);
        logger.info('✅ 内存存储认证完成（降级模式）');
        return result;
      } catch (memoryError: any) {
        logger.error('❌ 内存存储认证也失败:', memoryError);
        throw memoryError;
      }
    }
  } catch (error: any) {
    console.error('❌ [API] Auth error (最外层捕获):', error);
    console.error('[API] 错误类型:', typeof error);
    console.error('[API] 错误消息:', error?.message || '未知错误');
    console.error('[API] 错误堆栈:', error?.stack || '无堆栈信息');
    logger.error('❌ Auth error (最外层捕获):', error);
    logger.error('错误类型:', typeof error);
    logger.error('错误消息:', error?.message || '未知错误');
    logger.error('错误堆栈:', error?.stack || '无堆栈信息');
    
    // 确保返回 JSON 格式的错误响应
    try {
      return NextResponse.json(
        {
          success: false,
          error: error?.message || '认证失败',
          details: process.env.NODE_ENV === 'development' ? error?.toString() : undefined,
        },
        { 
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (jsonError: any) {
      // 如果连 JSON 响应都创建失败，记录错误
      logger.error('❌ 无法创建 JSON 响应:', jsonError);
      // 返回一个简单的文本响应（虽然不理想，但总比 HTML 错误页面好）
      return new Response(
        JSON.stringify({
          success: false,
          error: '服务器内部错误',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  }
}

// GET /api/auth?userId=xxx - 验证用户是否存在
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    logger.info(`🔍 GET /api/auth?userId=${userId}`);

    if (!userId) {
      logger.warn('⚠️ userId 参数缺失');
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    // 检查数据库是否可用
    const dbAvailable = isDatabaseAvailable() && prisma;
    
    if (!dbAvailable) {
      logger.warn('⚠️ 数据库不可用，从内存查找用户');
      const memoryUser = memoryUsers.get(userId);
      if (!memoryUser) {
        logger.warn(`⚠️ 用户不存在（内存）: ${userId}`);
        return NextResponse.json(
          { success: false, error: '用户不存在' },
          { status: 404 }
        );
      }
      logger.info(`✅ 找到用户（内存）: ${memoryUser.username}`);
      return NextResponse.json({
        success: true,
        user: {
          id: memoryUser.id,
          username: memoryUser.username,
          createdAt: new Date().toISOString(),
        },
      });
    }

    // 从数据库查找用户
    try {
      logger.info(`🔍 从数据库查找用户: ${userId}`);
      const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          createdAt: true,
        },
      });

      if (!user) {
        logger.warn(`⚠️ 用户不存在（数据库）: ${userId}`);
        // 尝试从内存查找（可能是在数据库不可用时创建的）
        const memoryUser = memoryUsers.get(userId);
        if (memoryUser) {
          logger.info(`✅ 找到用户（内存降级）: ${memoryUser.username}`);
          return NextResponse.json({
            success: true,
            user: {
              id: memoryUser.id,
              username: memoryUser.username,
              createdAt: new Date().toISOString(),
            },
          });
        }
        return NextResponse.json(
          { success: false, error: '用户不存在' },
          { status: 404 }
        );
      }

      logger.info(`✅ 找到用户（数据库）: ${user.username}`);
      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          createdAt: user.createdAt,
        },
      });
    } catch (dbError: any) {
      logger.error('❌ 数据库查询失败:', dbError);
      // 降级到内存查找
      const memoryUser = memoryUsers.get(userId);
      if (memoryUser) {
        logger.info(`✅ 找到用户（内存降级）: ${memoryUser.username}`);
        return NextResponse.json({
          success: true,
          user: {
            id: memoryUser.id,
            username: memoryUser.username,
            createdAt: new Date().toISOString(),
          },
        });
      }
      throw dbError;
    }
  } catch (error: any) {
    logger.error('❌ Get user error:', error);
    logger.error('错误堆栈:', error.stack);
    return NextResponse.json(
      {
        success: false,
        error: error.message || '查询失败',
        details: process.env.NODE_ENV === 'development' ? error.toString() : undefined,
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
