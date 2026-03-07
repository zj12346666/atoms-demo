/**
 * 📡 环境感知与通知 Skill (Environment Sync)
 * 职责：解决"用户体验"和"状态同步"问题。
 */

import { WebSocketManager, FileUpdateEvent } from '../websocket-manager-shared';
import { logger } from '../logger';
import { FileManager, FileTree } from '../file-manager';
import { prisma, ensureConnection } from '../db';

export interface ProjectMapNode {
  name: string;
  type: 'file' | 'folder';
  path: string;
  children?: ProjectMapNode[];
  size?: number;
  mimeType?: string;
}

export class EnvironmentSyncSkill {
  private wsManager: WebSocketManager;
  private fileManager: FileManager;

  constructor() {
    this.wsManager = WebSocketManager.getInstance();
    this.fileManager = new FileManager();
  }

  /**
   * 同步 Web IDE 视图
   * 通过 WebSocket/Socket.io 向前端发送刷新指令。
   * 
   * @param sessionId 会话ID
   * @param filePaths 更新的文件路径列表（可选）
   * @param action 操作类型（可选）
   */
  async syncWebIdeView(
    sessionId: string,
    filePaths?: string[],
    action: 'UPDATE' | 'CREATE' | 'DELETE' = 'UPDATE'
  ): Promise<void> {
    try {
      if (!this.wsManager) {
        logger.warn('⚠️ WebSocketManager 未初始化，跳过同步');
        return;
      }

      if (!filePaths || filePaths.length === 0) {
        // 发送通用刷新事件
        const emitPromise = this.wsManager.emitFileUpdate({
          type: 'FILE_UPDATED',
          sessionId,
          path: '*', // 通配符表示所有文件
        });
        if (emitPromise && typeof emitPromise.catch === 'function') {
          emitPromise.catch(err => logger.warn('Failed to emit file update:', err));
        }
        logger.info(`📡 发送 Web IDE 刷新指令 (session: ${sessionId}, 所有文件)`);
        return;
      }

      // 批量发送文件更新事件
      const events: FileUpdateEvent[] = filePaths.map(path => ({
        type: `FILE_${action}` as 'FILE_UPDATED' | 'FILE_CREATED' | 'FILE_DELETED',
        sessionId,
        path,
      }));

      // 如果需要，可以包含文件内容
      if (action !== 'DELETE') {
        for (let i = 0; i < events.length; i++) {
          try {
            const file = await this.fileManager.getFile(sessionId, filePaths[i]);
            if (file?.content) {
              events[i].content = file.content;
            }
          } catch (error) {
            logger.warn(`⚠️ 获取文件内容失败 ${filePaths[i]}:`, error);
          }
        }
      }

      const emitPromise = this.wsManager.emitFileUpdates(events);
      if (emitPromise && typeof emitPromise.catch === 'function') {
        emitPromise.catch(err => logger.warn('Failed to emit file updates:', err));
      }
      logger.info(`📡 发送 Web IDE 刷新指令 (session: ${sessionId}, ${events.length} 个文件)`);
    } catch (error: any) {
      logger.error('❌ 同步 Web IDE 视图失败:', error);
    }
  }

  /**
   * 获取项目地图
   * 从 PG 生成最新的文件夹层级树。
   * 
   * @param sessionId 会话ID
   * @param projectId 项目ID（可选，如果提供则从项目级别获取）
   * @returns 项目文件夹层级树
   */
  async getProjectMap(
    sessionId: string,
    projectId?: string
  ): Promise<ProjectMapNode | null> {
    try {
      // 1. 获取文件树
      const fileTree = await this.fileManager.getFileTree(sessionId);

      // 2. 转换为 ProjectMapNode
      const projectMap = this.convertFileTreeToMap(fileTree);

      return projectMap;
    } catch (error: any) {
      logger.error('❌ 获取项目地图失败:', error);
      return null;
    }
  }

  /**
   * 将 FileTree 转换为 ProjectMapNode
   */
  private convertFileTreeToMap(
    fileTree: FileTree,
    currentPath: string = ''
  ): ProjectMapNode | null {
    // FileTree 是一个对象，键是文件名或文件夹名
    const entries = Object.entries(fileTree);

    if (entries.length === 0) {
      return null;
    }

    // 如果只有一个根节点，返回它
    if (entries.length === 1) {
      const [name, node] = entries[0];
      return this.convertNode(name, node, currentPath);
    }

    // 多个节点，创建一个根文件夹
    const root: ProjectMapNode = {
      name: 'root',
      type: 'folder',
      path: '',
      children: [],
    };

    for (const [name, node] of entries) {
      const converted = this.convertNode(name, node, currentPath);
      if (converted) {
        root.children!.push(converted);
      }
    }

    return root;
  }

  /**
   * 转换单个节点
   */
  private convertNode(
    name: string,
    node: any,
    parentPath: string
  ): ProjectMapNode | null {
    const currentPath = parentPath ? `${parentPath}/${name}` : name;

    if (node.type === 'file') {
      return {
        name,
        type: 'file',
        path: node.path || currentPath,
        size: node.size,
        mimeType: node.mimeType,
      };
    } else if (node.type === 'folder') {
      const children: ProjectMapNode[] = [];

      if (node.children) {
        for (const [childName, childNode] of Object.entries(node.children)) {
          const converted = this.convertNode(childName, childNode, currentPath);
          if (converted) {
            children.push(converted);
          }
        }
      }

      return {
        name,
        type: 'folder',
        path: currentPath,
        children: children.length > 0 ? children : undefined,
      };
    }

    return null;
  }

  /**
   * 发送工作流进度更新
   */
  emitWorkflowProgress(
    sessionId: string,
    state: string,
    message: string,
    progress: number,
    details?: string
  ): void {
    if (!this.wsManager) {
      logger.warn('⚠️ WebSocketManager 未初始化，跳过进度通知');
      return;
    }
    const emitPromise = this.wsManager.emitWorkflowProgress({
      type: 'WORKFLOW_PROGRESS',
      sessionId,
      state,
      message,
      progress,
      details,
    });
    if (emitPromise && typeof emitPromise.catch === 'function') {
      emitPromise.catch(err => logger.warn('Failed to emit workflow progress:', err));
    }
  }

  /**
   * 获取文件统计信息
   */
  async getFileStats(
    sessionId: string,
    projectId?: string
  ): Promise<{
    totalFiles: number;
    totalSize: number;
    filesByType: Record<string, number>;
  }> {
    try {
      const files = await this.fileManager.getFiles(sessionId);

      const stats = {
        totalFiles: files.length,
        totalSize: 0,
        filesByType: {} as Record<string, number>,
      };

      for (const file of files) {
        stats.totalSize += file.size || 0;

        const ext = file.path.split('.').pop()?.toLowerCase() || 'unknown';
        stats.filesByType[ext] = (stats.filesByType[ext] || 0) + 1;
      }

      return stats;
    } catch (error: any) {
      logger.error('❌ 获取文件统计失败:', error);
      return {
        totalFiles: 0,
        totalSize: 0,
        filesByType: {},
      };
    }
  }

  /**
   * 通知文件变更（便捷方法）
   */
  notifyFileChange(
    sessionId: string,
    path: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE'
  ): void {
    this.syncWebIdeView(sessionId, [path], action);
  }

  /**
   * 批量通知文件变更
   */
  notifyFileChanges(
    sessionId: string,
    changes: Array<{ path: string; action: 'CREATE' | 'UPDATE' | 'DELETE' }>
  ): void {
    // 按操作类型分组
    const updates: string[] = [];
    const creates: string[] = [];
    const deletes: string[] = [];

    for (const change of changes) {
      if (change.action === 'UPDATE') {
        updates.push(change.path);
      } else if (change.action === 'CREATE') {
        creates.push(change.path);
      } else {
        deletes.push(change.path);
      }
    }

    // 分别发送
    if (updates.length > 0) {
      this.syncWebIdeView(sessionId, updates, 'UPDATE');
    }
    if (creates.length > 0) {
      this.syncWebIdeView(sessionId, creates, 'CREATE');
    }
    if (deletes.length > 0) {
      this.syncWebIdeView(sessionId, deletes, 'DELETE');
    }
  }
}
