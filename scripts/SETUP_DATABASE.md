# 数据库设置指南

由于 Prisma 7.4+ 的配置变更，`prisma db push` 需要明确指定数据库 URL。

## 方法 1：使用 --url 参数（推荐）

```bash
# 直接指定数据库 URL
npx prisma db push --accept-data-loss --url "postgresql://user:password@host:port/database"
```

## 方法 2：使用环境变量

```bash
# 1. 设置环境变量
export DATABASE_URL="postgresql://user:password@host:port/database"

# 2. 运行 db push
npx prisma db push --accept-data-loss
```

## 方法 3：从 .env.local 加载（如果使用 dotenv）

```bash
# 安装 dotenv-cli（如果未安装）
npm install -D dotenv-cli

# 使用 dotenv-cli 运行
npx dotenv -e .env.local -- npx prisma db push --accept-data-loss
```

## 方法 4：使用 TypeScript 脚本

```bash
# 安装 tsx（如果未安装）
npm install -D tsx

# 运行脚本（会自动加载 .env.local）
npx tsx scripts/setup-database.ts
```

## 验证数据库表

运行以下命令检查表是否创建成功：

```bash
npx tsx scripts/check-db-tables.ts
```

## 常见问题

### 1. 错误：`The datasource.url property is required`

**原因**：Prisma 7.4+ 需要明确指定数据库 URL

**解决方案**：使用 `--url` 参数：
```bash
npx prisma db push --accept-data-loss --url "your-database-url"
```

### 2. 错误：`Cannot find module 'prisma/build/types.js'`

**原因**：`prisma.config.ts` 格式不正确或 Prisma 版本问题

**解决方案**：不使用 `prisma.config.ts`，直接使用 `--url` 参数

### 3. 错误：`The table does not exist`

**解决方案**：运行 `npx prisma db push --accept-data-loss --url "your-database-url"` 创建表

### 4. 错误：`Cannot connect to database`

**解决方案**：
- 检查数据库服务是否运行
- 检查 DATABASE_URL 是否正确
- 检查网络连接

## 需要的表

脚本会创建以下表：
- `users` - 用户表
- `sessions` - 会话表
- `files` - 文件表
- `chat_messages` - 聊天消息表
- `projects` - 项目表
- `messages` - 消息表
- `code_versions` - 代码版本表
- `symbols` - 符号表

## 快速开始

1. 确保 `.env.local` 中已设置 `DATABASE_URL`
2. 运行以下命令（替换 YOUR_DATABASE_URL）：

```bash
npx prisma db push --accept-data-loss --url "YOUR_DATABASE_URL"
```

或者使用环境变量：

```bash
export DATABASE_URL="YOUR_DATABASE_URL"
npx prisma db push --accept-data-loss
```
