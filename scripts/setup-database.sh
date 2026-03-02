#!/bin/bash
# 设置数据库表
# 运行方式: bash scripts/setup-database.sh
# 或者: npx tsx scripts/setup-database.ts

echo "🔧 设置数据库表..."
echo ""

# 优先使用 TypeScript 脚本（更可靠）
if [ -f "node_modules/.bin/tsx" ] || [ -f "node_modules/tsx/package.json" ]; then
  echo "📝 使用 TypeScript 脚本..."
  npx tsx scripts/setup-database.ts
  exit $?
fi

# 回退到 bash 脚本
echo "⚠️ tsx 未安装，使用 bash 脚本..."
echo "💡 建议安装 tsx: npm install -D tsx"
echo ""

# 1. 检查 .env.local 文件
if [ ! -f .env.local ]; then
  echo "❌ .env.local 文件不存在！"
  echo "💡 请创建 .env.local 文件并设置 DATABASE_URL"
  exit 1
fi

# 2. 检查 Prisma Client 是否已生成
if [ ! -d "node_modules/.prisma/client" ]; then
  echo "📦 生成 Prisma Client..."
  if [ -f "node_modules/.bin/prisma" ]; then
    node_modules/.bin/prisma generate
  else
    echo "⚠️ Prisma CLI 未找到，请先运行: npm install"
    exit 1
  fi
fi

# 3. 推送 schema 到数据库
echo "🚀 推送 schema 到数据库..."
echo "💡 注意：Prisma 7.4+ 需要 --url 参数或 prisma.config.ts"
echo "💡 请手动运行以下命令（替换 YOUR_DATABASE_URL）："
echo ""
echo "   npx prisma db push --accept-data-loss --url 'YOUR_DATABASE_URL'"
echo ""
echo "   或者设置环境变量后运行："
echo "   export DATABASE_URL='YOUR_DATABASE_URL'"
echo "   npx prisma db push --accept-data-loss"
echo ""
echo "⚠️ 由于权限限制，无法自动读取 .env.local"
echo "💡 请查看 scripts/SETUP_DATABASE.md 了解详细说明"
exit 0

# 以下代码保留但不会执行（因为上面已经 exit）
if [ -f "node_modules/.bin/prisma" ]; then
  # Prisma 7.4+ 需要 --url 参数
  if [ -n "$DATABASE_URL" ]; then
    node_modules/.bin/prisma db push --accept-data-loss --url "$DATABASE_URL"
  else
    echo "⚠️ DATABASE_URL 环境变量未设置"
    exit 1
  fi
else
  echo "⚠️ Prisma CLI 未找到"
  echo "💡 请手动运行: npx prisma db push --accept-data-loss"
  exit 1
fi

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ 数据库表创建成功！"
  echo ""
  echo "✅ 数据库设置完成！"
else
  echo ""
  echo "❌ 数据库表创建失败！"
  echo "💡 请检查："
  echo "   1. .env.local 中 DATABASE_URL 是否正确"
  echo "   2. 数据库服务是否运行"
  echo "   3. 网络连接是否正常"
  echo ""
  echo "💡 也可以手动运行:"
  echo "   npx prisma db push --accept-data-loss"
  exit 1
fi
