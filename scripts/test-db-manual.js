/**
 * 手动测试数据库连接
 * 支持从环境变量或命令行参数读取
 * 
 * 使用方法:
 *   1. node scripts/test-db-manual.js --url "postgresql://..."
 *   2. export DATABASE_URL="postgresql://..." && node scripts/test-db-manual.js
 */

const { Pool } = require('pg');
const readline = require('readline');

// 获取数据库连接字符串
function getDatabaseUrl() {
  // 方式1: 命令行参数
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      return args[i + 1];
    }
  }
  
  // 方式2: 环境变量
  return process.env.DATABASE_URL || 
         process.env.POSTGRES_URL || 
         process.env.PRISMA_DATABASE_URL;
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
      database: parsed.pathname.replace(/^\//, '').split('?')[0],
      username: parsed.username,
      password: parsed.password ? '***' : null,
      searchParams: parsed.searchParams,
      full: url,
    };
  } catch (error) {
    return null;
  }
}

// 测试数据库连接
async function testConnection(databaseUrl) {
  console.log('🔍 测试数据库连接...\n');
  
  // 解析连接字符串
  const parsed = parseDatabaseUrl(databaseUrl);
  if (!parsed) {
    console.error('❌ 无法解析数据库连接字符串');
    console.error('💡 格式应该是: postgresql://user:password@host:port/database');
    return false;
  }
  
  console.log('📋 连接信息:');
  console.log(`   协议: ${parsed.protocol}`);
  console.log(`   主机: ${parsed.hostname}`);
  console.log(`   端口: ${parsed.port}`);
  console.log(`   数据库: ${parsed.database}`);
  console.log(`   用户: ${parsed.username}`);
  console.log(`   密码: ${parsed.password ? '已设置' : '未设置'}`);
  
  // 检查常见问题
  console.log('\n⚠️  连接字符串检查:');
  if (parsed.hostname === 'base') {
    console.error('   ❌ 检测到主机名为 "base"，这可能是连接字符串格式错误！');
    console.error('   💡 正确的格式应该是: postgresql://user:pass@host:port/db');
    console.error('   💡 常见错误: 缺少 @ 符号或主机名部分');
    return false;
  }
  
  if (!parsed.database || parsed.database === '') {
    console.error('   ❌ 数据库名称为空');
    return false;
  }
  
  if (!parsed.username) {
    console.error('   ❌ 用户名为空');
    return false;
  }
  
  console.log('   ✅ 格式检查通过\n');
  
  // 创建连接池
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
    query_timeout: 5000,
  });
  
  try {
    console.log('🔌 尝试连接数据库...');
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
        inet_server_port() as server_port,
        pg_database_size(current_database()) as db_size
    `);
    
    console.log('   ✅ 查询成功！\n');
    
    console.log('📋 数据库信息:');
    const row = result.rows[0];
    const versionMatch = row.version.match(/PostgreSQL (\d+\.\d+)/);
    console.log(`   PostgreSQL 版本: ${versionMatch ? versionMatch[1] : '未知'}`);
    console.log(`   当前数据库: ${row.database}`);
    console.log(`   当前用户: ${row.user}`);
    if (row.server_ip) {
      console.log(`   服务器IP: ${row.server_ip}`);
    }
    if (row.server_port) {
      console.log(`   服务器端口: ${row.server_port}`);
    }
    if (row.db_size) {
      const sizeMB = Math.round(row.db_size / 1024 / 1024);
      console.log(`   数据库大小: ${sizeMB} MB`);
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
      console.log('   ⚠️  未找到相关表（可能需要先创建表结构）');
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
      console.error('\n   常见问题:');
      console.error('   - 主机名拼写错误');
      console.error('   - 缺少 @ 符号: postgresql://userpass@host/db (错误)');
      console.error('   - 正确格式: postgresql://user:pass@host/db');
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
  let databaseUrl = getDatabaseUrl();
  
  if (!databaseUrl) {
    console.log('❌ 未找到数据库连接字符串\n');
    console.log('💡 使用方法:');
    console.log('   方式1: node scripts/test-db-manual.js --url "postgresql://user:pass@host:port/db"');
    console.log('   方式2: export DATABASE_URL="postgresql://..." && node scripts/test-db-manual.js');
    console.log('\n📝 连接字符串格式:');
    console.log('   postgresql://用户名:密码@主机:端口/数据库名');
    console.log('   示例: postgresql://postgres:mypassword@localhost:5432/mydb');
    process.exit(1);
  }
  
  console.log(`📝 连接字符串: ${databaseUrl.substring(0, 60)}...\n`);
  
  const success = await testConnection(databaseUrl);
  process.exit(success ? 0 : 1);
}

main();
