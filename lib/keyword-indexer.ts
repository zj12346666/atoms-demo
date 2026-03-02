// 关键词索引器 - 代码符号提取

export interface Symbol {
  name: string;
  type: 'function' | 'variable' | 'class' | 'event';
  snippet: string;
  line: number;
  keywords: string[];
}

export class CodeKeywordIndexer {
  // 提取 JavaScript 代码中的符号
  extractSymbols(code: string, type: 'js' | 'html' | 'css'): Symbol[] {
    const symbols: Symbol[] = [];

    switch (type) {
      case 'js':
        symbols.push(...this.extractJSSymbols(code));
        break;
      case 'html':
        symbols.push(...this.extractHTMLSymbols(code));
        break;
      case 'css':
        symbols.push(...this.extractCSSSymbols(code));
        break;
    }

    return symbols;
  }

  // 提取 JavaScript 符号
  private extractJSSymbols(code: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = code.split('\n');

    // 正则匹配函数定义
    const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)|(\w+)\s*:\s*function)/g;
    
    lines.forEach((line, index) => {
      // 匹配函数
      let match;
      const funcRegex = new RegExp(functionRegex.source, 'g');
      while ((match = funcRegex.exec(line)) !== null) {
        const funcName = match[1] || match[2] || match[3];
        if (funcName && !this.isKeyword(funcName)) {
          symbols.push({
            name: funcName,
            type: 'function',
            snippet: line.trim(),
            line: index + 1,
            keywords: this.extractKeywords(line),
          });
        }
      }

      // 匹配变量声明
      const varRegex = /(?:const|let|var)\s+(\w+)\s*=/g;
      while ((match = varRegex.exec(line)) !== null) {
        const varName = match[1];
        if (varName && !this.isKeyword(varName)) {
          symbols.push({
            name: varName,
            type: 'variable',
            snippet: line.trim(),
            line: index + 1,
            keywords: this.extractKeywords(line),
          });
        }
      }

      // 匹配事件监听
      const eventRegex = /(?:addEventListener|onclick|onchange|onsubmit|on\w+)\s*=?\s*['"]?(\w+)/g;
      while ((match = eventRegex.exec(line)) !== null) {
        const eventName = match[1];
        if (eventName && !this.isKeyword(eventName)) {
          symbols.push({
            name: eventName,
            type: 'event',
            snippet: line.trim(),
            line: index + 1,
            keywords: this.extractKeywords(line),
          });
        }
      }

      // 匹配类定义
      const classRegex = /class\s+(\w+)/g;
      while ((match = classRegex.exec(line)) !== null) {
        const className = match[1];
        symbols.push({
          name: className,
          type: 'class',
          snippet: line.trim(),
          line: index + 1,
          keywords: this.extractKeywords(line),
        });
      }
    });

    return symbols;
  }

  // 提取 HTML 符号（ID 和重要元素）
  private extractHTMLSymbols(code: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      // 匹配 ID
      const idRegex = /id=['"]([^'"]+)['"]/g;
      let match;
      while ((match = idRegex.exec(line)) !== null) {
        const idName = match[1];
        symbols.push({
          name: idName,
          type: 'variable',
          snippet: line.trim(),
          line: index + 1,
          keywords: [idName, 'id', ...this.extractKeywords(line)],
        });
      }
    });

    return symbols;
  }

  // 提取 CSS 符号（类名和ID）
  private extractCSSSymbols(code: string): Symbol[] {
    const symbols: Symbol[] = [];
    const lines = code.split('\n');

    lines.forEach((line, index) => {
      // 匹配 class 和 ID 选择器
      const selectorRegex = /([.#][\w-]+)/g;
      let match;
      while ((match = selectorRegex.exec(line)) !== null) {
        const selector = match[1];
        symbols.push({
          name: selector,
          type: 'class',
          snippet: line.trim(),
          line: index + 1,
          keywords: [selector, ...this.extractKeywords(line)],
        });
      }
    });

    return symbols;
  }

  // 提取关键词
  private extractKeywords(text: string): string[] {
    // 移除标点符号，分词
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !this.isKeyword(word));

    // 去重
    return Array.from(new Set(words));
  }

  // 判断是否是保留字
  private isKeyword(word: string): boolean {
    const keywords = new Set([
      'function', 'const', 'let', 'var', 'if', 'else', 'for', 'while',
      'return', 'class', 'new', 'this', 'true', 'false', 'null', 'undefined',
      'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'throw', 'async', 'await'
    ]);
    return keywords.has(word.toLowerCase());
  }

  // 关键词搜索匹配
  searchByKeywords(symbols: Symbol[], keywords: string[]): Symbol[] {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    
    return symbols.filter(symbol => {
      // 名称精确匹配
      if (lowerKeywords.some(k => symbol.name.toLowerCase().includes(k))) {
        return true;
      }
      
      // 关键词匹配
      return symbol.keywords.some(kw => 
        lowerKeywords.some(k => kw.includes(k))
      );
    }).sort((a, b) => {
      // 优先级排序：函数 > 类 > 变量 > 事件
      const priority = { function: 0, class: 1, variable: 2, event: 3 };
      return priority[a.type] - priority[b.type];
    });
  }
}
