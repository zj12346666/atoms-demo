// 检查环境变量配置

console.log('🔍 环境变量检查\n');

console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✅ 已设置' : '❌ 未设置');
console.log('POSTGRES_URL:', process.env.POSTGRES_URL ? '✅ 已设置' : '❌ 未设置');
console.log('PRISMA_DATABASE_URL:', process.env.PRISMA_DATABASE_URL ? '✅ 已设置' : '❌ 未设置');
console.log('REDIS_URL:', process.env.REDIS_URL ? '✅ 已设置' : '❌ 未设置');
console.log('NODE_ENV:', process.env.NODE_ENV || '未设置');

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.PRISMA_DATABASE_URL) {
  console.log('\n❌ 数据库环境变量未设置！');
  console.log('\n💡 解决方案：');
  console.log('1. 在项目根目录创建 .env.local 文件');
  console.log('2. 添加以下内容：');
  console.log('');
  console.log('DATABASE_URL="postgres://e2a3c935945e2f3f0633c1509531df994ec064a8480727bade7ca50bb42b65b7:sk_yxW1aGIQNE8rBK260cvz_@db.prisma.io:5432/postgres?sslmode=require"');
  console.log('REDIS_URL="redis://default:7tKapeMPdUg9MfjKfdai4lSZa3TV8fIg@redis-17375.c322.us-east-1-2.ec2.cloud.redislabs.com:17375"');
  console.log('');
  console.log('3. 重启开发服务器（npm run dev）');
}
