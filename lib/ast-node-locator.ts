/**
 * ASTNodeLocator - 定位错误节点在 AST 中的位置
 */

import * as ts from 'typescript';
import { ParsedAST } from './ast-parser';
import { logger } from './logger';

export interface ErrorLocation {
  file: string;
  line?: number;
  column?: number;
}

export interface LocatedNode {
  node: ts.Node;
  start: number;
  end: number;
  line: number;
  column: number;
}

export class ASTNodeLocator {
  /**
   * 定位错误节点
   */
  locateErrorNode(ast: ParsedAST, error: ErrorLocation): LocatedNode | null {
    try {
      const { sourceFile, sourceCode } = ast;
      
      // 如果没有行号信息，返回 null
      if (!error.line) {
        logger.warn('⚠️ 错误信息缺少行号，无法定位节点');
        return null;
      }

      // 将行号转换为字符位置
      const position = this.getPositionFromLine(sourceCode, error.line, error.column || 1);
      
      if (position === -1) {
        logger.warn(`⚠️ 无法将行号 ${error.line} 转换为字符位置`);
        return null;
      }

      // 查找包含该位置的节点
      const node = this.findNodeAtPosition(sourceFile, position);
      
      if (!node) {
        logger.warn(`⚠️ 在位置 ${position} 未找到节点`);
        return null;
      }

      // 获取节点的行号和列号
      const { line: nodeLine, character: nodeColumn } = sourceFile.getLineAndCharacterOfPosition(node.getStart());

      return {
        node,
        start: node.getStart(),
        end: node.getEnd(),
        line: nodeLine + 1, // TypeScript 使用 0-based，转换为 1-based
        column: nodeColumn + 1,
      };
    } catch (error: any) {
      logger.error('❌ 定位错误节点失败:', error);
      return null;
    }
  }

  /**
   * 将行号和列号转换为字符位置
   */
  private getPositionFromLine(sourceCode: string, line: number, column: number): number {
    const lines = sourceCode.split('\n');
    
    if (line < 1 || line > lines.length) {
      return -1;
    }

    let position = 0;
    for (let i = 0; i < line - 1; i++) {
      position += lines[i].length + 1; // +1 for newline
    }
    
    position += column - 1;
    
    return position;
  }

  /**
   * 在 AST 中查找指定位置的节点
   */
  private findNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | null {
    let result: ts.Node | null = null;

    const visit = (node: ts.Node) => {
      const start = node.getStart();
      const end = node.getEnd();

      // 如果位置在节点范围内
      if (position >= start && position <= end) {
        // 优先选择更小的节点（更精确）
        if (!result || (end - start) < (result.getEnd() - result.getStart())) {
          result = node;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return result;
  }

  /**
   * 查找包含给定节点的函数
   */
  findEnclosingFunction(ast: ParsedAST, node: LocatedNode): LocatedNode | null {
    try {
      const { sourceFile } = ast;

      // 向上遍历查找包含该节点的函数
      let current: ts.Node | null = node.node;

      // 从当前节点开始向上查找
      while (current && current !== sourceFile) {
        // 检查是否是函数节点
        if (
          ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current) ||
          ts.isGetAccessorDeclaration(current) ||
          ts.isSetAccessorDeclaration(current)
        ) {
          // 找到函数节点，返回其位置信息
          const { line: funcLine, character: funcColumn } = sourceFile.getLineAndCharacterOfPosition(
            current.getStart()
          );

          return {
            node: current,
            start: current.getStart(),
            end: current.getEnd(),
            line: funcLine + 1, // 转换为 1-based
            column: funcColumn + 1,
          };
        }

        // 继续向上查找父节点
        current = current.parent;
      }

      // 未找到函数节点
      return null;
    } catch (error: any) {
      logger.error('❌ 查找包含函数失败:', error);
      return null;
    }
  }
}
