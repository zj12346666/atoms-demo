/**
 * ASTParser - 使用 TypeScript Compiler API 解析代码 AST
 */

import * as ts from 'typescript';
import { logger } from './logger';

export interface ParsedAST {
  sourceFile: ts.SourceFile;
  sourceCode: string;
  filePath: string;
}

export class ASTParser {
  /**
   * 解析源代码为 AST
   */
  parse(sourceCode: string, filePath: string): ParsedAST {
    try {
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      return {
        sourceFile,
        sourceCode,
        filePath,
      };
    } catch (error: any) {
      logger.error(`❌ AST 解析失败 (${filePath}):`, error);
      throw new Error(`AST 解析失败: ${error.message}`);
    }
  }
}
