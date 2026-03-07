/**
 * FileWriter - 将生成的代码写入 WebContainer 文件系统
 */

import { WebContainer } from '@webcontainer/api';
import {
  IFileWriter,
  FileWriterInput,
  FileWriterOutput,
} from './types';
import { logger } from '../logger';

export class FileWriter implements IFileWriter {
  private webcontainer: WebContainer | null = null;

  /**
   * 设置 WebContainer 实例
   */
  setWebContainer(webcontainer: WebContainer): void {
    this.webcontainer = webcontainer;
  }

  /**
   * 写入文件
   */
  async write(input: FileWriterInput): Promise<FileWriterOutput> {
    const { filePath, content, encoding = 'utf-8' } = input;

    if (!this.webcontainer) {
      return {
        success: false,
        error: 'WebContainer 未初始化，请先调用 setWebContainer()',
      };
    }

    try {
      // 规范化路径（移除开头的斜杠，确保相对路径）
      const normalizedPath = this.normalizePath(filePath);

      // 确保目录存在
      await this.ensureDirectory(normalizedPath);

      // 写入文件
      await this.webcontainer.fs.writeFile(normalizedPath, content, {
        encoding: encoding === 'utf8' ? 'utf-8' : encoding,
      });

      const bytesWritten = Buffer.byteLength(content, encoding);

      logger.info(`✅ [FileWriter] 文件写入成功: ${normalizedPath} (${bytesWritten} bytes)`);

      return {
        success: true,
        bytesWritten,
      };
    } catch (error: any) {
      logger.error(`❌ [FileWriter] 文件写入失败 (${filePath}):`, error);
      
      return {
        success: false,
        error: error.message || '文件写入失败',
      };
    }
  }

  /**
   * 规范化文件路径
   */
  private normalizePath(filePath: string): string {
    // 移除开头的斜杠
    let normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    // 规范化路径分隔符（统一使用 /）
    normalized = normalized.replace(/\\/g, '/');
    
    // 移除多余的斜杠
    normalized = normalized.replace(/\/+/g, '/');
    
    return normalized;
  }

  /**
   * 确保文件所在的目录存在
   */
  private async ensureDirectory(filePath: string): Promise<void> {
    if (!this.webcontainer) {
      return;
    }

    const dirPath = this.getDirectoryPath(filePath);
    
    // 如果目录路径为空或为根目录，不需要创建
    if (!dirPath || dirPath === '.' || dirPath === '/') {
      return;
    }

    try {
      // 检查目录是否存在
      const dirExists = await this.webcontainer.fs.readdir(dirPath).then(
        () => true,
        () => false
      );

      if (!dirExists) {
        // 递归创建目录
        await this.createDirectoryRecursive(dirPath);
      }
    } catch (error: any) {
      // 如果读取目录失败，尝试创建
      if (error.code === 'ENOENT' || error.message?.includes('not found')) {
        await this.createDirectoryRecursive(dirPath);
      } else {
        // 其他错误，记录但不抛出（可能是目录已存在）
        logger.debug(`目录检查/创建时的非致命错误: ${error.message}`);
      }
    }
  }

  /**
   * 获取文件路径的目录部分
   */
  private getDirectoryPath(filePath: string): string {
    const lastSlashIndex = filePath.lastIndexOf('/');
    if (lastSlashIndex === -1) {
      return '';
    }
    return filePath.substring(0, lastSlashIndex);
  }

  /**
   * 递归创建目录
   */
  private async createDirectoryRecursive(dirPath: string): Promise<void> {
    if (!this.webcontainer) {
      return;
    }

    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      try {
        // 尝试读取目录，如果失败则创建
        await this.webcontainer.fs.readdir(currentPath);
      } catch (error: any) {
        // 目录不存在，创建它
        try {
          await this.webcontainer.fs.mkdir(currentPath);
          logger.debug(`📁 [FileWriter] 创建目录: ${currentPath}`);
        } catch (mkdirError: any) {
          // 如果创建失败，可能是并发创建或已存在，忽略错误
          if (!mkdirError.message?.includes('already exists') && 
              !mkdirError.message?.includes('EEXIST')) {
            logger.warn(`⚠️ [FileWriter] 创建目录失败: ${currentPath}`, mkdirError);
          }
        }
      }
    }
  }
}
