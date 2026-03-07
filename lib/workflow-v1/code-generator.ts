/**
 * CodeGenerator - 调用 LLM 生成完整文件代码
 */

import OpenAI from 'openai';
import {
  ICodeGenerator,
  CodeGeneratorInput,
  CodeGeneratorOutput,
} from './types';
import { logger } from '../logger';

export class CodeGenerator implements ICodeGenerator {
  private client: OpenAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(options?: {
    apiKey?: string;
    baseURL?: string;
    client?: OpenAI;
    defaultModel?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
  }) {
    // 如果提供了客户端，直接使用
    if (options?.client) {
      this.client = options.client;
    } else {
      // 否则创建新的客户端
      const apiKey = options?.apiKey || process.env.OPENAI_API_KEY || '';
      const baseURL = options?.baseURL || process.env.OPENAI_BASE_URL;

      if (!apiKey) {
        throw new Error('OpenAI API key is required. Provide it via options or OPENAI_API_KEY environment variable.');
      }

      this.client = new OpenAI({
        apiKey,
        baseURL,
      });
    }

    // 设置默认配置
    this.defaultModel = options?.defaultModel || 'glm-4-flash';
    this.defaultTemperature = options?.defaultTemperature ?? 0.7;
    this.defaultMaxTokens = options?.defaultMaxTokens || 4000;
  }

  /**
   * 生成代码
   */
  async generate(input: CodeGeneratorInput): Promise<CodeGeneratorOutput> {
    const { llmPrompt, modelConfig } = input;

    try {
      const model = modelConfig?.model || this.defaultModel;
      const temperature = modelConfig?.temperature ?? this.defaultTemperature;
      const maxTokens = modelConfig?.maxTokens || this.defaultMaxTokens;

      logger.debug(`🤖 调用 LLM 生成代码 (model: ${model}, temperature: ${temperature})`);

      // 将 prompt 拆分为 system 和 user 消息
      const { systemMessage, userMessage } = this.splitPrompt(llmPrompt);

      const response = await this.client.chat.completions.create({
        model,
        messages: [
          ...(systemMessage ? [{ role: 'system' as const, content: systemMessage }] : []),
          { role: 'user' as const, content: userMessage },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      const content = response.choices[0]?.message?.content || '';

      if (!content) {
        throw new Error('LLM 返回空内容');
      }

      // 提取代码（移除可能的 markdown 代码块标记）
      const generatedCode = this.extractCode(content);

      // 获取 token 使用量
      const tokensUsed = response.usage?.total_tokens;

      logger.debug(`✅ 代码生成成功 (tokens: ${tokensUsed || 'unknown'})`);

      return {
        generatedCode,
        metadata: {
          model,
          tokensUsed,
        },
      };
    } catch (error: any) {
      logger.error('❌ CodeGenerator 生成失败:', error);
      throw new Error(`代码生成失败: ${error.message}`);
    }
  }

  /**
   * 将 prompt 拆分为 system 和 user 消息
   * 如果 prompt 包含 "你是一个" 或 "你是" 等系统提示词，则提取为 system message
   */
  private splitPrompt(prompt: string): { systemMessage?: string; userMessage: string } {
    // 查找系统提示的开始位置
    const systemPatterns = [
      /^你是一个[^\n]*\n/,
      /^你是[^\n]*\n/,
      /^你是一个[^\n]*$/,
      /^你是[^\n]*$/,
    ];

    let systemMessage: string | undefined;
    let userMessage = prompt;

    // 尝试提取系统消息
    for (const pattern of systemPatterns) {
      const match = prompt.match(pattern);
      if (match) {
        // 查找系统消息的结束位置（通常是第一个 ** 或空行后）
        const systemEndMatch = prompt.match(new RegExp(pattern.source + '([\\s\\S]*?)(?=\\n\\n|\\*\\*)'));
        if (systemEndMatch) {
          systemMessage = systemEndMatch[0].trim();
          userMessage = prompt.substring(systemEndMatch[0].length).trim();
          break;
        }
      }
    }

    // 如果没有找到系统消息，检查是否有明确的系统提示部分
    if (!systemMessage && prompt.includes('**用户需求：**')) {
      const parts = prompt.split('**用户需求：**');
      if (parts.length === 2) {
        systemMessage = parts[0].trim();
        userMessage = parts[1].trim();
      }
    }

    // 如果还是没有，整个 prompt 作为 user message
    if (!systemMessage) {
      userMessage = prompt;
    }

    return {
      systemMessage: systemMessage || undefined,
      userMessage,
    };
  }

  /**
   * 从 LLM 响应中提取代码
   * 移除 markdown 代码块标记（```typescript, ```tsx, ```js, ```css 等）
   */
  private extractCode(content: string): string {
    // 移除 markdown 代码块标记
    // 匹配 ```language\n...\n``` 或 ```\n...\n```
    const codeBlockPattern = /```(?:\w+)?\n([\s\S]*?)\n```/g;
    const matches = content.matchAll(codeBlockPattern);

    const codeBlocks: string[] = [];
    for (const match of matches) {
      codeBlocks.push(match[1]);
    }

    // 如果找到代码块，返回第一个（通常是最完整的）
    if (codeBlocks.length > 0) {
      return codeBlocks[0].trim();
    }

    // 如果没有代码块标记，检查是否包含代码特征
    // 如果包含 import、export、function、class 等，可能是纯代码
    const codeIndicators = /^(import|export|function|class|const|let|var|interface|type|enum)/m;
    if (codeIndicators.test(content)) {
      return content.trim();
    }

    // 否则返回原始内容（可能是纯代码，没有标记）
    return content.trim();
  }
}
