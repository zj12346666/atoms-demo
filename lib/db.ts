// Prisma Client Singleton with PostgreSQL support

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { logger } from './logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// 判断是否配置了数据库
// 直接写死 DATABASE_URL
let databaseUrl = 'postgres://e2a3c935945e2f3f0633c1509531df994ec064a8480727bade7ca50bb42b65b7:sk_yxW1aGIQNE8rBK260cvz_@db.prisma.io:5432/postgres?sslmode=verify-full';

// 清理 URL（移除可能的引号和空格）
if (databaseUrl) {
  databaseUrl = databaseUrl.trim();
  // 移除首尾的引号（如果存在）
  if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
      (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) {
    databaseUrl = databaseUrl.slice(1, -1);
  }
}

// 打印 DATABASE_URL 用于调试（隐藏敏感信息）
const logDatabaseUrl = (url: string | undefined) => {
  if (!url) {
    logger.warn('⚠️ DATABASE_URL 未设置');
    logger.warn('   检查的环境变量: DATABASE_URL, POSTGRES_URL, PRISMA_DATABASE_URL');
    logger.warn(`   DATABASE_URL: ${process.env.DATABASE_URL || 'undefined'}`);
    logger.warn(`   POSTGRES_URL: ${process.env.POSTGRES_URL || 'undefined'}`);
    logger.warn(`   PRISMA_DATABASE_URL: ${process.env.PRISMA_DATABASE_URL || 'undefined'}`);
    return;
  }

  // 打印完整的 URL（用于调试，但隐藏密码部分）
  try {
    const urlObj = new URL(url);
    const maskedUrl = `${urlObj.protocol}//${urlObj.username}:***@${urlObj.hostname}:${urlObj.port || '5432'}${urlObj.pathname}${urlObj.search}`;
    logger.info(`📋 DATABASE_URL 内容:`);
    logger.info(`   协议: ${urlObj.protocol}`);
    logger.info(`   用户名: ${urlObj.username}`);
    logger.info(`   主机: ${urlObj.hostname}`);
    logger.info(`   端口: ${urlObj.port || '5432'}`);
    logger.info(`   数据库: ${urlObj.pathname}`);
    logger.info(`   完整 URL (隐藏密码): ${maskedUrl}`);
    logger.info(`   URL 长度: ${url.length} 字符`);
    logger.info(`   URL 前50字符: ${url.substring(0, 50)}...`);
  } catch (error) {
    logger.error(`❌ DATABASE_URL 解析失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logger.error(`   原始 URL: ${url.substring(0, 200)}`);
  }
};

// 验证 URL 格式
const isValidPostgresUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  // 检查是否是有效的 PostgreSQL URL 格式
  return /^postgres(ql)?:\/\/.+/.test(url) && url !== 'file:./dev.db';
};

const isDatabaseConfigured = isValidPostgresUrl(databaseUrl);

// 记录数据库配置状态（仅在开发环境）
if (process.env.NODE_ENV === 'development') {
  logger.info('🔍 检查数据库配置...');
  logDatabaseUrl(databaseUrl);
  
  if (!databaseUrl) {
    logger.warn('⚠️ DATABASE_URL 环境变量未设置，数据库功能将不可用');
    logger.warn('💡 请创建 .env.local 文件并设置 DATABASE_URL');
  } else if (databaseUrl === 'file:./dev.db') {
    logger.warn('⚠️ DATABASE_URL 指向 SQLite，但项目使用 PostgreSQL');
  } else if (!isValidPostgresUrl(databaseUrl)) {
    logger.error('❌ DATABASE_URL 格式无效');
    logger.error(`   原始值: ${databaseUrl}`);
    logger.error('   请确保 URL 格式为: postgres://user:password@host:port/database');
  } else {
    logger.info('✅ DATABASE_URL 格式验证通过');
  }
}

let prismaInstance: PrismaClient | null = null;

if (isDatabaseConfigured && databaseUrl) {
  try {
    // 先检查全局实例
    if (globalForPrisma.prisma) {
      prismaInstance = globalForPrisma.prisma;
    } else {
      // 尝试创建新实例，但捕获所有可能的错误
      try {
        // 验证 URL 格式
        try {
          const testUrl = new URL(databaseUrl);
          logger.debug(`✅ URL 格式验证通过: ${testUrl.protocol}//${testUrl.hostname}:${testUrl.port || '5432'}`);
        } catch (urlError) {
          logger.error(`❌ URL 格式验证失败:`);
          logger.error(`   错误: ${urlError instanceof Error ? urlError.message : 'Unknown error'}`);
          logger.error(`   URL 值: ${databaseUrl?.substring(0, 200)}`);
          throw new Error(`Invalid DATABASE_URL format: ${urlError instanceof Error ? urlError.message : 'Unknown error'}`);
        }

        // Prisma 7.4+ 需要 adapter 或 accelerateUrl
        // 对于 PostgreSQL，使用 @prisma/adapter-pg
        const pool = new Pool({
          connectionString: databaseUrl,
          // 连接池配置
          max: 10, // 最大连接数
          idleTimeoutMillis: 30000, // 空闲连接超时（30秒）
          connectionTimeoutMillis: 10000, // 连接超时（10秒）
          // 连接保活
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        });
        
        // 监听连接错误
        pool.on('error', (err) => {
          logger.error('❌ PostgreSQL 连接池错误:', err.message);
        });
        
        const adapter = new PrismaPg(pool);
        
        prismaInstance = new PrismaClient({
          adapter,
          log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
        });
      } catch (constructorError: any) {
        // 如果是 adapter 相关错误，说明可能安装了错误的 adapter
        if (constructorError.message?.includes('adapter') || constructorError.message?.includes('accelerateUrl')) {
          logger.error('❌ Prisma Client 构造函数失败: adapter 配置错误');
          logger.error('💡 原因：检测到 libsql adapter，但 schema 使用的是 PostgreSQL');
          logger.error('💡 解决方案：');
          logger.error('   1. 卸载 libsql adapter: npm uninstall @prisma/adapter-libsql @libsql/client');
          logger.error('   2. 重新生成 Prisma Client: npx prisma generate');
          logger.error('   3. 或者安装 PostgreSQL adapter: npm install @prisma/adapter-pg pg');
        }
        console.error('❌ Prisma Client 构造函数失败:', constructorError.message);
        logger.error('❌ Prisma Client 构造函数失败:', constructorError.message);
        logger.error('💡 应用将使用降级模式（内存存储）继续运行');
        prismaInstance = null;
      }
    }
    
    // 如果实例存在，测试连接（异步，不阻塞）
    if (prismaInstance) {
      prismaInstance.$connect().catch((error: any) => {
        console.warn('⚠️ Prisma 连接失败:', error.message);
        logger.warn('⚠️ Prisma 连接失败:', error.message);
        // 不设置为 null，允许降级使用
      });
    }
  } catch (error: any) {
    console.error('❌ Prisma Client 初始化失败:', error.message);
    console.error('错误堆栈:', error.stack);
    logger.error('❌ Prisma Client 初始化失败:', error.message);
    logger.error('错误详情:', error);
    prismaInstance = null;
  }
} else {
  console.log('ℹ️ 数据库未配置，Prisma Client 将不可用');
}

export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production' && prisma) {
  globalForPrisma.prisma = prisma;
}

// 检查数据库是否可用
export function isDatabaseAvailable(): boolean {
  return prisma !== null;
}

// 检查并确保数据库连接正常
export async function ensureConnection(): Promise<boolean> {
  if (!prisma) {
    return false;
  }
  
  try {
    // 尝试执行一个简单的查询来检查连接
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error: any) {
    logger.warn('⚠️ 数据库连接检查失败，尝试重新连接:', error.message);
    
    // 尝试重新连接
    try {
      await prisma.$connect();
      logger.info('✅ 数据库重新连接成功');
      return true;
    } catch (reconnectError: any) {
      logger.error('❌ 数据库重新连接失败:', reconnectError.message);
      return false;
    }
  }
}
