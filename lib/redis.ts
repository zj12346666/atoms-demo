// Redis 客户端 - 已移除 Redis 依赖，所有功能已迁移到 PostgreSQL
// 保留此文件以防其他地方调用，但总是返回 null

import { logger } from './logger';

// 已禁用 Redis，所有功能使用 PostgreSQL
export async function getRedisClient(): Promise<null> {
  // Redis 已移除，总是返回 null
  return null;
}

// 安全执行 Redis 操作（已禁用）
export async function safeRedisOperation<T>(
  operation: (client: any) => Promise<T>,
  fallback: T | null = null
): Promise<T | null> {
  // Redis 已移除，返回 fallback
  return fallback;
}

// 检查 Redis 是否可用（总是返回 false）
export async function isRedisAvailable(): Promise<boolean> {
  return false;
}

// 关闭 Redis 连接（空操作）
export async function closeRedis() {
  // Redis 已移除，无需操作
}
