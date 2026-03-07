/**
 * WebContainerRuntime - WebContainer 运行时核心
 * 
 * 负责完整的生命周期管理：
 * 1. 启动 WebContainer
 * 2. 构建文件树
 * 3. 补全模板
 * 4. 挂载文件系统
 * 5. 安装依赖
 * 6. 启动开发服务器
 */

import { WebContainer } from '@webcontainer/api';
import { webContainerManager } from '../webcontainer-manager';
import { fileTreeBuilder, type FlatFileStructure, type WebContainerFileTree } from './file-tree-builder';
import { templateCompleter } from './template-completer';
import { performanceOptimizer } from './performance-optimizer';
import { logger } from '../logger';

/**
 * 运行时结果
 */
export interface RuntimeResult {
  url: string;
  webcontainer: WebContainer;
  cleanup: () => Promise<void>;
}

/**
 * 运行时选项
 */
export interface RuntimeOptions {
  sessionId?: string;
  skipInstall?: boolean;
  cacheEnabled?: boolean;
  timeout?: number; // 超时时间（毫秒）
  /** 跳过内部的模板补全（调用方已完成预处理时使用） */
  skipTemplateCompletion?: boolean;
}

/**
 * WebContainer 运行时
 */
export class WebContainerRuntime {
  private webcontainer: WebContainer | null = null;
  private devProcess: any = null;
  private isInitialized = false;

  // ── 错误缓冲区 ────────────────────────────────────────────
  /** 运行时错误缓冲区（由 dev server 输出流填充） */
  private runtimeErrors: string[] = [];
  /** 预览 URL 缓存 */
  private previewUrl: string | null = null;

  /**
   * 初始化并运行项目
   */
  async initialize(
    flatFiles: FlatFileStructure,
    options: RuntimeOptions = {}
  ): Promise<RuntimeResult> {
    const {
      sessionId,
      skipInstall = false,
      cacheEnabled = true,
      timeout = 60000, // 默认 60 秒超时
      skipTemplateCompletion = false,
    } = options;

    try {
      logger.info('🚀 [WebContainerRuntime] 开始初始化...');

      // 1. 补全模板（如果调用方未完成预处理）
      let completedFiles = flatFiles;
      if (!skipTemplateCompletion) {
        logger.info('📦 [WebContainerRuntime] 补全模板文件...');
        completedFiles = templateCompleter.complete(flatFiles);
        logger.info(
          `✅ [WebContainerRuntime] 模板补全完成，共 ${Object.keys(completedFiles).length} 个文件`
        );
      } else {
        logger.info(
          `⏭️ [WebContainerRuntime] 跳过模板补全（调用方已预处理），共 ${Object.keys(completedFiles).length} 个文件`
        );
      }

      // 2. 构建文件树
      logger.info('🌳 [WebContainerRuntime] 构建文件树...');
      const fileTree = fileTreeBuilder.build(completedFiles);

      // 验证文件树
      const validation = fileTreeBuilder.validate(fileTree);
      if (!validation.valid) {
        logger.error('❌ [WebContainerRuntime] 文件树验证失败:', validation.errors);
        throw new Error(`文件树验证失败: ${validation.errors.join('; ')}`);
      }

      const stats = fileTreeBuilder.getStats(fileTree);
      logger.info(
        `✅ [WebContainerRuntime] 文件树构建完成: ${stats.fileCount} 个文件, ${stats.directoryCount} 个目录, ${stats.totalSize} 字节`
      );

      // 3. 启动 WebContainer
      logger.info('🔧 [WebContainerRuntime] 启动 WebContainer...');
      this.webcontainer = await webContainerManager.boot();
      logger.info('✅ [WebContainerRuntime] WebContainer 启动成功');

      // 4. 挂载文件系统
      logger.info('💾 [WebContainerRuntime] 挂载文件系统...');
      await this.mount(fileTree);
      logger.info('✅ [WebContainerRuntime] 文件系统挂载成功');

      // 5. 安装依赖（如果未跳过）
      if (!skipInstall) {
        // 检查缓存，决定是否跳过安装
        const shouldSkip = cacheEnabled
          ? await performanceOptimizer.shouldSkipInstall(completedFiles, sessionId)
          : false;

        if (shouldSkip) {
          logger.info('⏭️ [WebContainerRuntime] 跳过依赖安装（使用缓存）');
        } else {
          logger.info('📦 [WebContainerRuntime] 安装依赖...');
          await this.installDependencies();
          logger.info('✅ [WebContainerRuntime] 依赖安装完成');

          // 标记已安装（用于缓存）
          if (cacheEnabled) {
            await performanceOptimizer.markInstalled(completedFiles, sessionId);
          }
        }
      } else {
        logger.info('⏭️ [WebContainerRuntime] 跳过依赖安装');
      }

      // 6. 启动开发服务器
      logger.info('🚀 [WebContainerRuntime] 启动开发服务器...');
      const url = await this.startDevServer(timeout);
      logger.info(`✅ [WebContainerRuntime] 开发服务器启动成功: ${url}`);

      this.isInitialized = true;

      return {
        url,
        webcontainer: this.webcontainer,
        cleanup: () => this.cleanup(),
      };
    } catch (error: any) {
      logger.error('❌ [WebContainerRuntime] 初始化失败:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 挂载文件系统
   */
  private async mount(fileTree: WebContainerFileTree): Promise<void> {
    if (!this.webcontainer) {
      throw new Error('WebContainer 未初始化');
    }

    try {
      await this.webcontainer.mount(fileTree);
    } catch (error: any) {
      logger.error('❌ [WebContainerRuntime] 文件系统挂载失败:', error);
      logger.error('📋 [WebContainerRuntime] 文件树结构:', {
        keys: Object.keys(fileTree),
        stats: fileTreeBuilder.getStats(fileTree),
      });

      // 检查常见错误
      if (error.message?.includes('invalid file name')) {
        throw new Error(
          `文件系统挂载失败: 无效的文件名。请检查文件路径是否包含特殊字符。原始错误: ${error.message}`
        );
      }

      throw error;
    }
  }

  /**
   * 安装依赖
   */
  private async installDependencies(): Promise<void> {
    if (!this.webcontainer) {
      throw new Error('WebContainer 未初始化');
    }

    try {
      const installProcess = await this.webcontainer.spawn('npm', ['install']);

      // 监听安装输出
      const installOutput: string[] = [];
      installProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            installOutput.push(data);
            logger.debug(`📦 [npm install] ${data}`);
          },
        })
      );

      const exitCode = await installProcess.exit;

      if (exitCode !== 0) {
        const errorOutput = installOutput.join('\n');
        logger.error('❌ [WebContainerRuntime] 依赖安装失败:', {
          exitCode,
          output: errorOutput,
        });
        throw new Error(
          `依赖安装失败，退出码: ${exitCode}\n输出: ${errorOutput.slice(-500)}`
        );
      }
    } catch (error: any) {
      // 如果是 spawn 错误，可能是命令不存在
      if (error.message?.includes('spawn')) {
        throw new Error(
          `无法执行 npm install: ${error.message}。请确保 WebContainer 已正确初始化。`
        );
      }
      throw error;
    }
  }

  /**
   * 启动开发服务器，同时开始监控运行时错误
   */
  private async startDevServer(timeout: number = 60000): Promise<string> {
    if (!this.webcontainer) {
      throw new Error('WebContainer 未初始化');
    }

    const webcontainer = this.webcontainer;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`开发服务器启动超时（${timeout}ms）`));
      }, timeout);

      // 监听 server-ready 事件
      const serverReadyHandler = (port: number, url: string) => {
        clearTimeout(timeoutId);
        unsubscribeServerReady();
        this.previewUrl = url; // 缓存 preview URL
        logger.info(`✅ [WebContainerRuntime] 服务器就绪: ${url} (端口: ${port})`);
        resolve(url);
      };

      const unsubscribeServerReady = webcontainer.on('server-ready', serverReadyHandler);

      // 启动开发服务器
      webcontainer
        .spawn('npm', ['run', 'dev'])
        .then((process) => {
          this.devProcess = process;

          // 使用箭头函数以正确捕获 `this`（WebContainerRuntime 实例）
          process.output.pipeTo(
            new WritableStream({
              write: (data: string) => {
                logger.debug(`🚀 [dev server] ${data}`);

                // ── 错误捕获 ──────────────────────────────
                if (this.isErrorOutput(data)) {
                  const trimmed = data.trim();
                  if (trimmed) {
                    this.runtimeErrors.push(trimmed);
                    logger.warn(`⚠️ [WebContainerRuntime] 捕获错误: ${trimmed}`);
                  }
                }

                // 尝试从输出中提取 URL（备用方案）
                const urlMatch = data.match(/https?:\/\/[^\s]+/);
                if (urlMatch && !this.isInitialized) {
                  const url = urlMatch[0];
                  clearTimeout(timeoutId);
                  unsubscribeServerReady();
                  this.previewUrl = url;
                  resolve(url);
                }
              },
            })
          );

          // 监听进程退出
          process.exit.then((exitCode) => {
            if (exitCode !== 0 && !this.isInitialized) {
              clearTimeout(timeoutId);
              unsubscribeServerReady();
              reject(
                new Error(`开发服务器异常退出，退出码: ${exitCode}`)
              );
            }
          });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          unsubscribeServerReady();
          reject(error);
        });
    });
  }

  /**
   * 判断 dev server 输出行是否属于错误
   */
  private isErrorOutput(data: string): boolean {
    // 忽略常见非错误输出
    const ignorePatterns = [
      /^\s*$/,          // 空行
      /ready in/i,      // "ready in Xms"
      /vite v/i,        // Vite 版本信息
      /local:/i,        // Local: http://...
      /network:/i,      // Network: http://...
      /press h/i,       // "press h to show help"
      /hmr/i,           // HMR 相关
      /page reload/i,
      /warn/i,          // 警告不算错误
      /warning/i,
    ];
    if (ignorePatterns.some((p) => p.test(data))) return false;

    // 判断是否包含错误关键词
    const errorPatterns = [
      /\berror\b/i,
      /\bfailed\b/i,
      /✘\s*\[ERROR\]/,        // Vite/esbuild 错误标记
      /\[vite\].*error/i,
      /SyntaxError/,
      /TypeError/,
      /ReferenceError/,
      /Cannot find module/,
      /Module not found/,
      /Uncaught/,
      /Build failed/i,
      /ENOENT/,
      /ERR_/,
    ];
    return errorPatterns.some((p) => p.test(data));
  }

  // ============================================================
  // 公共辅助方法（供 CodeGenPipeline 使用）
  // ============================================================

  /**
   * 获取自上次 clearErrors() 后捕获的所有运行时错误
   */
  getErrors(): string[] {
    return [...this.runtimeErrors];
  }

  /**
   * 清空错误缓冲区（在下一轮观察前调用）
   */
  clearErrors(): void {
    this.runtimeErrors = [];
  }

  /**
   * 获取当前预览 URL（服务器就绪后才有值）
   */
  getPreviewUrl(): string | null {
    return this.previewUrl;
  }

  /**
   * 将修复后的文件写入已运行的 WebContainer 文件系统。
   * Vite 的 HMR 会自动检测文件变化并热更新。
   *
   * @param files 需要更新的文件（路径 → 内容），路径为相对路径
   */
  async updateFiles(files: Record<string, string>): Promise<void> {
    if (!this.webcontainer) {
      throw new Error('[WebContainerRuntime] updateFiles: WebContainer 未初始化');
    }

    for (const [rawPath, content] of Object.entries(files)) {
      // 路径规范化
      const normalizedPath = rawPath
        .replace(/^\/+/, '')
        .replace(/^\.\//, '');

      if (!normalizedPath || normalizedPath.includes('..')) {
        logger.warn(`⚠️ [WebContainerRuntime] updateFiles: 跳过无效路径 ${rawPath}`);
        continue;
      }

      try {
        // 确保父目录存在
        const parts = normalizedPath.split('/');
        if (parts.length > 1) {
          const dirPath = parts.slice(0, -1).join('/');
          await this.webcontainer.fs.mkdir(dirPath, { recursive: true } as any).catch(() => {
            // 目录已存在时忽略错误
          });
        }

        await this.webcontainer.fs.writeFile(normalizedPath, content);
        logger.debug(`📝 [WebContainerRuntime] 更新文件: ${normalizedPath}`);
      } catch (error: any) {
        logger.warn(`⚠️ [WebContainerRuntime] 更新文件失败 ${normalizedPath}: ${error.message}`);
      }
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    logger.info('🧹 [WebContainerRuntime] 开始清理...');

    // 停止开发服务器进程
    if (this.devProcess) {
      try {
        this.devProcess.kill();
        logger.debug('✅ [WebContainerRuntime] 开发服务器进程已停止');
      } catch (error) {
        logger.warn('⚠️ [WebContainerRuntime] 停止开发服务器进程失败:', error);
      }
      this.devProcess = null;
    }

    // 释放 WebContainer 引用
    if (this.webcontainer) {
      try {
        await webContainerManager.release();
        logger.debug('✅ [WebContainerRuntime] WebContainer 引用已释放');
      } catch (error) {
        logger.warn('⚠️ [WebContainerRuntime] 释放 WebContainer 引用失败:', error);
      }
      this.webcontainer = null;
    }

    this.isInitialized = false;
    this.previewUrl = null;
    this.runtimeErrors = [];
    logger.info('✅ [WebContainerRuntime] 清理完成');
  }

  /**
   * 获取当前 WebContainer 实例
   */
  getWebContainer(): WebContainer | null {
    return this.webcontainer;
  }

  /**
   * 检查是否已初始化
   */
  isReady(): boolean {
    return this.isInitialized && this.webcontainer !== null;
  }
}

/**
 * 便捷函数：运行项目
 */
export async function runProject(
  flatFiles: FlatFileStructure,
  options: RuntimeOptions = {}
): Promise<RuntimeResult> {
  const runtime = new WebContainerRuntime();
  return runtime.initialize(flatFiles, options);
}
