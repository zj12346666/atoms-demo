/**
 * 测试数据库连接的简单脚本
 * 执行方式: node scripts/test-db-connection-simple.js --url "postgresql://..."
 */

const { Pool } = require('pg');

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

async function testConnection() {
  console.log('🔍 测试数据库连接...\n');
  
  const databaseUrl = getDatabaseUrl();
  
  if (!databaseUrl) {
    console.error('❌ 未找到数据库连接字符串');
    console.error('\n💡 使用方法:');
    console.error('   node scripts/test-db-connection-simple.js --url "postgresql://..."');
    console.error('   或设置环境变量: export DATABASE_URL="postgresql://..."');
    process.exit(1);
  }
  
  console.log(`📝 连接字符串: ${databaseUrl.substring(0, 50)}...\n`);
  
  // 解析连接字符串
  try {
    const url = new URL(databaseUrl);
    console.log('📋 连接信息:');
    console.log(`   协议: ${url.protocol.replace(':', '')}`);
    console.log(`   主机: ${url.hostname}`);
    console.log(`   端口: ${url.port || '5432 (默认)'}`);
    console.log(`   数据库: ${url.pathname.replace('/', '')}`);
    console.log(`   用户: ${url.username || '未指定'}\n`);
  } catch (e) {
    console.log('⚠️  无法解析连接字符串格式\n');
  }
  
  // 测试连接
  console.log('🔌 尝试连接数据库...');
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  
  try {
    const client = await pool.connect();
    console.log('   ✅ 连接成功！\n');
    
    // 测试查询
    console.log('📊 测试查询...');
    const result = await client.query('SELECT version(), current_database(), current_user');
    console.log('   ✅ 查询成功！\n');
    
    console.log('📋 数据库信息:');
    console.log(`   PostgreSQL 版本: ${result.rows[0].version.split(' ').slice(0, 2).join(' ')}`);
    console.log(`   当前数据库: ${result.rows[0].current_database}`);
    console.log(`   当前用户: ${result.rows[0].current_user}\n`);
    
    client.release();
    await pool.end();
    
    console.log('✅ 数据库连接测试通过！');
    console.log('\n💡 现在可以执行迁移:');
    console.log(`   node scripts/run-migration-simple.js --url "${databaseUrl}"`);
    
  } catch (error) {
    console.error('   ❌ 连接失败\n');
    console.error('   错误信息:', error.message);
    console.error('   错误代码:', error.code || 'N/A');
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 连接被拒绝，请检查:');
      console.error('   1. 数据库服务是否运行');
      console.error('   2. 主机地址和端口是否正确');
      console.error('   3. 防火墙设置');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 主机名无法解析，请检查:');
      console.error('   1. 主机地址是否正确');
      console.error('   2. 网络连接是否正常');
    } else if (error.code === '28P01' || error.message.includes('password')) {
      console.error('\n💡 认证失败，请检查:');
      console.error('   1. 用户名和密码是否正确');
      console.error('   2. 用户是否有权限访问数据库');
    } else if (error.code === '3D000') {
      console.error('\n💡 数据库不存在，请检查:');
      console.error('   1. 数据库名称是否正确');
      console.error('   2. 是否需要先创建数据库');
    }
    
    await pool.end();
    process.exit(1);
  }
}

testConnection();
