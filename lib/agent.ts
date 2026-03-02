// Plan & Execute Agent 架构

import { OpenAI } from 'openai';

export interface Task {
  id: string;
  description: string;
  type: 'component' | 'logic' | 'style' | 'integration';
  dependencies: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface Plan {
  tasks: Task[];
  summary: string;
}

export interface CodeArtifact {
  html: string;
  css: string;
  js: string;
  description: string;
}

// Planner Prompt
const PLANNER_PROMPT = `你是一个专业的前端开发规划师。

用户会描述他们想要的应用，你需要将任务拆解为清晰的步骤。

## 任务类型
- component: UI 组件设计
- logic: 业务逻辑实现
- style: 样式美化
- integration: 组件整合

## 输出格式（必须是有效的 JSON）
\`\`\`json
{
  "summary": "简短的项目总结",
  "tasks": [
    {
      "id": "task_1",
      "description": "设计整体布局结构",
      "type": "component",
      "dependencies": []
    },
    {
      "id": "task_2",
      "description": "实现核心业务逻辑",
      "type": "logic",
      "dependencies": ["task_1"]
    }
  ]
}
\`\`\`

## 规则
1. 任务数量：2-4 个（不要太多）
2. 必须有清晰的依赖关系
3. 描述要具体可执行
4. 输出必须是有效的 JSON`;

// Executor Prompt
const EXECUTOR_PROMPT = `你是一个专业的前端代码生成器。

你会收到一个任务列表和当前要执行的任务，以及之前完成的代码。

## 技术要求
- 使用纯 HTML + CSS + JavaScript (ES6+)
- 使用 Tailwind CSS (通过 CDN)
- 代码必须完整可运行
- 适配移动端

## 输出格式（必须是有效的 JSON）
\`\`\`json
{
  "html": "HTML body 内容",
  "css": "自定义 CSS",
  "js": "JavaScript 代码",
  "description": "本步骤完成的功能"
}
\`\`\`

## 重要提示
1. 如果有之前的代码，要在此基础上改进
2. 保持代码的连贯性
3. 确保新增功能与现有代码兼容
4. 输出必须是有效的 JSON`;

export class CodeGenerationAgent {
  private client: OpenAI;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  // Planner: 拆解任务
  async createPlan(userInput: string): Promise<Plan> {
    console.log('🧠 Planner: 开始任务拆解...');
    
    const response = await this.client.chat.completions.create({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: PLANNER_PROMPT },
        { role: 'user', content: userInput },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const content = response.choices[0].message.content || '';
    
    // 解析 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    let plan: Plan;
    
    if (jsonMatch) {
      plan = JSON.parse(jsonMatch[1]);
    } else {
      plan = JSON.parse(content);
    }

    console.log('✅ Planner: 任务拆解完成');
    console.log('📋 任务列表:', plan.tasks.map(t => t.description));
    
    return plan;
  }

  // Executor: 执行单个任务
  async executeTask(
    task: Task,
    context: {
      userInput: string;
      allTasks: Task[];
      previousCode?: CodeArtifact;
    }
  ): Promise<CodeArtifact> {
    console.log(`🔨 Executor: 执行任务 [${task.id}] ${task.description}`);
    
    const contextInfo = context.previousCode
      ? `\n\n## 当前代码基础\n\`\`\`\nHTML: ${context.previousCode.html.substring(0, 200)}...\nCSS: ${context.previousCode.css.substring(0, 100)}...\nJS: ${context.previousCode.js.substring(0, 200)}...\n\`\`\``
      : '';

    const prompt = `用户需求：${context.userInput}

当前任务：${task.description}
任务类型：${task.type}

所有任务：
${context.allTasks.map((t, i) => `${i + 1}. ${t.description} ${t.status === 'completed' ? '✓' : ''}`).join('\n')}
${contextInfo}

请生成或改进代码，确保完成当前任务。`;

    const response = await this.client.chat.completions.create({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: EXECUTOR_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const content = response.choices[0].message.content || '';
    
    // 解析 JSON
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    let artifact: CodeArtifact;
    
    if (jsonMatch) {
      artifact = JSON.parse(jsonMatch[1]);
    } else {
      artifact = JSON.parse(content);
    }

    console.log(`✅ Executor: 任务 [${task.id}] 完成`);
    
    return artifact;
  }

  // 主流程：Plan & Execute（支持上下文检索）
  async generateCode(
    userInput: string,
    options?: {
      projectId?: string;
      useContext?: boolean;
      contextRetriever?: (query: string) => Promise<string>;
      onProgress?: (progress: { currentTask: string; completed: number; total: number }) => void;
    }
  ): Promise<CodeArtifact> {
    try {
      // 1. 如果启用上下文检索，先获取相关上下文
      let context = '';
      if (options?.useContext && options?.contextRetriever) {
        console.log('🔍 检索上下文...');
        context = await options.contextRetriever(userInput);
        if (context) {
          console.log('✅ 上下文检索完成');
        }
      }

      // 2. Planner: 创建计划
      const planInput = context ? `${context}\n\n用户需求：${userInput}` : userInput;
      const plan = await this.createPlan(planInput);
      
      // 3. Executor: 逐步执行
      let currentCode: CodeArtifact | undefined;
      
      for (let i = 0; i < plan.tasks.length; i++) {
        const task = plan.tasks[i];
        task.status = 'running';
        
        // 通知进度
        options?.onProgress?.({
          currentTask: task.description,
          completed: i,
          total: plan.tasks.length,
        });
        
        // 执行任务
        const artifact = await this.executeTask(task, {
          userInput: planInput, // 使用带上下文的输入
          allTasks: plan.tasks,
          previousCode: currentCode,
        });
        
        // 合并代码（简单策略：直接覆盖）
        currentCode = artifact;
        task.status = 'completed';
      }
      
      if (!currentCode) {
        throw new Error('No code generated');
      }
      
      // 添加计划摘要到描述
      currentCode.description = `${plan.summary}\n\n${currentCode.description}`;
      
      return currentCode;
      
    } catch (error: any) {
      console.error('❌ Agent error:', error);
      throw error;
    }
  }
}
