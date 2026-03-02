/**
 * 终端错误捕获器 (The Healer)
 * 监听 WebContainer 的控制台输出，自动捕获运行时错误并反馈给 Agent
 */

import { WebContainer } from '@webcontainer/api';

export interface CapturedError {
  message: string;
  type: 'module_not_found' | 'syntax_error' | 'type_error' | 'runtime_error' | 'build_error' | 'unknown';
  file?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: number;
  source: 'stdout' | 'stderr' | 'console';
}

export interface ErrorPattern {
  pattern: RegExp;
  type: CapturedError['type'];
  extractFile?: (match: RegExpMatchArray) => string | undefined;
  extractLine?: (match: RegExpMatchArray) => number | undefined;
  extractColumn?: (match: RegExpMatchArray) => number | undefined;
}

export class WebContainerHealer {
  private webcontainer: WebContainer | null = null;
  private errorPatterns: ErrorPattern[] = [];
  private capturedErrors: CapturedError[] = [];
  private onErrorCallback?: (errors: CapturedError[]) => void;
  private isMonitoring = false;
  private devProcess: any = null;

  constructor() {
    this.setupErrorPatterns();
  }

  /**
   * 设置错误匹配模式
   */
  private setupErrorPatterns(): void {
    this.errorPatterns = [
      // 模块未找到错误
      {
        pattern: /Module not found: Error: Can't resolve ['"]([^'"]+)['"]/i,
        type: 'module_not_found',
        extractFile: (match) => match[1],
      },
      {
        pattern: /Cannot find module ['"]([^'"]+)['"]/i,
        type: 'module_not_found',
        extractFile: (match) => match[1],
      },
      // 语法错误
      {
        pattern: /SyntaxError:\s*(.+?)(?:\n|$)/i,
        type: 'syntax_error',
        extractFile: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? fileMatch[1] : undefined;
        },
        extractLine: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[2], 10) : undefined;
        },
        extractColumn: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[3], 10) : undefined;
        },
      },
      {
        pattern: /Unexpected token (.+?)(?:\n|$)/i,
        type: 'syntax_error',
      },
      {
        pattern: /Parsing error:\s*(.+?)(?:\n|$)/i,
        type: 'syntax_error',
      },
      // TypeScript 类型错误
      {
        pattern: /Property ['"]([^'"]+)['"] does not exist on type ['"]([^'"]+)['"]/i,
        type: 'type_error',
        extractFile: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? fileMatch[1] : undefined;
        },
        extractLine: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[2], 10) : undefined;
        },
        extractColumn: (match) => {
          const fileMatch = match[0].match(/\(([^)]+):(\d+):(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[3], 10) : undefined;
        },
      },
      {
        pattern: /Type ['"]([^'"]+)['"] is not assignable to type ['"]([^'"]+)['"]/i,
        type: 'type_error',
      },
      // 构建错误
      {
        pattern: /Failed to compile/i,
        type: 'build_error',
      },
      {
        pattern: /error TS\d+:/i,
        type: 'type_error',
        extractFile: (match) => {
          const fileMatch = match[0].match(/([^(]+)\((\d+),(\d+)\)/);
          return fileMatch ? fileMatch[1].trim() : undefined;
        },
        extractLine: (match) => {
          const fileMatch = match[0].match(/([^(]+)\((\d+),(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[2], 10) : undefined;
        },
        extractColumn: (match) => {
          const fileMatch = match[0].match(/([^(]+)\((\d+),(\d+)\)/);
          return fileMatch ? parseInt(fileMatch[3], 10) : undefined;
        },
      },
      // 运行时错误
      {
        pattern: /ReferenceError:\s*(.+?)(?:\n|$)/i,
        type: 'runtime_error',
      },
      {
        pattern: /TypeError:\s*(.+?)(?:\n|$)/i,
        type: 'runtime_error',
      },
    ];
  }

  /**
   * 开始监听 WebContainer 输出
   */
  async startMonitoring(
    webcontainer: WebContainer,
    onError: (errors: CapturedError[]) => void
  ): Promise<void> {
    if (this.isMonitoring) {
      console.warn('⚠️ [Healer] 已经在监听中，跳过重复启动');
      return;
    }

    this.webcontainer = webcontainer;
    this.onErrorCallback = onError;
    this.capturedErrors = [];
    this.isMonitoring = true;

    console.log('🔍 [Healer] 开始监听 WebContainer 输出流...');

    // 监听已存在的进程输出（如果有）
    // 注意：这里假设 dev 进程已经启动，实际使用时需要在启动 dev 后调用
  }

  /**
   * 监听开发服务器进程的输出
   */
  async monitorDevProcess(devProcess: any): Promise<void> {
    if (!this.isMonitoring || !this.webcontainer) {
      return;
    }

    this.devProcess = devProcess;
    console.log('🔍 [Healer] 开始监听 dev 进程输出...');

    // 监听 stdout
    devProcess.output.pipeTo(
      new WritableStream({
        write: (chunk: string) => {
          this.processOutput(chunk, 'stdout');
        },
      })
    );

    // 监听 stderr（如果可用）
    if (devProcess.stderr) {
      devProcess.stderr.pipeTo(
        new WritableStream({
          write: (chunk: string) => {
            this.processOutput(chunk, 'stderr');
          },
        })
      );
    }
  }

  /**
   * 处理输出流数据
   */
  private processOutput(data: string, source: 'stdout' | 'stderr'): void {
    if (!this.isMonitoring) return;

    // 检查是否包含错误
    for (const errorPattern of this.errorPatterns) {
      const match = data.match(errorPattern.pattern);
      if (match) {
        const error: CapturedError = {
          message: match[0],
          type: errorPattern.type,
          file: errorPattern.extractFile?.(match),
          line: errorPattern.extractLine?.(match),
          column: errorPattern.extractColumn?.(match),
          timestamp: Date.now(),
          source,
        };

        // 提取堆栈信息（如果存在）
        const stackMatch = data.match(/at\s+.+?\n/g);
        if (stackMatch) {
          error.stack = stackMatch.join('');
        }

        this.captureError(error);
        break; // 只捕获第一个匹配的错误
      }
    }
  }

  /**
   * 捕获错误
   */
  private captureError(error: CapturedError): void {
    // 避免重复捕获相同的错误（5秒内）
    const recentError = this.capturedErrors.find(
      (e) =>
        e.message === error.message &&
        e.type === error.type &&
        Date.now() - e.timestamp < 5000
    );

    if (recentError) {
      console.debug(`🔍 [Healer] 跳过重复错误: ${error.message.substring(0, 50)}...`);
      return;
    }

    this.capturedErrors.push(error);
    console.warn(`🚨 [Healer] 捕获到错误 [${error.type}]: ${error.message.substring(0, 100)}`);

    // 立即通知回调（静默模式：不通知用户，直接发送给 Agent）
    if (this.onErrorCallback) {
      // 只发送最近的错误（避免一次性发送太多）
      const recentErrors = this.capturedErrors.slice(-10);
      this.onErrorCallback(recentErrors);
    }
  }

  /**
   * 获取所有捕获的错误
   */
  getCapturedErrors(): CapturedError[] {
    return [...this.capturedErrors];
  }

  /**
   * 清空错误记录
   */
  clearErrors(): void {
    this.capturedErrors = [];
    console.log('🧹 [Healer] 已清空错误记录');
  }

  /**
   * 停止监听
   */
  stopMonitoring(): void {
    this.isMonitoring = false;
    this.devProcess = null;
    console.log('🛑 [Healer] 已停止监听');
  }

  /**
   * 格式化错误为 Agent 可理解的格式
   */
  formatErrorsForAgent(errors: CapturedError[]): string {
    if (errors.length === 0) return '';

    const errorGroups = errors.reduce((acc, error) => {
      if (!acc[error.type]) {
        acc[error.type] = [];
      }
      acc[error.type].push(error);
      return acc;
    }, {} as Record<string, CapturedError[]>);

    const formatted: string[] = [];

    for (const [type, typeErrors] of Object.entries(errorGroups)) {
      formatted.push(`\n## ${this.getErrorTypeLabel(type)} (${typeErrors.length} 个)`);
      
      for (const error of typeErrors.slice(0, 5)) { // 每种类型最多显示5个
        const location = error.file
          ? `在 ${error.file}${error.line ? `:${error.line}${error.column ? `:${error.column}` : ''}` : ''}`
          : '';
        formatted.push(`- ${error.message} ${location}`);
      }
    }

    return formatted.join('\n');
  }

  /**
   * 获取错误类型标签
   */
  private getErrorTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      module_not_found: '模块未找到',
      syntax_error: '语法错误',
      type_error: '类型错误',
      runtime_error: '运行时错误',
      build_error: '构建错误',
      unknown: '未知错误',
    };
    return labels[type] || type;
  }
}

// 导出单例
export const webContainerHealer = new WebContainerHealer();
