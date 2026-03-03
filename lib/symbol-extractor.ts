/**
 * SymbolExtractor - 使用Tree-sitter提取TypeScript/JavaScript符号
 * 支持提取：export函数、interface、type、class等
 */

import { logger } from './logger';

export interface ExtractedSymbol {
  name: string;
  type: 'function' | 'variable' | 'class' | 'interface' | 'type' | 'event';
  snippet: string;
  line: number;
  keywords: string[];
  signature?: string; // 函数签名或接口定义
}

export class SymbolExtractor {
  private useTreeSitter: boolean = false;

  constructor() {
    // 检查是否可用Tree-sitter（需要安装tree-sitter相关包）
    this.checkTreeSitterAvailability();
  }

  /**
   * 提取关键词（从CodeKeywordIndexer复制）
   */
  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !this.isKeyword(word));
    return Array.from(new Set(words));
  }

  /**
   * 判断是否是保留字
   */
  private isKeyword(word: string): boolean {
    const keywords = new Set([
      'function', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
      'return', 'class', 'new', 'this', 'true', 'false', 'null', 'undefined',
      'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'throw', 'async', 'await',
      'export', 'import', 'from', 'default', 'interface', 'type',
    ]);
    return keywords.has(word.toLowerCase());
  }

  /**
   * 检查Tree-sitter是否可用
   */
  private async checkTreeSitterAvailability(): Promise<void> {
    try {
      // 尝试动态导入tree-sitter（如果安装了）
      // const treeSitter = await import('tree-sitter');
      // this.useTreeSitter = true;
      this.useTreeSitter = false; // 暂时禁用，使用正则作为fallback
    } catch {
      this.useTreeSitter = false;
    }
  }

  /**
   * 从文件内容提取符号
   */
  async extractFromFile(
    filePath: string,
    content: string
  ): Promise<ExtractedSymbol[]> {
    if (this.useTreeSitter) {
      return this.extractWithTreeSitter(filePath, content);
    } else {
      return this.extractWithRegex(filePath, content);
    }
  }

  /**
   * 使用Tree-sitter提取（如果可用）
   */
  private async extractWithTreeSitter(
    filePath: string,
    content: string
  ): Promise<ExtractedSymbol[]> {
    // TODO: 实现Tree-sitter提取
    // 这里需要安装 tree-sitter 和 tree-sitter-typescript
    return this.extractWithRegex(filePath, content);
  }

  /**
   * 使用正则表达式提取（fallback）
   */
  private async extractWithRegex(
    filePath: string,
    content: string
  ): Promise<ExtractedSymbol[]> {
    const symbols: ExtractedSymbol[] = [];
    const lines = content.split('\n');

    // 提取export函数
    const exportFunctionRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*{/g;
    // 提取export const函数
    const exportConstFunctionRegex = /export\s+const\s+(\w+)\s*[:=]\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*([^{=>]+))?\s*(?:=>|{)/g;
    // 提取interface
    const interfaceRegex = /export\s+interface\s+(\w+)(?:<[^>]+>)?\s*{/g;
    // 提取type
    const typeRegex = /export\s+type\s+(\w+)(?:<[^>]+>)?\s*=/g;
    // 提取class
    const classRegex = /export\s+(?:default\s+)?class\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+\w+)?\s*{/g;
    // 提取React组件（函数组件）
    const reactComponentRegex = /export\s+(?:default\s+)?(?:function\s+)?(\w+)\s*[:=]\s*(?:React\.)?(?:FC|FunctionComponent|React\.FC)<[^>]*>\s*[=:]/g;

    lines.forEach((line, index) => {
      // Export函数
      let match;
      const funcRegex = new RegExp(exportFunctionRegex.source, 'g');
      while ((match = funcRegex.exec(line)) !== null) {
        const [, name, params, returnType] = match;
        const signature = `${name}(${params})${returnType ? `: ${returnType.trim()}` : ''}`;
        symbols.push({
          name,
          type: 'function',
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature,
        });
      }

      // Export const函数
      const constFuncRegex = new RegExp(exportConstFunctionRegex.source, 'g');
      while ((match = constFuncRegex.exec(line)) !== null) {
        const [, name, params, returnType] = match;
        const signature = `${name}(${params})${returnType ? `: ${returnType.trim()}` : ''}`;
        symbols.push({
          name,
          type: 'function',
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature,
        });
      }

      // Interface
      const interfaceMatch = interfaceRegex.exec(line);
      if (interfaceMatch) {
        const [, name] = interfaceMatch;
        // 提取interface内容（简单版本）
        let interfaceContent = '';
        let braceCount = 0;
        let startLine = index;
        for (let i = index; i < Math.min(index + 50, lines.length); i++) {
          const l = lines[i];
          interfaceContent += l + '\n';
          braceCount += (l.match(/{/g) || []).length;
          braceCount -= (l.match(/}/g) || []).length;
          if (braceCount === 0 && i > index) break;
        }
        
        symbols.push({
          name,
          type: 'interface',
          snippet: interfaceContent.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature: interfaceContent.substring(0, 200),
        });
        interfaceRegex.lastIndex = 0; // 重置
      }

      // Type
      const typeMatch = typeRegex.exec(line);
      if (typeMatch) {
        const [, name] = typeMatch;
        symbols.push({
          name,
          type: 'type',
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature: line.trim(),
        });
        typeRegex.lastIndex = 0;
      }

      // Class
      const classMatch = classRegex.exec(line);
      if (classMatch) {
        const [, name] = classMatch;
        symbols.push({
          name,
          type: 'class',
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature: line.trim(),
        });
        classRegex.lastIndex = 0;
      }

      // React组件
      const reactMatch = reactComponentRegex.exec(line);
      if (reactMatch) {
        const [, name] = reactMatch;
        symbols.push({
          name,
          type: 'function', // React组件也是函数
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
          signature: `${name}: React.FC`,
        });
        reactComponentRegex.lastIndex = 0;
      }
    });

    return symbols;
  }
}
