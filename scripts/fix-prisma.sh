#!/bin/bash
# 修复 Prisma Client 初始化失败的问题

echo "🔧 修复 Prisma Client 配置..."

# 1. 确保依赖已安装
echo "📦 检查依赖..."
if [ ! -d "node_modules/@prisma/adapter-pg" ]; then
  echo "⚠️ @prisma/adapter-pg 未安装，正在安装..."
  npm install @prisma/adapter-pg
fi

# 2. 清理 Prisma Client 缓存和 Next.js 缓存
echo "🧹 清理缓存..."
rm -rf node_modules/.prisma 2>/dev/null || echo "⚠️ 无法清理 Prisma 缓存"
rm -rf .next 2>/dev/null || echo "⚠️ 无法清理 Next.js 缓存"

# 3. 重新生成 Prisma Client
echo "🔄 重新生成 Prisma Client..."
npx prisma generate

if [ $? -eq 0 ]; then
  echo "✅ Prisma Client 生成成功！"
else
  echo "❌ Prisma Client 生成失败！"
  echo "💡 请检查："
  echo "   1. DATABASE_URL 环境变量是否正确配置（可选，用于验证）"
  echo "   2. prisma.config.ts 文件是否存在"
  echo "   3. prisma/schema.prisma 文件是否正确"
  exit 1
fi

echo "✅ 修复完成！"
echo "💡 现在可以重启应用: npm run dev"
