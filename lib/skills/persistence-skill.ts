/**
 * 💾 确定性持久化 Skill (Persistence & Evolution)
 * 职责：解决"记忆同步"问题。
 */

import { prisma, ensureConnection } from '../db';
import { logger } from '../logger';
import { SymbolExtractor } from '../symbol-extractor';

export interface PersistenceResult {
  success: boolean;
  persistedFiles: string[];
  errors?: string[];
}

export class PersistenceSkill {
  private symbolExtractor: SymbolExtractor;

  constructor() {
    this.symbolExtractor = new SymbolExtractor();
  }

  /**
   * 提交暂存的变更
   * 将内存中的代码正式 Update 到 PostgreSQL 对应的 content 字段。
   * 使用事务（Transaction）确保多文件同步更新。
   * 
   * @param sessionId 会话ID
   * @param projectId 项目ID
   * @param stagedFiles 暂存的文件系统（从 MultiFileEngineeringSkill 获取）
   * @returns 持久化结果
   */
  async commitStagedChanges(
    sessionId: string,
    projectId: string,
    stagedFiles: Map<string, string>
  ): Promise<PersistenceResult> {
    if (!prisma) {
      return {
        success: false,
        persistedFiles: [],
        errors: ['数据库不可用'],
      };
    }

    try {
      await ensureConnection();

      const persistedFiles: string[] = [];
      const errors: string[] = [];

      // 使用事务确保原子性
      await prisma.$transaction(async (tx: any) => {
        for (const [path, content] of stagedFiles.entries()) {
          try {
            const pathParts = path.split('/');
            const name = pathParts[pathParts.length - 1];
            const mimeType = this.getMimeType(path);

            // 检查文件是否已存在
            const existing = await tx.file.findFirst({
              where: {
                sessionId,
                path,
              },
            });

            if (existing) {
              // UPDATE
              await tx.file.update({
                where: { id: existing.id },
                data: {
                  content,
                  size: Buffer.byteLength(content, 'utf8'),
                  updatedAt: new Date(),
                },
              });
              logger.info(`  📝 更新文件: ${path}`);
            } else {
              // CREATE
              await tx.file.create({
                data: {
                  sessionId,
                  // projectId 是可选的，暂时移除以避免 Prisma Client 错误
                  // projectId,
                  path,
                  name,
                  type: 'text',
                  content,
                  mimeType,
                  size: Buffer.byteLength(content, 'utf8'),
                },
              });
              logger.info(`  ✨ 创建文件: ${path}`);
            }

            persistedFiles.push(path);
          } catch (error: any) {
            const errorMsg = `持久化文件失败 ${path}: ${error.message}`;
            logger.error(`  ❌ ${errorMsg}`);
            errors.push(errorMsg);
            // 在事务中，如果有一个失败，整个事务会回滚
            // 但我们可以继续尝试其他文件（取决于错误类型）
          }
        }
      });

      logger.info(`✅ 已持久化 ${persistedFiles.length} 个文件`);

      return {
        success: errors.length === 0,
        persistedFiles,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      logger.error('❌ 提交暂存变更失败:', error);
      return {
        success: false,
        persistedFiles: [],
        errors: [error.message],
      };
    }
  }

  /**
   * 刷新符号索引
   * 写入成功后，立即调用 Tree-sitter 重新解析这几个文件，更新 symbol_index 表。
   * 
   * @param fileIds 文件ID列表（可选，如果提供则只更新这些文件）
   * @param filePaths 文件路径列表（可选，如果提供则只更新这些路径的文件）
   * @param sessionId 会话ID
   * @param projectId 项目ID
   * @returns 更新的符号数量
   */
  async refreshSymbolIndex(
    filePaths: string[],
    sessionId: string,
    projectId: string
  ): Promise<{
    success: boolean;
    updatedSymbols: number;
    errors?: string[];
  }> {
    if (!prisma) {
      return {
        success: false,
        updatedSymbols: 0,
        errors: ['数据库不可用'],
      };
    }

    try {
      await ensureConnection();

      const allSymbols: Array<{
        name: string;
        type: string;
        snippet: string;
        line: number;
        file: string;
        keywords: string[];
        signature?: string;
      }> = [];

      const errors: string[] = [];

      // 1. 获取文件内容并提取符号
      for (const filePath of filePaths) {
        try {
          const file = await (prisma as any).file.findFirst({
            where: {
              sessionId,
              path: filePath,
            },
          });

          if (!file || !file.content) {
            logger.warn(`⚠️ 文件不存在或内容为空: ${filePath}`);
            continue;
          }

          // 只处理 TypeScript/JavaScript 文件
          if (!filePath.match(/\.(ts|tsx|js|jsx)$/)) {
            continue;
          }

          // 提取符号
          const symbols = await this.symbolExtractor.extractFromFile(
            filePath,
            file.content
          );

          allSymbols.push(
            ...symbols.map(s => ({
              name: s.name,
              type: s.type,
              snippet: s.snippet,
              line: s.line,
              file: filePath,
              keywords: s.keywords,
              signature: s.signature,
            }))
          );
        } catch (error: any) {
          const errorMsg = `提取符号失败 ${filePath}: ${error.message}`;
          logger.error(`  ❌ ${errorMsg}`);
          errors.push(errorMsg);
        }
      }

      if (allSymbols.length === 0) {
        logger.info('ℹ️ 没有需要更新的符号');
        return {
          success: true,
          updatedSymbols: 0,
          errors: errors.length > 0 ? errors : undefined,
        };
      }

      // 2. 使用事务批量更新符号索引
      await prisma.$transaction(async (tx: any) => {
        // 先删除这些文件的旧符号
        await tx.symbol.deleteMany({
          where: {
            projectId,
            file: {
              in: filePaths,
            },
          },
        });

        // 插入新符号
        if (allSymbols.length > 0) {
          await tx.symbol.createMany({
            data: allSymbols.map(s => ({
              projectId,
              name: s.name,
              type: s.type,
              snippet: s.snippet,
              line: s.line,
              file: s.file,
              keywords: s.keywords,
              signature: s.signature,
            })),
          });
        }
      });

      logger.info(`✅ 已更新 ${allSymbols.length} 个符号索引`);

      return {
        success: errors.length === 0,
        updatedSymbols: allSymbols.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error: any) {
      logger.error('❌ 刷新符号索引失败:', error);
      return {
        success: false,
        updatedSymbols: 0,
        errors: [error.message],
      };
    }
  }

  /**
   * 批量提交并刷新索引
   * 一次性完成持久化和索引更新
   */
  async commitAndRefresh(
    sessionId: string,
    projectId: string,
    stagedFiles: Map<string, string>
  ): Promise<{
    persistence: PersistenceResult;
    reindex: {
      success: boolean;
      updatedSymbols: number;
      errors?: string[];
    };
  }> {
    // 1. 先提交文件
    const persistence = await this.commitStagedChanges(
      sessionId,
      projectId,
      stagedFiles
    );

    // 2. 如果提交成功，刷新符号索引
    let reindex = {
      success: false,
      updatedSymbols: 0,
      errors: ['文件提交失败，跳过索引更新'] as string[],
    };

    if (persistence.success) {
      const filePaths = Array.from(stagedFiles.keys());
      reindex = await this.refreshSymbolIndex(filePaths, sessionId, projectId);
    }

    return {
      persistence,
      reindex,
    };
  }

  /**
   * 获取 MIME 类型
   */
  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      ts: 'text/typescript',
      tsx: 'text/typescript',
      js: 'text/javascript',
      jsx: 'text/javascript',
      css: 'text/css',
      html: 'text/html',
      json: 'application/json',
      md: 'text/markdown',
      txt: 'text/plain',
    };
    return mimeTypes[ext || ''] || 'text/plain';
  }
}
