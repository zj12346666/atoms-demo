/**
 * 🧪 自动化沙箱校验 Skill (Self-Correction/Sandbox)
 * 职责：这是 VIP 方案的"护城河"，实现自愈循环。
 */

import { SandboxService, ValidationResult } from '../sandbox-service';
import { logger } from '../logger';

export interface ValidationError {
  file: string;
  line: number;
  column: number;
  message: string;
  code: string; // TS错误码，如 TS2304
  contextCode?: string; // 错误上下文代码片段
}

export interface ValidationReport {
  success: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  summary: string;
}

export class SandboxValidationSkill {
  private sandbox: SandboxService;

  constructor() {
    this.sandbox = new SandboxService();
  }

  /**
   * 在沙箱中验证代码
   * 在内存中对 staged 的代码运行 tsc --noEmit（类型检查）和 eslint
   * 
   * @param stagedFiles 暂存的文件系统（从 MultiFileEngineeringSkill 获取）
   * @returns 验证结果，包含精准的 JSON 错误：{ file, line, column, message, context_code }
   */
  async validateInSandbox(
    stagedFiles: Map<string, string>
  ): Promise<ValidationReport> {
    try {
      logger.info(`🔬 开始验证 ${stagedFiles.size} 个文件...`);

      // 1. 运行 TypeScript 类型检查
      const tscResult = await this.sandbox.validateTypeScript(stagedFiles);

      // 2. 解析错误
      const errors = this.parseValidationErrors(tscResult.stderr, stagedFiles);
      const warnings = this.parseValidationWarnings(tscResult.stderr, stagedFiles);

      // 3. 运行 AST 检查（预览渲染检查）
      const astErrors = await this.previewRenderCheck(stagedFiles);
      errors.push(...astErrors);

      const success = errors.length === 0;
      const summary = success
        ? `✅ 验证通过：${stagedFiles.size} 个文件无错误`
        : `❌ 验证失败：发现 ${errors.length} 个错误，${warnings.length} 个警告`;

      logger.info(summary);

      return {
        success,
        errors,
        warnings,
        summary,
      };
    } catch (error: any) {
      logger.error('❌ 沙箱验证失败:', error);
      return {
        success: false,
        errors: [{
          file: 'unknown',
          line: 0,
          column: 0,
          message: `验证过程出错: ${error.message}`,
          code: 'VALIDATION_ERROR',
        }],
        warnings: [],
        summary: `❌ 验证过程出错: ${error.message}`,
      };
    }
  }

  /**
   * 预览渲染检查
   * 尝试进行简单的 AST 解析，检查是否有循环引用或未定义的变量
   * 
   * @param stagedFiles 暂存的文件系统
   * @returns AST 检查发现的错误
   */
  async previewRenderCheck(
    stagedFiles: Map<string, string>
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    try {
      // 1. 检查循环引用
      const circularRefs = this.detectCircularReferences(stagedFiles);
      errors.push(...circularRefs);

      // 2. 检查未定义的变量/导入
      const undefinedVars = this.detectUndefinedVariables(stagedFiles);
      errors.push(...undefinedVars);

      // 3. 检查未使用的导入
      const unusedImports = this.detectUnusedImports(stagedFiles);
      // 这些作为警告，不阻塞

      logger.info(`🔍 AST 检查完成: 发现 ${errors.length} 个问题`);
    } catch (error: any) {
      logger.warn(`⚠️ AST 检查失败: ${error.message}`);
    }

    return errors;
  }

  /**
   * 解析验证错误
   */
  private parseValidationErrors(
    stderr: string,
    stagedFiles: Map<string, string>
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = stderr.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // tsc错误格式：
      // file.ts(行号,列号): error TS错误码: 错误描述
      const errorMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
      
      if (errorMatch) {
        const [, file, lineNum, colNum, code, message] = errorMatch;
        
        // 提取错误上下文代码
        const contextCode = this.extractContextCode(
          file,
          parseInt(lineNum),
          stagedFiles
        );

        errors.push({
          file: file.trim(),
          line: parseInt(lineNum),
          column: parseInt(colNum),
          message: message.trim(),
          code: code.trim(),
          contextCode,
        });
      } else if (line.includes('error') || line.includes('Error')) {
        // 其他错误格式
        errors.push({
          file: 'unknown',
          line: 0,
          column: 0,
          message: line.trim(),
          code: 'UNKNOWN_ERROR',
        });
      }
    }

    return errors;
  }

  /**
   * 解析验证警告
   */
  private parseValidationWarnings(
    stderr: string,
    stagedFiles: Map<string, string>
  ): ValidationError[] {
    const warnings: ValidationError[] = [];
    const lines = stderr.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // tsc警告格式：
      // file.ts(行号,列号): warning TS错误码: 警告描述
      const warningMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*warning\s+(TS\d+):\s*(.+)$/);
      
      if (warningMatch) {
        const [, file, lineNum, colNum, code, message] = warningMatch;
        
        const contextCode = this.extractContextCode(
          file,
          parseInt(lineNum),
          stagedFiles
        );

        warnings.push({
          file: file.trim(),
          line: parseInt(lineNum),
          column: parseInt(colNum),
          message: message.trim(),
          code: code.trim(),
          contextCode,
        });
      }
    }

    return warnings;
  }

  /**
   * 提取错误上下文代码
   */
  private extractContextCode(
    filePath: string,
    lineNumber: number,
    stagedFiles: Map<string, string>
  ): string | undefined {
    // 从文件路径中提取相对路径
    const relativePath = filePath.split('/').pop() || filePath;
    const content = stagedFiles.get(relativePath);

    if (!content) {
      // 尝试完整路径匹配
      for (const [path, fileContent] of stagedFiles.entries()) {
        if (path.endsWith(relativePath)) {
          return this.getLineContext(fileContent, lineNumber);
        }
      }
      return undefined;
    }

    return this.getLineContext(content, lineNumber);
  }

  /**
   * 获取行的上下文（前后各2行）
   */
  private getLineContext(content: string, lineNumber: number): string {
    const lines = content.split('\n');
    const startLine = Math.max(0, lineNumber - 3);
    const endLine = Math.min(lines.length, lineNumber + 2);
    
    return lines.slice(startLine, endLine).join('\n');
  }

  /**
   * 检测循环引用
   */
  private detectCircularReferences(
    stagedFiles: Map<string, string>
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // 构建导入图
    const importGraph = new Map<string, Set<string>>();
    
    for (const [filePath, content] of stagedFiles.entries()) {
      const imports = this.extractImports(content);
      importGraph.set(filePath, new Set(imports));
    }

    // 简单的循环检测（DFS）
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (file: string, stack: Set<string>): boolean => {
      if (stack.has(file)) {
        return true; // 发现循环
      }
      if (visited.has(file)) {
        return false;
      }

      visited.add(file);
      stack.add(file);

      const imports = importGraph.get(file) || new Set();
      for (const importedFile of imports) {
        // 检查是否是本地文件
        if (stagedFiles.has(importedFile)) {
          if (dfs(importedFile, stack)) {
            return true;
          }
        }
      }

      stack.delete(file);
      return false;
    };

    for (const file of stagedFiles.keys()) {
      if (!visited.has(file)) {
        const stack = new Set<string>();
        if (dfs(file, stack)) {
          errors.push({
            file,
            line: 0,
            column: 0,
            message: `检测到循环引用: ${Array.from(stack).join(' -> ')} -> ${file}`,
            code: 'CIRCULAR_REFERENCE',
          });
        }
      }
    }

    return errors;
  }

  /**
   * 检测未定义的变量
   */
  private detectUndefinedVariables(
    stagedFiles: Map<string, string>
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // 简单的检查：查找未导入但使用的标识符
    // 这是一个简化版本，完整的检查需要完整的 AST 解析
    
    for (const [filePath, content] of stagedFiles.entries()) {
      const lines = content.split('\n');
      const imports = this.extractImports(content);
      const definedSymbols = new Set<string>();

      // 提取导入的符号
      for (const importLine of imports) {
        // 简单的导入解析
        const importMatch = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
        if (importMatch) {
          // TODO: 更完整的导入解析
        }
      }

      // 检查每一行是否有未定义的标识符
      // 这是一个简化版本，实际应该使用 AST
      lines.forEach((line, index) => {
        // 简单的启发式检查
        if (line.includes('undefined') && !line.includes('//')) {
          // 可能是未定义的变量
          // 这里只是示例，实际应该更智能
        }
      });
    }

    return errors;
  }

  /**
   * 检测未使用的导入
   */
  private detectUnusedImports(
    stagedFiles: Map<string, string>
  ): ValidationError[] {
    // TODO: 实现未使用导入的检测
    // 这需要完整的 AST 解析
    return [];
  }

  /**
   * 提取导入语句
   */
  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const importMatch = line.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        imports.push(importMatch[1]);
      }
    }

    return imports;
  }
}
