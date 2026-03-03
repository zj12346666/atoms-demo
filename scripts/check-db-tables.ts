// 检查数据库表是否存在
// 运行方式: npx tsx scripts/check-db-tables.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
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

async function checkDatabaseTables() {
  console.log('🔍 检查数据库表状态...\n');

  // 1. 检查环境变量
  console.log('1️⃣ 环境变量检查:');
  console.log('   DATABASE_URL:', databaseUrl ? `${databaseUrl.substring(0, 50)}...` : '❌ 未设置');
  console.log('');

  if (!databaseUrl) {
    console.log('❌ 数据库未配置！');
    console.log('💡 解决方案：');
    console.log('   1. 检查 .env.local 文件是否存在');
    console.log('   2. 设置 DATABASE_URL=postgresql://user:password@host:port/database');
    process.exit(1);
  }

  // 2. 测试连接
  console.log('2️⃣ 测试数据库连接...');
  let prisma: PrismaClient | null = null;
  
  try {
    const pool = new Pool({ connectionString: databaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    
    await prisma.$connect();
    console.log('   ✅ 数据库连接成功\n');
  } catch (error: any) {
    console.log('   ❌ 数据库连接失败:', error.message);
    console.log('💡 请检查：');
    console.log('   1. 数据库服务是否运行');
    console.log('   2. DATABASE_URL 是否正确');
    console.log('   3. 网络连接是否正常');
    process.exit(1);
  }

  // 3. 检查表是否存在
  console.log('3️⃣ 检查数据库表...');
  try {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    const tableNames = tables.map(t => t.table_name);
    console.log(`   找到 ${tableNames.length} 个表:`);
    tableNames.forEach(name => {
      console.log(`   - ${name}`);
    });
    console.log('');

    // 检查必需的表
    const requiredTables = ['users', 'sessions', 'files', 'chat_messages', 'projects', 'messages', 'code_versions', 'symbols'];
    console.log('4️⃣ 检查必需的表:');
    const missingTables: string[] = [];
    
    requiredTables.forEach(table => {
      const exists = tableNames.includes(table);
      console.log(`   ${table}:`, exists ? '✅ 存在' : '❌ 不存在');
      if (!exists) {
        missingTables.push(table);
      }
    });
    console.log('');

    if (missingTables.length > 0) {
      console.log('❌ 缺少以下表:', missingTables.join(', '));
      console.log('');
      console.log('💡 解决方案：运行以下命令创建表：');
      console.log('   npx prisma db push');
      console.log('');
      console.log('   或者使用 migration：');
      console.log('   npx prisma migrate dev --name init');
      process.exit(1);
    } else {
      console.log('✅ 所有必需的表都存在！');
    }

    await prisma.$disconnect();
  } catch (error: any) {
    console.log('   ❌ 查询表失败:', error.message);
    if (error.code === 'P2021') {
      console.log('');
      console.log('💡 这通常意味着数据库中没有表');
      console.log('💡 解决方案：运行 npx prisma db push');
    }
    await prisma?.$disconnect();
    process.exit(1);
  }
}

checkDatabaseTables().catch(console.error);
