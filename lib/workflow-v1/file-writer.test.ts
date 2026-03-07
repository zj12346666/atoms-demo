/**
 * FileWriter 测试
 */

import { FileWriter } from './file-writer';
import { FileWriterInput } from './types';
import { WebContainer } from '@webcontainer/api';

describe('FileWriter', () => {
  let writer: FileWriter;
  let mockWebContainer: any;

  beforeEach(() => {
    writer = new FileWriter();
    
    // 创建模拟的 WebContainer
    mockWebContainer = {
      fs: {
        writeFile: jest.fn().mockResolvedValue(undefined),
        readdir: jest.fn().mockResolvedValue([]),
        mkdir: jest.fn().mockResolvedValue(undefined),
      },
    };

    writer.setWebContainer(mockWebContainer as any);
  });

  describe('write', () => {
    it('应该成功写入文件', async () => {
      const input: FileWriterInput = {
        filePath: 'src/App.tsx',
        content: 'function App() { return <div>Hello</div>; }',
        encoding: 'utf-8',
      };

      const result = await writer.write(input);

      expect(result.success).toBe(true);
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(mockWebContainer.fs.writeFile).toHaveBeenCalledWith(
        'src/App.tsx',
        input.content,
        { encoding: 'utf-8' }
      );
    });

    it('应该规范化路径（移除开头的斜杠）', async () => {
      const input: FileWriterInput = {
        filePath: '/src/App.tsx',
        content: 'test',
      };

      await writer.write(input);

      expect(mockWebContainer.fs.writeFile).toHaveBeenCalledWith(
        'src/App.tsx',
        'test',
        expect.any(Object)
      );
    });

    it('应该规范化路径分隔符', async () => {
      const input: FileWriterInput = {
        filePath: 'src\\components\\Button.tsx',
        content: 'test',
      };

      await writer.write(input);

      expect(mockWebContainer.fs.writeFile).toHaveBeenCalledWith(
        'src/components/Button.tsx',
        'test',
        expect.any(Object)
      );
    });

    it('应该创建不存在的目录', async () => {
      // 模拟目录不存在
      mockWebContainer.fs.readdir.mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const input: FileWriterInput = {
        filePath: 'src/components/Button.tsx',
        content: 'test',
      };

      await writer.write(input);

      // 应该尝试创建目录
      expect(mockWebContainer.fs.mkdir).toHaveBeenCalledWith('src');
      expect(mockWebContainer.fs.mkdir).toHaveBeenCalledWith('src/components');
    });

    it('应该处理 WebContainer 未初始化的情况', async () => {
      const uninitializedWriter = new FileWriter();
      
      const input: FileWriterInput = {
        filePath: 'test.ts',
        content: 'test',
      };

      const result = await uninitializedWriter.write(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('WebContainer 未初始化');
    });

    it('应该处理写入错误', async () => {
      mockWebContainer.fs.writeFile.mockRejectedValueOnce(
        new Error('写入失败')
      );

      const input: FileWriterInput = {
        filePath: 'test.ts',
        content: 'test',
      };

      const result = await writer.write(input);

      expect(result.success).toBe(false);
      expect(result.error).toBe('写入失败');
    });

    it('应该正确计算写入的字节数', async () => {
      const input: FileWriterInput = {
        filePath: 'test.ts',
        content: 'Hello, 世界!',
        encoding: 'utf-8',
      };

      const result = await writer.write(input);

      expect(result.bytesWritten).toBe(Buffer.byteLength('Hello, 世界!', 'utf-8'));
    });

    it('应该支持不同的编码格式', async () => {
      const input: FileWriterInput = {
        filePath: 'test.ts',
        content: 'test',
        encoding: 'utf8',
      };

      await writer.write(input);

      expect(mockWebContainer.fs.writeFile).toHaveBeenCalledWith(
        'test.ts',
        'test',
        { encoding: 'utf-8' }
      );
    });
  });
});
