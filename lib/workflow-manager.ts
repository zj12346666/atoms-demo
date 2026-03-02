/**
 * VIP Code Agent - WorkflowManager
 * 核心状态机：Intent & Retrieval → MultiFileCodeGen → Validation Loop → Persistence & Reindex
 */

import { prisma, ensureConnection } from './db';
import { logger } from './logger';
import OpenAI from 'openai';
import { SandboxService } from './sandbox-service';
import { SymbolExtractor } from './symbol-extractor';
import { FileManager } from './file-manager';
import { CodeKeywordIndexer } from './keyword-indexer';

export type WorkflowState = 
  | 'idle'
  | 'intent_retrieval'
  | 'code_generation'
  | 'validation'
  | 'fixing'
  | 'persistence'
  | 'reindexing'
  | 'completed'
  | 'failed';

export interface WorkflowProgress {
  state: WorkflowState;
  message: string;
  progress: number; // 0-100
  details?: string;
}

export interface FileChange {
  path: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  code: string; // 完整代码或diff
  isDiff?: boolean; // 是否为增量更新
}

export interface WorkflowResult {
  success: boolean;
  fileChanges: FileChange[];
  errors?: string[];
  warnings?: string[];
  validationAttempts?: number;
}

export class WorkflowManager {
  private client: OpenAI;
  private sandbox: SandboxService;
  private symbolExtractor: SymbolExtractor;
  private fileManager: FileManager;
  private maxFixAttempts = 3;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    this.sandbox = new SandboxService();
    this.symbolExtractor = new SymbolExtractor();
    this.fileManager = new FileManager();
  }

  /**
   * 主工作流入口
   */
  async execute(
    prompt: string,
    sessionId: string,
    projectId: string,
    onProgress: (progress: WorkflowProgress) => void
  ): Promise<WorkflowResult> {
    let currentState: WorkflowState = 'idle';
    let fixAttempts = 0;
    let fileChanges: FileChange[] = [];

    try {
      // 确保数据库连接
      await ensureConnection();

      // 状态1: Intent & Retrieval
      currentState = 'intent_retrieval';
      onProgress({
        state: currentState,
        message: '🧠 解析意图并检索符号...',
        progress: 10,
      });

      const { keywords, symbols } = await this.intentAndRetrieval(prompt, projectId);
      
      onProgress({
        state: currentState,
        message: `✅ 检索到 ${symbols.length} 个相关符号`,
        progress: 20,
        details: `关键词: ${keywords.join(', ')}`,
      });

      // 状态2: MultiFileCodeGen (循环直到验证通过)
      while (fixAttempts < this.maxFixAttempts) {
        currentState = 'code_generation';
        onProgress({
          state: currentState,
          message: fixAttempts > 0 
            ? `🔧 修复代码 (尝试 ${fixAttempts + 1}/${this.maxFixAttempts})...`
            : '✍️ 生成代码...',
          progress: 30 + fixAttempts * 10,
        });

        // 获取当前文件内容（用于上下文）
        const currentFiles = await this.getCurrentFiles(sessionId);
        
        // 生成代码（XML格式）
        const generatedXml = await this.generateCode(
          prompt,
          keywords,
          symbols,
          currentFiles,
          fixAttempts > 0 ? fileChanges : undefined
        );

        // 解析XML获取文件变更
        fileChanges = this.parseXmlFileChanges(generatedXml);

        if (fileChanges.length === 0) {
          throw new Error('未生成任何文件变更');
        }

        // 状态3: Validation Loop
        currentState = 'validation';
        onProgress({
          state: currentState,
          message: '🔬 验证代码...',
          progress: 60,
        });

        const validationResult = await this.validateCode(fileChanges, sessionId);

        if (validationResult.success) {
          // 验证通过，退出循环
          break;
        }

        // 验证失败，准备修复
        fixAttempts++;
        if (fixAttempts >= this.maxFixAttempts) {
          return {
            success: false,
            fileChanges,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            validationAttempts: fixAttempts,
          };
        }

        // 更新prompt，包含错误信息
        prompt = this.buildFixPrompt(prompt, validationResult.errors, fileChanges);
      }

      // 状态4: Persistence
      currentState = 'persistence';
      onProgress({
        state: currentState,
        message: '💾 持久化文件...',
        progress: 80,
      });

      await this.persistFiles(sessionId, fileChanges);

      // 状态5: Reindex
      currentState = 'reindexing';
      onProgress({
        state: currentState,
        message: '🔄 更新符号索引...',
        progress: 90,
      });

      await this.reindexSymbols(sessionId, projectId, fileChanges);

      // 完成
      currentState = 'completed';
      onProgress({
        state: currentState,
        message: '✅ 完成！',
        progress: 100,
      });

      return {
        success: true,
        fileChanges,
        validationAttempts: fixAttempts + 1,
      };

    } catch (error: any) {
      logger.error('❌ Workflow执行失败:', error);
      currentState = 'failed';
      onProgress({
        state: currentState,
        message: `❌ 失败: ${error.message}`,
        progress: 0,
      });

      return {
        success: false,
        fileChanges,
        errors: [error.message],
        validationAttempts: fixAttempts,
      };
    }
  }

  /**
   * 阶段1: Intent & Retrieval
   * 提取关键词并在symbol_index表中检索
   */
  private async intentAndRetrieval(
    prompt: string,
    projectId: string
  ): Promise<{ keywords: string[]; symbols: any[] }> {
    // 提取关键词
    const keywords = this.extractKeywords(prompt);

    // 在symbols表中检索
    if (!prisma) {
      return { keywords, symbols: [] };
    }

    const symbols = await (prisma as any).symbol.findMany({
      where: {
        projectId,
        OR: [
          {
            name: {
              in: keywords,
              mode: 'insensitive',
            },
          },
          {
            keywords: {
              hasSome: keywords,
            },
          },
        ],
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20, // 限制返回数量
    });

    return { keywords, symbols };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 移除标点符号，转换为小写，分词
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);

    // 去重
    return Array.from(new Set(words));
  }

  /**
   * 阶段2: MultiFileCodeGen
   * 生成XML格式的代码变更
   */
  private async generateCode(
    prompt: string,
    keywords: string[],
    symbols: any[],
    currentFiles: Array<{ path: string; content: string }>,
    previousChanges?: FileChange[]
  ): Promise<string> {
    // 构建符号上下文
    const symbolContext = symbols.map(s => `
[${s.type.toUpperCase()}] ${s.name}
${s.signature || s.snippet}
文件: ${s.file}
关键词: ${s.keywords.slice(0, 5).join(', ')}
`).join('\n');

    // 构建当前文件上下文
    const filesContext = currentFiles.map(f => `
文件: ${f.path}
\`\`\`
${f.content.substring(0, 500)}${f.content.length > 500 ? '...' : ''}
\`\`\`
`).join('\n');

    // 构建修复上下文（如果有）
    const fixContext = previousChanges 
      ? `\n\n**之前的修改（需要修复）:**\n${previousChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}`
      : '';

    const systemPrompt = `你是一个专业的前端代码生成专家。请根据用户需求生成代码变更。

**重要要求：**
1. 必须使用XML格式输出
2. 支持在一个任务中同时修改多个关联文件
3. 使用Search/Replace模式生成代码增量，不要重写整个文件
4. 确保代码符合TypeScript/React最佳实践

**输出格式：**
\`\`\`xml
<plan>
  简述本次修改的逻辑步骤
</plan>

<file_change path="src/components/MyComponent.tsx">
  <action>UPDATE</action>
  <code>
    // 完整代码或增量代码（使用 // ... existing code ... 标记保留的部分）
  </code>
</file_change>

<file_change path="src/styles/MyComponent.css">
  <action>CREATE</action>
  <code>
    /* CSS代码 */
  </code>
</file_change>
\`\`\`

**当前项目符号：**
${symbolContext}

**当前文件：**
${filesContext}
${fixContext}`;

    const userPrompt = `用户需求：${prompt}

请生成代码变更，确保：
1. 所有文件路径使用相对路径
2. 代码语法正确
3. 导入/导出正确
4. 类型定义完整`;

    const response = await this.client.chat.completions.create({
      model: 'glm-4-plus',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // 提取XML部分
    const xmlMatch = content.match(/```xml\n([\s\S]*?)\n```/) || content.match(/<plan>[\s\S]*<\/file_change>/);
    if (xmlMatch) {
      return xmlMatch[1] || xmlMatch[0];
    }

    return content;
  }

  /**
   * 解析XML文件变更
   */
  private parseXmlFileChanges(xml: string): FileChange[] {
    const changes: FileChange[] = [];

    // 使用正则表达式解析XML
    const fileChangeRegex = /<file_change\s+path=["']([^"']+)["']>[\s\S]*?<action>([^<]+)<\/action>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/file_change>/g;
    
    let match;
    while ((match = fileChangeRegex.exec(xml)) !== null) {
      const [, path, action, code] = match;
      changes.push({
        path: path.trim(),
        action: action.trim().toUpperCase() as 'CREATE' | 'UPDATE' | 'DELETE',
        code: code.trim(),
        isDiff: code.includes('// ... existing code ...') || code.includes('/* ... existing code ... */'),
      });
    }

    return changes;
  }

  /**
   * 阶段3: Validation Loop
   * 在内存虚拟文件系统中运行tsc --noEmit
   */
  private async validateCode(
    fileChanges: FileChange[],
    sessionId: string
  ): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
    // 获取当前所有文件
    const allFiles = await this.getCurrentFiles(sessionId);
    
    // 应用文件变更到内存文件系统
    const virtualFs = new Map<string, string>();
    
    // 先加载现有文件
    for (const file of allFiles) {
      virtualFs.set(file.path, file.content);
    }

    // 应用变更
    for (const change of fileChanges) {
      if (change.action === 'DELETE') {
        virtualFs.delete(change.path);
      } else {
        // 如果是UPDATE且是diff，需要合并
        if (change.action === 'UPDATE' && change.isDiff && virtualFs.has(change.path)) {
          const existing = virtualFs.get(change.path) || '';
          virtualFs.set(change.path, this.mergeCode(existing, change.code));
        } else {
          virtualFs.set(change.path, change.code);
        }
      }
    }

    // 运行tsc验证
    return await this.sandbox.validateTypeScript(virtualFs);
  }

  /**
   * 合并代码（简单的diff合并）
   */
  private mergeCode(existing: string, newCode: string): string {
    // 如果新代码包含标记，尝试合并
    if (newCode.includes('// ... existing code ...')) {
      // 简单的实现：替换标记部分
      // 实际应该使用更智能的diff算法
      return newCode.replace(/\/\/ \.\.\. existing code \.\.\./g, existing);
    }
    
    // 如果没有标记，直接替换
    return newCode;
  }

  /**
   * 构建修复提示
   */
  private buildFixPrompt(
    originalPrompt: string,
    errors: string[],
    fileChanges: FileChange[]
  ): string {
    return `${originalPrompt}

**需要修复的错误：**
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

**当前文件变更：**
${fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}

请修复以上错误，确保代码可以编译通过。`;
  }

  /**
   * 获取当前文件
   */
  private async getCurrentFiles(sessionId: string): Promise<Array<{ path: string; content: string }>> {
    const files = await this.fileManager.getFiles(sessionId);
    const filesWithContent = await Promise.all(
      files.map(async (f) => {
        const content = await this.fileManager.getFile(sessionId, f.path);
        return {
          path: f.path,
          content: content?.content || '',
        };
      })
    );
    return filesWithContent;
  }

  /**
   * 阶段4: Persistence
   * 原子写入文件到PostgreSQL
   */
  private async persistFiles(sessionId: string, fileChanges: FileChange[]): Promise<void> {
    if (!prisma) {
      throw new Error('Database not available');
    }

    // 获取session以获取projectId
    const session = await (prisma as any).session.findUnique({
      where: { sessionId },
      select: { projectId: true },
    });

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 使用事务批量更新
    await prisma.$transaction(async (tx: any) => {
      for (const change of fileChanges) {
        if (change.action === 'DELETE') {
          await tx.file.deleteMany({
            where: {
              sessionId,
              path: change.path,
            },
          });
        } else {
          // CREATE 或 UPDATE
          const existing = await tx.file.findFirst({
            where: {
              sessionId,
              path: change.path,
            },
          });

          if (existing) {
            // UPDATE
            await tx.file.update({
              where: { id: existing.id },
              data: {
                content: change.code,
                size: change.code.length,
                updatedAt: new Date(),
              },
            });
          } else {
            // CREATE
            const pathParts = change.path.split('/');
            const name = pathParts[pathParts.length - 1];
            const mimeType = this.getMimeType(change.path);

            await tx.file.create({
              data: {
                sessionId,
                // projectId 是可选的，暂时移除以避免 Prisma Client 错误
                // projectId: session.projectId,
                path: change.path,
                name,
                type: 'text',
                content: change.code,
                mimeType,
                size: change.code.length,
              },
            });
          }
        }
      }
    });

    logger.info(`✅ 已持久化 ${fileChanges.length} 个文件变更`);
  }

  /**
   * 阶段5: Reindex
   * Tree-sitter扫描并更新symbol_index
   */
  private async reindexSymbols(
    sessionId: string,
    projectId: string,
    fileChanges: FileChange[]
  ): Promise<void> {
    if (!prisma) {
      return;
    }

    // 获取变更的文件内容
    const filesToReindex = await Promise.all(
      fileChanges
        .filter(fc => fc.action !== 'DELETE')
        .map(async (fc) => {
          const file = await this.fileManager.getFile(sessionId, fc.path);
          return {
            path: fc.path,
            content: file?.content || fc.code,
          };
        })
    );

    // 提取符号
    const allSymbols: Array<{
      name: string;
      type: string;
      snippet: string;
      line: number;
      file: string;
      keywords: string[];
      signature?: string;
    }> = [];

    for (const file of filesToReindex) {
      if (file.path.endsWith('.ts') || file.path.endsWith('.tsx') || file.path.endsWith('.js') || file.path.endsWith('.jsx')) {
        // 使用Tree-sitter提取（如果可用）或回退到正则
        const symbols = await this.symbolExtractor.extractFromFile(file.path, file.content);
        allSymbols.push(...symbols.map(s => ({
          ...s,
          file: file.path,
        })));
      }
    }

    // 批量更新symbols表
    if (allSymbols.length > 0) {
      // 先删除旧符号（这些文件的）
      const filePaths = filesToReindex.map(f => f.path);
      await (prisma as any).symbol.deleteMany({
        where: {
          projectId,
          file: {
            in: filePaths,
          },
        },
      });

      // 插入新符号
      await (prisma as any).symbol.createMany({
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

      logger.info(`✅ 已更新 ${allSymbols.length} 个符号索引`);
    }
  }

  /**
   * 获取MIME类型
   */
  private getMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'ts': 'text/typescript',
      'tsx': 'text/typescript',
      'js': 'text/javascript',
      'jsx': 'text/javascript',
      'css': 'text/css',
      'html': 'text/html',
      'json': 'application/json',
    };
    return mimeTypes[ext || ''] || 'text/plain';
  }
}
