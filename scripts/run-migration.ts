/**
 * 执行数据库迁移脚本
 * 从 .env.local 读取数据库配置并执行迁移SQL
 */

import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

// 加载环境变量
dotenv.config({ path: '.env.local' });

const databaseUrl = process.env.DATABASE_URL || 
                    process.env.POSTGRES_URL || 
                    process.env.PRISMA_DATABASE_URL;

async function runMigration() {
  console.log('🚀 开始执行数据库迁移...\n');

  // 1. 检查环境变量
  console.log('1️⃣ 检查环境变量:');
  if (!databaseUrl) {
    console.error('❌ 数据库未配置！');
    console.error('💡 请创建 .env.local 文件并设置 DATABASE_URL');
    console.error('   检查的环境变量: DATABASE_URL, POSTGRES_URL, PRISMA_DATABASE_URL');
    process.exit(1);
  }
  console.log(`   ✅ DATABASE_URL 已配置: ${databaseUrl.substring(0, 50)}...\n`);

  // 2. 读取迁移SQL文件
  console.log('2️⃣ 读取迁移SQL文件...');
  const migrationPath = join(process.cwd(), 'prisma/migrations/add_symbol_signature/migration.sql');
  let sql: string;
  
  try {
    sql = readFileSync(migrationPath, 'utf-8');
    console.log(`   ✅ 已读取: ${migrationPath}\n`);
  } catch (error: any) {
    console.error(`   ❌ 读取失败: ${error.message}`);
    process.exit(1);
  }

  // 3. 连接数据库
  console.log('3️⃣ 连接数据库...');
  const pool = new Pool({
    connectionString: databaseUrl,
    // 连接配置
    max: 1, // 迁移时只需要一个连接
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  console.log('   ✅ 数据库连接成功\n');

  try {
    // 4. 执行迁移SQL
    console.log('4️⃣ 执行迁移SQL...');
    console.log('   SQL内容:');
    console.log('   ' + '─'.repeat(60));
    sql.split('\n').forEach((line, i) => {
      if (line.trim() && !line.trim().startsWith('--')) {
        console.log(`   ${i + 1}. ${line.trim()}`);
      }
    });
    console.log('   ' + '─'.repeat(60) + '\n');

    // 开始事务
    await client.query('BEGIN');

    try {
      // 执行SQL（逐行执行，因为可能包含多个语句）
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement.trim()) {
          console.log(`   📝 执行语句 ${i + 1}/${statements.length}...`);
          try {
            await client.query(statement);
            console.log(`      ✅ 成功`);
          } catch (error: any) {
            // 如果是 "already exists" 错误，忽略
            if (error.message.includes('already exists') || 
                error.message.includes('duplicate') ||
                error.code === '42P07' || // duplicate_table
                error.code === '42710') { // duplicate_object
              console.log(`      ⚠️  已存在，跳过: ${error.message.split('\n')[0]}`);
            } else {
              throw error;
            }
          }
        }
      }

      // 提交事务
      await client.query('COMMIT');
      console.log('\n   ✅ 迁移执行成功！\n');

    } catch (error: any) {
      // 回滚事务
      await client.query('ROLLBACK');
      console.error(`\n   ❌ 迁移执行失败: ${error.message}`);
      console.error(`   错误代码: ${error.code || 'N/A'}`);
      throw error;
    }

  } finally {
    // 释放连接
    client.release();
    await pool.end();
  }

  // 5. 验证迁移结果
  console.log('5️⃣ 验证迁移结果...');
  const verifyClient = await pool.connect();
  
  try {
    // 检查 symbols 表的新字段
    const symbolColumns = await verifyClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'symbols' 
      AND column_name IN ('signature', 'fileId', 'updatedAt')
      ORDER BY column_name;
    `);

    console.log('   symbols 表新字段:');
    if (symbolColumns.rows.length === 0) {
      console.log('      ⚠️  未找到新字段');
    } else {
      symbolColumns.rows.forEach((row: any) => {
        console.log(`      ✅ ${row.column_name} (${row.data_type})`);
      });
    }

    // 检查 files 表的 projectId 字段
    const fileColumns = await verifyClient.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'files' 
      AND column_name = 'projectId';
    `);

    console.log('\n   files 表新字段:');
    if (fileColumns.rows.length === 0) {
      console.log('      ⚠️  未找到 projectId 字段');
    } else {
      fileColumns.rows.forEach((row: any) => {
        console.log(`      ✅ ${row.column_name} (${row.data_type})`);
      });
    }

    // 检查索引
    const indexes = await verifyClient.query(`
      SELECT indexname, tablename 
      FROM pg_indexes 
      WHERE tablename IN ('symbols', 'files')
      AND indexname IN (
        'symbols_fileId_idx',
        'symbols_file_idx',
        'files_projectId_idx',
        'files_sessionId_path_key'
      )
      ORDER BY tablename, indexname;
    `);

    console.log('\n   索引:');
    if (indexes.rows.length === 0) {
      console.log('      ⚠️  未找到新索引');
    } else {
      indexes.rows.forEach((row: any) => {
        console.log(`      ✅ ${row.indexname} (${row.tablename})`);
      });
    }

  } finally {
    verifyClient.release();
    await pool.end();
  }

  console.log('\n✅ 迁移完成！');
}

// 执行迁移
runMigration()
  .then(() => {
    console.log('\n🎉 所有操作完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 迁移失败:', error);
    process.exit(1);
  });
