/**
 * 手动执行数据库迁移脚本
 * 用于 Prisma 7.4+ 无法在 schema 中使用 url 的情况
 */

import { Pool } from 'pg';

const DATABASE_URL = 'postgres://e2a3c935945e2f3f0633c1509531df994ec064a8480727bade7ca50bb42b65b7:sk_yxW1aGIQNE8rBK260cvz_@db.prisma.io:5432/postgres?sslmode=require';

const migrationSQL = `
-- Add symbol_hash and last_validation fields to File table
-- This migration adds support for self-healing Code Agent features

-- Add symbol_hash column (for tracking code content changes)
ALTER TABLE "files" 
ADD COLUMN IF NOT EXISTS "symbolHash" TEXT;

-- Add last_validation column (for storing sandbox validation results)
ALTER TABLE "files" 
ADD COLUMN IF NOT EXISTS "lastValidation" JSONB;

-- Create index on symbolHash for fast lookups
CREATE INDEX IF NOT EXISTS "files_symbolHash_idx" ON "files"("symbolHash");

-- Add comment to explain the new fields
COMMENT ON COLUMN "files"."symbolHash" IS 'Hash of code content for detecting changes and re-indexing symbols';
COMMENT ON COLUMN "files"."lastValidation" IS 'Last sandbox validation result (tsc errors, etc.)';
`;

async function runMigration() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log('🔗 连接到数据库...');
    const client = await pool.connect();
    
    console.log('📝 执行迁移 SQL...');
    await client.query(migrationSQL);
    
    console.log('✅ 迁移完成！');
    
    // 验证迁移结果
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'files' 
      AND column_name IN ('symbolHash', 'lastValidation')
    `);
    
    console.log('\n📋 验证结果:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    client.release();
  } catch (error: any) {
    console.error('❌ 迁移失败:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration()
  .then(() => {
    console.log('\n✅ 所有操作完成！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 执行失败:', error);
    process.exit(1);
  });
