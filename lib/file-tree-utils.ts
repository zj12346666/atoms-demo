// 文件树工具函数 - 将扁平数据转换为嵌套树结构

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  children?: FileNode[];
}

/**
 * 将扁平的文件列表转换为嵌套树结构
 */
export function buildFileTree(files: Array<{
  id: string;
  path: string;
  name: string;
  type: 'text' | 'binary';
  size?: number;
  mimeType?: string;
}>): FileNode[] {
  const tree: FileNode[] = [];
  const pathMap = new Map<string, FileNode>();

  // 按路径排序，确保父目录在前
  const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sortedFiles) {
    const parts = file.path.split('/').filter(p => p);
    let currentPath = '';
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      
      if (!pathMap.has(currentPath)) {
        const node: FileNode = {
          id: isLast ? file.id : `folder-${currentPath}`,
          name: part,
          path: currentPath,
          type: isLast ? 'file' : 'folder',
          children: isLast ? undefined : [],
        };

        if (isLast) {
          node.size = file.size;
          node.mimeType = file.mimeType;
        }

        pathMap.set(currentPath, node);

        // 添加到父节点或根节点
        if (parentPath) {
          const parent = pathMap.get(parentPath);
          if (parent && parent.children) {
            parent.children.push(node);
          }
        } else {
          tree.push(node);
        }
      } else if (isLast) {
        // 更新文件节点信息
        const existing = pathMap.get(currentPath);
        if (existing) {
          existing.size = file.size;
          existing.mimeType = file.mimeType;
        }
      }
    }
  }

  return tree;
}

/**
 * 根据文件路径获取语言标识（用于 Monaco Editor）
 */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'html': 'html',
    'css': 'css',
    'json': 'json',
    'md': 'markdown',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'go': 'go',
    'rs': 'rust',
    'php': 'php',
    'rb': 'ruby',
    'sh': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
  };
  return languageMap[ext || ''] || 'plaintext';
}
