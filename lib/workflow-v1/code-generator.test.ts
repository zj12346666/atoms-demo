/**
 * CodeGenerator 测试
 */

import { CodeGenerator } from './code-generator';
import { CodeGeneratorInput } from './types';
import OpenAI from 'openai';

describe('CodeGenerator', () => {
  let generator: CodeGenerator;
  let mockClient: any;

  beforeEach(() => {
    // 创建模拟的 OpenAI 客户端
    mockClient = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    generator = new CodeGenerator({
      client: mockClient as any,
      defaultModel: 'test-model',
      defaultTemperature: 0.7,
      defaultMaxTokens: 4000,
    });
  });

  describe('generate', () => {
    it('应该调用 LLM API 并返回生成的代码', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'function hello() { return "world"; }',
            },
          },
        ],
        usage: {
          total_tokens: 100,
        },
      };

      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const input: CodeGeneratorInput = {
        llmPrompt: '生成一个 hello 函数',
      };

      const result = await generator.generate(input);

      expect(result.generatedCode).toBe('function hello() { return "world"; }');
      expect(result.metadata?.model).toBe('test-model');
      expect(result.metadata?.tokensUsed).toBe(100);
      expect(mockClient.chat.completions.create).toHaveBeenCalled();
    });

    it('应该使用自定义模型配置', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'const x = 1;',
            },
          },
        ],
        usage: {
          total_tokens: 50,
        },
      };

      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const input: CodeGeneratorInput = {
        llmPrompt: '生成代码',
        modelConfig: {
          model: 'custom-model',
          temperature: 0.5,
          maxTokens: 2000,
        },
      };

      await generator.generate(input);

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.model).toBe('custom-model');
      expect(callArgs.temperature).toBe(0.5);
      expect(callArgs.max_tokens).toBe(2000);
    });

    it('应该从 markdown 代码块中提取代码', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: '```typescript\nfunction test() {}\n```',
            },
          },
        ],
        usage: {
          total_tokens: 50,
        },
      };

      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const input: CodeGeneratorInput = {
        llmPrompt: '生成代码',
      };

      const result = await generator.generate(input);

      expect(result.generatedCode).toBe('function test() {}');
    });

    it('应该处理包含系统消息的 prompt', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'const x = 1;',
            },
          },
        ],
        usage: {
          total_tokens: 50,
        },
      };

      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const input: CodeGeneratorInput = {
        llmPrompt: '你是一个专业的代码生成专家。\n\n**用户需求：**\n生成代码',
      };

      await generator.generate(input);

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.messages.length).toBeGreaterThan(1);
      expect(callArgs.messages[0].role).toBe('system');
    });

    it('应该处理空响应', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
        usage: {
          total_tokens: 0,
        },
      };

      mockClient.chat.completions.create.mockResolvedValue(mockResponse);

      const input: CodeGeneratorInput = {
        llmPrompt: '生成代码',
      };

      await expect(generator.generate(input)).rejects.toThrow('LLM 返回空内容');
    });

    it('应该处理 API 错误', async () => {
      mockClient.chat.completions.create.mockRejectedValue(
        new Error('API 调用失败')
      );

      const input: CodeGeneratorInput = {
        llmPrompt: '生成代码',
      };

      await expect(generator.generate(input)).rejects.toThrow('代码生成失败');
    });
  });
});
