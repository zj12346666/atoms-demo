/**
 * 📝 原子化多文件生成 Skill (Multi-File Engineering)
 * 职责：解决"脏代码入库"和"多文件协同"问题。
 */

import { logger } from '../logger';
import { SymbolExtractor } from '../symbol-extractor';
import { FileManager } from '../file-manager';

export interface FileChange {
  path: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  code: string; // 完整代码或diff
  isDiff?: boolean; // 是否为增量更新
}

export interface FileSkeleton {
  path: string;
  classes: Array<{ name: string; line: number }>;
  functions: Array<{ name: string; line: number; signature?: string }>;
  interfaces: Array<{ name: string; line: number }>;
  imports: string[];
  exports: string[];
}

/**
 * 虚拟文件系统（内存中）
 * 用于暂存代码变更，在验证通过前不写入数据库
 */
class VirtualFileSystem {
  private files: Map<string, string> = new Map();
  private originalFiles: Map<string, string> = new Map(); // 保存原始内容用于合并

  /**
   * 加载现有文件到虚拟文件系统
   */
  loadFile(path: string, content: string): void {
    this.files.set(path, content);
    this.originalFiles.set(path, content);
  }

  /**
   * 应用文件变更
   */
  applyChange(change: FileChange): void {
    if (change.action === 'DELETE') {
      this.files.delete(change.path);
      this.originalFiles.delete(change.path);
      return;
    }

    if (change.action === 'UPDATE' && change.isDiff) {
      // 增量更新：需要合并
      const existing = this.files.get(change.path) || '';
      const merged = this.mergeCode(existing, change.code);
      this.files.set(change.path, merged);
    } else {
      // 完整替换
      this.files.set(change.path, change.code);
    }
  }

  /**
   * 合并代码（简单的diff合并）
   */
  private mergeCode(existing: string, newCode: string): string {
    // 如果新代码包含标记，尝试合并
    if (newCode.includes('// ... existing code ...')) {
      // 简单的实现：替换标记部分
      // TODO: 可以使用更智能的diff算法（如 diff-match-patch）
      return newCode.replace(/\/\/ \.\.\. existing code \.\.\./g, existing);
    }
    
    if (newCode.includes('/* ... existing code ... */')) {
      return newCode.replace(/\/\* \.\.\. existing code \.\.\. \*\//g, existing);
    }
    
    // 如果没有标记，直接替换
    return newCode;
  }

  /**
   * 获取文件内容
   */
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  /**
   * 获取所有文件
   */
  getAllFiles(): Map<string, string> {
    return new Map(this.files);
  }

  /**
   * 清空虚拟文件系统
   */
  clear(): void {
    this.files.clear();
    this.originalFiles.clear();
  }

  /**
   * 获取变更的文件列表
   */
  getChangedFiles(): string[] {
    const changed: string[] = [];
    for (const [path, content] of this.files.entries()) {
      const original = this.originalFiles.get(path);
      if (!original || original !== content) {
        changed.push(path);
      }
    }
    return changed;
  }
}

export class MultiFileEngineeringSkill {
  private virtualFs: VirtualFileSystem;
  private symbolExtractor: SymbolExtractor;
  private fileManager: FileManager;

  constructor() {
    this.virtualFs = new VirtualFileSystem();
    this.symbolExtractor = new SymbolExtractor();
    this.fileManager = new FileManager();
  }

  /**
   * 暂存代码变更
   * 接收 XML 格式的增量修改。它不直接写入 PG，而是写入一个内存虚拟文件系统（Virtual FS）
   * 
   * @param changes 文件变更列表
   * @param sessionId 会话ID（用于加载现有文件）
   */
  async stageCodeChanges(
    changes: FileChange[],
    sessionId: string
  ): Promise<{
    success: boolean;
    stagedFiles: string[];
    errors?: string[];
  }> {
    try {
      // 1. 加载现有文件到虚拟文件系统
      const existingFiles = await this.fileManager.getFiles(sessionId);
      for (const file of existingFiles) {
        if (file.content) {
          this.virtualFs.loadFile(file.path, file.content);
        }
      }

      // 2. 应用变更
      const errors: string[] = [];
      for (const change of changes) {
        try {
          // 如果是 UPDATE 且文件不存在，转换为 CREATE
          if (change.action === 'UPDATE' && !this.virtualFs.getFile(change.path)) {
            logger.warn(`⚠️ 文件 ${change.path} 不存在，将 UPDATE 转换为 CREATE`);
            change.action = 'CREATE';
          }

          this.virtualFs.applyChange(change);
        } catch (error: any) {
          errors.push(`应用变更失败 ${change.path}: ${error.message}`);
        }
      }

      const stagedFiles = this.virtualFs.getChangedFiles();

      logger.info(`📝 已暂存 ${stagedFiles.length} 个文件变更`);

      return {
        success: errors.length === 0,
        stagedFiles,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      logger.error('❌ 暂存代码变更失败:', error);
      return {
        success: false,
        stagedFiles: [],
        errors: [error.message],
      };
    }
  }

  /**
   * 获取文件骨架
   * 利用 Tree-sitter 只返回文件的骨架（类名、函数名），隐藏具体实现
   * 
   * @param path 文件路径
   * @param sessionId 会话ID（可选，如果提供则从数据库读取）
   * @returns 文件骨架信息
   */
  async getFileSkeleton(
    path: string,
    sessionId?: string
  ): Promise<FileSkeleton | null> {
    try {
      let content: string | undefined;

      // 优先从虚拟文件系统读取（如果有暂存的变更）
      content = this.virtualFs.getFile(path);

      // 如果虚拟文件系统没有，从数据库读取
      if (!content && sessionId) {
        const file = await this.fileManager.getFile(sessionId, path);
        content = file?.content;
      }

      if (!content) {
        logger.warn(`⚠️ 文件不存在: ${path}`);
        return null;
      }

      // 使用 SymbolExtractor 提取符号
      const symbols = await this.symbolExtractor.extractFromFile(path, content);

      // 解析 imports 和 exports
      const imports = this.extractImports(content);
      const exports = this.extractExports(content);

      // 分类符号
      const classes = symbols
        .filter(s => s.type === 'class')
        .map(s => ({ name: s.name, line: s.line }));

      const functions = symbols
        .filter(s => s.type === 'function')
        .map(s => ({ name: s.name, line: s.line, signature: s.signature }));

      const interfaces = symbols
        .filter(s => s.type === 'interface')
        .map(s => ({ name: s.name, line: s.line }));

      return {
        path,
        classes,
        functions,
        interfaces,
        imports,
        exports,
      };
    } catch (error: any) {
      logger.error(`❌ 获取文件骨架失败 (${path}):`, error);
      return null;
    }
  }

  /**
   * 提取 imports
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // 匹配 import 语句
      const importMatch = line.match(/^import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/);
      if (importMatch) {
        imports.push(importMatch[1]);
      }
    }

    return imports;
  }

  /**
   * 提取 exports
   */
  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // 匹配 export 语句
      const exportMatch = line.match(/^export\s+(?:default\s+)?(?:function|const|class|interface|type)\s+(\w+)/);
      if (exportMatch) {
        exports.push(exportMatch[1]);
      }
    }

    return exports;
  }

  /**
   * 获取暂存的文件内容
   */
  getStagedFile(path: string): string | undefined {
    return this.virtualFs.getFile(path);
  }

  /**
   * 获取所有暂存的文件
   */
  getAllStagedFiles(): Map<string, string> {
    return this.virtualFs.getAllFiles();
  }

  /**
   * 清空暂存区
   */
  clearStaged(): void {
    this.virtualFs.clear();
    logger.info('🗑️ 已清空暂存区');
  }

  /**
   * 获取变更的文件列表
   */
  getChangedFiles(): string[] {
    return this.virtualFs.getChangedFiles();
  }
}
