/**
 * ASTValidator - 使用 TypeScript Compiler API 验证代码语法
 */

import * as ts from 'typescript';
import {
  IASTValidator,
  ASTValidatorInput,
  ASTValidatorOutput,
  SyntaxError,
} from './types';
import { logger } from '../logger';

export class ASTValidator implements IASTValidator {
  /**
   * 验证代码语法
   */
  async validate(input: ASTValidatorInput): Promise<ASTValidatorOutput> {
    const { code, filePath, language = 'typescript' } = input;

    try {
      // 创建 SourceFile（这会自动检测语法错误）
      const sourceFile = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.Latest,
        true
      );

      // 收集诊断信息
      const diagnostics: ts.Diagnostic[] = [];
      
      // 使用 TypeScript 编译器 API 检查语法
      // 创建一个简单的编译器主机来检查语法
      const compilerHost: ts.CompilerHost = {
        getSourceFile: (fileName) => {
          if (fileName === filePath || fileName === filePath.replace(/\\/g, '/')) {
            return sourceFile;
          }
          return undefined;
        },
        writeFile: () => {},
        getCurrentDirectory: () => '/',
        getDirectories: () => [],
        fileExists: (fileName) => {
          const normalized = fileName.replace(/\\/g, '/');
          return normalized === filePath || normalized === filePath.replace(/\\/g, '/');
        },
        readFile: (fileName) => {
          const normalized = fileName.replace(/\\/g, '/');
          if (normalized === filePath || normalized === filePath.replace(/\\/g, '/')) {
            return code;
          }
          return undefined;
        },
        getCanonicalFileName: (fileName) => fileName.replace(/\\/g, '/'),
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        getDefaultLibFileName: () => 'lib.d.ts',
      };

      const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        jsx: code.includes('<') && (code.includes('jsx') || code.includes('JSX') || code.includes('React'))
          ? ts.JsxEmit.React 
          : ts.JsxEmit.None,
        allowJs: true,
        checkJs: false, // 只检查语法，不检查类型
        noEmit: true,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
      };

      const program = ts.createProgram([filePath], compilerOptions, compilerHost);

      // 获取语法诊断（只包括语法错误，不包括类型检查）
      const allDiagnostics = ts.getPreEmitDiagnostics(program);
      
      // 过滤出语法相关的错误（错误代码 1000-1999）
      const syntaxDiagnostics = allDiagnostics.filter(diagnostic => {
        const errorCode = diagnostic.code;
        // 语法错误代码范围：1000-1999
        // 常见语法错误：
        // - 1005: ';' expected
        // - 1006: ')' expected
        // - 1009: Trailing comma not allowed
        // - 1010: Unexpected token
        // - 1128: Declaration or statement expected
        return diagnostic.category === ts.DiagnosticCategory.Error && 
               errorCode >= 1000 && errorCode < 2000;
      });

      diagnostics.push(...syntaxDiagnostics);

      // 转换诊断信息为 SyntaxError
      const errors: SyntaxError[] = [];
      const warnings: SyntaxError[] = [];

      for (const diagnostic of diagnostics) {
        const error = this.diagnosticToSyntaxError(diagnostic, code, filePath);
        
        if (diagnostic.category === ts.DiagnosticCategory.Error) {
          errors.push(error);
        } else if (diagnostic.category === ts.DiagnosticCategory.Warning) {
          warnings.push(error);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error: any) {
      logger.error(`❌ AST 验证失败 (${filePath}):`, error);
      
      // 如果解析失败，返回解析错误
      return {
        isValid: false,
        errors: [{
          message: `解析失败: ${error.message}`,
          line: 1,
          column: 1,
          code: 'PARSE_ERROR',
          severity: 'error',
        }],
      };
    }
  }


  /**
   * 将 TypeScript Diagnostic 转换为 SyntaxError
   */
  private diagnosticToSyntaxError(
    diagnostic: ts.Diagnostic,
    code: string,
    filePath: string
  ): SyntaxError {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n'
    );

    let line = 1;
    let column = 1;

    if (diagnostic.file && diagnostic.start !== undefined) {
      const position = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start
      );
      line = position.line + 1; // 转换为 1-based
      column = position.character + 1; // 转换为 1-based
    }

    // 提取错误代码
    const errorCode = `TS${diagnostic.code}`;

    return {
      message,
      line,
      column,
      code: errorCode,
      severity: diagnostic.category === ts.DiagnosticCategory.Error 
        ? 'error' 
        : 'warning',
    };
  }
}
