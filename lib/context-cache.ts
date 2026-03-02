// 短期上下文缓存 - 已移除 Redis 依赖，使用内存缓存作为降级方案

import { Symbol } from './keyword-indexer';

// 内存缓存（降级方案）
const memoryCache = new Map<string, { data: any; expiresAt: number }>();

// 缓存键前缀
const CACHE_PREFIX = {
  SESSION: 'session:',        // 会话上下文
  SYMBOLS: 'symbols:',        // 热门符号
  RECENT_CODE: 'recent:',     // 最近生成的代码
  QUERY_CACHE: 'query:',      // 查询结果缓存
};

// 过期时间（秒）
const TTL = {
  SESSION: 3600,      // 1小时
  SYMBOLS: 7200,      // 2小时
  RECENT_CODE: 1800,  // 30分钟
  QUERY_CACHE: 600,   // 10分钟
};

// 清理过期缓存
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiresAt < now) {
      memoryCache.delete(key);
    }
  }
}

export class ContextCache {
  // 缓存会话上下文（使用内存缓存）
  async cacheSessionContext(
    sessionId: string,
    context: {
      recentSymbols: string[];
      conversationHistory: Array<{ role: string; content: string }>;
      userPreferences?: Record<string, any>;
    }
  ): Promise<void> {
    const key = `${CACHE_PREFIX.SESSION}${sessionId}`;
    memoryCache.set(key, {
      data: context,
      expiresAt: Date.now() + TTL.SESSION * 1000,
    });
    console.log(`💾 会话上下文已缓存到内存: ${sessionId}`);
  }

  // 获取会话上下文
  async getSessionContext(sessionId: string): Promise<any | null> {
    cleanExpiredCache();
    const key = `${CACHE_PREFIX.SESSION}${sessionId}`;
    const cached = memoryCache.get(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`✅ 命中会话缓存: ${sessionId}`);
      return cached.data;
    }
    
    return null;
  }

  // 缓存热门符号（频繁使用的函数/变量）- 使用内存缓存
  async cacheHotSymbols(projectId: string, symbols: Symbol[]): Promise<void> {
    const key = `${CACHE_PREFIX.SYMBOLS}${projectId}`;
    memoryCache.set(key, {
      data: symbols,
      expiresAt: Date.now() + TTL.SYMBOLS * 1000,
    });
    console.log(`🔥 热门符号已缓存到内存: ${symbols.length} 个`);
  }

  // 获取热门符号
  async getHotSymbols(projectId: string): Promise<Symbol[] | null> {
    cleanExpiredCache();
    const key = `${CACHE_PREFIX.SYMBOLS}${projectId}`;
    const cached = memoryCache.get(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      console.log('✅ 命中符号缓存');
      return cached.data;
    }
    
    return null;
  }

  // 缓存最近生成的代码 - 使用内存缓存
  async cacheRecentCode(
    projectId: string,
    code: { html: string; css: string; js: string; description?: string }
  ): Promise<void> {
    const key = `${CACHE_PREFIX.RECENT_CODE}${projectId}`;
    memoryCache.set(key, {
      data: code,
      expiresAt: Date.now() + TTL.RECENT_CODE * 1000,
    });
    console.log('💾 最近代码已缓存到内存');
  }

  // 获取最近生成的代码
  async getRecentCode(projectId: string): Promise<any | null> {
    cleanExpiredCache();
    const key = `${CACHE_PREFIX.RECENT_CODE}${projectId}`;
    const cached = memoryCache.get(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      console.log('✅ 命中代码缓存');
      return cached.data;
    }
    
    return null;
  }

  // 缓存查询结果（避免重复查询）- 使用内存缓存
  async cacheQueryResult(query: string, result: string): Promise<void> {
    const queryHash = Buffer.from(query).toString('base64').substring(0, 32);
    const key = `${CACHE_PREFIX.QUERY_CACHE}${queryHash}`;
    memoryCache.set(key, {
      data: result,
      expiresAt: Date.now() + TTL.QUERY_CACHE * 1000,
    });
  }

  // 获取查询结果缓存
  async getQueryResult(query: string): Promise<string | null> {
    cleanExpiredCache();
    const queryHash = Buffer.from(query).toString('base64').substring(0, 32);
    const key = `${CACHE_PREFIX.QUERY_CACHE}${queryHash}`;
    const cached = memoryCache.get(key);
    
    if (cached && cached.expiresAt > Date.now()) {
      console.log('✅ 命中查询缓存');
      return cached.data;
    }
    
    return null;
  }

  // 增量更新符号使用频率（用于识别热门符号）- 使用内存 Map
  private symbolUsage = new Map<string, Map<string, number>>();

  async incrementSymbolUsage(projectId: string, symbolName: string): Promise<void> {
    if (!this.symbolUsage.has(projectId)) {
      this.symbolUsage.set(projectId, new Map());
    }
    const usageMap = this.symbolUsage.get(projectId)!;
    usageMap.set(symbolName, (usageMap.get(symbolName) || 0) + 1);
  }

  // 获取最常用的符号
  async getTopUsedSymbols(projectId: string, limit: number = 10): Promise<string[]> {
    const usageMap = this.symbolUsage.get(projectId);
    if (!usageMap) return [];

    const sorted = Array.from(usageMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name]) => name);
    
    return sorted;
  }

  // 清除项目缓存
  async clearProjectCache(projectId: string): Promise<void> {
    cleanExpiredCache();
    let cleared = 0;
    for (const key of memoryCache.keys()) {
      if (key.includes(projectId)) {
        memoryCache.delete(key);
        cleared++;
      }
    }
    this.symbolUsage.delete(projectId);
    if (cleared > 0) {
      console.log(`🗑️ 已清除 ${cleared} 个缓存键`);
    }
  }
}
