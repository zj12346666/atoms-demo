// 文件管理器 - 管理项目文件存储和检索

import { prisma, isDatabaseAvailable, ensureConnection } from './db';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';
import { templateCompleter } from './webcontainer/template-completer';

export interface FileInfo {
  id: string;
  sessionId: string;
  path: string;
  name: string;
  type: 'text' | 'binary';
  content?: string;
  binaryData?: Buffer;
  mimeType?: string;
  size: number;
  createdAt: Date;
  updatedAt: Date;
}

// 已移除内存缓存，直接使用 PostgreSQL

export class FileManager {
  // 保存文件
  async saveFile(
    sessionId: string,
    path: string,
    content: string | Buffer,
    mimeType?: string
  ): Promise<FileInfo> {
    const name = path.split('/').pop() || path;
    const isBinary = Buffer.isBuffer(content);
    const size = isBinary ? content.length : Buffer.byteLength(content, 'utf8');

    const fileData: any = {
      id: uuidv4(),
      sessionId,
      path,
      name,
      type: isBinary ? 'binary' : 'text',
      size,
      mimeType: mimeType || this.getMimeType(path),
    };

    if (isBinary) {
      fileData.binaryData = content;
    } else {
      fileData.content = content as string;
    }

    const fallbackInfo: FileInfo = {
      id: fileData.id,
      sessionId,
      path,
      name: fileData.name,
      type: fileData.type,
      content: typeof content === 'string' ? content : undefined,
      binaryData: Buffer.isBuffer(content) ? content : undefined,
      mimeType: fileData.mimeType,
      size,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (isDatabaseAvailable() && prisma) {
      try {
        // 检查并确保连接正常
        const isConnected = await ensureConnection();
        if (!isConnected) {
          throw new Error('Database connection unavailable');
        }
        
        // 检查文件是否已存在
        const existing = await (prisma as any).file.findFirst({
          where: { sessionId, path },
        });

        let result: FileInfo;
        if (existing) {
          // 更新现有文件
          const updated = await (prisma as any).file.update({
            where: { id: existing.id },
            data: fileData,
          });
          logger.info(`  📝 更新文件: ${path}`);
          result = this.mapToFileInfo(updated);
        } else {
          // 创建新文件
          const created = await (prisma as any).file.create({
            data: fileData,
          });
          logger.info(`  ✨ 创建文件: ${path}`);
          result = this.mapToFileInfo(created);
        }
        return result;
      } catch (error: any) {
        // P1017 错误：服务器关闭连接，尝试重新连接一次
        if (error?.code === 'P1017' || error?.message?.includes('Server has closed the connection')) {
          logger.warn('⚠️ 数据库连接已关闭，尝试重新连接并重试保存...');
          try {
            await ensureConnection();
            // 重试保存
            const existing = await (prisma as any).file.findFirst({
              where: { sessionId, path },
            });
            let result: FileInfo;
            if (existing) {
              const updated = await (prisma as any).file.update({
                where: { id: existing.id },
                data: fileData,
              });
              result = this.mapToFileInfo(updated);
            } else {
              const created = await (prisma as any).file.create({
                data: fileData,
              });
              result = this.mapToFileInfo(created);
            }
            logger.info('✅ 重连后成功保存文件');
            return result;
          } catch (retryError) {
            logger.error('❌ 重连后仍然失败:', retryError);
            throw new Error(`Failed to save file after reconnection: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`);
          }
        } else {
          logger.error('❌ 保存文件失败:', error);
          throw new Error(`Failed to save file: ${error.message}`);
        }
      }
    } else {
      // 数据库不可用，直接抛出错误
      logger.error('❌ 数据库不可用，无法保存文件');
      throw new Error('Database not available. Cannot save file to PostgreSQL.');
    }
  }


  // 获取文件
  async getFile(sessionId: string, path: string): Promise<FileInfo | null> {
    if (isDatabaseAvailable() && prisma) {
      try {
        // 检查并确保连接正常
        const isConnected = await ensureConnection();
        if (!isConnected) {
          throw new Error('Database connection unavailable');
        }
        
        const file = await (prisma as any).file.findFirst({
          where: { sessionId, path },
        });
        if (file) return this.mapToFileInfo(file);
      } catch (error: any) {
        // P1017 错误：服务器关闭连接，尝试重新连接一次
        if (error?.code === 'P1017' || error?.message?.includes('Server has closed the connection')) {
          logger.warn('⚠️ 数据库连接已关闭，尝试重新连接并重试获取...');
          try {
            await ensureConnection();
            const file = await (prisma as any).file.findFirst({
              where: { sessionId, path },
            });
            if (file) {
              logger.info('✅ 重连后成功获取文件');
              return this.mapToFileInfo(file);
            }
            // 文件不存在，返回 null
            return null;
          } catch (retryError: any) {
            logger.error('❌ 重连后仍然失败:', retryError);
            throw new Error(`Failed to get file after reconnection: ${retryError.message}`);
          }
        } else {
          logger.error('❌ 获取文件失败:', error);
          throw new Error(`Failed to get file: ${error.message}`);
        }
      }
    } else {
      logger.error('❌ 数据库不可用，无法获取文件');
      throw new Error('Database not available. Cannot get file from PostgreSQL.');
    }
    return null;
  }

  // 获取会话的所有文件
  async getFiles(sessionId: string): Promise<FileInfo[]> {
    if (isDatabaseAvailable() && prisma) {
      try {
        // 检查并确保连接正常
        const isConnected = await ensureConnection();
        if (!isConnected) {
          logger.error('❌ 数据库连接不可用');
          throw new Error('Database connection unavailable');
        }
        
        const files = await (prisma as any).file.findMany({
          where: { sessionId },
          orderBy: { path: 'asc' },
        });
        // 即使文件列表为空也返回（可能是新 session）
        return files.map((f: any) => this.mapToFileInfo(f));
      } catch (error: any) {
        // P1017 错误：服务器关闭连接，尝试重新连接一次
        if (error?.code === 'P1017' || error?.message?.includes('Server has closed the connection')) {
          logger.warn('⚠️ 数据库连接已关闭，尝试重新连接...');
          try {
            await ensureConnection();
            // 重试一次
            const files = await (prisma as any).file.findMany({
              where: { sessionId },
              orderBy: { path: 'asc' },
            });
            logger.info('✅ 重连后成功获取文件列表');
            return files.map((f: any) => this.mapToFileInfo(f));
          } catch (retryError: any) {
            logger.error('❌ 重连后仍然失败:', retryError);
            throw new Error(`Failed to get files after reconnection: ${retryError.message}`);
          }
        } else {
          logger.error('❌ 获取文件列表失败:', error);
          throw new Error(`Failed to get files: ${error.message}`);
        }
      }
    } else {
      logger.error('❌ 数据库不可用，无法获取文件列表');
      throw new Error('Database not available. Cannot get files from PostgreSQL.');
    }
  }

  // 获取文件树结构
  async getFileTree(sessionId: string): Promise<FileTree> {
    const files = await this.getFiles(sessionId);
    logger.info(`📂 获取文件列表 (session: ${sessionId}):`, files.length, '个文件');
    
    const tree: FileTree = {};

    for (const file of files) {
      const parts = file.path.split('/').filter(p => p); // 过滤空字符串
      let current = tree;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;

        if (isLast) {
          current[part] = {
            type: 'file',
            path: file.path,
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
          };
        } else {
          if (!current[part]) {
            current[part] = {
              type: 'folder',
              children: {},
            };
          }
          current = (current[part] as FolderNode).children;
        }
      }
    }

    return tree;
  }

  // 删除文件
  async deleteFile(sessionId: string, path: string): Promise<void> {
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法删除文件');
      throw new Error('Database not available. Cannot delete file from PostgreSQL.');
    }

    try {
      await (prisma as any).file.deleteMany({
        where: { sessionId, path },
      });
      logger.info(`🗑️ 文件已删除: ${path} (session: ${sessionId})`);
    } catch (error: any) {
      logger.error('❌ 删除文件失败:', error);
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  // 保存生成的代码文件（支持新格式：多文件，和旧格式：html/css/js）
  async saveGeneratedCode(
    sessionId: string,
    code: { 
      html?: string; 
      css?: string; 
      js?: string; 
      description: string;
      files?: Array<{ path: string; content: string; type: string; description: string }>;
      plan?: { modules: Array<{ name: string; files: Array<{ path: string }> }> };
    }
  ): Promise<void> {
    // 检查数据库是否可用
    if (!isDatabaseAvailable() || !prisma) {
      logger.error('❌ 数据库不可用，无法保存生成的文件');
      throw new Error('Database not available. Cannot save generated code to PostgreSQL.');
    }

    try {
      logger.info(`💾 开始保存文件到数据库（session: ${sessionId}）`);
      
      // 新格式：多文件生成
      if (code.files && code.files.length > 0) {
        for (const file of code.files) {
          // 根据文件类型确定 MIME 类型
          const mimeType = this.getMimeType(file.path);
          await this.saveFile(sessionId, file.path, file.content, mimeType);
          logger.info(`  ✅ ${file.path} 已保存`);
        }

        // 使用 TemplateCompleter 补全缺失的关键文件（package.json、vite.config.ts 等）
        const flatFiles: Record<string, string> = {};
        for (const file of code.files) {
          flatFiles[file.path] = file.content;
        }
        const completed = templateCompleter.complete(flatFiles);
        for (const [filePath, fileContent] of Object.entries(completed)) {
          if (!flatFiles[filePath]) {
            const mimeType = this.getMimeType(filePath);
            await this.saveFile(sessionId, filePath, fileContent, mimeType);
            logger.info(`  ✅ [TemplateCompleter] ${filePath} 已补全并保存`);
          }
        }
        
        // 保存实现方案（如果存在）
        if (code.plan) {
          const planContent = JSON.stringify(code.plan, null, 2);
          await this.saveFile(sessionId, 'implementation-plan.json', planContent, 'application/json');
          logger.info('  ✅ implementation-plan.json 已保存');
        }
        
        // 保存描述文件
        await this.saveFile(
          sessionId,
          'README.md',
          `# ${code.description}\n\n${code.description}\n\n## 生成的文件\n\n${code.files.map(f => `- ${f.path}: ${f.description}`).join('\n')}`,
          'text/markdown'
        );
        logger.info('  ✅ README.md 已保存');
      } 
      // 旧格式兼容：html/css/js
      else if (code.html || code.css || code.js) {
        // 保存 HTML
        if (code.html) {
          await this.saveFile(sessionId, 'index.html', code.html, 'text/html');
          logger.info('  ✅ index.html 已保存');
        }
        
        // 保存 CSS
        if (code.css) {
          await this.saveFile(sessionId, 'styles.css', code.css, 'text/css');
          logger.info('  ✅ styles.css 已保存');
        }
        
        // 保存 JS
        if (code.js) {
          await this.saveFile(sessionId, 'script.js', code.js, 'text/javascript');
          logger.info('  ✅ script.js 已保存');
        }

        // 保存描述文件
        await this.saveFile(
          sessionId,
          'README.md',
          `# ${code.description}\n\n${code.description}`,
          'text/markdown'
        );
        logger.info('  ✅ README.md 已保存');
      }
      
      logger.info(`✅ 所有文件已保存到数据库（session: ${sessionId}）`);
    } catch (error) {
      // 即使保存失败也不抛出错误，只记录日志
      logger.error('❌ 保存生成的文件失败:', error);
    }
  }

  // 辅助方法：获取 MIME 类型
  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      html: 'text/html',
      css: 'text/css',
      js: 'text/javascript',
      json: 'application/json',
      md: 'text/markdown',
      txt: 'text/plain',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  // 映射数据库记录到 FileInfo
  private mapToFileInfo(dbFile: any): FileInfo {
    return {
      id: dbFile.id,
      sessionId: dbFile.sessionId,
      path: dbFile.path,
      name: dbFile.name,
      type: dbFile.type,
      content: dbFile.content || undefined,
      binaryData: dbFile.binaryData ? Buffer.from(dbFile.binaryData) : undefined,
      mimeType: dbFile.mimeType || undefined,
      size: dbFile.size,
      createdAt: dbFile.createdAt,
      updatedAt: dbFile.updatedAt,
    };
  }
}

// 文件树类型定义
export interface FileNode {
  type: 'file' | 'folder';
  path?: string;
  name?: string;
  size?: number;
  mimeType?: string;
  children?: FileTree;
}

export interface FolderNode {
  type: 'folder';
  children: FileTree;
}

export interface FileTree {
  [key: string]: FileNode;
}
