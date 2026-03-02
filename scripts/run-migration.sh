#!/bin/bash

# 执行数据库迁移脚本
# 使用方法: bash scripts/run-migration.sh

set -e

echo "🚀 开始执行数据库迁移..."
echo ""

# 1. 检查 .env.local 文件
if [ ! -f ".env.local" ]; then
    echo "❌ 错误: .env.local 文件不存在"
    echo "💡 请创建 .env.local 文件并设置 DATABASE_URL"
    exit 1
fi

# 2. 读取 DATABASE_URL
echo "1️⃣ 读取数据库配置..."
DATABASE_URL=$(grep -E "^DATABASE_URL=|^POSTGRES_URL=" .env.local | head -1 | cut -d '=' -f2- | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

if [ -z "$DATABASE_URL" ]; then
    echo "❌ 错误: 未找到 DATABASE_URL 或 POSTGRES_URL"
    echo "💡 请在 .env.local 中设置 DATABASE_URL"
    exit 1
fi

echo "   ✅ DATABASE_URL 已找到"
echo ""

# 3. 检查迁移文件
MIGRATION_FILE="prisma/migrations/add_symbol_signature/migration.sql"
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ 错误: 迁移文件不存在: $MIGRATION_FILE"
    exit 1
fi

echo "2️⃣ 检查迁移文件..."
echo "   ✅ 迁移文件存在: $MIGRATION_FILE"
echo ""

# 4. 检查 psql 是否可用
if command -v psql &> /dev/null; then
    echo "3️⃣ 使用 psql 执行迁移..."
    echo "   SQL 内容预览:"
    echo "   ────────────────────────────────────────────────────────────"
    grep -v "^--" "$MIGRATION_FILE" | grep -v "^$" | head -10 | nl
    echo "   ────────────────────────────────────────────────────────────"
    echo ""
    
    # 执行迁移
    psql "$DATABASE_URL" -f "$MIGRATION_FILE" -v ON_ERROR_STOP=1
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ 迁移执行成功！"
        echo ""
        echo "5️⃣ 验证迁移结果..."
        
        # 验证 symbols 表
        psql "$DATABASE_URL" -c "
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'symbols' 
            AND column_name IN ('signature', 'fileId', 'updatedAt')
            ORDER BY column_name;
        "
        
        # 验证 files 表
        psql "$DATABASE_URL" -c "
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'files' 
            AND column_name = 'projectId';
        "
        
        # 验证索引
        psql "$DATABASE_URL" -c "
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
        "
        
        echo ""
        echo "🎉 所有操作完成！"
    else
        echo ""
        echo "❌ 迁移执行失败"
        exit 1
    fi
    
else
    echo "⚠️  psql 命令不可用"
    echo ""
    echo "💡 请使用以下方式之一执行迁移："
    echo ""
    echo "方式1: 安装 PostgreSQL 客户端工具后重试"
    echo "方式2: 使用 Prisma Migrate:"
    echo "   npx prisma migrate deploy"
    echo ""
    echo "方式3: 手动执行 SQL:"
    echo "   1. 打开数据库管理工具"
    echo "   2. 连接到数据库"
    echo "   3. 执行文件: $MIGRATION_FILE"
    echo ""
    echo "方式4: 使用 Node.js 脚本（需要先安装 tsx）:"
    echo "   npm install -D tsx"
    echo "   npx tsx scripts/run-migration-prisma.ts"
    echo ""
    exit 1
fi
