// 诊断脚本：检查数据库连接状态

import { PrismaClient } from '@prisma/client';
import { isDatabaseAvailable, prisma } from '../lib/db';

console.log('🔍 数据库连接诊断\n');

// 1. 检查环境变量
console.log('1️⃣ 环境变量检查:');
console.log('   DATABASE_URL:', process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 50)}...` : '❌ 未设置');
console.log('   POSTGRES_URL:', process.env.POSTGRES_URL ? `${process.env.POSTGRES_URL.substring(0, 50)}...` : '❌ 未设置');
console.log('   PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL ? `${process.env.PRISMA_DATABASE_URL.substring(0, 50)}...` : '❌ 未设置');
console.log('');

// 2. 检查 isDatabaseConfigured 逻辑
const isDatabaseConfigured = !!process.env.DATABASE_URL && process.env.DATABASE_URL !== 'file:./dev.db';
console.log('2️⃣ 数据库配置检查:');
console.log('   DATABASE_URL 存在:', !!process.env.DATABASE_URL);
console.log('   DATABASE_URL 不是 SQLite:', process.env.DATABASE_URL !== 'file:./dev.db');
console.log('   isDatabaseConfigured:', isDatabaseConfigured);
console.log('');

// 3. 检查 Prisma Client
console.log('3️⃣ Prisma Client 状态:');
console.log('   prisma 实例:', prisma ? '✅ 已创建' : '❌ 为 null');
console.log('   isDatabaseAvailable():', isDatabaseAvailable() ? '✅ 可用' : '❌ 不可用');
console.log('');

// 4. 尝试连接数据库
if (prisma) {
  console.log('4️⃣ 测试数据库连接:');
  try {
    await prisma.$connect();
    console.log('   ✅ Prisma 连接成功');
    
    // 尝试一个简单查询
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('   ✅ 数据库查询成功:', result);
    
    // 检查 User 表是否存在
    try {
      const userCount = await (prisma as any).user.count();
      console.log('   ✅ User 表可访问，记录数:', userCount);
    } catch (error: any) {
      console.log('   ⚠️ User 表访问失败:', error.message);
      console.log('   💡 提示: 可能需要运行数据库迁移');
    }
    
    await prisma.$disconnect();
  } catch (error: any) {
    console.log('   ❌ 数据库连接失败:', error.message);
    console.log('   错误详情:', error);
  }
} else {
  console.log('4️⃣ 跳过连接测试（Prisma Client 未初始化）');
}

console.log('\n📋 诊断完成');
