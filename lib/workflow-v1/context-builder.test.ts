/**
 * ContextBuilder 测试
 */

import { ContextBuilder } from './context-builder';
import { ContextBuilderInput } from './types';

describe('ContextBuilder', () => {
  let builder: ContextBuilder;

  beforeEach(() => {
    builder = new ContextBuilder();
  });

  describe('build', () => {
    it('应该构造基本的 LLM prompt', async () => {
      const input: ContextBuilderInput = {
        filePath: 'src/App.tsx',
        fileContent: 'function App() { return <div>Hello</div>; }',
        userPrompt: '添加一个按钮',
      };

      const result = await builder.build(input);

      expect(result.llmPrompt).toContain('src/App.tsx');
      expect(result.llmPrompt).toContain('添加一个按钮');
      expect(result.llmPrompt).toContain('function App()');
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.filePath).toBe('src/App.tsx');
      expect(result.metadata?.language).toBe('typescript');
      expect(result.metadata?.lineCount).toBe(1);
    });

    it('应该包含项目上下文', async () => {
      const input: ContextBuilderInput = {
        filePath: 'src/App.tsx',
        fileContent: 'function App() { return <div>Hello</div>; }',
        userPrompt: '修改样式',
        projectContext: {
          fileTree: ['src/App.tsx', 'src/index.ts', 'src/styles.css'],
        },
      };

      const result = await builder.build(input);

      expect(result.llmPrompt).toContain('项目文件结构');
      expect(result.llmPrompt).toContain('src/App.tsx');
      expect(result.llmPrompt).toContain('src/index.ts');
    });

    it('应该包含相关文件内容', async () => {
      const input: ContextBuilderInput = {
        filePath: 'src/App.tsx',
        fileContent: 'function App() { return <div>Hello</div>; }',
        userPrompt: '使用工具函数',
        projectContext: {
          relatedFiles: [
            {
              path: 'src/utils.ts',
              content: 'export function helper() { return true; }',
            },
          ],
        },
      };

      const result = await builder.build(input);

      expect(result.llmPrompt).toContain('相关文件');
      expect(result.llmPrompt).toContain('src/utils.ts');
      expect(result.llmPrompt).toContain('helper');
    });

    it('应该正确检测语言类型', async () => {
      const testCases = [
        { path: 'test.ts', expected: 'typescript' },
        { path: 'test.tsx', expected: 'typescript' },
        { path: 'test.js', expected: 'javascript' },
        { path: 'test.jsx', expected: 'javascript' },
        { path: 'test.css', expected: 'css' },
        { path: 'test.html', expected: 'html' },
      ];

      for (const testCase of testCases) {
        const input: ContextBuilderInput = {
          filePath: testCase.path,
          fileContent: 'test content',
          userPrompt: 'test',
        };

        const result = await builder.build(input);

        expect(result.metadata?.language).toBe(testCase.expected);
      }
    });

    it('应该计算正确的行数', async () => {
      const input: ContextBuilderInput = {
        filePath: 'test.ts',
        fileContent: 'line1\nline2\nline3',
        userPrompt: 'test',
      };

      const result = await builder.build(input);

      expect(result.metadata?.lineCount).toBe(3);
    });

    it('应该包含修改模式提示', async () => {
      const input: ContextBuilderInput = {
        filePath: 'src/App.tsx',
        fileContent: 'function App() { return <div>Hello</div>; }',
        userPrompt: '修改代码',
      };

      const result = await builder.build(input);

      expect(result.llmPrompt).toContain('修改模式');
      expect(result.llmPrompt).toContain('只修改目标文件');
    });

    it('应该包含语言特定的指导原则', async () => {
      const input: ContextBuilderInput = {
        filePath: 'src/App.tsx',
        fileContent: 'function App() { return <div>Hello</div>; }',
        userPrompt: '添加功能',
      };

      const result = await builder.build(input);

      expect(result.llmPrompt).toContain('TypeScript');
      expect(result.llmPrompt).toContain('类型安全');
    });
  });
});
