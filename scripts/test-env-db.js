/**
 * 测试 .env.local 中的数据库连接
 * 执行方式: node scripts/test-env-db.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

console.log('🔍 测试 .env.local 中的数据库连接...\n');

// 读取 .env.local
function loadEnvLocal() {
  const envLocalPath = path.join(process.cwd(), '.env.local');
  
  console.log('1️⃣ 读取 .env.local 文件...');
  try {
    if (!fs.existsSync(envLocalPath)) {
      console.error(`   ❌ 文件不存在: ${envLocalPath}`);
      return null;
    }
    
    const content = fs.readFileSync(envLocalPath, 'utf-8');
    console.log(`   ✅ 文件读取成功\n`);
    
    // 解析环境变量
    const envVars = {};
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          const value = trimmed.substring(equalIndex + 1).trim();
          // 移除引号
          const cleanValue = value.replace(/^["']|["']$/g, '');
          envVars[key] = cleanValue;
        }
      }
    });
    
    return envVars;
  } catch (error) {
    console.error(`   ❌ 读取失败: ${error.message}`);
    if (error.code === 'EPERM') {
      console.error('   ⚠️  文件权限不足，无法读取');
      console.error('   💡 请手动检查 .env.local 文件中的 DATABASE_URL');
    }
    return null;
  }
}

// 解析数据库连接字符串
function parseDatabaseUrl(url) {
  if (!url) return null;
  
  try {
    // 处理 postgresql:// 或 postgres://
    const cleanUrl = url.replace(/^postgres:\/\//, 'postgresql://');
    const parsed = new URL(cleanUrl);
    
    return {
      protocol: parsed.protocol.replace(':', ''),
      hostname: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, ''),
      username: parsed.username,
      password: parsed.password ? '***' : null,
      full: url.substring(0, 50) + '...',
    };
  } catch (error) {
    console.error(`   ⚠️  无法解析连接字符串: ${error.message}`);
    return null;
  }
}

// 测试数据库连接
async function testConnection(databaseUrl) {
  console.log('3️⃣ 测试数据库连接...\n');
  
  // 解析连接字符串
  const parsed = parseDatabaseUrl(databaseUrl);
  if (parsed) {
    console.log('📋 连接信息:');
    console.log(`   协议: ${parsed.protocol}`);
    console.log(`   主机: ${parsed.hostname}`);
    console.log(`   端口: ${parsed.port}`);
    console.log(`   数据库: ${parsed.database}`);
    console.log(`   用户: ${parsed.username}`);
    console.log(`   密码: ${parsed.password ? '已设置' : '未设置'}\n`);
    
    // 检查常见问题
    if (parsed.hostname === 'base' || parsed.hostname === 'localhost' || !parsed.hostname) {
      console.log('⚠️  警告:');
      if (parsed.hostname === 'base') {
        console.log('   检测到主机名为 "base"，这可能是连接字符串格式错误');
        console.log('   正确的格式应该是: postgresql://user:pass@host:port/db');
      }
      if (parsed.hostname === 'localhost' && parsed.port === '5432') {
        console.log('   使用本地数据库，请确保 PostgreSQL 服务正在运行');
      }
      console.log('');
    }
  }
  
  // 创建连接池
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
    query_timeout: 5000,
  });
  
  try {
    console.log('🔌 尝试连接...');
    const client = await pool.connect();
    console.log('   ✅ 连接成功！\n');
    
    // 测试查询
    console.log('📊 执行测试查询...');
    const result = await client.query(`
      SELECT 
        version() as version,
        current_database() as database,
        current_user as user,
        inet_server_addr() as server_ip,
        inet_server_port() as server_port
    `);
    
    console.log('   ✅ 查询成功！\n');
    
    console.log('📋 数据库信息:');
    const row = result.rows[0];
    console.log(`   PostgreSQL 版本: ${row.version.split(' ').slice(0, 2).join(' ')}`);
    console.log(`   当前数据库: ${row.database}`);
    console.log(`   当前用户: ${row.user}`);
    if (row.server_ip) {
      console.log(`   服务器IP: ${row.server_ip}`);
    }
    if (row.server_port) {
      console.log(`   服务器端口: ${row.server_port}`);
    }
    
    // 检查表是否存在
    console.log('\n📊 检查表结构...');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('symbols', 'files', 'sessions', 'projects')
      ORDER BY table_name;
    `);
    
    if (tablesResult.rows.length > 0) {
      console.log(`   ✅ 找到 ${tablesResult.rows.length} 个相关表:`);
      tablesResult.rows.forEach(row => {
        console.log(`      - ${row.table_name}`);
      });
    } else {
      console.log('   ⚠️  未找到相关表（可能需要先运行迁移）');
    }
    
    // 检查 symbols 表的字段
    console.log('\n📊 检查 symbols 表字段...');
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'symbols'
      AND column_name IN ('signature', 'fileId', 'updatedAt')
      ORDER BY column_name;
    `);
    
    if (columnsResult.rows.length > 0) {
      console.log(`   ✅ symbols 表已包含新字段:`);
      columnsResult.rows.forEach(row => {
        console.log(`      - ${row.column_name} (${row.data_type}, ${row.is_nullable === 'YES' ? '可空' : '非空'})`);
      });
    } else {
      console.log('   ⚠️  symbols 表缺少新字段（需要运行迁移）');
    }
    
    // 检查 files 表的 projectId 字段
    console.log('\n📊 检查 files 表字段...');
    const filesColumnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'files'
      AND column_name = 'projectId';
    `);
    
    if (filesColumnsResult.rows.length > 0) {
      console.log(`   ✅ files 表已包含 projectId 字段`);
      filesColumnsResult.rows.forEach(row => {
        console.log(`      - ${row.column_name} (${row.data_type}, ${row.is_nullable === 'YES' ? '可空' : '非空'})`);
      });
    } else {
      console.log('   ⚠️  files 表缺少 projectId 字段（需要运行迁移）');
    }
    
    client.release();
    await pool.end();
    
    console.log('\n✅ 数据库连接测试通过！');
    console.log('\n💡 如果缺少字段，可以运行迁移:');
    console.log(`   node scripts/run-migration-simple.js --url "${databaseUrl}"`);
    
    return true;
    
  } catch (error) {
    console.error('   ❌ 连接失败\n');
    console.error('   错误信息:', error.message);
    console.error('   错误代码:', error.code || 'N/A');
    
    if (error.code === 'ENOTFOUND') {
      console.error('\n💡 主机名无法解析:');
      console.error('   1. 检查主机地址是否正确');
      console.error('   2. 检查网络连接');
      console.error('   3. 如果使用域名，检查 DNS 解析');
      console.error('   4. 检查连接字符串格式是否正确');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 连接被拒绝:');
      console.error('   1. 检查数据库服务是否运行');
      console.error('   2. 检查端口是否正确');
      console.error('   3. 检查防火墙设置');
    } else if (error.code === '28P01' || error.message.includes('password')) {
      console.error('\n💡 认证失败:');
      console.error('   1. 检查用户名和密码是否正确');
      console.error('   2. 检查用户是否有权限访问数据库');
    } else if (error.code === '3D000') {
      console.error('\n💡 数据库不存在:');
      console.error('   1. 检查数据库名称是否正确');
      console.error('   2. 需要先创建数据库');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('\n💡 连接超时:');
      console.error('   1. 检查网络连接');
      console.error('   2. 检查数据库服务是否运行');
      console.error('   3. 检查防火墙设置');
    }
    
    await pool.end();
    return false;
  }
}

// 主函数
async function main() {
  const envVars = loadEnvLocal();
  
  if (!envVars) {
    console.log('\n❌ 无法读取 .env.local 文件');
    console.log('\n💡 请使用以下方式之一测试数据库连接:');
    console.log('   方式1: 手动查看 .env.local 文件，然后运行:');
    console.log('      node scripts/test-db-manual.js --url "你的DATABASE_URL"');
    console.log('   方式2: 使用环境变量:');
    console.log('      export DATABASE_URL="你的DATABASE_URL"');
    console.log('      node scripts/test-db-manual.js');
    process.exit(1);
  }
  
  console.log('2️⃣ 查找数据库连接字符串...');
  const databaseUrl = envVars.DATABASE_URL || 
                     envVars.POSTGRES_URL || 
                     envVars.PRISMA_DATABASE_URL;
  
  if (!databaseUrl) {
    console.log('   ❌ 未找到 DATABASE_URL、POSTGRES_URL 或 PRISMA_DATABASE_URL');
    console.log('\n💡 请在 .env.local 中添加:');
    console.log('   DATABASE_URL="postgresql://user:password@host:port/database"');
    process.exit(1);
  }
  
  console.log(`   ✅ 找到: ${databaseUrl.substring(0, 60)}...\n`);
  
  const success = await testConnection(databaseUrl);
  process.exit(success ? 0 : 1);
}

main();
