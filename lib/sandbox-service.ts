/**
 * SandboxService - 内存虚拟文件系统中的TypeScript验证
 * 运行 tsc --noEmit 并捕获错误
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  stderr: string;
  stdout: string;
}

export class SandboxService {
  private tempDir: string;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.cwd(), '.temp-sandbox');
  }

  /**
   * 验证TypeScript代码
   * @param virtualFs 虚拟文件系统 Map<path, content>
   */
  async validateTypeScript(
    virtualFs: Map<string, string>
  ): Promise<ValidationResult> {
    const projectDir = path.join(this.tempDir, `validate-${Date.now()}`);
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. 创建临时目录
      await fs.mkdir(projectDir, { recursive: true });
      
      // 2. 写入文件到临时目录
      for (const [filePath, content] of virtualFs.entries()) {
        const fullPath = path.join(projectDir, filePath);
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
      }

      // 3. 创建tsconfig.json（如果不存在）
      const tsconfigPath = path.join(projectDir, 'tsconfig.json');
      try {
        await fs.access(tsconfigPath);
      } catch {
        await this.createDefaultTsConfig(tsconfigPath);
      }

      // 4. 运行 tsc --noEmit
      const { stdout, stderr } = await execAsync('npx tsc --noEmit', {
        cwd: projectDir,
        timeout: 30000, // 30秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      // 5. 解析错误
      this.parseTscErrors(stderr, errors, warnings);

      // 清理临时目录
      await this.cleanup(projectDir);

      return {
        success: errors.length === 0,
        errors,
        warnings,
        stderr,
        stdout,
      };

    } catch (error: any) {
      // 清理临时目录
      await this.cleanup(projectDir).catch(() => {});

      // 解析错误输出
      if (error.stderr) {
        this.parseTscErrors(error.stderr, errors, warnings);
      } else {
        errors.push(`验证过程出错: ${error.message}`);
      }

      return {
        success: false,
        errors,
        warnings,
        stderr: error.stderr || '',
        stdout: error.stdout || '',
      };
    }
  }

  /**
   * 解析tsc错误输出
   * 提取行号和错误描述
   */
  private parseTscErrors(
    stderr: string,
    errors: string[],
    warnings: string[]
  ): void {
    // tsc错误格式：
    // file.ts(行号,列号): error TS错误码: 错误描述
    // file.ts(行号,列号): warning TS错误码: 警告描述

    const lines = stderr.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;

      // 匹配错误格式
      const errorMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/);
      
      if (errorMatch) {
        const [, file, lineNum, colNum, level, code, message] = errorMatch;
        const errorMsg = `${file}:${lineNum}:${colNum} - ${code}: ${message}`;
        
        if (level === 'error') {
          errors.push(errorMsg);
        } else {
          warnings.push(errorMsg);
        }
      } else if (line.includes('error') || line.includes('Error')) {
        // 其他错误格式
        errors.push(line.trim());
      } else if (line.includes('warning') || line.includes('Warning')) {
        warnings.push(line.trim());
      }
    }
  }

  /**
   * 创建默认tsconfig.json
   */
  private async createDefaultTsConfig(tsconfigPath: string): Promise<void> {
    const tsconfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        jsx: 'react',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        moduleResolution: 'node',
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
      },
      include: ['**/*'],
      exclude: ['node_modules'],
    };

    await fs.writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf-8');
  }

  /**
   * 清理临时目录
   */
  private async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`⚠️ 清理临时目录失败: ${dir}`, error);
    }
  }
}
