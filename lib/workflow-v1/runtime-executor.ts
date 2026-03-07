/**
 * RuntimeExecutor - 在 WebContainer 中执行项目运行命令并收集错误
 */

import { WebContainer } from '@webcontainer/api';
import {
  IRuntimeExecutor,
  RuntimeExecutorInput,
  RuntimeExecutorOutput,
  RuntimeLog,
  RuntimeError,
} from './types';
import { logger } from '../logger';

export class RuntimeExecutor implements IRuntimeExecutor {
  private webcontainer: WebContainer | null = null;

  /**
   * 设置 WebContainer 实例
   */
  setWebContainer(webcontainer: WebContainer): void {
    this.webcontainer = webcontainer;
  }

  /**
   * 执行运行命令
   */
  async execute(input: RuntimeExecutorInput): Promise<RuntimeExecutorOutput> {
    const { projectPath, command, timeout = 30000 } = input;

    if (!this.webcontainer) {
      return {
        success: false,
        logs: [],
        errors: [{
          message: 'WebContainer 未初始化，请先调用 setWebContainer()',
          type: 'unknown',
        }],
      };
    }

    const startTime = Date.now();
    const logs: RuntimeLog[] = [];
    const errors: RuntimeError[] = [];

    try {
      // 确定要执行的命令
      const execCommand = command || await this.detectCommand(projectPath);

      logger.info(`🚀 [RuntimeExecutor] 执行命令: ${execCommand}`);

      // 执行命令
      const process = await this.webcontainer.spawn(
        'sh',
        ['-c', `cd ${projectPath || '.'} && ${execCommand}`]
      );

      // 收集输出
      const outputPromise = this.collectOutput(process, logs, errors, timeout);

      // 等待进程退出
      const exitCode = await process.exit;

      const executionTime = Date.now() - startTime;

      // 等待输出收集完成（最多再等 1 秒）
      await Promise.race([
        outputPromise,
        new Promise(resolve => setTimeout(resolve, 1000)),
      ]);

      // 分析错误
      const analyzedErrors = this.analyzeErrors(errors, logs);

      const success = exitCode === 0 && analyzedErrors.length === 0;

      logger.info(
        `✅ [RuntimeExecutor] 执行完成 (exitCode: ${exitCode}, time: ${executionTime}ms)`
      );

      return {
        success,
        logs,
        errors: analyzedErrors,
        exitCode,
        executionTime,
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      logger.error(`❌ [RuntimeExecutor] 执行失败:`, error);

      errors.push({
        message: error.message || '执行失败',
        stack: error.stack,
        type: this.classifyError(error.message || ''),
      });

      return {
        success: false,
        logs,
        errors,
        executionTime,
      };
    }
  }

  /**
   * 检测项目应该执行的命令
   */
  private async detectCommand(projectPath: string): Promise<string> {
    if (!this.webcontainer) {
      return 'npm run dev';
    }

    try {
      // 读取 package.json
      const packageJsonPath = projectPath 
        ? `${projectPath}/package.json` 
        : 'package.json';
      
      const packageJsonContent = await this.webcontainer.fs.readFile(
        packageJsonPath,
        'utf-8'
      );
      const packageJson = JSON.parse(packageJsonContent);

      // 优先使用 dev 脚本，否则使用 start，最后使用默认
      if (packageJson.scripts?.dev) {
        return 'npm run dev';
      } else if (packageJson.scripts?.start) {
        return 'npm run start';
      } else if (packageJson.scripts?.build) {
        return 'npm run build';
      }
    } catch (error) {
      logger.debug('无法读取 package.json，使用默认命令');
    }

    return 'npm run dev';
  }

  /**
   * 收集进程输出
   */
  private async collectOutput(
    process: any,
    logs: RuntimeLog[],
    errors: RuntimeError[],
    timeout: number
  ): Promise<void> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        logger.warn(`⏱️ [RuntimeExecutor] 输出收集超时 (${timeout}ms)`);
        resolve();
      }, timeout);

      let outputBuffer = '';

      // 使用 pipeTo 读取输出流
      process.output.pipeTo(
        new WritableStream({
          write: (chunk: string) => {
            outputBuffer += chunk;
            
            // 按行处理
            const lines = outputBuffer.split('\n');
            outputBuffer = lines.pop() || ''; // 保留最后不完整的行

            for (const line of lines) {
              if (!line.trim()) continue;

              const timestamp = Date.now();
              const level = this.detectLogLevel(line, false);

              logs.push({
                level,
                message: line,
                timestamp,
              });

              // 检查是否是错误
              if (level === 'error') {
                const error = this.parseError(line);
                if (error) {
                  errors.push(error);
                }
              }
            }
          },
          close: () => {
            // 处理最后一行
            if (outputBuffer.trim()) {
              const timestamp = Date.now();
              const level = this.detectLogLevel(outputBuffer, false);

              logs.push({
                level,
                message: outputBuffer.trim(),
                timestamp,
              });

              if (level === 'error') {
                const error = this.parseError(outputBuffer);
                if (error) {
                  errors.push(error);
                }
              }
            }

            clearTimeout(timeoutId);
            resolve();
          },
          abort: () => {
            clearTimeout(timeoutId);
            resolve();
          },
        })
      ).catch((error: any) => {
        logger.debug('读取输出流时出错:', error);
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  /**
   * 检测日志级别
   */
  private detectLogLevel(line: string, isError: boolean): RuntimeLog['level'] {
    if (isError) {
      return 'error';
    }

    const lowerLine = line.toLowerCase();

    if (lowerLine.includes('error') || lowerLine.includes('failed') || 
        lowerLine.includes('exception')) {
      return 'error';
    } else if (lowerLine.includes('warn') || lowerLine.includes('warning')) {
      return 'warn';
    } else if (lowerLine.includes('debug')) {
      return 'debug';
    }

    return 'info';
  }

  /**
   * 解析错误信息
   */
  private parseError(line: string): RuntimeError | null {
    // 跳过非错误行
    if (!line.includes('error') && !line.includes('Error') && 
        !line.includes('failed') && !line.includes('Failed')) {
      return null;
    }

    // 尝试提取文件路径和行号
    const fileMatch = line.match(/([^\s]+\.(ts|tsx|js|jsx)):(\d+):(\d+)/);
    
    if (fileMatch) {
      return {
        message: line,
        file: fileMatch[1],
        line: parseInt(fileMatch[3], 10),
        column: parseInt(fileMatch[4], 10),
        type: this.classifyError(line),
      };
    }

    // 尝试提取文件路径（无行号）
    const simpleFileMatch = line.match(/([^\s]+\.(ts|tsx|js|jsx))/);
    
    if (simpleFileMatch) {
      return {
        message: line,
        file: simpleFileMatch[1],
        type: this.classifyError(line),
      };
    }

    // 通用错误
    return {
      message: line,
      type: this.classifyError(line),
    };
  }

  /**
   * 分类错误类型
   */
  private classifyError(message: string): RuntimeError['type'] {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('syntax') || 
        lowerMessage.includes('unexpected token') ||
        lowerMessage.includes('parsing error') ||
        lowerMessage.includes('expected')) {
      return 'syntax';
    }

    if (lowerMessage.includes('type') || 
        lowerMessage.includes('typescript') ||
        lowerMessage.includes('ts') ||
        lowerMessage.includes('cannot find name') ||
        lowerMessage.includes('type error')) {
      return 'type';
    }

    if (lowerMessage.includes('build') || 
        lowerMessage.includes('compilation') ||
        lowerMessage.includes('webpack') ||
        lowerMessage.includes('vite')) {
      return 'build';
    }

    if (lowerMessage.includes('runtime') || 
        lowerMessage.includes('cannot read') ||
        lowerMessage.includes('undefined') ||
        lowerMessage.includes('null')) {
      return 'runtime';
    }

    return 'unknown';
  }

  /**
   * 分析并去重错误
   */
  private analyzeErrors(
    errors: RuntimeError[],
    logs: RuntimeLog[]
  ): RuntimeError[] {
    // 去重：相同文件、行号、列号的错误只保留一个
    const seen = new Set<string>();
    const uniqueErrors: RuntimeError[] = [];

    for (const error of errors) {
      const key = `${error.file || ''}:${error.line || 0}:${error.column || 0}:${error.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueErrors.push(error);
      }
    }

    // 如果错误为空，检查日志中是否有错误级别的消息
    if (uniqueErrors.length === 0) {
      const errorLogs = logs.filter(log => log.level === 'error');
      for (const log of errorLogs) {
        const error = this.parseError(log.message);
        if (error) {
          uniqueErrors.push(error);
        }
      }
    }

    return uniqueErrors;
  }
}
