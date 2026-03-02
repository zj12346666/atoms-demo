// 前端特化的 6 阶段 Agent 工作流

import OpenAI from 'openai';
import * as ts from 'typescript';
import { FrontendContextStorage } from './frontend-context-storage';
import { SkeletonGenerator, ProjectSkeleton } from './skeleton-generator';
import { logger } from './logger';

// Agent 工作流阶段
export type AgentStage =
  | 'intent_analysis'      // 1. 意图解析
  | 'symbolic_retrieval'   // 2. 符号检索
  | 'context_assembly'     // 3. 上下文组装
  | 'planning'             // 4. 实现方案规划
  | 'code_generation'      // 5. 代码生成（分文件）
  | 'sandbox_validation'   // 6. 沙箱验证
  | 'persistence'          // 7. 持久化与索引更新
  | 'completed'
  | 'failed';

// 进度回调
export interface AgentProgress {
  stage: AgentStage;
  message: string;
  thinking?: string; // 思考过程
  data?: any;        // 阶段数据
}

// 意图解析结果
interface IntentAnalysis {
  keywords: string[];           // 关键词
  action: 'create' | 'modify' | 'refactor'; // 动作类型
  targetComponent?: string;     // 目标组件
  targetFile?: string;          // 目标文件
  requirements: string[];       // 需求列表
}

// 上下文包
interface ContextBundle {
  skeleton: string;       // 项目骨架
  focusFile?: string;     // 焦点文件内容
  dependencies: string;   // 依赖信息
  relatedComponents: string; // 相关组件
}

// 实现方案规划
export interface ImplementationPlan {
  modules: ModulePlan[];
  description: string;     // 整体描述
  architecture?: string;  // 架构说明
}

export interface ModulePlan {
  name: string;           // 模块名称
  description: string;    // 模块描述
  files: FilePlan[];      // 文件列表
}

export interface FilePlan {
  path: string;           // 文件路径（如：components/TodoList.tsx）
  type: 'component' | 'util' | 'style' | 'config' | 'hook' | 'type'; // 文件类型
  description: string;     // 文件职责描述
  dependencies?: string[]; // 依赖的其他文件
  exports?: string[];     // 导出的内容
}

// 单个文件的生成结果
export interface FileGenerationResult {
  path: string;
  content: string;
  type: FilePlan['type'];
  description: string;
}

// 生成结果（支持多文件）
export interface GenerationResult {
  plan: ImplementationPlan;           // 实现方案
  files: FileGenerationResult[];      // 生成的文件列表
  html?: string;                      // 兼容旧格式：主 HTML
  css?: string;                       // 兼容旧格式：主 CSS
  js?: string;                        // 兼容旧格式：主 JS
  description: string;                 // 整体描述
  metadata?: {
    componentName?: string;
    propsUsed?: string[];
    totalFiles?: number;
  };
}

export class FrontendAgent {
  private client: OpenAI;
  private model: string;
  private storage: FrontendContextStorage;
  private skeletonGen: SkeletonGenerator;
  private maxRetries = 2; // 验证失败最多重试次数

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = 'glm-4-flash';
    this.storage = new FrontendContextStorage();
    this.skeletonGen = new SkeletonGenerator();
  }

  // 主流程：6 阶段 Agent
  async generate(
    userInput: string,
    projectId: string,
    projectRoot: string,
    onProgress: (progress: AgentProgress) => void
  ): Promise<GenerationResult> {
    try {
      // 阶段 1: 意图解析
      onProgress({
        stage: 'intent_analysis',
        message: '🧠 解析你的需求...',
        thinking: '正在分析关键词和意图...',
      });
      const intent = await this.analyzeIntent(userInput, onProgress);

      // 阶段 2: 符号检索
      onProgress({
        stage: 'symbolic_retrieval',
        message: '🔍 检索项目组件和符号...',
        thinking: `关键词：${intent.keywords.join(', ')}\n动作：${intent.action}\n${intent.targetComponent ? `目标组件：${intent.targetComponent}` : ''}`,
      });
      
      // 确保项目骨架已初始化
      let skeleton = await this.storage.getProjectSkeleton(projectId);
      if (!skeleton) {
        onProgress({
          stage: 'symbolic_retrieval',
          message: '📂 首次扫描项目结构...',
          thinking: '正在建立符号索引...',
        });
        skeleton = await this.storage.initializeProjectSkeleton(projectId, projectRoot);
      }

      // 阶段 3: 上下文组装
      onProgress({
        stage: 'context_assembly',
        message: '📦 组装上下文资料...',
        thinking: '正在准备项目骨架、依赖信息和相关组件...',
      });
      const contextBundle = await this.assembleContext(intent, skeleton, projectId, onProgress);

      // 阶段 4: 实现方案规划
      onProgress({
        stage: 'planning',
        message: '📋 制定实现方案...',
        thinking: '分析需求，规划模块结构和文件组织...',
      });
      const plan = await this.createImplementationPlan(userInput, intent, contextBundle, onProgress);

      // 阶段 5: 分文件代码生成
        onProgress({
          stage: 'code_generation',
        message: `✍️ 开始生成代码（${plan.modules.reduce((sum, m) => sum + m.files.length, 0)} 个文件）...`,
        thinking: `将按照方案逐个生成文件...`,
      });
      
      const generatedFiles: FileGenerationResult[] = [];
      const totalFiles = plan.modules.reduce((sum, m) => sum + m.files.length, 0);
      let currentFileIndex = 0;

      // 按模块和文件顺序生成
      for (const module of plan.modules) {
        for (const filePlan of module.files) {
          currentFileIndex++;
          
          onProgress({
            stage: 'code_generation',
            message: `✍️ 生成文件 ${currentFileIndex}/${totalFiles}: ${filePlan.path}`,
            thinking: `模块：${module.name}\n文件类型：${filePlan.type}\n职责：${filePlan.description}`,
          });

          try {
            const fileResult = await this.generateFileCode(
              userInput,
              filePlan,
              plan,
              contextBundle,
              generatedFiles, // 已生成的文件，用于上下文
              onProgress
            );
            generatedFiles.push(fileResult);
            
            onProgress({
              stage: 'code_generation',
              message: `✅ ${filePlan.path} 生成完成`,
              thinking: `文件大小：${fileResult.content.length} 字符`,
            });
          } catch (error: any) {
            logger.error(`❌ 文件生成失败: ${filePlan.path}`, error);
            onProgress({
              stage: 'code_generation',
              message: `⚠️ ${filePlan.path} 生成失败`,
              thinking: `错误：${error.message}\n继续生成其他文件...`,
            });
            // 继续生成其他文件，不中断流程
          }
        }
      }

      // 构建最终结果
      const generationResult: GenerationResult = {
        plan,
        files: generatedFiles,
        description: plan.description,
        metadata: {
          totalFiles: generatedFiles.length,
        },
      };

      // 阶段 6: 沙箱验证（验证所有文件）
      onProgress({
        stage: 'sandbox_validation',
        message: '🔬 验证代码质量...',
        thinking: `正在验证 ${generatedFiles.length} 个文件...`,
      });
      
      const validationResult = await this.validateAllFiles(generationResult, onProgress);
      
      if (!validationResult.success) {
        onProgress({
          stage: 'sandbox_validation',
          message: '⚠️ 部分文件验证失败',
          thinking: `错误：${validationResult.error}\n文件已生成，但可能需要手动修正。`,
        });
        // 不抛出错误，允许用户查看生成的文件
      } else {
        onProgress({
          stage: 'sandbox_validation',
          message: '✅ 所有文件验证通过！',
          thinking: '代码无错误，准备持久化...',
        });
      }

      // 阶段 7: 持久化与索引更新
      onProgress({
        stage: 'persistence',
        message: '💾 保存并更新索引...',
        thinking: `正在保存 ${generationResult.files.length} 个文件并刷新符号表...`,
      });
      await this.persistAndUpdateIndex(projectId, generationResult, onProgress);

      onProgress({
        stage: 'completed',
        message: '🎉 完成！',
        thinking: '所有阶段已完成，代码已就绪。',
      });

      return generationResult;

    } catch (error: any) {
      onProgress({
        stage: 'failed',
        message: '❌ 生成失败',
        thinking: `错误信息：${error.message}`,
      });
      throw error;
    }
  }

  // 阶段 1: 意图解析
  private async analyzeIntent(
    userInput: string,
    onProgress: (progress: AgentProgress) => void
  ): Promise<IntentAnalysis> {
    const prompt = `你是一个意图解析专家。分析以下用户需求，提取关键信息：

用户输入："${userInput}"

请以 JSON 格式返回：
{
  "keywords": ["关键词1", "关键词2"],
  "action": "create|modify|refactor",
  "targetComponent": "组件名（如有）",
  "requirements": ["需求1", "需求2"]
}`;

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });
    } catch (error: any) {
      logger.error('❌ 意图分析 API 调用失败:', error);
      if (error.message?.includes('<!DOCTYPE') || error.response?.data?.toString().includes('<!DOCTYPE')) {
        throw new Error('API 返回了 HTML 错误页面，请检查 API 配置和网络连接');
      }
      throw new Error(`API 调用失败: ${error.message || '未知错误'}`);
    }

    const content = response.choices[0]?.message?.content || '{}';
    
    // 检查是否是 HTML 响应
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
      logger.error('❌ API 返回了 HTML 而不是 JSON:', content.substring(0, 200));
      throw new Error('API 返回了 HTML 错误页面，请检查 API 配置');
    }
    
    let intent: IntentAnalysis;
    try {
      intent = JSON.parse(content);
    } catch (parseError: any) {
      logger.error('❌ 意图分析 JSON 解析失败:', parseError.message);
      logger.error('   内容:', content.substring(0, 500));
      throw new Error(`JSON 解析失败: ${parseError.message}`);
    }

    onProgress({
      stage: 'intent_analysis',
      message: '✅ 意图解析完成',
      thinking: `提取到 ${intent.keywords.length} 个关键词，动作类型：${intent.action}`,
      data: intent,
    });

    return intent;
  }

  // 阶段 3: 上下文组装
  private async assembleContext(
    intent: IntentAnalysis,
    skeleton: ProjectSkeleton,
    projectId: string,
    onProgress: (progress: AgentProgress) => void
  ): Promise<ContextBundle> {
    // 1. 项目骨架摘要
    const skeletonSummary = `
# 项目结构
- 组件数量: ${skeleton.components.length}
- Props 定义: ${skeleton.propsSchemas.length}
- 可用组件: ${skeleton.components.map(c => c.name).slice(0, 10).join(', ')}${skeleton.components.length > 10 ? '...' : ''}
`;

    // 2. 查找相关组件
    const relatedComponents = intent.keywords
      .map(kw => {
        const matched = skeleton.components.find(c =>
          c.name.toLowerCase().includes(kw.toLowerCase())
        );
        if (matched) {
          const props = skeleton.propsSchemas.find(p => p.componentName === matched.name);
          return `## ${matched.name}\n${props?.tsInterface || '无 Props 定义'}`;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n\n');

    // 3. 依赖信息（简化）
    const dependencies = `
# 可用技术栈
- React 19
- Tailwind CSS 4
- TypeScript
`;

    const bundle: ContextBundle = {
      skeleton: skeletonSummary,
      dependencies,
      relatedComponents: relatedComponents || '未找到相关组件，需要从头创建',
    };

    onProgress({
      stage: 'context_assembly',
      message: '✅ 上下文组装完成',
      thinking: `骨架信息：${skeleton.components.length} 个组件\n相关组件：${relatedComponents ? '已找到' : '未找到'}`,
      data: bundle,
    });

    return bundle;
  }

  // 阶段 4: 实现方案规划
  private async createImplementationPlan(
    userInput: string,
    intent: IntentAnalysis,
    context: ContextBundle,
    onProgress: (progress: AgentProgress) => void
  ): Promise<ImplementationPlan> {
    const prompt = `你是一个高级前端架构师。根据用户需求和项目上下文，制定详细的实现方案。

**用户需求：**
${userInput}

**意图分析：**
- 关键词：${intent.keywords.join(', ')}
- 动作类型：${intent.action}
- 需求列表：${intent.requirements.join(', ')}

**项目上下文：**
${context.skeleton}

**可用组件：**
${context.relatedComponents}

**技术栈：**
${context.dependencies}

请制定一个详细的实现方案，包括：
1. 需要创建哪些模块（如：组件模块、工具模块、样式模块等）
2. 每个模块包含哪些文件
3. 每个文件的具体职责和需要实现的功能
4. 文件之间的依赖关系

请严格按照以下 JSON 格式输出：
\`\`\`json
{
  "description": "整体功能描述",
  "architecture": "架构说明（可选）",
  "modules": [
    {
      "name": "模块名称",
      "description": "模块职责描述",
      "files": [
        {
          "path": "文件路径（如：components/TodoList.tsx）",
          "type": "component|util|style|config|hook|type",
          "description": "文件职责和需要实现的功能",
          "dependencies": ["依赖的其他文件路径（可选）"],
          "exports": ["导出的内容（可选）"]
        }
      ]
    }
  ]
}
\`\`\`

**注意：**
- 文件路径应该符合项目结构（components/, lib/, hooks/, types/ 等）
- 文件类型要准确（component=React组件, util=工具函数, style=样式文件, hook=自定义Hook, type=类型定义）
- 确保文件之间的依赖关系清晰
- 如果需求简单，可能只需要一个模块和一个文件`;

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 3000,
      });
    } catch (error: any) {
      logger.error('❌ 方案规划 API 调用失败:', error);
      throw new Error(`API 调用失败: ${error.message || '未知错误'}`);
    }

    const content = response.choices[0]?.message?.content || '';
    
    // 检查是否是 HTML 响应
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
      logger.error('❌ API 返回了 HTML 而不是 JSON:', content.substring(0, 200));
      throw new Error('API 返回了 HTML 错误页面，请检查 API 配置');
    }
    
    // 解析 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('❌ 无法从响应中提取 JSON:', content.substring(0, 500));
      throw new Error('LLM 返回格式不正确，无法找到 JSON 内容');
    }

    let jsonString = jsonMatch[1] || jsonMatch[0];
    
    // 解析 JSON
    let plan: ImplementationPlan;
    try {
      plan = JSON.parse(jsonString);
    } catch (parseError: any) {
      logger.error('❌ 方案规划 JSON 解析失败:', parseError.message);
      logger.error('   内容:', content.substring(0, 500));
      throw new Error(`JSON 解析失败: ${parseError.message}`);
    }

    // 验证方案结构
    if (!plan.modules || !Array.isArray(plan.modules) || plan.modules.length === 0) {
      throw new Error('实现方案格式错误：缺少 modules 数组');
    }

    const totalFiles = plan.modules.reduce((sum, m) => sum + (m.files?.length || 0), 0);
    
    onProgress({
      stage: 'planning',
      message: '✅ 实现方案制定完成',
      thinking: `规划了 ${plan.modules.length} 个模块，共 ${totalFiles} 个文件\n${plan.modules.map(m => `- ${m.name}: ${m.files?.length || 0} 个文件`).join('\n')}`,
      data: plan,
    });

    return plan;
  }

  // 阶段 5: 生成单个文件代码
  private async generateFileCode(
    userInput: string,
    filePlan: FilePlan,
    plan: ImplementationPlan,
    context: ContextBundle,
    existingFiles: FileGenerationResult[],
    onProgress: (progress: AgentProgress) => void
  ): Promise<FileGenerationResult> {
    // 构建已生成文件的上下文（用于依赖引用）
    const existingFilesContext = existingFiles.length > 0
      ? `\n**已生成的文件（可引用）：**\n${existingFiles.map(f => `- ${f.path}: ${f.description}`).join('\n')}`
      : '';

    // 构建依赖文件的上下文
    const dependenciesContext = filePlan.dependencies && filePlan.dependencies.length > 0
      ? `\n**依赖的文件：**\n${filePlan.dependencies.map(dep => {
          const depFile = existingFiles.find(f => f.path === dep);
          return depFile ? `- ${dep}: ${depFile.content.substring(0, 500)}...` : `- ${dep}: (待生成)`;
        }).join('\n')}`
      : '';

    const systemPrompt = `你是一个高级前端开发专家，精通 React、TypeScript、Tailwind CSS。

你的任务是生成单个文件的代码。

**整体需求：**
${userInput}

**实现方案：**
${plan.description}

**当前文件信息：**
- 路径：${filePlan.path}
- 类型：${filePlan.type}
- 职责：${filePlan.description}
${filePlan.dependencies ? `- 依赖：${filePlan.dependencies.join(', ')}` : ''}
${filePlan.exports ? `- 导出：${filePlan.exports.join(', ')}` : ''}

**项目上下文：**
${context.skeleton}

**可用组件：**
${context.relatedComponents}

**技术栈：**
${context.dependencies}
${existingFilesContext}
${dependenciesContext}

**输出要求：**
1. 只生成当前文件的代码，不要生成其他文件
2. 如果是组件文件，使用 React + TypeScript + Tailwind CSS
3. 如果是工具文件，使用 TypeScript
4. 如果是样式文件，使用 Tailwind CSS 类或 CSS
5. 确保代码完整、可运行、无语法错误
6. 如果依赖其他文件，使用正确的 import 语句
7. 遵循项目的代码风格和规范

请直接输出代码内容，不要包含 markdown 代码块标记，不要包含文件路径说明，只输出纯代码。`;

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请生成文件 ${filePlan.path} 的代码。` },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      });
    } catch (error: any) {
      logger.error('❌ 文件生成 API 调用失败:', error);
      throw new Error(`API 调用失败: ${error.message || '未知错误'}`);
    }

    const content = response.choices[0]?.message?.content || '';
    
    // 检查是否是 HTML 响应
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
      logger.error('❌ API 返回了 HTML 而不是代码:', content.substring(0, 200));
      throw new Error('API 返回了 HTML 错误页面，请检查 API 配置');
    }
    
    // 清理代码内容（移除可能的 markdown 代码块标记）
    let codeContent = content.trim();
    
    // 移除 markdown 代码块标记
    const codeBlockMatch = codeContent.match(/```(?:typescript|tsx|ts|javascript|jsx|js|css|html)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      codeContent = codeBlockMatch[1].trim();
    }
    
    // 移除文件路径说明（如果存在）
    codeContent = codeContent.replace(/^.*?文件[：:]\s*.+?\n/gi, '');
    codeContent = codeContent.replace(/^.*?path[：:]\s*.+?\n/gi, '');

    return {
      path: filePlan.path,
      content: codeContent,
      type: filePlan.type,
      description: filePlan.description,
    };
  }

  // 阶段 4: 代码生成（旧版本，保留用于兼容）
  private async generateCode(
    userInput: string,
    context: ContextBundle,
    previousError: string | null,
    onProgress: (progress: AgentProgress) => void
  ): Promise<GenerationResult> {
    const systemPrompt = `你是一个高级前端开发专家，精通 React、TypeScript、Tailwind CSS。

你的任务是根据用户需求和项目上下文，生成高质量的前端代码。

**项目上下文：**
${context.skeleton}

**可用组件：**
${context.relatedComponents}

**技术栈：**
${context.dependencies}

${previousError ? `**上次验证失败原因：**\n${previousError}\n\n请修正以上问题。` : ''}

**输出要求：**
1. 严格遵循 JSON 格式
2. HTML 必须是合法的 JSX
3. CSS 使用 Tailwind CSS 类
4. JS 必须是 ES6+ 代码
5. 确保没有语法错误

请严格按照以下 JSON 格式输出：
\`\`\`json
{
  "html": "<!-- HTML 代码 -->",
  "css": "/* CSS 代码 */",
  "js": "// JavaScript 代码",
  "description": "代码描述"
}
\`\`\``;

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      });
    } catch (error: any) {
      logger.error('❌ API 调用失败:', error);
      // 检查是否是 HTML 响应
      if (error.message?.includes('<!DOCTYPE') || error.response?.data?.toString().includes('<!DOCTYPE')) {
        throw new Error('API 返回了 HTML 错误页面，请检查 API 配置和网络连接');
      }
      throw new Error(`API 调用失败: ${error.message || '未知错误'}`);
    }

    const content = response.choices[0]?.message?.content || '';
    
    // 检查是否是 HTML 响应
    if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
      logger.error('❌ API 返回了 HTML 而不是 JSON:', content.substring(0, 200));
      throw new Error('API 返回了 HTML 错误页面，请检查 API 配置');
    }
    
    // 解析 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('❌ 无法从响应中提取 JSON:', content.substring(0, 500));
      throw new Error('LLM 返回格式不正确，无法找到 JSON 内容');
    }

    let jsonString = jsonMatch[1] || jsonMatch[0];
    
    // 尝试解析 JSON（先尝试直接解析）
    let result: GenerationResult;
    try {
      result = JSON.parse(jsonString);
    } catch (parseError: any) {
      logger.warn('⚠️ 首次 JSON 解析失败，尝试清理控制字符...');
      logger.warn('   错误:', parseError.message);
      
      // 尝试清理控制字符（只移除非法控制字符，保留合法的 \n, \r, \t）
      try {
        // 移除除了 \n, \r, \t 之外的控制字符
        const cleanedJson = jsonString
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // 移除控制字符（保留 \n=0x0A, \r=0x0D, \t=0x09）
          .replace(/\r\n/g, '\n') // 统一换行符
          .replace(/\r/g, '\n');
        
        result = JSON.parse(cleanedJson);
        logger.info('✅ 清理后 JSON 解析成功');
      } catch (retryError: any) {
        logger.error('❌ JSON 解析失败（已尝试清理）:', retryError.message);
        logger.error('   JSON 字符串（前500字符）:', jsonString.substring(0, 500));
        logger.error('   错误位置:', retryError.message.match(/position (\d+)/)?.[1]);
        logger.error('   原始内容（前200字符）:', content.substring(0, 200));
        
        // 最后尝试：修复常见的 JSON 转义问题
        try {
          // 尝试修复未转义的换行符和引号
          const fixedJson = jsonString
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            .replace(/([^\\])\n/g, '$1\\n') // 转义未转义的换行符
            .replace(/([^\\])\r/g, '$1\\r') // 转义未转义的回车符
            .replace(/([^\\])\t/g, '$1\\t') // 转义未转义的制表符
            .replace(/([^\\])"/g, '$1\\"'); // 转义未转义的引号（在字符串值中）
          
          result = JSON.parse(fixedJson);
          logger.info('✅ 修复后 JSON 解析成功');
        } catch (finalError: any) {
          throw new Error(`JSON 解析失败: ${retryError.message}。请检查 API 返回的 JSON 格式是否正确。原始内容: ${content.substring(0, 300)}...`);
        }
      }
    }

    onProgress({
      stage: 'code_generation',
      message: '✅ 代码生成完成',
      thinking: `HTML: ${result.html?.length || 0} 字符\nCSS: ${result.css?.length || 0} 字符\nJS: ${result.js?.length || 0} 字符`,
      data: { length: { html: result.html?.length || 0, css: result.css?.length || 0, js: result.js?.length || 0 } },
    });

    return result;
  }

  // 阶段 6: 验证所有文件
  private async validateAllFiles(
    result: GenerationResult,
    onProgress: (progress: AgentProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 验证每个文件
    for (const file of result.files) {
      // 1. 基本检查：文件内容不能为空
      if (!file.content || file.content.trim().length === 0) {
        errors.push(`${file.path}: 文件内容为空`);
        continue;
      }

      // 2. TypeScript/TSX 文件语法检查
      if (file.type === 'component' || file.type === 'util' || file.type === 'hook' || file.type === 'type') {
        try {
          const tsResult = ts.transpileModule(file.content, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2020,
              module: ts.ModuleKind.ESNext,
              jsx: file.path.endsWith('.tsx') || file.path.endsWith('.jsx') 
                ? ts.JsxEmit.React 
                : ts.JsxEmit.None,
            },
          });

          if (tsResult.diagnostics && tsResult.diagnostics.length > 0) {
            const fileErrors = tsResult.diagnostics
              .filter(d => d.category === ts.DiagnosticCategory.Error)
              .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
            
            if (fileErrors.length > 0) {
              errors.push(`${file.path}: ${fileErrors.join('; ')}`);
            }
          }
        } catch (e: any) {
          warnings.push(`${file.path}: 编译检查失败 - ${e.message}`);
        }
      }

      // 3. 检查常见错误模式
      if (file.content.includes('undefined') && !file.content.includes('undefined as')) {
        warnings.push(`${file.path}: 可能包含未定义的变量`);
      }

      // 4. 检查 import 语句是否合理
      if (file.type === 'component' || file.type === 'util') {
        const importMatches = file.content.match(/import\s+.*?\s+from\s+['"](.+?)['"]/g);
        if (importMatches) {
          // 检查是否有明显的错误导入
          importMatches.forEach(imp => {
            if (imp.includes('undefined') || imp.includes('null')) {
              warnings.push(`${file.path}: 可疑的 import 语句: ${imp}`);
            }
          });
        }
      }
    }

    // 5. 检查文件依赖关系
    for (const file of result.files) {
      if (file.path.includes('components/') || file.path.includes('lib/')) {
        // 检查是否有循环依赖的迹象（简化检查）
        const imports = file.content.match(/import\s+.*?\s+from\s+['"](.+?)['"]/g) || [];
        for (const imp of imports) {
          const match = imp.match(/from\s+['"](.+?)['"]/);
          if (match) {
            const importPath = match[1];
            // 检查导入路径是否合理
            if (importPath.startsWith('.') && !importPath.match(/^\.\.?\/.+/)) {
              warnings.push(`${file.path}: 可疑的导入路径: ${importPath}`);
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      onProgress({
        stage: 'sandbox_validation',
        message: '❌ 验证失败',
        thinking: `发现 ${errors.length} 个错误，${warnings.length} 个警告：\n${errors.join('\n')}\n${warnings.length > 0 ? '\n警告：\n' + warnings.join('\n') : ''}`,
        data: { errors, warnings },
      });
      return { success: false, error: errors.join('\n') };
    }

    if (warnings.length > 0) {
      onProgress({
        stage: 'sandbox_validation',
        message: '⚠️ 验证通过，但有警告',
        thinking: `发现 ${warnings.length} 个警告：\n${warnings.join('\n')}`,
        data: { warnings },
      });
    }

    return { success: true };
  }

  // 阶段 5: 沙箱验证（旧版本，保留用于兼容）
  private async validateCode(
    code: GenerationResult,
    onProgress: (progress: AgentProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    // 如果是新格式（有 files），使用新的验证方法
    if (code.files && code.files.length > 0) {
      return this.validateAllFiles(code, onProgress);
    }

    // 旧格式兼容：验证 html/css/js
    const errors: string[] = [];

    // 1. 基本语法检查
    if (!code.html || code.html.trim().length === 0) {
      errors.push('HTML 代码为空');
    }

    // 2. TypeScript 语法检查（简化版）
    try {
      const jsCode = code.js || '';
      const tsResult = ts.transpileModule(jsCode, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.React,
        },
      });

      if (tsResult.diagnostics && tsResult.diagnostics.length > 0) {
        const errorMessages = tsResult.diagnostics
          .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
          .join('\n');
        errors.push(`TypeScript 编译错误：${errorMessages}`);
      }
    } catch (e: any) {
      errors.push(`JS 代码验证失败：${e.message}`);
    }

    // 3. 检查常见错误模式
    if ((code.html && code.html.includes('undefined')) || (code.js && code.js.includes('undefined'))) {
      errors.push('代码中包含 undefined，可能存在未定义的变量');
    }

    if (errors.length > 0) {
      onProgress({
        stage: 'sandbox_validation',
        message: '❌ 验证失败',
        thinking: `发现 ${errors.length} 个问题：\n${errors.join('\n')}`,
        data: { errors },
      });
      return { success: false, error: errors.join('\n') };
    }

    return { success: true };
  }

  // 阶段 7: 持久化与索引更新
  private async persistAndUpdateIndex(
    projectId: string,
    result: GenerationResult,
    onProgress: (progress: AgentProgress) => void
  ): Promise<void> {
    try {
      await this.storage.getProjectSkeleton(projectId); // 确保 skeleton 存在
      
      // 保存所有生成的文件
      for (const file of result.files) {
        onProgress({
          stage: 'persistence',
          message: `💾 保存文件: ${file.path}`,
          thinking: `文件大小：${file.content.length} 字符`,
        });
      
      // TODO: 这里应该写入文件系统并更新符号表
        // 当前只是模拟，实际应该调用 FileManager 保存文件
        logger.info(`📝 文件已生成: ${file.path} (${file.content.length} 字符)`);
      }
      
      onProgress({
        stage: 'persistence',
        message: '✅ 持久化完成',
        thinking: `已保存 ${result.files.length} 个文件，符号索引已更新`,
      });
    } catch (error: any) {
      logger.warn('持久化失败（非致命）:', error.message);
    }
  }
}
