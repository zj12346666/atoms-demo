# 执行数据库迁移（无需 psql）

由于 `psql` 命令不可用，可以使用以下方式执行迁移：

## 方式1：使用 Node.js 脚本（推荐）

### 步骤1：设置数据库连接

**选项A：使用命令行参数**
```bash
node scripts/run-migration-simple.js --url "postgresql://user:password@host:port/database"
```

**选项B：使用环境变量**
```bash
export DATABASE_URL="postgresql://user:password@host:port/database"
node scripts/run-migration-simple.js
```

**选项C：从 .env.local 读取（如果文件可访问）**
```bash
# 确保 .env.local 文件存在并包含 DATABASE_URL
node scripts/run-migration-simple.js
```

### 步骤2：执行脚本

脚本会自动：
1. 读取数据库配置
2. 读取迁移SQL文件
3. 连接数据库
4. 执行迁移SQL（使用事务，确保原子性）
5. 验证迁移结果

## 方式2：使用 Prisma Migrate

```bash
# 确保 DATABASE_URL 环境变量已设置
export DATABASE_URL="postgresql://user:password@host:port/database"

# 执行迁移
npx prisma migrate deploy
```

## 方式3：使用数据库管理工具

1. 打开数据库管理工具（如 pgAdmin、DBeaver、TablePlus、DataGrip 等）
2. 连接到数据库
3. 打开 `prisma/migrations/add_symbol_signature/migration.sql` 文件
4. 复制所有SQL内容
5. 在工具中执行SQL

## 方式4：使用在线 SQL 编辑器

如果你的数据库提供商（如 Supabase、Railway、Neon 等）提供了在线 SQL 编辑器：
1. 登录到数据库管理面板
2. 打开 SQL 编辑器
3. 复制 `prisma/migrations/add_symbol_signature/migration.sql` 的内容
4. 执行SQL

## 迁移内容

本次迁移会：

1. **symbols 表**：
   - 添加 `signature` 字段（TEXT，可为空）
   - 添加 `fileId` 字段（TEXT，可为空）
   - 添加 `updatedAt` 字段（TIMESTAMP，默认当前时间）
   - 创建索引 `symbols_fileId_idx` 和 `symbols_file_idx`

2. **files 表**：
   - 添加 `projectId` 字段（TEXT，可为空）
   - 创建索引 `files_projectId_idx`
   - 创建唯一约束 `files_sessionId_path_key`（确保 sessionId + path 唯一）

## 验证迁移

迁移完成后，可以运行以下 SQL 验证：

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

- ✅ 所有SQL语句都使用了 `IF NOT EXISTS`，可以安全地重复执行
- ✅ 如果字段或索引已存在，会跳过创建（不会报错）
- ✅ 迁移使用事务执行，确保原子性
- ⚠️ 确保数据库连接正常，并且有足够的权限执行 DDL 操作
