// 测试数据库连接脚本

import { PrismaClient } from '@prisma/client';

async function testConnection() {
  console.log('🔍 检查数据库配置...\n');

  // 1. 检查环境变量
  console.log('1️⃣ 环境变量检查:');
  console.log('   DATABASE_URL:', process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 50)}...` : '❌ 未设置');
  console.log('   POSTGRES_URL:', process.env.POSTGRES_URL ? `${process.env.POSTGRES_URL.substring(0, 50)}...` : '❌ 未设置');
  console.log('   PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL ? `${process.env.PRISMA_DATABASE_URL.substring(0, 50)}...` : '❌ 未设置');
  console.log('');

  // 2. 检查 isDatabaseConfigured
  const isDatabaseConfigured = !!process.env.DATABASE_URL && process.env.DATABASE_URL !== 'file:./dev.db';
  console.log('2️⃣ 数据库配置检查:');
  console.log('   DATABASE_URL 存在:', !!process.env.DATABASE_URL);
  console.log('   DATABASE_URL 不是 SQLite:', process.env.DATABASE_URL !== 'file:./dev.db');
  console.log('   isDatabaseConfigured:', isDatabaseConfigured);
  console.log('');

  if (!isDatabaseConfigured) {
    console.log('❌ 数据库未配置！');
    console.log('💡 请创建 .env.local 文件并设置 DATABASE_URL');
    process.exit(1);
  }

  // 3. 尝试连接数据库
  console.log('3️⃣ 测试数据库连接:');
  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });

  try {
    await prisma.$connect();
    console.log('   ✅ Prisma 连接成功');

    // 测试查询
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('   ✅ 数据库查询成功:', result);

    // 检查 File 表是否存在
    try {
      const fileCount = await (prisma as any).file.count();
      console.log('   ✅ File 表可访问，记录数:', fileCount);
    } catch (error: any) {
      console.log('   ⚠️ File 表访问失败:', error.message);
      console.log('   💡 可能需要运行数据库迁移');
    }

    // 检查 Session 表是否存在
    try {
      const sessionCount = await (prisma as any).session.count();
      console.log('   ✅ Session 表可访问，记录数:', sessionCount);
    } catch (error: any) {
      console.log('   ⚠️ Session 表访问失败:', error.message);
    }

    await prisma.$disconnect();
    console.log('\n✅ 数据库连接测试通过！');
  } catch (error: any) {
    console.log('   ❌ 数据库连接失败:', error.message);
    console.log('   错误详情:', error);
    process.exit(1);
  }
}

testConnection();
