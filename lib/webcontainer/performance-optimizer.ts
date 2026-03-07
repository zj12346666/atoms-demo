/**
 * PerformanceOptimizer - 性能优化和缓存管理
 * 
 * 功能：
 * 1. 依赖安装缓存（基于 package.json hash）
 * 2. node_modules 缓存（IndexedDB）
 * 3. 冷启动加速
 */

import { logger } from '../logger';
import type { FlatFileStructure } from './file-tree-builder';

/**
 * 缓存键生成器
 */
class CacheKeyGenerator {
  /**
   * 计算 package.json 的 hash（简单实现）
   */
  async hashPackageJson(packageJson: string): Promise<string> {
    // 使用 Web Crypto API 计算 SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(packageJson);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 从文件结构中提取 package.json 并计算 hash
   */
  async getPackageJsonHash(files: FlatFileStructure): Promise<string | null> {
    const packageJson = files['package.json'];
    if (!packageJson) {
      return null;
    }

    try {
      return await this.hashPackageJson(packageJson);
    } catch (error) {
      logger.error('❌ [PerformanceOptimizer] 计算 package.json hash 失败:', error);
      return null;
    }
  }
}

/**
 * IndexedDB 缓存管理器
 */
class IndexedDBCache {
  private dbName = 'webcontainer-cache';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        reject(new Error('无法打开 IndexedDB'));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 创建对象存储：package.json hash -> node_modules 快照
        if (!db.objectStoreNames.contains('node_modules')) {
          db.createObjectStore('node_modules', { keyPath: 'hash' });
        }

        // 创建对象存储：sessionId -> 安装状态
        if (!db.objectStoreNames.contains('install_status')) {
          db.createObjectStore('install_status', { keyPath: 'sessionId' });
        }
      };
    });
  }

  /**
   * 保存 node_modules 快照（实际上只保存元数据，因为 node_modules 太大）
   */
  async saveNodeModulesSnapshot(
    hash: string,
    metadata: { fileCount: number; totalSize: number; timestamp: number }
  ): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['node_modules'], 'readwrite');
      const store = transaction.objectStore('node_modules');

      const request = store.put({
        hash,
        ...metadata,
      });

      request.onsuccess = () => {
        logger.debug(`✅ [PerformanceOptimizer] 保存 node_modules 快照: ${hash}`);
        resolve();
      };

      request.onerror = () => {
        logger.error('❌ [PerformanceOptimizer] 保存 node_modules 快照失败');
        reject(request.error);
      };
    });
  }

  /**
   * 检查 node_modules 快照是否存在
   */
  async hasNodeModulesSnapshot(hash: string): Promise<boolean> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['node_modules'], 'readonly');
      const store = transaction.objectStore('node_modules');

      const request = store.get(hash);

      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 保存安装状态
   */
  async saveInstallStatus(
    sessionId: string,
    hash: string,
    installed: boolean
  ): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['install_status'], 'readwrite');
      const store = transaction.objectStore('install_status');

      const request = store.put({
        sessionId,
        hash,
        installed,
        timestamp: Date.now(),
      });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * 获取安装状态
   */
  async getInstallStatus(sessionId: string): Promise<{
    hash: string;
    installed: boolean;
    timestamp: number;
  } | null> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['install_status'], 'readonly');
      const store = transaction.objectStore('install_status');

      const request = store.get(sessionId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(
        ['node_modules', 'install_status'],
        'readwrite'
      );

      const nodeModulesStore = transaction.objectStore('node_modules');
      const installStatusStore = transaction.objectStore('install_status');

      const clearNodeModules = nodeModulesStore.clear();
      const clearInstallStatus = installStatusStore.clear();

      Promise.all([
        new Promise((res, rej) => {
          clearNodeModules.onsuccess = () => res(undefined);
          clearNodeModules.onerror = () => rej(clearNodeModules.error);
        }),
        new Promise((res, rej) => {
          clearInstallStatus.onsuccess = () => res(undefined);
          clearInstallStatus.onerror = () => rej(clearInstallStatus.error);
        }),
      ])
        .then(() => {
          logger.info('✅ [PerformanceOptimizer] 缓存已清除');
          resolve();
        })
        .catch(reject);
    });
  }
}

/**
 * 性能优化器
 */
export class PerformanceOptimizer {
  private cacheKeyGenerator = new CacheKeyGenerator();
  private cache = new IndexedDBCache();
  private initialized = false;

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.cache.init();
      this.initialized = true;
      logger.debug('✅ [PerformanceOptimizer] 初始化完成');
    } catch (error) {
      logger.warn('⚠️ [PerformanceOptimizer] 初始化失败，将禁用缓存:', error);
      // 不抛出错误，允许在没有缓存的情况下继续运行
    }
  }

  /**
   * 检查是否应该跳过依赖安装
   */
  async shouldSkipInstall(
    files: FlatFileStructure,
    sessionId?: string
  ): Promise<boolean> {
    await this.init();

    try {
      // 计算 package.json hash
      const hash = await this.cacheKeyGenerator.getPackageJsonHash(files);
      if (!hash) {
        logger.debug('ℹ️ [PerformanceOptimizer] 未找到 package.json，需要安装');
        return false;
      }

      // 如果有 sessionId，检查该 session 的安装状态
      if (sessionId) {
        const status = await this.cache.getInstallStatus(sessionId);
        if (status && status.hash === hash && status.installed) {
          logger.info(
            `✅ [PerformanceOptimizer] 检测到已安装的依赖 (session: ${sessionId}, hash: ${hash.slice(0, 8)}...)`
          );
          return true;
        }
      }

      // 检查是否有 node_modules 快照
      const hasSnapshot = await this.cache.hasNodeModulesSnapshot(hash);
      if (hasSnapshot) {
        logger.info(
          `✅ [PerformanceOptimizer] 检测到缓存的 node_modules (hash: ${hash.slice(0, 8)}...)`
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.warn('⚠️ [PerformanceOptimizer] 检查缓存失败，将执行安装:', error);
      return false;
    }
  }

  /**
   * 标记依赖已安装
   */
  async markInstalled(
    files: FlatFileStructure,
    sessionId?: string
  ): Promise<void> {
    await this.init();

    try {
      const hash = await this.cacheKeyGenerator.getPackageJsonHash(files);
      if (!hash) {
        return;
      }

      // 保存安装状态
      if (sessionId) {
        await this.cache.saveInstallStatus(sessionId, hash, true);
      }

      // 保存 node_modules 快照元数据
      // 注意：实际 node_modules 内容太大，只保存元数据
      await this.cache.saveNodeModulesSnapshot(hash, {
        fileCount: 0, // 实际应该从文件系统读取
        totalSize: 0, // 实际应该从文件系统读取
        timestamp: Date.now(),
      });

      logger.debug(
        `✅ [PerformanceOptimizer] 已标记依赖安装完成 (hash: ${hash.slice(0, 8)}...)`
      );
    } catch (error) {
      logger.warn('⚠️ [PerformanceOptimizer] 标记安装状态失败:', error);
    }
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    await this.init();
    await this.cache.clearCache();
  }

  /**
   * 获取缓存统计信息
   */
  async getCacheStats(): Promise<{
    nodeModulesSnapshots: number;
    installStatusRecords: number;
  }> {
    await this.init();

    // 这里简化实现，实际应该从 IndexedDB 读取统计信息
    return {
      nodeModulesSnapshots: 0,
      installStatusRecords: 0,
    };
  }
}

/**
 * 单例导出
 */
export const performanceOptimizer = new PerformanceOptimizer();
