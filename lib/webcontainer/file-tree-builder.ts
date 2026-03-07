/**
 * FileTreeBuilder - 将扁平文件结构转换为 WebContainer 树形结构
 * 
 * 输入格式：{ "src/App.tsx": "...", "package.json": "..." }
 * 输出格式：{ "src": { directory: { "App.tsx": { file: { contents: "..." } } } } }
 */

import { logger } from '../logger';

/**
 * WebContainer 文件树节点类型
 */
export type WebContainerFileTree = {
  [key: string]: 
    | { file: { contents: string } }
    | { directory: WebContainerFileTree };
};

/**
 * 扁平文件结构（LLM 返回格式）
 */
export type FlatFileStructure = Record<string, string>;

/**
 * 文件树构建器
 */
export class FileTreeBuilder {
  /**
   * 将扁平文件结构转换为 WebContainer 树形结构
   */
  build(flatFiles: FlatFileStructure): WebContainerFileTree {
    const tree: WebContainerFileTree = {};

    for (const [path, content] of Object.entries(flatFiles)) {
      // 规范化路径
      const normalizedPath = this.normalizePath(path);
      if (!normalizedPath) {
        logger.warn(`⚠️ [FileTreeBuilder] 跳过无效路径: ${path}`);
        continue;
      }

      // 构建目录树
      this.insertFile(tree, normalizedPath, content);
    }

    return tree;
  }

  /**
   * 规范化文件路径
   * - 移除开头的 `/`
   * - 移除 `./` 前缀
   * - 禁止 `..` 路径遍历
   * - 禁止控制字符
   */
  normalizePath(path: string): string | null {
    // 移除开头的斜杠
    let normalized = path.startsWith('/') ? path.slice(1) : path;

    // 移除相对路径前缀
    normalized = normalized.replace(/^\.\//, '').trim();

    // 规范化斜杠（多个斜杠合并为一个）
    normalized = normalized.replace(/\/+/g, '/');

    // 移除末尾的斜杠（文件不能以斜杠结尾）
    normalized = normalized.replace(/\/$/, '');

    // 验证路径：不允许包含危险字符
    if (
      !normalized ||
      normalized.includes('..') ||
      normalized.startsWith('/') ||
      normalized.includes('\0') ||
      normalized.includes('\r') ||
      normalized.includes('\n') ||
      /[<>:"|?*]/.test(normalized)
    ) {
      return null;
    }

    return normalized;
  }

  /**
   * 将文件插入到树形结构中
   */
  private insertFile(
    tree: WebContainerFileTree,
    path: string,
    content: string
  ): void {
    const parts = path.split('/');
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);

    // 导航到目标目录
    let current = tree;
    for (const dirName of dirParts) {
      // 确保目录存在
      if (!(dirName in current)) {
        current[dirName] = { directory: {} };
      }

      const node = current[dirName];
      if (!('directory' in node)) {
        // 如果路径冲突（文件 vs 目录），记录错误
        logger.error(
          `❌ [FileTreeBuilder] 路径冲突: ${dirName} 既作为文件又作为目录`
        );
        return;
      }

      current = node.directory;
    }

    // 插入文件
    // 检查是否已存在同名文件或目录
    if (fileName in current) {
      const existing = current[fileName];
      if ('directory' in existing) {
        logger.warn(
          `⚠️ [FileTreeBuilder] 文件 ${path} 与目录冲突，跳过文件`
        );
        return;
      }
      // 如果已存在同名文件，覆盖（使用新内容）
      logger.debug(`🔄 [FileTreeBuilder] 覆盖已存在的文件: ${path}`);
    }

    current[fileName] = {
      file: {
        contents: content,
      },
    };
  }

  /**
   * 验证文件树结构
   */
  validate(tree: WebContainerFileTree): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    const validateNode = (
      node: { file: { contents: string } } | { directory: WebContainerFileTree },
      path: string = ''
    ): void => {
      if ('file' in node) {
        // 验证文件内容
        const contents = node.file.contents;
        if (typeof contents !== 'string') {
          errors.push(`文件 ${path} 的内容类型错误: ${typeof contents}`);
        } else if (contents.includes('\0')) {
          errors.push(`文件 ${path} 包含空字符`);
        }
      } else if ('directory' in node) {
        // 验证目录内容
        for (const [name, child] of Object.entries(node.directory)) {
          // 检查 key 是否包含斜杠（不允许）
          if (name.includes('/')) {
            errors.push(`路径 ${path}/${name} 包含斜杠，这是不允许的`);
            continue;
          }

          const childPath = path ? `${path}/${name}` : name;
          validateNode(child, childPath);
        }
      } else {
        errors.push(`节点 ${path} 的类型无效`);
      }
    };

    for (const [name, node] of Object.entries(tree)) {
      if (name.includes('/')) {
        errors.push(`根级 key ${name} 包含斜杠，这是不允许的`);
        continue;
      }
      validateNode(node, name);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取文件树统计信息
   */
  getStats(tree: WebContainerFileTree): {
    fileCount: number;
    directoryCount: number;
    totalSize: number;
  } {
    let fileCount = 0;
    let directoryCount = 0;
    let totalSize = 0;

    const traverse = (
      node: WebContainerFileTree | { file: { contents: string } } | { directory: WebContainerFileTree }
    ): void => {
      if ('file' in node) {
        fileCount++;
        totalSize += node.file.contents.length;
      } else if ('directory' in node) {
        directoryCount++;
        for (const child of Object.values(node.directory)) {
          traverse(child);
        }
      }
    };

    for (const node of Object.values(tree)) {
      traverse(node);
    }

    return { fileCount, directoryCount, totalSize };
  }
}

/**
 * 单例导出
 */
export const fileTreeBuilder = new FileTreeBuilder();
