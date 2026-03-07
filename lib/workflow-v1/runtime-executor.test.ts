/**
 * RuntimeExecutor 测试
 */

import { RuntimeExecutor } from './runtime-executor';
import { RuntimeExecutorInput } from './types';
import { WebContainer } from '@webcontainer/api';

describe('RuntimeExecutor', () => {
  let executor: RuntimeExecutor;
  let mockWebContainer: any;
  let mockProcess: any;

  beforeEach(() => {
    executor = new RuntimeExecutor();

    // 创建模拟的进程
    mockProcess = {
      exit: Promise.resolve(0),
      output: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      },
    };

    // 创建模拟的 WebContainer
    mockWebContainer = {
      spawn: jest.fn().mockResolvedValue(mockProcess),
      fs: {
        readFile: jest.fn().mockResolvedValue(JSON.stringify({
          scripts: {
            dev: 'vite',
          },
        })),
      },
    };

    executor.setWebContainer(mockWebContainer as any);
  });

  describe('execute', () => {
    it('应该成功执行命令', async () => {
      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(mockWebContainer.spawn).toHaveBeenCalled();
    });

    it('应该自动检测命令', async () => {
      const input: RuntimeExecutorInput = {
        projectPath: '.',
      };

      await executor.execute(input);

      expect(mockWebContainer.fs.readFile).toHaveBeenCalledWith(
        'package.json',
        'utf-8'
      );
    });

    it('应该收集日志', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('Info message\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockProcess.output.getReader = jest.fn().mockReturnValue(mockReader);

      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      expect(result.logs.length).toBeGreaterThan(0);
    });

    it('应该检测错误', async () => {
      const mockReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('Error: Cannot find module\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockProcess.output.getReader = jest.fn().mockReturnValue(mockReader);

      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('应该处理进程退出码非零', async () => {
      mockProcess.exit = Promise.resolve(1);

      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('应该处理 WebContainer 未初始化', async () => {
      const uninitializedExecutor = new RuntimeExecutor();

      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await uninitializedExecutor.execute(input);

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('WebContainer 未初始化');
    });

    it('应该分类错误类型', async () => {
      const syntaxErrorReader = {
        read: jest.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('SyntaxError: Unexpected token\n'),
          })
          .mockResolvedValueOnce({ done: true, value: undefined }),
      };

      mockProcess.output.getReader = jest.fn().mockReturnValue(syntaxErrorReader);

      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      if (result.errors.length > 0) {
        expect(result.errors[0].type).toBe('syntax');
      }
    });

    it('应该计算执行时间', async () => {
      const input: RuntimeExecutorInput = {
        projectPath: '.',
        command: 'npm run dev',
      };

      const result = await executor.execute(input);

      expect(result.executionTime).toBeDefined();
      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });
});
