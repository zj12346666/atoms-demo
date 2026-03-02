// 上下文存储服务 - 基于 Prisma + PostgreSQL

import { prisma } from './db';
import { CodeKeywordIndexer, Symbol as IndexSymbol } from './keyword-indexer';

export class ContextStorage {
  private indexer: CodeKeywordIndexer;

  constructor() {
    this.indexer = new CodeKeywordIndexer();
  }

  // 存储代码并建立索引
  async storeCode(projectId: string, code: { html: string; css: string; js: string; description?: string }) {
    if (!prisma) {
      throw new Error('Database not available');
    }

    // 1. 存储代码版本
    const version = await prisma.codeVersion.create({
      data: {
        projectId,
        html: code.html,
        css: code.css,
        js: code.js,
        ...(code.description && { description: code.description }),
      },
    });

    // 2. 提取符号并存储
    const symbols: IndexSymbol[] = [
      ...this.indexer.extractSymbols(code.js, 'js'),
      ...this.indexer.extractSymbols(code.html, 'html'),
      ...this.indexer.extractSymbols(code.css, 'css'),
    ];

    // 3. 批量插入符号表
    if (symbols.length > 0 && prisma && 'symbol' in prisma) {
      await (prisma as any).symbol.createMany({
        data: symbols.map(symbol => ({
          projectId,
          name: symbol.name,
          type: symbol.type,
          snippet: symbol.snippet,
          line: symbol.line,
          keywords: symbol.keywords,
        })),
      });
    }

    console.log(`✅ 存储完成: ${symbols.length} 个符号已索引`);
    
    return version;
  }

  // 关键词检索上下文（支持 Redis 缓存）
  async retrieveContext(
    projectId: string,
    userQuery: string,
    cache?: { getQueryResult?: (q: string) => Promise<string | null>; cacheQueryResult?: (q: string, r: string) => Promise<void> }
  ): Promise<string> {
    if (!prisma) {
      return '';
    }
    // 0. 尝试从缓存获取
    if (cache?.getQueryResult) {
      const cached = await cache.getQueryResult(userQuery);
      if (cached) {
        return cached;
      }
    }

    // 1. 提取查询关键词
    const queryKeywords = userQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);

    console.log('🔍 检索关键词:', queryKeywords);

    // 2. 从数据库查询符号
    const symbols = await (prisma as any).symbol.findMany({
      where: {
        projectId,
        OR: [
          // 名称匹配
          {
            name: {
              in: queryKeywords,
              mode: 'insensitive',
            },
          },
          // 关键词数组匹配（PostgreSQL 数组操作）
          {
            keywords: {
              hasSome: queryKeywords,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10, // 限制返回数量
    });

    console.log(`✅ 找到 ${symbols.length} 个相关符号`);

    // 3. 构建上下文
    if (symbols.length === 0) {
      return '';
    }

    const context = `### PROJECT CONTEXT (Keyword-Retrieved)
---
检索到 ${symbols.length} 个相关符号：

${symbols.map((symbol: any) => `
#### [${symbol.type.toUpperCase()}] ${symbol.name}
\`\`\`
${symbol.snippet}
\`\`\`
关键词: ${symbol.keywords.slice(0, 5).join(', ')}
`).join('\n')}

---
`;

    // 4. 缓存结果
    if (cache?.cacheQueryResult) {
      await cache.cacheQueryResult(userQuery, context);
    }

    return context;
  }

  // 获取最新代码
  async getLatestCode(projectId: string) {
    if (!prisma) return null;
    return prisma.codeVersion.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 清理项目上下文
  async clearContext(projectId: string) {
    if (!prisma || !('symbol' in prisma)) return;
    await (prisma as any).symbol.deleteMany({
      where: { projectId },
    });
  }
}
