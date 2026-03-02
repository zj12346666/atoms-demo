// 密码加密工具（MD5 + 盐值）

import crypto from 'crypto';

const SALT_LENGTH = 16; // 盐值长度

// 生成随机盐值
export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

// MD5 加密密码（加盐）
export function hashPassword(password: string, salt: string): string {
  const hash = crypto.createHash('md5');
  hash.update(password + salt);
  return hash.digest('hex');
}

// 验证密码
export function verifyPassword(password: string, salt: string, hashedPassword: string): boolean {
  const hash = hashPassword(password, salt);
  return hash === hashedPassword;
}

// 生成密码哈希（包含盐值）
export function createPasswordHash(password: string): { salt: string; hash: string } {
  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  return { salt, hash };
}
