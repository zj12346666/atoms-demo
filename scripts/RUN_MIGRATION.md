# 执行数据库迁移

本迁移脚本会为 `symbols` 表和 `files` 表添加新字段和索引。

## 迁移内容

1. **symbols 表**：
   - 添加 `signature` 字段（TEXT）
   - 添加 `fileId` 字段（TEXT）
   - 添加 `updatedAt` 字段（TIMESTAMP）
   - 创建索引：`symbols_fileId_idx`、`symbols_file_idx`

2. **files 表**：
   - 添加 `projectId` 字段（TEXT）
   - 创建索引：`files_projectId_idx`
   - 创建唯一约束：`files_sessionId_path_key`（确保 sessionId + path 唯一）

## 执行方式

### 方式1：使用 psql（推荐）

```bash
# 从 .env.local 读取 DATABASE_URL 并执行
export DATABASE_URL=$(grep DATABASE_URL .env.local | cut -d '=' -f2)
psql $DATABASE_URL -f prisma/migrations/add_symbol_signature/migration.sql
```

### 方式2：使用 Prisma Migrate

```bash
# 如果迁移文件已经在 prisma/migrations 目录下
npx prisma migrate deploy
```

### 方式3：手动执行 SQL

1. 打开数据库管理工具（如 pgAdmin、DBeaver、或命令行 psql）
2. 连接到数据库
3. 复制 `prisma/migrations/add_symbol_signature/migration.sql` 的内容
4. 执行 SQL

### 方式4：使用 Node.js 脚本（需要先安装 tsx）

```bash
# 安装 tsx（如果未安装）
npm install -D tsx

# 执行迁移脚本
npx tsx scripts/run-migration-prisma.ts
```

## 验证迁移结果

执行以下 SQL 查询验证迁移是否成功：

```sql
-- 检查 symbols 表的新字段
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'symbols' 
AND column_name IN ('signature', 'fileId', 'updatedAt')
ORDER BY column_name;

-- 检查 files 表的 projectId 字段
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'files' 
AND column_name = 'projectId';

-- 检查索引
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
```

## 注意事项

- 迁移脚本使用了 `IF NOT EXISTS`，可以安全地重复执行
- 如果字段或索引已存在，会跳过创建（不会报错）
- 确保数据库连接正常，并且有足够的权限执行 DDL 操作
