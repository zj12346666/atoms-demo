/**
 * 简单的数据库迁移脚本（使用 Node.js，无需 tsx）
 * 执行方式: node scripts/run-migration-simple.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// 加载环境变量（支持多种方式）
function loadEnv() {
  const envVars = {};
  
  // 方式1: 从命令行参数读取
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      envVars.DATABASE_URL = args[i + 1];
      break;
    }
  }
  
  // 方式2: 从环境变量读取
  if (!envVars.DATABASE_URL) {
    envVars.DATABASE_URL = process.env.DATABASE_URL;
    envVars.POSTGRES_URL = process.env.POSTGRES_URL;
    envVars.PRISMA_DATABASE_URL = process.env.PRISMA_DATABASE_URL;
  }
  
  // 方式3: 尝试读取 .env.local（如果可访问）
  if (!envVars.DATABASE_URL && !envVars.POSTGRES_URL && !envVars.PRISMA_DATABASE_URL) {
    try {
      const envFile = fs.readFileSync('.env.local', 'utf-8');
      envFile.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            envVars[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    } catch (error) {
      // 忽略文件读取错误，继续使用环境变量
    }
  }
  
  return envVars;
}

async function runMigration() {
  console.log('🚀 开始执行数据库迁移...\n');

  // 1. 加载环境变量
  console.log('1️⃣ 读取数据库配置...');
  const env = loadEnv();
  const databaseUrl = env.DATABASE_URL || env.POSTGRES_URL || env.PRISMA_DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ 错误: 未找到 DATABASE_URL 或 POSTGRES_URL');
    console.error('');
    console.error('💡 请使用以下方式之一提供数据库连接：');
    console.error('');
    console.error('方式1: 使用命令行参数');
    console.error('   node scripts/run-migration-simple.js --url "postgresql://user:password@host:port/database"');
    console.error('');
    console.error('方式2: 使用环境变量');
    console.error('   export DATABASE_URL="postgresql://user:password@host:port/database"');
    console.error('   node scripts/run-migration-simple.js');
    console.error('');
    console.error('方式3: 在 .env.local 中设置（如果文件可访问）');
    console.error('   DATABASE_URL="postgresql://user:password@host:port/database"');
    process.exit(1);
  }

  // 检查是否是示例连接字符串
  const isExampleUrl = databaseUrl.includes('password@localhost:5432/mydb') || 
                       databaseUrl.includes('postgres:password@localhost');
  
  if (isExampleUrl) {
    console.log(`   ⚠️  检测到示例连接字符串: ${databaseUrl.substring(0, 50)}...`);
    console.log('   ⚠️  请使用实际的数据库连接字符串！\n');
    console.log('💡 如何获取正确的连接字符串:');
    console.log('   1. 运行: node scripts/get-db-url.js');
    console.log('   2. 或从 .env.local 文件中查找 DATABASE_URL');
    console.log('   3. 或从数据库提供商获取连接字符串\n');
  } else {
    console.log(`   ✅ DATABASE_URL 已找到: ${databaseUrl.substring(0, 50)}...\n`);
  }

  // 2. 读取迁移SQL文件
  console.log('2️⃣ 读取迁移SQL文件...');
  const migrationPath = path.join(process.cwd(), 'prisma/migrations/add_symbol_signature/migration.sql');
  
  let sql;
  try {
    sql = fs.readFileSync(migrationPath, 'utf-8');
    console.log(`   ✅ 已读取: ${migrationPath}\n`);
  } catch (error) {
    console.error(`   ❌ 读取失败: ${error.message}`);
    process.exit(1);
  }

  // 3. 连接数据库
  console.log('3️⃣ 连接数据库...');
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  let client;
  try {
    client = await pool.connect();
    console.log('   ✅ 数据库连接成功\n');
  } catch (error) {
    console.error('   ❌ 数据库连接失败\n');
    console.error('   错误信息:', error.message);
    console.error('   错误代码:', error.code || 'N/A');
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 连接被拒绝，可能的原因:');
      console.error('   1. 数据库服务未启动');
      console.error('   2. 数据库连接字符串不正确');
      console.error('   3. 数据库不在 localhost:5432');
      console.error('\n🔧 解决方案:');
      console.error('   1. 检查数据库服务是否运行:');
      console.error('      - macOS: brew services list | grep postgresql');
      console.error('      - Linux: sudo systemctl status postgresql');
      console.error('      - Docker: docker ps | grep postgres');
      console.error('   2. 确认数据库连接字符串格式:');
      console.error('      postgresql://用户名:密码@主机:端口/数据库名');
      console.error('   3. 如果使用远程数据库，确保主机地址正确');
      console.error('   4. 运行以下命令获取正确的连接字符串:');
      console.error('      node scripts/get-db-url.js');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 主机名无法解析，请检查:');
      console.error('   1. 数据库主机地址是否正确');
      console.error('   2. 网络连接是否正常');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('\n💡 连接超时，请检查:');
      console.error('   1. 数据库服务是否运行');
      console.error('   2. 防火墙设置');
      console.error('   3. 数据库端口是否正确');
    }
    
    await pool.end();
    process.exit(1);
  }

  try {
    // 4. 执行迁移SQL
    console.log('4️⃣ 执行迁移SQL...');
    console.log('   SQL内容预览:');
    console.log('   ' + '─'.repeat(60));
    sql.split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('--'))
      .slice(0, 10)
      .forEach((line, i) => {
        console.log(`   ${i + 1}. ${line.trim()}`);
      });
    console.log('   ' + '─'.repeat(60) + '\n');

    // 注意：某些DDL语句（如CREATE INDEX）在事务中可能有问题，我们逐个执行
    // 分割SQL语句（更智能的分割，处理多行语句）
    const lines = sql.split('\n');
    const statements = [];
    let currentStatement = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      // 跳过注释和空行
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      
      currentStatement += (currentStatement ? ' ' : '') + trimmed;
      
      // 如果行以分号结尾，说明语句结束
      if (trimmed.endsWith(';')) {
        const stmt = currentStatement.replace(/;$/, '').trim();
        if (stmt.length > 0) {
          statements.push(stmt);
        }
        currentStatement = '';
      }
    }
    
    // 处理最后一条可能没有分号的语句
    if (currentStatement.trim().length > 0) {
      statements.push(currentStatement.trim());
    }

    console.log(`   共 ${statements.length} 条SQL语句\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        console.log(`   📝 执行语句 ${i + 1}/${statements.length}...`);
        console.log(`      内容: ${statement.substring(0, 80)}${statement.length > 80 ? '...' : ''}`);
        try {
          // 对于ALTER TABLE和CREATE INDEX，不使用事务，直接执行
          await client.query(statement);
          console.log(`      ✅ 成功\n`);
        } catch (error) {
          // 如果是 "already exists" 错误，忽略
          if (error.message.includes('already exists') || 
              error.message.includes('duplicate') ||
              error.message.includes('IF NOT EXISTS') ||
              error.code === '42P07' || // duplicate_table
              error.code === '42710' || // duplicate_object
              error.code === '23505') { // unique_violation
            console.log(`      ⚠️  已存在，跳过: ${error.message.split('\n')[0]}\n`);
          } else {
            console.error(`      ❌ 失败: ${error.message}`);
            console.error(`      错误代码: ${error.code || 'N/A'}\n`);
            // 继续执行下一条语句，不中断
          }
        }
      }
    }

    console.log('   ✅ 所有语句执行完成！\n');

    // 不再使用事务，因为某些DDL语句在事务中可能有问题

  } finally {
      // 释放连接（但保持连接池打开用于验证）
      client.release();
    }

  // 5. 验证迁移结果（使用同一个连接池）
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

    console.log('\n   symbols 表新字段:');
    if (symbolColumns.rows.length === 0) {
      console.log('      ⚠️  未找到新字段');
    } else {
      symbolColumns.rows.forEach(row => {
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
      fileColumns.rows.forEach(row => {
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
      indexes.rows.forEach(row => {
        console.log(`      ✅ ${row.indexname} (${row.tablename})`);
      });
    }

  } finally {
    verifyClient.release();
    // 最后关闭连接池
    await pool.end();
  }

  console.log('\n✅ 迁移完成！');
  console.log('\n🎉 所有操作完成！');
}

// 执行迁移
runMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 迁移失败:', error);
    process.exit(1);
  });
