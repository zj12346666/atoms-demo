/**
 * 检查迁移状态
 */

const { Pool } = require('pg');

const databaseUrl = process.argv[2] || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ 请提供数据库连接字符串');
  console.error('使用方法: node scripts/check-migration-status.js "postgresql://..."');
  process.exit(1);
}

async function checkMigration() {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  
  try {
    console.log('🔍 检查迁移状态...\n');
    
    // 检查 symbols 表的所有字段
    console.log('📊 symbols 表字段:');
    const symbolColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'symbols'
      ORDER BY ordinal_position;
    `);
    
    symbolColumns.rows.forEach(row => {
      const isNew = ['signature', 'fileId', 'updatedAt'].includes(row.column_name);
      const marker = isNew ? '✨' : '  ';
      console.log(`${marker} ${row.column_name.padEnd(20)} ${row.data_type.padEnd(20)} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });
    
    // 检查 files 表的所有字段
    console.log('\n📊 files 表字段:');
    const fileColumns = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'files'
      ORDER BY ordinal_position;
    `);
    
    fileColumns.rows.forEach(row => {
      const isNew = ['projectId'].includes(row.column_name);
      const marker = isNew ? '✨' : '  ';
      console.log(`${marker} ${row.column_name.padEnd(20)} ${row.data_type.padEnd(20)} ${row.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${row.column_default ? `DEFAULT ${row.column_default}` : ''}`);
    });
    
    // 检查索引
    console.log('\n📊 索引:');
    const indexes = await client.query(`
      SELECT indexname, tablename, indexdef
      FROM pg_indexes 
      WHERE tablename IN ('symbols', 'files')
      AND indexname IN (
        'symbols_fileId_idx',
        'symbols_file_idx',
        'files_projectId_idx',
        'files_sessionId_path_key'
      )
      ORDER BY tablename, indexname;
    `);
    
    if (indexes.rows.length > 0) {
      indexes.rows.forEach(row => {
        console.log(`✨ ${row.indexname} (${row.tablename})`);
      });
    } else {
      console.log('⚠️  未找到新索引');
    }
    
    // 检查唯一约束
    console.log('\n📊 唯一约束:');
    const constraints = await client.query(`
      SELECT constraint_name, table_name
      FROM information_schema.table_constraints 
      WHERE table_name IN ('files')
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%sessionId%path%';
    `);
    
    if (constraints.rows.length > 0) {
      constraints.rows.forEach(row => {
        console.log(`✨ ${row.constraint_name} (${row.table_name})`);
      });
    } else {
      console.log('⚠️  未找到唯一约束');
    }
    
  } finally {
    client.release();
    await pool.end();
  }
}

checkMigration().catch(console.error);
