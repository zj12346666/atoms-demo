#!/bin/bash
# 清理 Next.js 和 Turbopack 缓存
# 运行方式: bash scripts/clean-cache.sh

echo "🧹 清理 Next.js 和 Turbopack 缓存..."
echo ""

# 1. 清理 .next 目录
if [ -d ".next" ]; then
  rm -rf .next
  echo "✅ 已清理 .next 目录"
else
  echo "ℹ️  .next 目录不存在"
fi

# 2. 清理 node_modules/.cache
if [ -d "node_modules/.cache" ]; then
  rm -rf node_modules/.cache
  echo "✅ 已清理 node_modules/.cache"
else
  echo "ℹ️  node_modules/.cache 不存在"
fi

# 3. 清理 .turbo 目录
if [ -d ".turbo" ]; then
  rm -rf .turbo
  echo "✅ 已清理 .turbo 目录"
else
  echo "ℹ️  .turbo 目录不存在"
fi

# 4. 清理 Turbopack panic 日志
if [ -d "/var/folders" ]; then
  find /var/folders -name "next-panic-*.log" -type f -delete 2>/dev/null
  echo "✅ 已清理 Turbopack panic 日志"
fi

# 5. 清理 TypeScript 构建信息
if [ -f "*.tsbuildinfo" ]; then
  rm -f *.tsbuildinfo
  echo "✅ 已清理 TypeScript 构建信息"
fi

echo ""
echo "✅ 缓存清理完成！"
echo "💡 现在可以重新启动应用: npm run dev"
