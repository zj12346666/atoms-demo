// 设置数据库表
// 运行方式: npx tsx scripts/setup-database.ts

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { readFileSync } from 'fs';
import { join } from 'path';

// 加载环境变量
function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
          process.env[key.trim()] = value;
        }
      }
    });
  } catch (error) {
    // 如果文件不存在，忽略错误
  }
}
loadEnv();

const databaseUrl = process.env.DATABASE_URL || 
                    process.env.POSTGRES_URL || 
                    process.env.PRISMA_DATABASE_URL;

console.log('🔧 设置数据库表...\n');

// 1. 检查环境变量
if (!databaseUrl) {
  console.log('❌ DATABASE_URL 未设置！');
  console.log('💡 请检查 .env.local 文件并设置 DATABASE_URL');
  process.exit(1);
}

console.log('✅ DATABASE_URL 已配置');
console.log(`   数据库 URL: ${databaseUrl.substring(0, 50)}...\n`);

// 2. 检查 Prisma Client 是否已生成
const prismaClientPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client');
if (!fs.existsSync(prismaClientPath)) {
  console.log('📦 生成 Prisma Client...');
  try {
    execSync('node_modules/.bin/prisma generate', { stdio: 'inherit' });
    console.log('✅ Prisma Client 生成成功\n');
  } catch (error) {
    console.log('❌ Prisma Client 生成失败');
    process.exit(1);
  }
} else {
  console.log('✅ Prisma Client 已存在\n');
}

// 3. 推送 schema 到数据库
console.log('🚀 推送 schema 到数据库...\n');

try {
  // 设置环境变量并运行 prisma db push
  // Prisma 7.4+ 需要 --url 参数或 prisma.config.ts
  execSync(`node_modules/.bin/prisma db push --accept-data-loss --url "${databaseUrl}"`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
  });
  
  console.log('\n✅ 数据库表创建成功！');
  console.log('\n✅ 数据库设置完成！');
} catch (error: any) {
  console.log('\n❌ 数据库表创建失败！');
  console.log('💡 请检查：');
  console.log('   1. DATABASE_URL 是否正确');
  console.log('   2. 数据库服务是否运行');
  console.log('   3. 网络连接是否正常');
  console.log('\n💡 也可以手动运行:');
  console.log('   npx prisma db push --accept-data-loss');
  process.exit(1);
}
