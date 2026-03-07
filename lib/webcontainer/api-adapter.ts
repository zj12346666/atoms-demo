/**
 * API Adapter - 适配现有 API 到扁平文件结构
 * 
 * 提供两种方式获取文件：
 * 1. 从 /api/files 获取（现有方式）
 * 2. 从 /api/generate 返回的 code.files 获取（新方式）
 */

import { logger } from '../logger';
import type { FlatFileStructure } from './file-tree-builder';

/**
 * 从 sessionId 获取扁平文件结构（通过 /api/files）
 */
export async function getFlatFilesFromSession(
  sessionId: string
): Promise<FlatFileStructure> {
  try {
    // 1. 获取文件列表
    const filesResponse = await fetch(`/api/files?sessionId=${sessionId}`);
    const filesData = await filesResponse.json();

    if (!filesData.success || !filesData.files || filesData.files.length === 0) {
      throw new Error('项目文件为空，请先生成代码');
    }

    // 2. 获取所有文件内容
    const flatFiles: FlatFileStructure = {};

    await Promise.all(
      filesData.files.map(async (file: any) => {
        if (file.type === 'text') {
          try {
            const fileResponse = await fetch(
              `/api/files?sessionId=${sessionId}&path=${encodeURIComponent(file.path)}`
            );
            const fileData = await fileResponse.json();

            if (fileData.success && fileData.file) {
              flatFiles[file.path] = fileData.file.content || '';
            }
          } catch (error) {
            logger.warn(`⚠️ [APIAdapter] 加载文件 ${file.path} 失败:`, error);
          }
        }
      })
    );

    logger.info(
      `✅ [APIAdapter] 从 session 获取 ${Object.keys(flatFiles).length} 个文件`
    );

    return flatFiles;
  } catch (error: any) {
    logger.error('❌ [APIAdapter] 获取文件失败:', error);
    throw error;
  }
}

/**
 * 从 generate API 返回的 code 对象转换为扁平文件结构
 */
export function convertCodeToFlatFiles(code: {
  files?: Array<{ path: string; content: string }>;
  html?: string;
  css?: string;
  js?: string;
}): FlatFileStructure {
  const flatFiles: FlatFileStructure = {};

  // 优先使用 files 数组（新格式）
  if (code.files && Array.isArray(code.files)) {
    for (const file of code.files) {
      if (file.path && file.content !== undefined) {
        flatFiles[file.path] = file.content;
      }
    }
  } else {
    // 兼容旧格式（html/css/js）
    if (code.html) {
      flatFiles['index.html'] = code.html;
    }
    if (code.css) {
      flatFiles['style.css'] = code.css;
    }
    if (code.js) {
      flatFiles['main.js'] = code.js;
    }
  }

  logger.info(
    `✅ [APIAdapter] 从 code 对象转换 ${Object.keys(flatFiles).length} 个文件`
  );

  return flatFiles;
}
