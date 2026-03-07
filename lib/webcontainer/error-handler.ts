/**
 * ErrorHandler - WebContainer 错误处理和自动恢复
 * 
 * 功能：
 * 1. 错误分类和诊断
 * 2. 自动恢复机制
 * 3. 错误报告和建议
 */

import { logger } from '../logger';
import type { WebContainerFileTree } from './file-tree-builder';
import { fileTreeBuilder } from './file-tree-builder';

/**
 * 错误类型
 */
export enum ErrorType {
  MOUNT_ERROR = 'mount_error',
  INSTALL_ERROR = 'install_error',
  RUNTIME_ERROR = 'runtime_error',
  TIMEOUT_ERROR = 'timeout_error',
  VALIDATION_ERROR = 'validation_error',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * 错误信息
 */
export interface ErrorInfo {
  type: ErrorType;
  message: string;
  originalError?: Error;
  context?: Record<string, any>;
  suggestions?: string[];
}

/**
 * 错误处理器
 */
export class WebContainerErrorHandler {
  /**
   * 处理挂载错误
   */
  async handleMountError(
    error: Error,
    fileTree: WebContainerFileTree
  ): Promise<{
    fixed: boolean;
    fixedTree?: WebContainerFileTree;
    errorInfo: ErrorInfo;
  }> {
    const errorInfo: ErrorInfo = {
      type: ErrorType.MOUNT_ERROR,
      message: error.message,
      originalError: error,
      context: {
        fileCount: fileTreeBuilder.getStats(fileTree).fileCount,
      },
      suggestions: [],
    };

    // 分析错误类型
    if (error.message?.includes('invalid file name')) {
      errorInfo.suggestions?.push(
        '检查文件路径是否包含特殊字符或无效字符'
      );
      errorInfo.suggestions?.push('确保文件名不包含控制字符（\\0, \\r, \\n）');
    } else if (error.message?.includes('EIO')) {
      errorInfo.suggestions?.push('文件系统 I/O 错误，可能是文件内容损坏');
      errorInfo.suggestions?.push('尝试重新生成文件');
    } else if (error.message?.includes('path')) {
      errorInfo.suggestions?.push('检查文件路径是否包含 .. 或其他非法路径');
      errorInfo.suggestions?.push('确保所有路径都是相对路径且已规范化');
    }

    // 尝试修复：验证文件树
    const validation = fileTreeBuilder.validate(fileTree);
    if (!validation.valid) {
      logger.warn('⚠️ [ErrorHandler] 文件树验证失败:', validation.errors);
      errorInfo.suggestions?.push(
        `发现 ${validation.errors.length} 个文件树问题，请检查：${validation.errors.slice(0, 3).join('; ')}`
      );
    }

    return {
      fixed: false, // 挂载错误通常需要手动修复
      errorInfo,
    };
  }

  /**
   * 处理依赖安装错误
   */
  async handleInstallError(error: Error): Promise<{
    fixed: boolean;
    errorInfo: ErrorInfo;
  }> {
    const errorInfo: ErrorInfo = {
      type: ErrorType.INSTALL_ERROR,
      message: error.message,
      originalError: error,
      suggestions: [],
    };

    // 分析错误类型
    if (error.message?.includes('network') || error.message?.includes('fetch')) {
      errorInfo.suggestions?.push('网络连接问题，请检查网络连接');
      errorInfo.suggestions?.push('尝试清除缓存后重试');
    } else if (
      error.message?.includes('version') ||
      error.message?.includes('conflict')
    ) {
      errorInfo.suggestions?.push('依赖版本冲突，检查 package.json 中的版本要求');
      errorInfo.suggestions?.push('尝试更新或降级冲突的依赖版本');
    } else if (error.message?.includes('permission')) {
      errorInfo.suggestions?.push('权限问题，检查文件系统权限');
    } else if (error.message?.includes('ENOENT')) {
      errorInfo.suggestions?.push('文件或目录不存在，检查 package.json 格式');
    }

    return {
      fixed: false, // 安装错误通常需要手动修复
      errorInfo,
    };
  }

  /**
   * 处理运行时错误
   */
  async handleRuntimeError(error: Error): Promise<{
    fixed: boolean;
    errorInfo: ErrorInfo;
  }> {
    const errorInfo: ErrorInfo = {
      type: ErrorType.RUNTIME_ERROR,
      message: error.message,
      originalError: error,
      suggestions: [],
    };

    // 分析错误类型
    if (error.message?.includes('syntax')) {
      errorInfo.suggestions?.push('语法错误，检查代码语法');
      errorInfo.suggestions?.push('使用代码编辑器检查语法高亮');
    } else if (error.message?.includes('import') || error.message?.includes('require')) {
      errorInfo.suggestions?.push('导入错误，检查导入路径是否正确');
      errorInfo.suggestions?.push('确保所有导入的文件都存在');
    } else if (error.message?.includes('undefined')) {
      errorInfo.suggestions?.push('未定义变量，检查变量声明和使用');
    } else if (error.message?.includes('TypeError')) {
      errorInfo.suggestions?.push('类型错误，检查变量类型和函数调用');
    }

    return {
      fixed: false, // 运行时错误需要代码修复
      errorInfo,
    };
  }

  /**
   * 处理超时错误
   */
  async handleTimeoutError(
    error: Error,
    timeout: number
  ): Promise<{
    fixed: boolean;
    errorInfo: ErrorInfo;
  }> {
    const errorInfo: ErrorInfo = {
      type: ErrorType.TIMEOUT_ERROR,
      message: error.message,
      originalError: error,
      context: {
        timeout,
      },
      suggestions: [
        `操作超时（${timeout}ms），可能是：`,
        '1. 网络连接较慢',
        '2. 依赖安装时间过长',
        '3. 开发服务器启动时间过长',
        '建议：增加超时时间或检查网络连接',
      ],
    };

    return {
      fixed: false,
      errorInfo,
    };
  }

  /**
   * 处理验证错误
   */
  async handleValidationError(
    errors: string[]
  ): Promise<{
    fixed: boolean;
    errorInfo: ErrorInfo;
  }> {
    const errorInfo: ErrorInfo = {
      type: ErrorType.VALIDATION_ERROR,
      message: `发现 ${errors.length} 个验证错误`,
      context: {
        errors,
      },
      suggestions: [
        '文件树验证失败，请检查：',
        ...errors.slice(0, 5).map((e, i) => `${i + 1}. ${e}`),
      ],
    };

    return {
      fixed: false,
      errorInfo,
    };
  }

  /**
   * 通用错误处理
   */
  async handleError(error: Error, context?: Record<string, any>): Promise<ErrorInfo> {
    // 尝试分类错误
    if (error.message?.includes('mount')) {
      return (await this.handleMountError(error, context?.fileTree || {})).errorInfo;
    } else if (error.message?.includes('install') || error.message?.includes('npm')) {
      return (await this.handleInstallError(error)).errorInfo;
    } else if (error.message?.includes('timeout')) {
      return (await this.handleTimeoutError(error, context?.timeout || 60000)).errorInfo;
    } else if (error.message?.includes('syntax') || error.message?.includes('runtime')) {
      return (await this.handleRuntimeError(error)).errorInfo;
    }

    // 未知错误
    return {
      type: ErrorType.UNKNOWN_ERROR,
      message: error.message,
      originalError: error,
      context,
      suggestions: [
        '未知错误，请检查：',
        '1. 浏览器控制台的详细错误信息',
        '2. 网络连接是否正常',
        '3. WebContainer 是否支持当前浏览器',
      ],
    };
  }

  /**
   * 格式化错误信息用于显示
   */
  formatErrorForDisplay(errorInfo: ErrorInfo): {
    title: string;
    message: string;
    suggestions: string[];
  } {
    const typeLabels: Record<ErrorType, string> = {
      [ErrorType.MOUNT_ERROR]: '文件系统挂载错误',
      [ErrorType.INSTALL_ERROR]: '依赖安装错误',
      [ErrorType.RUNTIME_ERROR]: '运行时错误',
      [ErrorType.TIMEOUT_ERROR]: '操作超时',
      [ErrorType.VALIDATION_ERROR]: '验证错误',
      [ErrorType.UNKNOWN_ERROR]: '未知错误',
    };

    return {
      title: typeLabels[errorInfo.type] || '错误',
      message: errorInfo.message,
      suggestions: errorInfo.suggestions || [],
    };
  }

  /**
   * 检查错误是否可恢复
   */
  isRecoverable(errorInfo: ErrorInfo): boolean {
    // 某些错误类型可以自动恢复
    const recoverableTypes = [
      ErrorType.TIMEOUT_ERROR, // 可以重试
      ErrorType.INSTALL_ERROR, // 可以重试安装
    ];

    return recoverableTypes.includes(errorInfo.type);
  }

  /**
   * 获取恢复建议
   */
  getRecoverySuggestions(errorInfo: ErrorInfo): string[] {
    if (!this.isRecoverable(errorInfo)) {
      return ['此错误无法自动恢复，需要手动修复'];
    }

    const suggestions: string[] = [];

    switch (errorInfo.type) {
      case ErrorType.TIMEOUT_ERROR:
        suggestions.push('增加超时时间后重试');
        suggestions.push('检查网络连接');
        break;
      case ErrorType.INSTALL_ERROR:
        suggestions.push('清除缓存后重试安装');
        suggestions.push('检查 package.json 格式');
        break;
    }

    return suggestions;
  }
}

/**
 * 单例导出
 */
export const webContainerErrorHandler = new WebContainerErrorHandler();
