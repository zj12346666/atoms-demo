// 迁移脚本：为现有用户添加 username 字段
// 运行方式: npx tsx scripts/migrate-add-username.ts

import { PrismaClient } from '@prisma/client';
import { getSnowflakeId } from '../lib/snowflake';

const prisma = new PrismaClient();

async function migrateAddUsername() {
  try {
    console.log('🚀 开始迁移：添加 username 字段...');

    // 1. 检查 username 列是否存在
    const result = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'username'
    `;

    if (result.length === 0) {
      console.log('📝 添加 username 列...');
      await prisma.$executeRaw`
        ALTER TABLE "users" ADD COLUMN "username" TEXT;
      `;
      console.log('✅ username 列已添加');
    } else {
      console.log('ℹ️  username 列已存在');
    }

    // 2. 创建唯一索引（允许 NULL）
    console.log('📝 创建唯一索引...');
    await prisma.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" 
      ON "users" ("username") 
      WHERE "username" IS NOT NULL;
    `;
    console.log('✅ 唯一索引已创建');

    // 3. 为现有用户生成临时用户名
    console.log('📝 为现有用户生成用户名...');
    const usersWithoutUsername = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "users" WHERE "username" IS NULL
    `;

    let updated = 0;
    for (const user of usersWithoutUsername) {
      // 生成唯一的用户名
      let tempUsername = `user_${user.id.substring(0, 8)}`;
      let attempts = 0;
      
      // 确保用户名唯一
      while (attempts < 10) {
        const existing = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "users" WHERE "username" = ${tempUsername} LIMIT 1
        `;
        
        if (existing.length === 0) {
          break;
        }
        
        tempUsername = `user_${user.id.substring(0, 8)}_${attempts}`;
        attempts++;
      }

      await prisma.$executeRaw`
        UPDATE "users" SET "username" = ${tempUsername} WHERE "id" = ${user.id}
      `;
      updated++;
    }

    console.log(`✅ 已为 ${updated} 个用户生成用户名`);

    // 4. 设置 username 为 NOT NULL
    console.log('📝 设置 username 为 NOT NULL...');
    await prisma.$executeRaw`
      ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
    `;
    console.log('✅ username 已设置为 NOT NULL');

    // 5. 创建普通索引
    console.log('📝 创建普通索引...');
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
    `;
    console.log('✅ 普通索引已创建');

    console.log('🎉 迁移完成！');
  } catch (error) {
    console.error('❌ 迁移失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateAddUsername();
