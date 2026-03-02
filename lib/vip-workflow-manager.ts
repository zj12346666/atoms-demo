/**
 * VIP Code Agent - WorkflowManager (基于 Skill 模块重构)
 * 核心状态机：Intent & Retrieval → MultiFileCodeGen → Validation Loop → WebContainer Compatibility Check → Code Review → Persistence & Reindex
 * 
 * 使用 7 大核心 Skill 模块：
 * 1. SymbolicDiscoverySkill - 符号导航与检索
 * 2. MultiFileEngineeringSkill - 原子化多文件生成
 * 3. SandboxValidationSkill - 自动化沙箱校验
 * 4. WebContainerCompatibilitySkill - WebContainer 兼容性检查（文件名大小写、路径格式等）
 * 5. CodeReviewSkill - 代码质量审查
 * 6. PersistenceSkill - 确定性持久化
 * 7. EnvironmentSyncSkill - 环境感知与通知
 */

import { ensureConnection } from './db';
import { logger } from './logger';
import OpenAI from 'openai';
import { FileManager } from './file-manager';
import {
  SymbolicDiscoverySkill,
  MultiFileEngineeringSkill,
  SandboxValidationSkill,
  WebContainerCompatibilitySkill,
  CodeReviewSkill,
  PersistenceSkill,
  EnvironmentSyncSkill,
  FileChange,
} from './skills';
import { agentPromptInjector } from './agent-prompt-injector';

export type WorkflowState = 
  | 'idle'
  | 'intent_retrieval'
  | 'code_generation'
  | 'validation'
  | 'fixing'
  | 'reviewing'
  | 'persistence'
  | 'reindexing'
  | 'completed'
  | 'failed';

export interface WorkflowProgress {
  state: WorkflowState;
  message: string;
  progress: number; // 0-100
  details?: string;
}

export interface WorkflowResult {
  success: boolean;
  plan?: string;
  fileChanges: FileChange[];
  errors?: string[];
  warnings?: string[];
  validationAttempts?: number;
}

export class VIPWorkflowManager {
  private client: OpenAI;
  private fileManager: FileManager;
  private maxFixAttempts = 3;

  // 7 大核心 Skill 模块
  private symbolicDiscovery: SymbolicDiscoverySkill;
  private multiFileEngineering: MultiFileEngineeringSkill;
  private sandboxValidation: SandboxValidationSkill;
  private webContainerCompatibility: WebContainerCompatibilitySkill;
  private codeReview: CodeReviewSkill;
  private persistence: PersistenceSkill;
  private environmentSync: EnvironmentSyncSkill;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    this.fileManager = new FileManager();

    // 初始化 Skill 模块
    this.symbolicDiscovery = new SymbolicDiscoverySkill();
    this.multiFileEngineering = new MultiFileEngineeringSkill();
    this.sandboxValidation = new SandboxValidationSkill();
    this.webContainerCompatibility = new WebContainerCompatibilitySkill();
    this.codeReview = new CodeReviewSkill(apiKey, baseURL);
    this.persistence = new PersistenceSkill();
    this.environmentSync = new EnvironmentSyncSkill();
  }

  /**
   * 主工作流入口
   */
  async execute(
    prompt: string,
    sessionId: string,
    projectId: string,
    onProgress: (progress: WorkflowProgress) => void
  ): Promise<WorkflowResult> {
    let fixAttempts = 0;
    let fileChanges: FileChange[] = [];
    let plan: string = '';

    try {
      await ensureConnection();

      // ========== 阶段1: Intent & Retrieval (使用 SymbolicDiscoverySkill) ==========
      onProgress({
        state: 'intent_retrieval',
        message: '🧠 分析需求，查找相关代码...',
        progress: 10,
        details: '正在提取关键词并检索项目中的符号',
      });

      const { keywords, symbols } = await this.intentAndRetrieval(prompt, projectId);
      
      onProgress({
        state: 'intent_retrieval',
        message: `✅ 找到 ${symbols.length} 个相关组件和函数`,
        progress: 20,
        details: `关键词: ${keywords.slice(0, 5).join(', ')}`,
      });

      // ========== 阶段2-3: Code Generation + Validation Loop ==========
      while (fixAttempts < this.maxFixAttempts) {
        // 阶段2: MultiFileCodeGen
        if (fixAttempts > 0) {
          onProgress({
            state: 'fixing',
            message: `🔧 修复错误中... (第 ${fixAttempts + 1} 次尝试)`,
            progress: 30 + fixAttempts * 15,
            details: '根据错误信息调整代码',
          });
        } else {
          onProgress({
            state: 'code_generation',
            message: '✍️ 生成代码...',
            progress: 30,
            details: '基于检索到的符号和现有代码结构生成新代码',
          });
        }

        // 获取当前文件内容（用于生成上下文）
        const currentFiles = await this.getCurrentFiles(sessionId);
        
        // 注入项目上下文（package.json, tsconfig.json 等）
        const enhancedPrompt = await agentPromptInjector.enhancePrompt(sessionId, prompt);
        
        // 生成代码（XML格式）
        const generatedXml = await this.generateCode(
          enhancedPrompt,
          keywords,
          symbols,
          currentFiles,
          fixAttempts > 0 ? { fileChanges, errors: [] } : undefined
        );

        // 解析XML
        const parsed = this.parseXmlFileChanges(generatedXml);
        plan = parsed.plan || '';
        fileChanges = parsed.fileChanges;

        if (fileChanges.length === 0) {
          throw new Error('未生成任何文件变更');
        }

        onProgress({
          state: 'code_generation',
          message: `📝 已生成 ${fileChanges.length} 个文件的变更`,
          progress: 45,
          details: fileChanges.map(fc => `${fc.path} (${fc.action})`).join(', '),
        });

        // 使用 MultiFileEngineeringSkill 暂存代码变更
        const stageResult = await this.multiFileEngineering.stageCodeChanges(
          fileChanges,
          sessionId
        );

        if (!stageResult.success) {
          throw new Error(`暂存代码变更失败: ${stageResult.errors?.join(', ')}`);
        }

        // 阶段3: Validation Loop (使用 SandboxValidationSkill)
        onProgress({
          state: 'validation',
          message: '🔬 检查代码语法和类型...',
          progress: 60 + fixAttempts * 10,
          details: '运行 TypeScript 编译检查',
        });

        const stagedFiles = this.multiFileEngineering.getAllStagedFiles();
        const validationReport = await this.sandboxValidation.validateInSandbox(stagedFiles);

        if (validationReport.success) {
          // 验证通过，检查 WebContainer 兼容性
          onProgress({
            state: 'validation',
            message: '✅ 代码验证通过，检查 WebContainer 兼容性...',
            progress: 68,
            details: '检查文件名大小写和路径格式',
          });

          const compatibilityReport = await this.webContainerCompatibility.checkCompatibility(stagedFiles);

          if (!compatibilityReport.passed) {
            // 兼容性检查失败，需要修复
            const issueCount = compatibilityReport.issues.length;
            onProgress({
              state: 'validation',
              message: `⚠️ WebContainer 兼容性检查失败，发现 ${issueCount} 个问题，准备修复...`,
              progress: 65,
              details: `主要问题: ${compatibilityReport.issues.slice(0, 2).map(i => i.message).join('; ')}`,
            });

            fixAttempts++;
            if (fixAttempts >= this.maxFixAttempts) {
              // 清空暂存区
              this.multiFileEngineering.clearStaged();
              
              return {
                success: false,
                plan,
                fileChanges,
                errors: compatibilityReport.issues.map(i => `${i.file}:${i.line || 0} - ${i.message}`),
                warnings: [],
                validationAttempts: fixAttempts,
              };
            }

            // 将兼容性修复指令拼接到 prompt，跳回代码生成节点
            prompt = this.buildCompatibilityFixPrompt(prompt, compatibilityReport, fileChanges);
            continue; // 继续循环，重新生成代码
          }

          // 兼容性检查通过，退出循环
          onProgress({
            state: 'validation',
            message: '✅ 代码验证和兼容性检查通过',
            progress: 70,
            details: '所有语法、类型和 WebContainer 兼容性检查通过',
          });
          break;
        }

        // 验证失败，准备修复
        const errorCount = validationReport.errors.length;
        onProgress({
          state: 'validation',
          message: `⚠️ 发现 ${errorCount} 个错误，准备修复...`,
          progress: 65,
          details: `主要错误: ${validationReport.errors.slice(0, 2).map(e => e.message).join('; ')}`,
        });

        fixAttempts++;
        if (fixAttempts >= this.maxFixAttempts) {
          // 清空暂存区
          this.multiFileEngineering.clearStaged();
          
          return {
            success: false,
            plan,
            fileChanges,
            errors: validationReport.errors.map(e => `${e.file}:${e.line}:${e.column} - ${e.message}`),
            warnings: validationReport.warnings.map(w => `${w.file}:${w.line}:${w.column} - ${w.message}`),
            validationAttempts: fixAttempts,
          };
        }

        // 更新prompt，包含错误信息
        prompt = this.buildFixPrompt(prompt, validationReport.errors, fileChanges);
      }

      // ========== 阶段4: Code Review (使用 CodeReviewSkill) ==========
      let reviewAttempts = 0;
      const maxReviewAttempts = 2; // 最多审查2次
      let needsReviewRevision = false;

      while (reviewAttempts < maxReviewAttempts) {
        const stagedFiles = this.multiFileEngineering.getAllStagedFiles();
        
        onProgress({
          state: 'reviewing',
          message: reviewAttempts > 0 
            ? `🔍 重新审查代码... (第 ${reviewAttempts + 1} 次)`
            : '🔍 审查代码质量...',
          progress: 72 + reviewAttempts * 5,
          details: '检查代码逻辑、最佳实践和可维护性',
        });

        const reviewReport = await this.codeReview.reviewCode(
          stagedFiles,
          prompt,
          plan
        );

        if (!reviewReport.needsRevision) {
          // 审查通过
          onProgress({
            state: 'reviewing',
            message: `✅ 代码审查通过 (评分: ${reviewReport.score})`,
            progress: 75,
            details: reviewReport.summary,
          });
          needsReviewRevision = false;
          break;
        }

        // 审查发现问题，需要修改
        const issueCount = reviewReport.issues.length;
        onProgress({
          state: 'reviewing',
          message: `⚠️ 发现 ${issueCount} 个问题，准备修改...`,
          progress: 73,
          details: `主要问题: ${reviewReport.issues.slice(0, 2).map(i => i.message).join('; ')}`,
        });

        reviewAttempts++;
        if (reviewAttempts >= maxReviewAttempts) {
          // 达到最大审查次数，记录警告但继续
          logger.warn(`⚠️ 代码审查达到最大次数，但仍有问题: ${reviewReport.summary}`);
          needsReviewRevision = false;
          break;
        }

        // 根据审查意见修改代码
        onProgress({
          state: 'code_generation',
          message: '🔧 根据审查意见修改代码...',
          progress: 74,
          details: '根据审查建议优化代码',
        });

        try {
          const revisedXml = await this.codeReview.reviseCodeBasedOnReview(
            stagedFiles,
            prompt,
            reviewReport
          );

          // 解析修改后的代码
          const revisedParsed = this.parseXmlFileChanges(revisedXml);
          const revisedFileChanges = revisedParsed.fileChanges;

          if (revisedFileChanges.length === 0) {
            logger.warn('⚠️ 审查修改未生成任何文件变更，继续使用原代码');
            needsReviewRevision = false;
            break;
          }

          // 清空暂存区，重新暂存修改后的代码
          this.multiFileEngineering.clearStaged();
          
          const revisedStageResult = await this.multiFileEngineering.stageCodeChanges(
            revisedFileChanges,
            sessionId
          );

          if (!revisedStageResult.success) {
            logger.warn(`⚠️ 暂存审查修改失败: ${revisedStageResult.errors?.join(', ')}，继续使用原代码`);
            needsReviewRevision = false;
            break;
          }

          // 重新验证修改后的代码
          const revisedStagedFiles = this.multiFileEngineering.getAllStagedFiles();
          const revisedValidationReport = await this.sandboxValidation.validateInSandbox(revisedStagedFiles);

          if (!revisedValidationReport.success) {
            logger.warn(`⚠️ 审查修改后的代码验证失败，继续使用原代码`);
            // 恢复原代码
            this.multiFileEngineering.clearStaged();
            await this.multiFileEngineering.stageCodeChanges(fileChanges, sessionId);
            needsReviewRevision = false;
            break;
          }

          // 修改成功，更新fileChanges
          fileChanges = revisedFileChanges;
          needsReviewRevision = true;
          logger.info(`✅ 根据审查意见成功修改代码`);
        } catch (error: any) {
          logger.error(`❌ 根据审查意见修改代码失败: ${error.message}`);
          // 修改失败，继续使用原代码
          needsReviewRevision = false;
          break;
        }
      }

      // ========== 阶段5: Persistence (使用 PersistenceSkill) ==========
      const stagedFiles = this.multiFileEngineering.getAllStagedFiles();
      
      onProgress({
        state: 'persistence',
        message: '💾 保存文件到数据库...',
        progress: 80,
        details: `正在保存 ${stagedFiles.size} 个文件`,
      });

      const { persistence, reindex } = await this.persistence.commitAndRefresh(
        sessionId,
        projectId,
        stagedFiles
      );

      if (!persistence.success) {
        throw new Error(`持久化失败: ${persistence.errors?.join(', ')}`);
      }

      // ========== 阶段6: Reindex (已在 commitAndRefresh 中完成) ==========
      onProgress({
        state: 'reindexing',
        message: `🔄 更新代码索引...`,
        progress: 90,
        details: `已更新 ${reindex.updatedSymbols} 个符号，方便后续检索`,
      });

      // ========== 阶段7: 同步前端视图 (使用 EnvironmentSyncSkill) ==========
      onProgress({
        state: 'completed',
        message: '📡 刷新编辑器视图...',
        progress: 95,
        details: '通知前端更新文件列表',
      });

      await this.environmentSync.syncWebIdeView(
        sessionId,
        Array.from(stagedFiles.keys()),
        'UPDATE'
      );

      // 清空暂存区
      this.multiFileEngineering.clearStaged();

      // ========== 完成 ==========
      onProgress({
        state: 'completed',
        message: '✅ 完成！代码已生成并保存',
        progress: 100,
        details: `共处理 ${fileChanges.length} 个文件`,
      });

      return {
        success: true,
        plan,
        fileChanges,
        validationAttempts: fixAttempts + 1,
      };

    } catch (error: any) {
      logger.error('❌ VIP Workflow执行失败:', error);
      
      // 清空暂存区
      this.multiFileEngineering.clearStaged();
      
      onProgress({
        state: 'failed',
        message: `❌ 执行失败`,
        progress: 0,
        details: error.message || '未知错误',
      });

      return {
        success: false,
        plan,
        fileChanges,
        errors: [error.message],
        validationAttempts: fixAttempts,
      };
    }
  }

  /**
   * 阶段1: Intent & Retrieval
   * 使用 SymbolicDiscoverySkill 进行符号检索
   */
  private async intentAndRetrieval(
    prompt: string,
    projectId: string
  ): Promise<{ keywords: string[]; symbols: any[] }> {
    // 提取关键词
    const keywords = this.extractKeywords(prompt);
    logger.info(`🔍 提取关键词: ${keywords.join(', ')}`);

    // 使用 SymbolicDiscoverySkill 搜索符号
    const searchResults = await this.symbolicDiscovery.searchSymbols(
      keywords,
      projectId,
      { limit: 20 }
    );

    logger.info(`✅ 检索到 ${searchResults.length} 个相关符号`);

    // 转换为内部格式（保持兼容性）
    const symbols = searchResults.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      snippet: s.snippet,
      line: s.line,
      file: s.file,
      keywords: s.keywords,
      signature: s.signature,
    }));

    return { keywords, symbols };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 移除标点符号，转换为小写，分词
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !this.isKeyword(word));

    // 去重
    return Array.from(new Set(words));
  }

  /**
   * 判断是否是保留字
   */
  private isKeyword(word: string): boolean {
    const keywords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'as', 'are', 'was', 'were',
      'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
      'those', 'create', 'update', 'delete', 'add', 'remove', 'change', 'modify',
    ]);
    return keywords.has(word.toLowerCase());
  }

  /**
   * 阶段2: MultiFileCodeGen
   * 生成XML格式的代码变更
   */
  private async generateCode(
    prompt: string,
    keywords: string[],
    symbols: any[],
    currentFiles: Array<{ path: string; content: string }>,
    previousAttempt?: { fileChanges: FileChange[]; errors: string[] }
  ): Promise<string> {
    // 构建符号上下文（包含签名）
    const symbolContext = symbols.map(s => `
[${s.type.toUpperCase()}] ${s.name}
${s.signature || s.snippet}
文件: ${s.file}
关键词: ${(s.keywords || []).slice(0, 5).join(', ')}
`).join('\n');

    // 构建当前文件上下文（只显示前500字符）
    const filesContext = currentFiles.map(f => `
文件: ${f.path}
\`\`\`
${f.content.substring(0, 500)}${f.content.length > 500 ? '...' : ''}
\`\`\`
`).join('\n');

    // 构建修复上下文（如果有）
    const fixContext = previousAttempt 
      ? `\n\n**之前的修改（需要修复）:**\n${previousAttempt.fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}\n\n**错误信息:**\n${previousAttempt.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
      : '';

    const systemPrompt = `你是一个专业的前端代码生成专家。请根据用户需求生成代码变更。

**重要要求：**
1. 必须使用XML格式输出，严格按照以下格式
2. 支持在一个任务中同时修改多个关联文件（如 Component.tsx 和 Style.css）
3. 使用Search/Replace模式生成代码增量，不要重写整个文件
4. 使用 // ... existing code ... 标记需要保留的代码部分
5. 确保代码符合TypeScript/React最佳实践
6. 确保所有导入/导出正确
7. 确保类型定义完整

**输出格式（严格遵循）：**
\`\`\`xml
<plan>
  简述本次修改的逻辑步骤（1-3句话）
</plan>

<file_change path="src/components/MyComponent.tsx">
  <action>UPDATE</action>
  <code>
    // 完整代码或增量代码
    // 使用 // ... existing code ... 标记保留的部分
  </code>
</file_change>

<file_change path="src/styles/MyComponent.css">
  <action>CREATE</action>
  <code>
    /* CSS代码 */
  </code>
</file_change>
\`\`\`

**当前项目符号（参考）：**
${symbolContext || '无'}

**当前文件：**
${filesContext || '无'}
${fixContext}`;

    const userPrompt = `用户需求：${prompt}

请生成代码变更，确保：
1. 所有文件路径使用相对路径（相对于项目根目录）
2. 代码语法正确，无TypeScript错误
3. 导入/导出正确
4. 类型定义完整
5. 如果修改现有文件，使用增量更新模式`;

    const response = await this.client.chat.completions.create({
      model: 'glm-4-plus',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // 提取XML部分
    const xmlMatch = content.match(/```xml\n([\s\S]*?)\n```/) || 
                     content.match(/<plan>[\s\S]*?<\/file_change>/);
    
    if (xmlMatch) {
      return xmlMatch[1] || xmlMatch[0];
    }

    // 如果没有找到XML标记，尝试直接使用内容
    if (content.includes('<plan>') || content.includes('<file_change')) {
      return content;
    }

    throw new Error('未找到有效的XML格式输出');
  }

  /**
   * 解析XML文件变更
   */
  private parseXmlFileChanges(xml: string): { plan: string; fileChanges: FileChange[] } {
    const changes: FileChange[] = [];
    let plan = '';

    // 提取plan
    const planMatch = xml.match(/<plan>([\s\S]*?)<\/plan>/);
    if (planMatch) {
      plan = planMatch[1].trim();
    }

    // 使用正则表达式解析file_change
    const fileChangeRegex = /<file_change\s+path=["']([^"']+)["']>[\s\S]*?<action>([^<]+)<\/action>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/file_change>/g;
    
    let match;
    while ((match = fileChangeRegex.exec(xml)) !== null) {
      const [, path, action, code] = match;
      const normalizedAction = action.trim().toUpperCase() as 'CREATE' | 'UPDATE' | 'DELETE';
      
      changes.push({
        path: path.trim(),
        action: normalizedAction,
        code: code.trim(),
        isDiff: code.includes('// ... existing code ...') || code.includes('/* ... existing code ... */'),
      });
    }

    return { plan, fileChanges: changes };
  }

  /**
   * 构建修复提示
   */
  private buildFixPrompt(
    originalPrompt: string,
    errors: Array<{ file: string; line: number; column: number; message: string; code: string }>,
    fileChanges: FileChange[]
  ): string {
    const errorMessages = errors.map((e, i) => 
      `${i + 1}. ${e.file}:${e.line}:${e.column} - ${e.code}: ${e.message}`
    ).join('\n');

    return `${originalPrompt}

**需要修复的错误（tsc编译错误）：**
${errorMessages}

**当前文件变更：**
${fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}

请仔细分析错误信息，修复代码中的所有问题，确保：
1. 修复所有语法错误
2. 修复所有导入/导出错误
3. 修复所有类型错误
4. 确保代码可以编译通过（tsc --noEmit）`;
  }

  /**
   * 构建 WebContainer 兼容性修复提示
   */
  private buildCompatibilityFixPrompt(
    originalPrompt: string,
    compatibilityReport: { issues: Array<{ file: string; line?: number; message: string; suggestion: string; reason: string; fixAction: { type: string; oldValue: string; newValue: string; description: string } }>; fixInstructions: string },
    fileChanges: FileChange[]
  ): string {
    // 使用兼容性检查生成的修复指令
    return `${originalPrompt}

${compatibilityReport.fixInstructions}

**当前文件变更：**
${fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}

**重要：**
请严格按照上述修复建议修改代码，确保：
1. 所有需要重命名的文件都正确重命名
2. 所有导入语句都更新为新的文件名
3. 所有文件路径都是相对路径（不以 "/" 开头）
4. 修改后确保代码仍然可以编译通过`;
  }

  /**
   * 获取当前文件
   */
  private async getCurrentFiles(sessionId: string): Promise<Array<{ path: string; content: string }>> {
    const files = await this.fileManager.getFiles(sessionId);
    const filesWithContent = await Promise.all(
      files.map(async (f) => {
        const content = await this.fileManager.getFile(sessionId, f.path);
        return {
          path: f.path,
          content: content?.content || '',
        };
      })
    );
    return filesWithContent;
  }
}
