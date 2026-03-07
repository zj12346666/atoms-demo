/**
 * WebContainer 热更新管理器
 * 监听 WebSocket 文件更新事件，自动同步到 WebContainer 文件系统
 * 
 * 注意：这是一个客户端模块，不能直接使用服务器端的 FileManager
 * 所有文件操作都通过 API 调用完成
 */

import { WebContainer } from '@webcontainer/api';
import { getWebSocketClient, FileUpdateEvent } from './websocket-client';
import { logger } from './logger';

export interface PackageJsonState {
  hash: string;
  content: string;
}

export class WebContainerHotReload {
  private webcontainer: WebContainer | null = null;
  private sessionId: string | null = null;
  private packageJsonState: PackageJsonState | null = null;
  private isInitialized = false;
  private wsClient: ReturnType<typeof getWebSocketClient> | null = null;
  private onPackageJsonChanged?: () => Promise<void>;

  /**
   * 初始化热更新系统
   */
  async initialize(
    webcontainer: WebContainer,
    sessionId: string,
    onPackageJsonChanged?: () => Promise<void>
  ): Promise<void> {
    if (this.isInitialized) {
      console.warn('⚠️ [HotReload] 已经初始化，跳过重复初始化');
      return;
    }

    this.webcontainer = webcontainer;
    this.sessionId = sessionId;
    this.onPackageJsonChanged = onPackageJsonChanged;

    // 初始化 package.json 状态
    await this.loadPackageJsonState();

    // 连接 WebSocket
    this.wsClient = getWebSocketClient();
    if (!this.wsClient.getConnected()) {
      this.wsClient.connect();
    }

    // 订阅会话
    this.wsClient.subscribe(sessionId);

    // 设置文件更新处理器
    this.wsClient.setHandlers({
      onFileUpdate: (event: FileUpdateEvent) => {
        this.handleFileUpdate(event);
      },
      onFileUpdates: (events: FileUpdateEvent[]) => {
        // 批量处理文件更新
        for (const event of events) {
          this.handleFileUpdate(event);
        }
      },
    });

    this.isInitialized = true;
    console.log(`✅ [HotReload] 热更新系统已初始化 (session: ${sessionId})`);
  }

  /**
   * 加载 package.json 状态（直接从 WebContainer 文件系统读取，不走 API）
   */
  private async loadPackageJsonState(): Promise<void> {
    if (!this.webcontainer) return;

    try {
      // 直接从已挂载的 WebContainer 文件系统读取，避免 API 404
      const content = await this.webcontainer.fs.readFile('package.json', 'utf-8');
      const hash = this.computeHash(content);
      this.packageJsonState = {
        hash,
        content,
      };
      console.log(`📦 [HotReload] 已加载 package.json 状态 (hash: ${hash.substring(0, 8)}...)`);
    } catch (error) {
      // 文件系统中不存在 package.json 也正常（项目初始化中）
      console.warn('⚠️ [HotReload] WebContainer 中暂无 package.json，可能是新项目:', error);
    }
  }

  /**
   * 处理文件更新事件（通过 API 获取文件内容）
   */
  private async handleFileUpdate(event: FileUpdateEvent): Promise<void> {
    if (!this.webcontainer || !this.sessionId) {
      console.warn('⚠️ [HotReload] WebContainer 或 sessionId 未设置，跳过文件更新');
      return;
    }

    try {
      // 跳过通配符更新（需要全量同步）
      if (event.path === '*') {
        console.log('📡 [HotReload] 收到全量更新信号，跳过（需要手动全量同步）');
        return;
      }

      // 如果事件包含内容，直接使用（WebSocket 可能已经包含）
      if (event.content !== undefined) {
        // 检查是否是 package.json
        if (event.path === 'package.json') {
          await this.handlePackageJsonUpdate(event.content);
          return;
        }
        // 更新文件到 WebContainer
        await this.updateFileInWebContainer(event.path, event.content);
        console.log(`✅ [HotReload] 已同步文件: ${event.path}`);
        return;
      }

      // 如果没有内容，通过 API 获取
      if (event.type === 'FILE_DELETED') {
        // 删除文件
        await this.deleteFileInWebContainer(event.path);
        return;
      }

      // 获取文件内容（通过 API）
      const response = await fetch(`/api/files?sessionId=${this.sessionId}&path=${encodeURIComponent(event.path)}`);
      const data = await response.json();
      
      if (!data.success || !data.file) {
        console.warn(`⚠️ [HotReload] 无法获取文件 ${event.path}`);
        return;
      }

      // 检查是否是 package.json
      if (event.path === 'package.json') {
        await this.handlePackageJsonUpdate(data.file.content || '');
        return;
      }

      // 更新文件到 WebContainer
      await this.updateFileInWebContainer(event.path, data.file.content || '');

      console.log(`✅ [HotReload] 已同步文件: ${event.path}`);
    } catch (error: any) {
      console.error(`❌ [HotReload] 同步文件失败 ${event.path}:`, error);
    }
  }

  /**
   * 处理 package.json 更新
   */
  private async handlePackageJsonUpdate(content: string): Promise<void> {
    const newHash = this.computeHash(content);

    // 检查是否有变化
    if (this.packageJsonState?.hash === newHash) {
      logger.debug('📦 [HotReload] package.json 未变化，跳过重装');
      return;
    }

    console.log('📦 [HotReload] 检测到 package.json 变化，准备静默重装...');

    // 更新状态
    this.packageJsonState = {
      hash: newHash,
      content,
    };

    // 更新文件到 WebContainer
    await this.updateFileInWebContainer('package.json', content);

    // 触发回调（执行 npm install）
    if (this.onPackageJsonChanged) {
      await this.onPackageJsonChanged();
    }
  }

  /**
   * 更新文件到 WebContainer
   */
  private async updateFileInWebContainer(path: string, content: string): Promise<void> {
    if (!this.webcontainer) return;

    try {
      // 规范化路径（移除开头的斜杠）
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

      // 写入文件
      await this.webcontainer.fs.writeFile(normalizedPath, content, { encoding: 'utf-8' });
      console.debug(`📝 [HotReload] 已写入文件到 WebContainer: ${normalizedPath}`);
    } catch (error: any) {
      logger.error(`❌ [HotReload] 写入文件失败 ${path}:`, error);
      throw error;
    }
  }

  /**
   * 从 WebContainer 删除文件
   */
  private async deleteFileInWebContainer(path: string): Promise<void> {
    if (!this.webcontainer) return;

    try {
      const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
      await this.webcontainer.fs.rm(normalizedPath, { recursive: true });
      console.log(`🗑️ [HotReload] 已从 WebContainer 删除文件: ${normalizedPath}`);
    } catch (error: any) {
      logger.error(`❌ [HotReload] 删除文件失败 ${path}:`, error);
    }
  }

  /**
   * 计算内容哈希（使用简单的字符串哈希算法，避免依赖 Node.js crypto）
   */
  private computeHash(content: string): string {
    // 使用简单的哈希算法（FNV-1a 变体）
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
      hash ^= content.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash.toString(16);
  }

  /**
   * 同步所有文件到 WebContainer（全量同步，通过 API）
   */
  async syncAllFiles(): Promise<void> {
    if (!this.webcontainer || !this.sessionId) {
      throw new Error('WebContainer 或 sessionId 未设置');
    }

    console.log('🔄 [HotReload] 开始全量同步文件...');

    // 通过 API 获取文件列表
    const filesResponse = await fetch(`/api/files?sessionId=${this.sessionId}`);
    const filesData = await filesResponse.json();
    
    if (!filesData.success || !filesData.files) {
      throw new Error('无法获取文件列表');
    }

    // 获取所有文件的内容（通过 API）
    const filesWithContent = await Promise.all(
      filesData.files.map(async (file: any) => {
        try {
          const fileResponse = await fetch(`/api/files?sessionId=${this.sessionId}&path=${encodeURIComponent(file.path)}`);
          const fileData = await fileResponse.json();
          return {
            path: file.path,
            content: fileData.success && fileData.file ? fileData.file.content || '' : '',
          };
        } catch (error) {
          console.warn(`⚠️ [HotReload] 获取文件 ${file.path} 失败:`, error);
          return {
            path: file.path,
            content: '',
          };
        }
      })
    );

    // 构建扁平文件映射（key 为完整路径）
    const flatFiles: Record<string, string> = {};
    for (const file of filesWithContent) {
      if (file.content) {
        const normalizedPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        flatFiles[normalizedPath] = file.content;
      }
    }

    // 将扁平路径转换为 WebContainer 需要的嵌套目录树
    // 直接用扁平 key 调用 mount() 会触发 EIO: invalid file name 错误
    const buildNestedTree = (flat: Record<string, string>) => {
      const tree: Record<string, any> = {};
      for (const [filePath, content] of Object.entries(flat)) {
        const parts = filePath.split('/');
        let current = tree;
        for (let i = 0; i < parts.length - 1; i++) {
          const dir = parts[i];
          if (!current[dir]) current[dir] = { directory: {} };
          current = current[dir].directory;
        }
        current[parts[parts.length - 1]] = { file: { contents: content } };
      }
      return tree;
    };

    // 挂载嵌套文件树（这会替换所有文件）
    await this.webcontainer.mount(buildNestedTree(flatFiles));
    console.log(`✅ [HotReload] 全量同步完成，共 ${filesWithContent.length} 个文件`);

    // 重新加载 package.json 状态
    await this.loadPackageJsonState();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.isInitialized = false;
    this.webcontainer = null;
    this.sessionId = null;
    this.packageJsonState = null;
    console.log('🧹 [HotReload] 已清理热更新系统');
  }
}

// 导出单例
export const webContainerHotReload = new WebContainerHotReload();
