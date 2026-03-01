// Prisma Client Singleton
// 注意：当前 Demo 暂时不使用数据库持久化，所有数据存储在内存中
// 这是为了快速部署和演示。生产环境应启用数据库功能。

// import { PrismaClient } from '@prisma/client';
// import { PrismaLibSql } from '@prisma/adapter-libsql';
// import { createClient } from '@libsql/client';

// const globalForPrisma = globalThis as unknown as {
//   prisma: PrismaClient | undefined;
// };

// 使用 SQLite 适配器
// const libsql = createClient({
//   url: process.env.DATABASE_URL || 'file:./dev.db'
// });

// const adapter = new PrismaLibSql(libsql);

// export const prisma =
//   globalForPrisma.prisma ??
//   new PrismaClient({
//     adapter,
//     log: ['query', 'error', 'warn'],
//   });

// if (process.env.NODE_ENV !== 'production') {
//   globalForPrisma.prisma = prisma;
// }

// 临时导出空对象，避免导入错误
export const prisma = {} as any;
