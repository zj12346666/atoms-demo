/**
 * CodeExtractor - 从源代码中提取代码片段
 */

import * as ts from 'typescript';
import { LocatedNode } from './ast-node-locator';
import { ParsedAST } from './ast-parser';
import { logger } from './logger';

export interface CodeSnippet {
  code: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

export class CodeExtractor {
  /**
   * 提取代码片段（包含上下文）
   */
  extractSnippet(
    ast: ParsedAST,
    node: LocatedNode,
    contextLines: number = 5
  ): CodeSnippet {
    try {
      const { sourceCode } = ast;
      const lines = sourceCode.split('\n');

      // 获取节点所在的行号（0-based）
      const nodeStartLine = node.line - 1;
      const nodeEndLine = this.getEndLine(sourceCode, node.end);

      // 计算上下文范围
      const startLine = Math.max(0, nodeStartLine - contextLines);
      const endLine = Math.min(lines.length - 1, nodeEndLine + contextLines);

      // 提取代码片段
      const snippetLines = lines.slice(startLine, endLine + 1);
      const code = snippetLines.join('\n');

      // 获取列号信息
      const startColumn = startLine === nodeStartLine ? node.column : 1;
      const endColumn = endLine === nodeEndLine 
        ? this.getColumnFromPosition(sourceCode, node.end)
        : lines[endLine].length + 1;

      return {
        code,
        startLine: startLine + 1, // 转换为 1-based
        endLine: endLine + 1,
        startColumn,
        endColumn,
      };
    } catch (error: any) {
      logger.error('❌ 提取代码片段失败:', error);
      
      // 降级：返回节点的原始代码
      const { sourceCode } = ast;
      const lines = sourceCode.split('\n');
      const nodeStartLine = node.line - 1;
      const nodeEndLine = Math.min(lines.length - 1, nodeStartLine + 10);
      
      return {
        code: lines.slice(nodeStartLine, nodeEndLine + 1).join('\n'),
        startLine: node.line,
        endLine: nodeEndLine + 1,
        startColumn: node.column,
        endColumn: lines[nodeEndLine]?.length || 1,
      };
    }
  }

  /**
   * 根据字符位置获取行号
   */
  private getEndLine(sourceCode: string, position: number): number {
    const beforePosition = sourceCode.substring(0, position);
    return beforePosition.split('\n').length - 1;
  }

  /**
   * 根据字符位置获取列号（1-based）
   */
  private getColumnFromPosition(sourceCode: string, position: number): number {
    const beforePosition = sourceCode.substring(0, position);
    const lastNewlineIndex = beforePosition.lastIndexOf('\n');
    
    if (lastNewlineIndex === -1) {
      return position + 1; // 1-based
    }
    
    // position - lastNewlineIndex 是从换行符后的字符数（0-based），需要 +1 转换为 1-based
    return position - lastNewlineIndex;
  }

  /**
   * 提取组件代码（完整函数/组件）
   */
  extractComponent(
    ast: ParsedAST,
    functionNode: LocatedNode
  ): CodeSnippet {
    try {
      const { sourceCode } = ast;
      const lines = sourceCode.split('\n');

      // 获取函数节点的起始和结束行号
      const startLine = this.getEndLine(sourceCode, functionNode.start);
      const endLine = this.getEndLine(sourceCode, functionNode.end);

      // 提取完整的函数代码
      const componentLines = lines.slice(startLine, endLine + 1);
      const code = componentLines.join('\n');

      // 获取列号信息
      const startColumn = this.getColumnFromPosition(sourceCode, functionNode.start);
      const endColumn = this.getColumnFromPosition(sourceCode, functionNode.end);

      return {
        code,
        startLine: startLine + 1, // 转换为 1-based
        endLine: endLine + 1,
        startColumn,
        endColumn,
      };
    } catch (error: any) {
      logger.error('❌ 提取组件代码失败:', error);
      
      // 降级：返回函数节点的原始代码
      const { sourceCode } = ast;
      const lines = sourceCode.split('\n');
      const startLine = functionNode.line - 1;
      const endLine = Math.min(lines.length - 1, startLine + 50);
      
      return {
        code: lines.slice(startLine, endLine + 1).join('\n'),
        startLine: functionNode.line,
        endLine: endLine + 1,
        startColumn: functionNode.column,
        endColumn: lines[endLine]?.length || 1,
      };
    }
  }
}
