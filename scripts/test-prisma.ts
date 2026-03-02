// 测试 Prisma Client 初始化问题

const fs = require('fs');
const path = require('path');

console.log('🔍 开始诊断 Prisma Client 初始化问题...\n');

// 1. 检查环境变量
console.log('1️⃣ 检查环境变量:');
const databaseUrl = process.env.DATABASE_URL || 
                    process.env.POSTGRES_URL || 
                    process.env.PRISMA_DATABASE_URL;
console.log(`   DATABASE_URL: ${databaseUrl ? databaseUrl.substring(0, 50) + '...' : '❌ 未设置'}`);
console.log(`   POSTGRES_URL: ${process.env.POSTGRES_URL ? '✅ 已设置' : '❌ 未设置'}`);
console.log(`   PRISMA_DATABASE_URL: ${process.env.PRISMA_DATABASE_URL ? '✅ 已设置' : '❌ 未设置'}`);
console.log('');

// 2. 检查 node_modules 中的 adapter
console.log('2️⃣ 检查 node_modules 中的 adapter:');
const nodeModulesPath = path.join(process.cwd(), 'node_modules');
const prismaAdapterPath = path.join(nodeModulesPath, '@prisma', 'adapter-libsql');
const libsqlPath = path.join(nodeModulesPath, '@libsql');
const libsqlRootPath = path.join(nodeModulesPath, 'libsql');

console.log(`   @prisma/adapter-libsql: ${fs.existsSync(prismaAdapterPath) ? '❌ 存在（需要删除）' : '✅ 不存在'}`);
console.log(`   @libsql: ${fs.existsSync(libsqlPath) ? '❌ 存在（需要删除）' : '✅ 不存在'}`);
console.log(`   libsql: ${fs.existsSync(libsqlRootPath) ? '❌ 存在（需要删除）' : '✅ 不存在'}`);
console.log('');

// 3. 检查 Prisma Client 生成的文件
console.log('3️⃣ 检查 Prisma Client 生成的文件:');
const prismaClientPath = path.join(nodeModulesPath, '.prisma', 'client');
const prismaClientIndex = path.join(prismaClientPath, 'index.js');
console.log(`   Prisma Client 目录: ${fs.existsSync(prismaClientPath) ? '✅ 存在' : '❌ 不存在'}`);
console.log(`   Prisma Client index.js: ${fs.existsSync(prismaClientIndex) ? '✅ 存在' : '❌ 不存在'}`);
console.log('');

// 4. 检查 package.json
console.log('4️⃣ 检查 package.json:');
const packageJsonPath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
  console.log(`   @prisma/adapter-libsql: ${deps['@prisma/adapter-libsql'] ? '❌ 在依赖中' : '✅ 不在依赖中'}`);
  console.log(`   @libsql/client: ${deps['@libsql/client'] ? '❌ 在依赖中' : '✅ 不在依赖中'}`);
  console.log(`   @prisma/client: ${deps['@prisma/client'] ? `✅ ${deps['@prisma/client']}` : '❌ 未安装'}`);
  console.log(`   prisma: ${deps['prisma'] ? `✅ ${deps['prisma']}` : '❌ 未安装'}`);
}
console.log('');

// 5. 尝试初始化 Prisma Client
console.log('5️⃣ 尝试初始化 Prisma Client:');
try {
  console.log('   正在创建 PrismaClient 实例...');
  const prisma = new PrismaClient({
    log: ['error', 'warn'],
  });
  console.log('   ✅ PrismaClient 创建成功！');
  
  // 尝试连接
  console.log('   正在测试数据库连接...');
  await prisma.$connect();
  console.log('   ✅ 数据库连接成功！');
  
  // 测试查询
  console.log('   正在测试查询...');
  await prisma.$queryRaw`SELECT 1`;
  console.log('   ✅ 查询测试成功！');
  
  await prisma.$disconnect();
  console.log('\n✅ 所有测试通过！Prisma Client 工作正常。');
} catch (error: any) {
  console.error('   ❌ Prisma Client 初始化失败:');
  console.error(`   错误类型: ${error.constructor.name}`);
  console.error(`   错误消息: ${error.message}`);
  console.error(`   错误堆栈: ${error.stack}`);
  
  // 分析错误原因
  console.log('\n📋 错误分析:');
  if (error.message?.includes('adapter')) {
    console.log('   ⚠️ 检测到 adapter 相关错误');
    console.log('   💡 可能原因：');
    console.log('      1. node_modules 中仍有 libsql adapter 残留');
    console.log('      2. Prisma Client 需要重新生成');
    console.log('      3. 需要清理 .next 缓存');
  }
  if (error.message?.includes('accelerateUrl')) {
    console.log('   ⚠️ 检测到 accelerateUrl 相关错误');
    console.log('   💡 可能原因：Prisma Accelerate 配置问题');
  }
  if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
    console.log('   ⚠️ 检测到文件未找到错误');
    console.log('   💡 可能原因：Prisma Client 未生成，需要运行 npx prisma generate');
  }
  if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connection')) {
    console.log('   ⚠️ 检测到数据库连接错误');
    console.log('   💡 可能原因：');
    console.log('      1. DATABASE_URL 配置错误');
    console.log('      2. PostgreSQL 服务未启动');
    console.log('      3. 网络连接问题');
  }
  
  console.log('\n💡 建议的修复步骤:');
  console.log('   1. 删除所有 libsql 相关目录:');
  console.log('      rm -rf node_modules/@prisma/adapter-libsql');
  console.log('      rm -rf node_modules/@libsql');
  console.log('      rm -rf node_modules/libsql');
  console.log('   2. 清理 Prisma Client 缓存:');
  console.log('      rm -rf node_modules/.prisma');
  console.log('   3. 重新生成 Prisma Client:');
  console.log('      npx prisma generate');
  console.log('   4. 清理 Next.js 缓存:');
  console.log('      rm -rf .next');
  console.log('   5. 重启应用');
}
