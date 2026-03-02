import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  buildOutput?: string;
  runtimeOutput?: string;
}

/**
 * 代码验证器：在后端运行项目并检测错误
 */
export class CodeValidator {
  private tempDir: string;
  private maxRetries = 3;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || path.join(process.cwd(), '.temp-projects');
  }

  /**
   * 验证代码：创建临时项目、安装依赖、构建并运行
   */
  async validateCode(
    sessionId: string,
    files: Array<{ path: string; content: string }>,
    maxRetries: number = 3
  ): Promise<ValidationResult> {
    const projectDir = path.join(this.tempDir, sessionId);
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. 创建项目目录
      await this.ensureDir(projectDir);
      logger.info(`📁 [Validator] 创建项目目录: ${projectDir}`);

      // 2. 写入文件
      await this.writeFiles(projectDir, files);
      logger.info(`✅ [Validator] 已写入 ${files.length} 个文件`);

      // 3. 检查是否有 package.json，如果没有则创建
      const packageJsonPath = path.join(projectDir, 'package.json');
      try {
        await fs.access(packageJsonPath);
      } catch {
        // 创建默认的 package.json
        await this.createDefaultPackageJson(projectDir, files);
      }

      // 4. 安装依赖
      logger.info(`📦 [Validator] 开始安装依赖...`);
      const installResult = await this.installDependencies(projectDir);
      if (!installResult.success) {
        errors.push(...installResult.errors);
        warnings.push(...installResult.warnings);
        return {
          success: false,
          errors,
          warnings,
          buildOutput: installResult.output,
        };
      }

      // 5. 构建项目（如果支持）
      logger.info(`🔨 [Validator] 开始构建项目...`);
      const buildResult = await this.buildProject(projectDir);
      if (!buildResult.success) {
        errors.push(...buildResult.errors);
        warnings.push(...buildResult.warnings);
        return {
          success: false,
          errors,
          warnings,
          buildOutput: buildResult.output,
        };
      }

      // 6. 启动开发服务器并检测错误（超时 10 秒）
      logger.info(`🚀 [Validator] 启动开发服务器...`);
      const runtimeResult = await this.startDevServer(projectDir, 10000);
      if (!runtimeResult.success) {
        errors.push(...runtimeResult.errors);
        warnings.push(...runtimeResult.warnings);
        return {
          success: false,
          errors,
          warnings,
          buildOutput: buildResult.output,
          runtimeOutput: runtimeResult.output,
        };
      }

      logger.info(`✅ [Validator] 代码验证通过！`);
      return {
        success: true,
        errors: [],
        warnings: warnings.concat(runtimeResult.warnings),
        buildOutput: buildResult.output,
        runtimeOutput: runtimeResult.output,
      };
    } catch (error: any) {
      logger.error(`❌ [Validator] 验证过程出错:`, error);
      errors.push(`验证过程出错: ${error.message}`);
      return {
        success: false,
        errors,
        warnings,
      };
    } finally {
      // 清理临时目录（可选，保留用于调试）
      // await this.cleanup(projectDir);
    }
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * 写入文件
   */
  private async writeFiles(projectDir: string, files: Array<{ path: string; content: string }>): Promise<void> {
    for (const file of files) {
      const filePath = path.join(projectDir, file.path);
      const dir = path.dirname(filePath);
      
      // 确保目录存在
      await this.ensureDir(dir);
      
      // 写入文件
      await fs.writeFile(filePath, file.content, 'utf-8');
    }
  }

  /**
   * 创建默认的 package.json
   */
  private async createDefaultPackageJson(projectDir: string, files: Array<{ path: string; content: string }>): Promise<void> {
    const hasReact = files.some(f => 
      f.path.endsWith('.tsx') || 
      f.path.endsWith('.jsx') || 
      f.content.includes('react')
    );

    const packageJson = hasReact ? {
      name: 'generated-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --host',
        build: 'vite build',
        preview: 'vite preview'
      },
      dependencies: {
        'react': '^18.2.0',
        'react-dom': '^18.2.0',
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        'vite': '^5.0.0',
        '@vitejs/plugin-react': '^4.2.0'
      }
    } : {
      name: 'generated-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --host',
        build: 'vite build',
        preview: 'vite preview'
      },
      dependencies: {
        'vite': '^5.0.0'
      }
    };

    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(packageJson, null, 2),
      'utf-8'
    );
  }

  /**
   * 安装依赖
   */
  private async installDependencies(projectDir: string): Promise<{ success: boolean; errors: string[]; warnings: string[]; output: string }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      const { stdout, stderr } = await execAsync('npm install', {
        cwd: projectDir,
        timeout: 60000, // 60 秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB 缓冲区
      });

      const output = stdout + stderr;
      
      // 检测错误
      if (stderr.includes('ERROR') || stderr.includes('Error') || 
          output.includes('npm ERR!') || 
          output.includes('failed')) {
        errors.push(`依赖安装失败: ${stderr}`);
      }

      // 检测警告
      if (output.includes('WARN') || output.includes('warn')) {
        warnings.push(`依赖安装警告: ${output.match(/WARN[^\n]*/g)?.join('\n') || ''}`);
      }

      return {
        success: errors.length === 0,
        errors,
        warnings,
        output,
      };
    } catch (error: any) {
      errors.push(`依赖安装失败: ${error.message}`);
      if (error.stdout) errors.push(`输出: ${error.stdout}`);
      if (error.stderr) errors.push(`错误: ${error.stderr}`);
      return {
        success: false,
        errors,
        warnings,
        output: error.stdout + error.stderr,
      };
    }
  }

  /**
   * 构建项目
   */
  private async buildProject(projectDir: string): Promise<{ success: boolean; errors: string[]; warnings: string[]; output: string }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    try {
      const { stdout, stderr } = await execAsync('npm run build', {
        cwd: projectDir,
        timeout: 60000, // 60 秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB 缓冲区
      });

      const output = stdout + stderr;
      
      // 检测构建错误
      if (output.includes('ERROR') || output.includes('Error') ||
          output.includes('failed to compile') || output.includes('Failed to compile') ||
          output.includes('SyntaxError') || output.includes('TypeError') ||
          output.includes('Cannot find module') || output.includes('Module not found') ||
          output.includes('Unexpected token') || output.includes('Parsing error')) {
        errors.push(`构建失败: ${output}`);
      }

      return {
        success: errors.length === 0,
        errors,
        warnings,
        output,
      };
    } catch (error: any) {
      // 如果构建命令不存在，不算错误（某些项目可能没有 build 脚本）
      if (error.message.includes('Missing script')) {
        warnings.push(`构建脚本不存在，跳过构建步骤`);
        return {
          success: true,
          errors: [],
          warnings,
          output: '',
        };
      }
      
      errors.push(`构建失败: ${error.message}`);
      if (error.stdout) errors.push(`输出: ${error.stdout}`);
      if (error.stderr) errors.push(`错误: ${error.stderr}`);
      return {
        success: false,
        errors,
        warnings,
        output: (error.stdout || '') + (error.stderr || ''),
      };
    }
  }

  /**
   * 启动开发服务器并检测错误
   */
  private async startDevServer(
    projectDir: string,
    timeout: number = 10000
  ): Promise<{ success: boolean; errors: string[]; warnings: string[]; output: string }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let output = '';

    return new Promise((resolve) => {
      // 使用 spawn 来正确捕获输出
      const devProcess = spawn('npm', ['run', 'dev'], {
        cwd: projectDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      devProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        output += text;
        logger.debug(`[Dev Server] ${text}`);
      });

      devProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        output += text;
        logger.debug(`[Dev Server Error] ${text}`);
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        devProcess.kill('SIGTERM');
        
        // 检查输出中是否有错误
        const allOutput = stdout + stderr;
        if (allOutput.includes('ERROR') || allOutput.includes('Error') ||
            allOutput.includes('failed to compile') || allOutput.includes('Failed to compile') ||
            allOutput.includes('SyntaxError') || allOutput.includes('TypeError') ||
            allOutput.includes('Cannot find module') || allOutput.includes('Module not found') ||
            allOutput.includes('Unexpected token') || allOutput.includes('Parsing error')) {
          errors.push(`开发服务器启动时检测到错误: ${allOutput.substring(0, 1000)}`);
          resolve({
            success: false,
            errors,
            warnings,
            output: allOutput,
          });
        } else {
          // 没有错误，认为启动成功
          resolve({
            success: true,
            errors: [],
            warnings,
            output: allOutput || '开发服务器启动成功（超时检查）',
          });
        }
      }, timeout);

      devProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        errors.push(`开发服务器启动失败: ${error.message}`);
        resolve({
          success: false,
          errors,
          warnings,
          output: stdout + stderr,
        });
      });

      devProcess.on('exit', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && code !== null) {
          errors.push(`开发服务器退出，退出码: ${code}`);
          resolve({
            success: false,
            errors,
            warnings,
            output: stdout + stderr,
          });
        }
      });
    });
  }

  /**
   * 清理临时目录
   */
  async cleanup(projectDir: string): Promise<void> {
    try {
      await fs.rm(projectDir, { recursive: true, force: true });
      logger.info(`🧹 [Validator] 已清理临时目录: ${projectDir}`);
    } catch (error) {
      logger.warn(`⚠️ [Validator] 清理临时目录失败: ${error}`);
    }
  }
}
