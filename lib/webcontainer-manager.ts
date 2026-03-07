import { WebContainer } from '@webcontainer/api';

/**
 * 全局 WebContainer 管理器
 * 确保整个应用只有一个 WebContainer 实例
 * 使用引用计数来管理实例的生命周期
 */
class WebContainerManager {
  private instance: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private teardownPromise: Promise<void> | null = null;
  private isBooting = false;
  private refCount = 0; // 引用计数

  /**
   * 获取或启动 WebContainer 实例
   * @returns WebContainer 实例
   */
  async boot(): Promise<WebContainer> {
    // 如果已有实例，增加引用计数并返回
    if (this.instance) {
      this.refCount++;
      console.log(`✅ [WebContainerManager] 返回现有实例 (引用计数: ${this.refCount})`);
      return this.instance;
    }

    // 如果正在启动中，等待启动完成
    if (this.bootPromise) {
      console.log('⏳ [WebContainerManager] 等待启动完成...');
      const instance = await this.bootPromise;
      this.refCount++;
      return instance;
    }

    // 如果正在清理，等待清理完成
    if (this.teardownPromise) {
      console.log('⏳ [WebContainerManager] 等待清理完成...');
      try {
        await this.teardownPromise;
      } catch (e) {
        // teardown 内部错误（如 Process aborted）不应阻止重新启动
        console.warn('⚠️ [WebContainerManager] 清理过程中出现错误（忽略）:', (e as any)?.message);
      }
      this.teardownPromise = null;
    }

    // 防止并发启动
    if (this.isBooting) {
      console.log('⚠️ [WebContainerManager] 启动已在进行中，等待...');
      // 等待一小段时间后重试
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.boot();
    }

    this.isBooting = true;
    this.refCount = 1; // 第一个引用
    console.log('🚀 [WebContainerManager] 启动新的 WebContainer 实例...');

    this.bootPromise = WebContainer.boot()
      .then((instance) => {
        this.instance = instance;
        this.isBooting = false;
        this.bootPromise = null;
        console.log(`✅ [WebContainerManager] WebContainer 启动成功 (引用计数: ${this.refCount})`);
        return instance;
      })
      .catch((error) => {
        this.isBooting = false;
        this.bootPromise = null;
        this.refCount = 0;
        console.error('❌ [WebContainerManager] WebContainer 启动失败:', error);
        throw error;
      });

    return this.bootPromise;
  }

  /**
   * 释放对 WebContainer 实例的引用
   * 当引用计数为 0 时，清理实例
   */
  async release(): Promise<void> {
    if (!this.instance) {
      console.log('ℹ️ [WebContainerManager] 没有实例需要释放');
      return;
    }

    this.refCount--;
    console.log(`🔽 [WebContainerManager] 释放引用 (引用计数: ${this.refCount})`);

    // 只有当引用计数为 0 时才真正清理
    if (this.refCount <= 0) {
      this.refCount = 0;
      await this.teardown();
    }
  }

  /**
   * 清理 WebContainer 实例
   */
  async teardown(): Promise<void> {
    if (!this.instance) {
      console.log('ℹ️ [WebContainerManager] 没有实例需要清理');
      return;
    }

    // 如果正在清理，等待清理完成
    if (this.teardownPromise) {
      console.log('⏳ [WebContainerManager] 等待清理完成...');
      return this.teardownPromise;
    }

    const instance = this.instance;
    this.instance = null;
    this.bootPromise = null;
    this.refCount = 0;

    console.log('🧹 [WebContainerManager] 开始清理 WebContainer 实例...');
    const teardownResult = instance.teardown();
    this.teardownPromise = Promise.resolve(teardownResult)
      .then(() => {
        console.log('✅ [WebContainerManager] WebContainer 清理完成');
        this.teardownPromise = null;
      })
      .catch((error: any) => {
        console.error('❌ [WebContainerManager] WebContainer 清理失败:', error);
        this.teardownPromise = null;
        throw error;
      });

    return this.teardownPromise;
  }

  /**
   * 获取当前实例（不启动）
   */
  getInstance(): WebContainer | null {
    return this.instance;
  }

  /**
   * 检查是否有实例
   */
  hasInstance(): boolean {
    return this.instance !== null;
  }

  /**
   * 获取当前引用计数
   */
  getRefCount(): number {
    return this.refCount;
  }
}

// 导出单例
export const webContainerManager = new WebContainerManager();
