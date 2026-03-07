/**
 * IntentAnalyzer 测试
 */

import { IntentAnalyzer } from './intent-analyzer';
import { IntentAnalyzerInput } from './types';

describe('IntentAnalyzer', () => {
  let analyzer: IntentAnalyzer;

  beforeEach(() => {
    analyzer = new IntentAnalyzer();
  });

  describe('analyze', () => {
    it('应该从 prompt 中提取明确的文件路径', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '修改 src/components/Button.tsx 中的样式',
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toContain('Button.tsx');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reasoning).toBeDefined();
    });

    it('应该识别当前文件', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '在这个文件中添加一个函数',
        projectContext: {
          currentFile: 'src/utils.ts',
          fileTree: ['src/utils.ts', 'src/index.ts'],
        },
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toBe('src/utils.ts');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('应该基于关键词匹配文件树', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '修改 Button 组件的样式',
        projectContext: {
          fileTree: [
            'src/components/Button.tsx',
            'src/components/Input.tsx',
            'src/index.ts',
          ],
        },
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toContain('Button');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('应该根据技术栈推断默认文件', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '创建一个 React 组件',
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toContain('tsx');
      expect(result.targetFilePath).toContain('App');
    });

    it('应该处理空文件树', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '添加一个新功能',
        projectContext: {
          fileTree: [],
        },
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('应该处理没有上下文的 prompt', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '创建一个计数器组件',
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toBeDefined();
      expect(result.reasoning).toBeDefined();
    });

    it('应该优先使用明确的文件路径', async () => {
      const input: IntentAnalyzerInput = {
        userPrompt: '修改 app/page.tsx 文件',
        projectContext: {
          currentFile: 'src/index.ts',
          fileTree: ['src/index.ts', 'app/page.tsx'],
        },
      };

      const result = await analyzer.analyze(input);

      expect(result.targetFilePath).toContain('page.tsx');
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });
});
