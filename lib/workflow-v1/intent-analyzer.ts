/**
 * IntentAnalyzer - 分析用户 prompt，识别目标文件路径
 */

import {
  IIntentAnalyzer,
  IntentAnalyzerInput,
  IntentAnalyzerOutput,
} from './types';
import { logger } from '../logger';

export class IntentAnalyzer implements IIntentAnalyzer {
  /**
   * 分析用户 prompt，识别目标文件
   */
  async analyze(input: IntentAnalyzerInput): Promise<IntentAnalyzerOutput> {
    const { userPrompt, projectContext } = input;

    try {
      // 策略1: 如果明确提到文件路径，直接提取
      const explicitPath = this.extractExplicitFilePath(userPrompt);
      if (explicitPath) {
        return {
          targetFilePath: explicitPath,
          confidence: 0.9,
          reasoning: `从 prompt 中提取到明确的文件路径: ${explicitPath}`,
        };
      }

      // 策略2: 如果有当前文件，优先使用
      if (projectContext?.currentFile) {
        const currentFileMatch = this.matchCurrentFile(userPrompt, projectContext.currentFile);
        if (currentFileMatch.confidence > 0.5) {
          return {
            targetFilePath: projectContext.currentFile,
            confidence: currentFileMatch.confidence,
            reasoning: currentFileMatch.reasoning,
          };
        }
      }

      // 策略3: 基于关键词匹配文件树
      if (projectContext?.fileTree && projectContext.fileTree.length > 0) {
        const fileTreeMatch = this.matchFileTree(userPrompt, projectContext.fileTree);
        if (fileTreeMatch.confidence > 0.3) {
          return fileTreeMatch;
        }
      }

      // 策略4: 默认返回第一个文件（如果有）
      if (projectContext?.fileTree && projectContext.fileTree.length > 0) {
        const firstFile = projectContext.fileTree[0];
        return {
          targetFilePath: firstFile,
          confidence: 0.2,
          reasoning: `未找到明确匹配，使用项目中的第一个文件: ${firstFile}`,
        };
      }

      // 策略5: 如果没有任何上下文，根据 prompt 推断默认文件名
      const inferredPath = this.inferDefaultFilePath(userPrompt);
      return {
        targetFilePath: inferredPath,
        confidence: 0.1,
        reasoning: `根据 prompt 推断默认文件路径: ${inferredPath}`,
      };
    } catch (error: any) {
      logger.error('❌ IntentAnalyzer 分析失败:', error);
      
      // 降级：返回默认文件
      return {
        targetFilePath: 'index.ts',
        confidence: 0.0,
        reasoning: `分析失败，使用默认文件: ${error.message}`,
      };
    }
  }

  /**
   * 提取明确的文件路径
   * 支持格式：
   * - "修改 src/components/Button.tsx"
   * - "在 app/page.tsx 中添加"
   * - "文件: lib/utils.ts"
   */
  private extractExplicitFilePath(prompt: string): string | null {
    // 匹配常见的文件路径模式
    const patterns = [
      // "修改/编辑/更新 [路径]"
      /(?:修改|编辑|更新|打开|查看|在)\s+([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|html|json|md))/i,
      // "[路径] 文件"
      /([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|html|json|md))\s+(?:文件|中|里)/i,
      // "文件: [路径]" 或 "file: [path]"
      /(?:文件|file)[:：]\s*([a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|html|json|md))/i,
      // 直接路径（以 / 或 ./ 开头）
      /([./][a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|css|html|json|md))/i,
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match && match[1]) {
        let path = match[1].trim();
        // 规范化路径
        if (!path.startsWith('/') && !path.startsWith('./')) {
          path = './' + path;
        }
        return path;
      }
    }

    return null;
  }

  /**
   * 匹配当前文件
   */
  private matchCurrentFile(
    prompt: string,
    currentFile: string
  ): { confidence: number; reasoning: string } {
    const lowerPrompt = prompt.toLowerCase();
    const fileName = currentFile.split('/').pop() || currentFile;
    const fileNameWithoutExt = fileName.replace(/\.(ts|tsx|js|jsx)$/, '');

    // 检查是否提到当前文件名
    if (lowerPrompt.includes(fileName.toLowerCase()) || 
        lowerPrompt.includes(fileNameWithoutExt.toLowerCase())) {
      return {
        confidence: 0.8,
        reasoning: `Prompt 中提到了当前文件名: ${fileName}`,
      };
    }

    // 检查是否提到"当前文件"、"这个文件"等
    const currentFileKeywords = ['当前', '这个', '本', '现在', 'current', 'this', 'here'];
    if (currentFileKeywords.some(keyword => lowerPrompt.includes(keyword))) {
      return {
        confidence: 0.7,
        reasoning: `Prompt 中提到了当前文件相关的关键词`,
      };
    }

    return {
      confidence: 0.3,
      reasoning: `未明确提到当前文件，但作为备选`,
    };
  }

  /**
   * 基于关键词匹配文件树
   */
  private matchFileTree(
    prompt: string,
    fileTree: string[]
  ): IntentAnalyzerOutput {
    const lowerPrompt = prompt.toLowerCase();
    const promptWords = this.extractKeywords(lowerPrompt);

    // 计算每个文件的匹配分数
    const scores: Array<{ path: string; score: number; reasons: string[] }> = [];

    for (const filePath of fileTree) {
      let score = 0;
      const reasons: string[] = [];
      const fileName = filePath.split('/').pop() || filePath;
      const fileNameWithoutExt = fileName.replace(/\.(ts|tsx|js|jsx|css|html|json|md)$/, '');
      const pathParts = filePath.split('/').filter(p => p);

      // 检查文件名匹配
      for (const word of promptWords) {
        if (fileNameWithoutExt.toLowerCase().includes(word)) {
          score += 0.3;
          reasons.push(`文件名包含关键词: ${word}`);
        }
      }

      // 检查路径匹配
      for (const word of promptWords) {
        for (const part of pathParts) {
          if (part.toLowerCase().includes(word)) {
            score += 0.2;
            reasons.push(`路径包含关键词: ${word}`);
          }
        }
      }

      // 检查文件扩展名匹配（根据 prompt 中的技术栈关键词）
      const extension = fileName.split('.').pop()?.toLowerCase();
      if (extension) {
        if (extension === 'tsx' || extension === 'ts') {
          if (lowerPrompt.includes('react') || lowerPrompt.includes('component') || 
              lowerPrompt.includes('tsx') || lowerPrompt.includes('typescript')) {
            score += 0.2;
            reasons.push('匹配 TypeScript/React 文件类型');
          }
        }
        if (extension === 'css') {
          if (lowerPrompt.includes('style') || lowerPrompt.includes('css') || 
              lowerPrompt.includes('样式')) {
            score += 0.2;
            reasons.push('匹配 CSS 文件类型');
          }
        }
        if (extension === 'html') {
          if (lowerPrompt.includes('html') || lowerPrompt.includes('页面') || 
              lowerPrompt.includes('page')) {
            score += 0.2;
            reasons.push('匹配 HTML 文件类型');
          }
        }
      }

      if (score > 0) {
        scores.push({ path: filePath, score, reasons });
      }
    }

    // 按分数排序
    scores.sort((a, b) => b.score - a.score);

    if (scores.length > 0 && scores[0].score > 0.3) {
      const best = scores[0];
      return {
        targetFilePath: best.path,
        confidence: Math.min(best.score, 0.8),
        reasoning: best.reasons.join('; '),
      };
    }

    // 如果没有好的匹配，返回第一个文件
    return {
      targetFilePath: fileTree[0],
      confidence: 0.2,
      reasoning: '未找到强匹配，使用文件树中的第一个文件',
    };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 移除常见停用词
    const stopWords = new Set([
      '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
    ]);

    // 提取单词（支持中英文）
    const words = text.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
    
    // 过滤停用词和短词
    return words
      .filter(word => word.length > 1 && !stopWords.has(word.toLowerCase()))
      .map(word => word.toLowerCase())
      .slice(0, 10); // 最多返回10个关键词
  }

  /**
   * 根据 prompt 推断默认文件路径
   */
  private inferDefaultFilePath(prompt: string): string {
    const lowerPrompt = prompt.toLowerCase();

    // 根据技术栈推断
    if (lowerPrompt.includes('react') || lowerPrompt.includes('component') || 
        lowerPrompt.includes('tsx')) {
      return 'src/App.tsx';
    }
    if (lowerPrompt.includes('typescript') || lowerPrompt.includes('ts')) {
      return 'src/index.ts';
    }
    if (lowerPrompt.includes('css') || lowerPrompt.includes('style') || 
        lowerPrompt.includes('样式')) {
      return 'src/styles.css';
    }
    if (lowerPrompt.includes('html') || lowerPrompt.includes('page') || 
        lowerPrompt.includes('页面')) {
      return 'index.html';
    }

    // 默认返回
    return 'src/index.ts';
  }
}
