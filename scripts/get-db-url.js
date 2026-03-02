/**
 * 获取数据库连接字符串的辅助脚本
 * 执行方式: node scripts/get-db-url.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 查找数据库连接字符串...\n');

// 方式1: 检查环境变量
console.log('1️⃣ 检查环境变量:');
const envVars = ['DATABASE_URL', 'POSTGRES_URL', 'PRISMA_DATABASE_URL'];
let found = false;

envVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`   ✅ ${varName}: ${value.substring(0, 50)}...`);
    found = true;
  } else {
    console.log(`   ❌ ${varName}: 未设置`);
  }
});

if (found) {
  console.log('\n💡 可以使用以下命令执行迁移:');
  console.log('   node scripts/run-migration-simple.js');
  process.exit(0);
}

// 方式2: 尝试读取 .env.local
console.log('\n2️⃣ 检查 .env.local 文件:');
const envLocalPath = path.join(process.cwd(), '.env.local');

try {
  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, 'utf-8');
    const lines = content.split('\n');
    
    let dbUrl = null;
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        if (trimmed.startsWith('DATABASE_URL=')) {
          dbUrl = trimmed.split('=').slice(1).join('=').trim();
        } else if (trimmed.startsWith('POSTGRES_URL=')) {
          dbUrl = trimmed.split('=').slice(1).join('=').trim();
        }
      }
    });
    
    if (dbUrl) {
      console.log(`   ✅ 找到数据库连接: ${dbUrl.substring(0, 50)}...`);
      console.log('\n💡 可以使用以下命令执行迁移:');
      console.log(`   export DATABASE_URL="${dbUrl}"`);
      console.log('   node scripts/run-migration-simple.js');
      console.log('\n或者直接:');
      console.log(`   node scripts/run-migration-simple.js --url "${dbUrl}"`);
      process.exit(0);
    } else {
      console.log('   ⚠️  文件中未找到 DATABASE_URL 或 POSTGRES_URL');
    }
  } else {
    console.log('   ⚠️  .env.local 文件不存在');
  }
} catch (error) {
  console.log(`   ⚠️  无法读取文件: ${error.message}`);
}

// 方式3: 检查其他可能的配置文件
console.log('\n3️⃣ 检查其他配置文件:');
const configFiles = ['.env', '.env.production', '.env.development'];
configFiles.forEach(file => {
  const filePath = path.join(process.cwd(), file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✅ 找到: ${file}`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('DATABASE_URL') || content.includes('POSTGRES_URL')) {
        console.log(`      ⚠️  文件中包含数据库配置，请手动检查`);
      }
    } catch (e) {
      // 忽略读取错误
    }
  }
});

console.log('\n❌ 未找到数据库连接字符串');
console.log('\n💡 解决方案:');
console.log('   1. 在 .env.local 文件中设置 DATABASE_URL');
console.log('   2. 或使用环境变量: export DATABASE_URL="postgresql://..."');
console.log('   3. 或使用命令行参数: node scripts/run-migration-simple.js --url "postgresql://..."');
console.log('\n📝 数据库连接字符串格式:');
console.log('   postgresql://用户名:密码@主机:端口/数据库名');
console.log('   示例: postgresql://postgres:mypassword@localhost:5432/mydb');
