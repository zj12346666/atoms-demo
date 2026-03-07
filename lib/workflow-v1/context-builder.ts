/**
 * ContextBuilder - 基于文件内容和用户 prompt 构造 LLM 上下文
 */

import {
  IContextBuilder,
  ContextBuilderInput,
  ContextBuilderOutput,
} from './types';
import { logger } from '../logger';

export class ContextBuilder implements IContextBuilder {
  /**
   * 构造 LLM prompt 上下文
   */
  async build(input: ContextBuilderInput): Promise<ContextBuilderOutput> {
    const { filePath, fileContent, userPrompt, projectContext } = input;

    try {
      // 检测语言类型
      const language = this.detectLanguage(filePath, fileContent);
      const lineCount = fileContent.split('\n').length;

      // 构建文件上下文部分
      const fileContext = this.buildFileContext(filePath, fileContent, language);

      // 构建项目上下文部分（如果有）
      const projectContextSection = this.buildProjectContext(projectContext);

      // 构建完整的 LLM prompt
      const llmPrompt = this.assemblePrompt(
        userPrompt,
        fileContext,
        projectContextSection,
        filePath,
        language
      );

      return {
        llmPrompt,
        metadata: {
          filePath,
          lineCount,
          language,
        },
      };
    } catch (error: any) {
      logger.error(`❌ ContextBuilder 构建失败 (${filePath}):`, error);
      throw new Error(`ContextBuilder 构建失败: ${error.message}`);
    }
  }

  /**
   * 检测语言类型
   */
  private detectLanguage(filePath: string, content: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      css: 'css',
      html: 'html',
      json: 'json',
      md: 'markdown',
    };

    return languageMap[ext] || 'text';
  }

  /**
   * 构建文件上下文
   */
  private buildFileContext(
    filePath: string,
    fileContent: string,
    language: string
  ): string {
    const codeBlock = language === 'text' ? 'text' : language;

    return `**目标文件：** ${filePath}

**文件内容：**
\`\`\`${codeBlock}
${fileContent}
\`\`\``;
  }

  /**
   * 构建项目上下文
   */
  private buildProjectContext(
    projectContext?: ContextBuilderInput['projectContext']
  ): string {
    if (!projectContext) {
      return '';
    }

    const sections: string[] = [];

    // 文件树信息
    if (projectContext.fileTree && projectContext.fileTree.length > 0) {
      sections.push(
        `**项目文件结构：**\n${projectContext.fileTree.map(f => `- ${f}`).join('\n')}`
      );
    }

    // 相关文件内容
    if (projectContext.relatedFiles && projectContext.relatedFiles.length > 0) {
      const relatedFilesSection = projectContext.relatedFiles
        .map(file => {
          const lang = this.detectLanguage(file.path, file.content);
          const codeBlock = lang === 'text' ? 'text' : lang;
          return `**相关文件：** ${file.path}\n\`\`\`${codeBlock}\n${file.content}\n\`\`\``;
        })
        .join('\n\n');

      sections.push(relatedFilesSection);
    }

    return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
  }

  /**
   * 组装完整的 LLM prompt
   */
  private assemblePrompt(
    userPrompt: string,
    fileContext: string,
    projectContext: string,
    filePath: string,
    language: string
  ): string {
    const isModification = fileContext.includes('```'); // 如果有文件内容，说明是修改模式

    const modificationModeHint = isModification
      ? `\n\n**⚠️ 重要提示：这是修改模式**
- 请只修改目标文件，保持代码风格一致
- 如果用户没有明确要求，不要删除或大幅修改现有功能
- 确保修改后的代码语法正确，无类型错误
- 检查并更新相关的导入/导出语句（如果需要）`
      : '';

    const languageSpecificGuidelines = this.getLanguageGuidelines(language);

    return `你是一个专业的代码生成专家。请根据用户需求${isModification ? '修改' : '生成'}代码。

${fileContext}

${projectContext}

**用户需求：**
${userPrompt}
${modificationModeHint}

**代码要求：**
1. 生成完整、可运行的代码文件
2. 确保代码语法正确，无语法错误
3. 遵循 ${language} 的最佳实践和代码规范
4. 如果涉及导入/导出，确保路径正确
${languageSpecificGuidelines}

**输出要求：**
- 只输出代码内容，不要包含 markdown 代码块标记
- 不要包含文件路径说明或注释
- 输出完整的文件代码（包括所有必要的导入、类型定义等）`;
  }

  /**
   * 获取语言特定的指导原则
   */
  private getLanguageGuidelines(language: string): string {
    const guidelines: Record<string, string> = {
      typescript: `5. 使用 TypeScript 类型系统，确保类型安全
6. 如果是 React 组件，使用函数式组件和 Hooks
7. 使用现代 ES6+ 语法`,
      javascript: `5. 使用现代 ES6+ 语法
6. 如果是 React 组件，使用函数式组件和 Hooks`,
      css: `5. 使用现代 CSS 特性（Flexbox、Grid 等）
6. 如果项目使用 Tailwind CSS，优先使用 Tailwind 类名`,
      html: `5. 使用语义化 HTML5 标签
6. 确保结构清晰，可访问性良好`,
    };

    return guidelines[language] || '';
  }
}
