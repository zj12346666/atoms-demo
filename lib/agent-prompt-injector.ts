/**
 * Agent Prompt 注入器
 * 自动注入 package.json 和 tsconfig.json 到 Agent 上下文
 */

import { FileManager } from './file-manager';
import { logger } from './logger';

export interface ProjectContext {
  packageJson?: string;
  tsconfigJson?: string;
  viteConfig?: string;
  pathAliases?: Record<string, string>;
}

export class AgentPromptInjector {
  private fileManager: FileManager;

  constructor() {
    this.fileManager = new FileManager();
  }

  /**
   * 获取项目上下文（package.json, tsconfig.json 等）
   */
  async getProjectContext(sessionId: string): Promise<ProjectContext> {
    const context: ProjectContext = {};

    try {
      if (!this.fileManager) {
        logger.warn('⚠️ [PromptInjector] fileManager 未初始化');
        return context;
      }

      // 获取 package.json
      try {
        const packageJsonFile = await this.fileManager.getFile(sessionId, 'package.json');
        if (packageJsonFile?.content) {
          context.packageJson = packageJsonFile.content;
        }
      } catch (error) {
        // 文件不存在是正常的，忽略错误
      }

      // 获取 tsconfig.json
      try {
        const tsconfigFile = await this.fileManager.getFile(sessionId, 'tsconfig.json');
        if (tsconfigFile?.content) {
          context.tsconfigJson = tsconfigFile.content;
          // 解析路径别名
          context.pathAliases = this.extractPathAliases(tsconfigFile.content);
        }
      } catch (error) {
        // 文件不存在是正常的，忽略错误
      }

      // 获取 vite.config.js/ts
      try {
        const viteConfigJs = await this.fileManager.getFile(sessionId, 'vite.config.js');
        const viteConfigTs = await this.fileManager.getFile(sessionId, 'vite.config.ts');
        const viteConfig = viteConfigTs || viteConfigJs;
        if (viteConfig?.content) {
          context.viteConfig = viteConfig.content;
        }
      } catch (error) {
        // 文件不存在是正常的，忽略错误
      }

      logger.info(`📋 [PromptInjector] 已加载项目上下文 (session: ${sessionId})`);
    } catch (error: any) {
      logger.warn(`⚠️ [PromptInjector] 加载项目上下文失败:`, error);
    }

    return context;
  }

  /**
   * 提取路径别名（从 tsconfig.json）
   */
  private extractPathAliases(tsconfigContent: string): Record<string, string> {
    try {
      const tsconfig = JSON.parse(tsconfigContent);
      const paths = tsconfig.compilerOptions?.paths || {};
      
      // 转换路径别名格式
      const aliases: Record<string, string> = {};
      for (const [alias, targets] of Object.entries(paths)) {
        if (Array.isArray(targets) && targets.length > 0) {
          // 移除通配符，只保留基础路径
          const aliasKey = alias.replace('/*', '');
          const targetPath = (targets[0] as string).replace('/*', '');
          aliases[aliasKey] = targetPath;
        }
      }
      
      return aliases;
    } catch (error) {
      logger.warn('⚠️ [PromptInjector] 解析 tsconfig.json 失败:', error);
      return {};
    }
  }

  /**
   * 构建增强的 Prompt（注入项目上下文）
   */
  async enhancePrompt(
    sessionId: string,
    originalPrompt: string
  ): Promise<string> {
    const context = await this.getProjectContext(sessionId);

    const contextParts: string[] = [];

    // 添加 package.json 上下文
    if (context.packageJson) {
      try {
        const packageJson = JSON.parse(context.packageJson);
        contextParts.push(
          `## 项目依赖配置 (package.json)\n` +
          `\`\`\`json\n${JSON.stringify(packageJson, null, 2)}\n\`\`\`\n`
        );
      } catch (error) {
        contextParts.push(
          `## 项目依赖配置 (package.json)\n` +
          `\`\`\`\n${context.packageJson}\n\`\`\`\n`
        );
      }
    }

    // 添加 tsconfig.json 上下文
    if (context.tsconfigJson) {
      contextParts.push(
        `## TypeScript 配置 (tsconfig.json)\n` +
        `\`\`\`json\n${context.tsconfigJson}\n\`\`\`\n`
      );

      // 添加路径别名说明
      if (context.pathAliases && Object.keys(context.pathAliases).length > 0) {
        const aliasList = Object.entries(context.pathAliases)
          .map(([alias, path]) => `- \`${alias}\` -> \`${path}\``)
          .join('\n');
        contextParts.push(
          `### 路径别名配置\n` +
          `请使用以下路径别名，不要使用相对路径：\n${aliasList}\n`
        );
      }
    }

    // 添加 vite.config 上下文
    if (context.viteConfig) {
      contextParts.push(
        `## Vite 配置 (vite.config)\n` +
        `\`\`\`javascript\n${context.viteConfig}\n\`\`\`\n`
      );
    }

    // 组合增强的 Prompt
    if (contextParts.length === 0) {
      return originalPrompt;
    }

    const enhancedPrompt = `${originalPrompt}\n\n---\n\n## 项目环境配置\n\n${contextParts.join('\n')}\n\n**重要提示：**\n- 请严格遵守上述配置中的路径别名规范\n- 确保导入路径与 package.json 中的依赖匹配\n- 遵循 TypeScript 配置的编译选项\n`;

    logger.info('✅ [PromptInjector] 已增强 Prompt，注入项目上下文');
    return enhancedPrompt;
  }

  /**
   * 获取路径别名提示（用于代码生成）
   */
  async getPathAliasHint(sessionId: string): Promise<string> {
    const context = await this.getProjectContext(sessionId);
    if (!context.pathAliases || Object.keys(context.pathAliases).length === 0) {
      return '';
    }

    const aliasList = Object.entries(context.pathAliases)
      .map(([alias, path]) => `  - ${alias} -> ${path}`)
      .join('\n');

    return `\n路径别名配置：\n${aliasList}\n`;
  }
}

// 导出单例
export const agentPromptInjector = new AgentPromptInjector();
