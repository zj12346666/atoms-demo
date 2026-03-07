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
import { templateCompleter } from './webcontainer/template-completer';
import type { ArchInfoForReview } from './skills';

// ============================================================
// 前端架构规范
// ============================================================

export type ArchitectureType = 'react-ts' | 'vue3-ts' | 'vanilla-ts' | 'html-only';

interface ArchitectureSpec {
  label: string;
  description: string;
  entryFile: string;
  requiredFiles: string[];
  /** 在该架构下不应出现的文件扩展名 */
  forbiddenExtensions: string[];
  codeGenInstructions: string;
}

const ARCHITECTURE_SPECS: Record<ArchitectureType, ArchitectureSpec> = {
  'react-ts': {
    label: 'React + TypeScript + Vite',
    description: 'React 18 函数组件 + TypeScript + Vite 构建工具，使用 Hooks 管理状态',
    entryFile: 'src/main.tsx',
    requiredFiles: ['src/main.tsx', 'src/App.tsx'],
    forbiddenExtensions: ['.vue'],
    codeGenInstructions: `
- 使用 React 18 函数组件 + TypeScript
- 文件扩展名：组件文件用 .tsx，工具/Hook 文件用 .ts
- 入口文件：src/main.tsx（渲染 <App /> 到 #root）
- 根组件：src/App.tsx
- 组件 Props 使用 TypeScript interface 定义
- 使用 Hooks（useState、useEffect、useCallback、useMemo）管理状态和副作用
- 使用 Tailwind CSS 做样式（或 CSS Module）
- import React from 'react' 必须出现在所有 .tsx 文件顶部`,
  },
  'vue3-ts': {
    label: 'Vue 3 + TypeScript + Vite',
    description: 'Vue 3 Composition API（setup 语法糖）+ TypeScript + Vite 构建工具',
    entryFile: 'src/main.ts',
    requiredFiles: ['src/main.ts', 'src/App.vue'],
    forbiddenExtensions: ['.tsx', '.jsx'],
    codeGenInstructions: `
- 使用 Vue 3 Composition API，优先使用 <script setup lang="ts"> 语法糖
- 文件扩展名：Vue 单文件组件用 .vue，工具文件用 .ts
- 入口文件：src/main.ts（createApp(App).mount('#app')）
- 根组件：src/App.vue
- SFC 结构：<script setup lang="ts"> + <template> + <style scoped>
- 使用 defineProps<{}>() / defineEmits<{}>() 定义组件接口
- 响应式数据使用 ref() / reactive()，计算属性用 computed()`,
  },
  'vanilla-ts': {
    label: 'Vanilla TypeScript + Vite',
    description: '原生 TypeScript + Vite 构建工具，不依赖 UI 框架，直接操作 DOM',
    entryFile: 'src/main.ts',
    requiredFiles: ['src/main.ts'],
    forbiddenExtensions: ['.vue', '.tsx', '.jsx'],
    codeGenInstructions: `
- 使用原生 TypeScript（不依赖 React / Vue 等 UI 框架）
- 文件扩展名统一用 .ts
- 入口文件：src/main.ts
- 直接操作 DOM API（document.querySelector、addEventListener 等）
- 样式放在 src/style.css 中，在 main.ts 里 import './style.css'`,
  },
  'html-only': {
    label: '纯 HTML/CSS/JS',
    description: '不使用构建工具，直接用 CDN 引入依赖，适合简单页面或原型',
    entryFile: 'index.html',
    requiredFiles: ['index.html'],
    forbiddenExtensions: ['.vue', '.tsx'],
    codeGenInstructions: `
- 使用纯 HTML + CSS + JavaScript（ES6+）
- 不使用 npm/Vite，通过 CDN（如 unpkg、jsDelivr）引入第三方库
- 所有代码集中在 index.html 或通过相对路径 <script src="./main.js"> 引入
- 可使用 Tailwind CSS CDN：<script src="https://cdn.tailwindcss.com"></script>
- 不需要 package.json / vite.config.ts`,
  },
};

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
      // 确保数据库连接
      try {
        const isConnected = await ensureConnection();
        if (!isConnected) {
          logger.warn('⚠️ 数据库连接不可用，但继续执行（可能使用降级模式）');
        }
      } catch (error) {
        logger.warn('⚠️ 数据库连接检查失败，但继续执行:', error);
      }

      // ========== 阶段0: 检测工作模式（首次生成 vs 后续修改）==========
      const currentFiles = await this.getCurrentFiles(sessionId);
      const isModificationMode = currentFiles.length > 0;
      
      if (isModificationMode) {
        onProgress({
          state: 'intent_retrieval',
          message: '🔄 检测到已有代码，进入修改模式...',
          progress: 5,
          details: `发现 ${currentFiles.length} 个现有文件，将进行增量修改`,
        });

        // 分析修改意图
        try {
          const modificationIntent = await this.analyzeModificationIntent(prompt, currentFiles);
          onProgress({
            state: 'intent_retrieval',
            message: `📝 修改意图：${modificationIntent.intent}`,
            progress: 8,
            details: `目标文件：${modificationIntent.targetFiles.length > 0 ? modificationIntent.targetFiles.join(', ') : '待确定'}`,
          });
        } catch (error) {
          logger.warn('修改意图分析失败，继续执行:', error);
          // 继续执行，不影响主流程
        }
      } else {
        onProgress({
          state: 'intent_retrieval',
          message: '🆕 首次生成模式，创建新项目...',
          progress: 5,
          details: '将从头开始生成代码',
        });
      }

      // ========== 阶段0.5: 架构检测 ==========
      const detectedArch = this.detectArchitecture(prompt, currentFiles);
      onProgress({
        state: 'intent_retrieval',
        message: `🏗️ 选定前端架构: ${detectedArch.spec.label}`,
        progress: 7,
        details: detectedArch.spec.description,
      });
      logger.info(`🏗️ 检测到架构: ${detectedArch.type} (${detectedArch.spec.label})`);

      // ========== 阶段1: Intent & Retrieval (使用 SymbolicDiscoverySkill) ==========
      onProgress({
        state: 'intent_retrieval',
        message: '🧠 分析需求，查找相关代码...',
        progress: 10,
        details: '正在提取关键词并检索项目中的符号',
      });

      const keywords = this.extractKeywords(prompt);
      onProgress({
        state: 'intent_retrieval',
        message: `🔑 提取到 ${keywords.length} 个关键词`,
        progress: 12,
        details: `关键词: ${keywords.slice(0, 8).join('、')}`,
      });

      onProgress({
        state: 'intent_retrieval',
        message: '🔍 在代码库中搜索相关符号...',
        progress: 14,
        details: '检索组件、函数、类型定义等',
      });

      const { symbols } = await this.intentAndRetrievalWithKeywords(keywords, projectId);

      onProgress({
        state: 'intent_retrieval',
        message: `✅ 找到 ${symbols.length} 个相关组件和函数`,
        progress: 20,
        details: symbols.length > 0
          ? `相关符号: ${symbols.slice(0, 5).map((s: any) => s.name).join('、')}${symbols.length > 5 ? ` 等 ${symbols.length} 个` : ''}`
          : '未找到匹配符号，将基于需求从头生成',
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

        // 注入项目上下文（package.json, tsconfig.json 等）
        let enhancedPrompt = prompt;
        try {
          if (agentPromptInjector && typeof agentPromptInjector.enhancePrompt === 'function') {
            enhancedPrompt = await agentPromptInjector.enhancePrompt(sessionId, prompt);
          } else {
            logger.warn('⚠️ agentPromptInjector 不可用，使用原始 prompt');
          }
        } catch (error) {
          logger.warn('⚠️ 增强 prompt 失败，使用原始 prompt:', error);
          enhancedPrompt = prompt;
        }
        
        onProgress({
          state: 'code_generation',
          message: '🤖 正在调用 AI 模型生成代码...',
          progress: fixAttempts > 0 ? 33 + fixAttempts * 5 : 32,
          details: `使用 glm-4-plus 模型，${isModificationMode ? '增量修改模式' : '全新生成模式'}，架构: ${detectedArch.spec.label}`,
        });

        // 生成代码（XML格式，带流式进度）
        const generatedXml = await this.generateCode(
          enhancedPrompt,
          keywords,
          symbols,
          currentFiles,
          isModificationMode,
          fixAttempts > 0 ? { fileChanges, errors: [] } : undefined,
          (tokenCount) => {
            onProgress({
              state: 'code_generation',
              message: `✍️ AI 正在生成代码... (已生成约 ${tokenCount} 个字符)`,
              progress: fixAttempts > 0 ? 35 + fixAttempts * 5 : 35,
              details: '等待 AI 完成代码生成',
            });
          },
          detectedArch
        );

        onProgress({
          state: 'code_generation',
          message: '📦 解析 AI 生成的代码结构...',
          progress: 42,
          details: '从 XML 格式中提取文件变更',
        });

        // 解析XML
        const parsed = this.parseXmlFileChanges(generatedXml);
        plan = parsed.plan || '';
        fileChanges = parsed.fileChanges;

        if (fileChanges.length === 0) {
          throw new Error('未生成任何文件变更');
        }

        onProgress({
          state: 'code_generation',
          message: `📝 已解析 ${fileChanges.length} 个文件的变更`,
          progress: 45,
          details: fileChanges.map(fc => `  ${fc.action === 'CREATE' ? '🆕' : fc.action === 'DELETE' ? '🗑️' : '✏️'} ${fc.path}`).join('\n'),
        });

        if (plan) {
          onProgress({
            state: 'code_generation',
            message: '📋 实现方案',
            progress: 47,
            details: plan,
          });
        }

        onProgress({
          state: 'code_generation',
          message: `⏳ 暂存 ${fileChanges.length} 个文件变更...`,
          progress: 48,
          details: '写入临时缓冲区，等待验证通过后持久化',
        });

        // 使用 MultiFileEngineeringSkill 暂存代码变更
        const stageResult = await this.multiFileEngineering.stageCodeChanges(
          fileChanges,
          sessionId
        );

        if (!stageResult.success) {
          throw new Error(`暂存代码变更失败: ${stageResult.errors?.join(', ')}`);
        }

        onProgress({
          state: 'code_generation',
          message: `✅ ${fileChanges.length} 个文件已暂存`,
          progress: 50,
          details: '代码暂存完成，准备进行验证',
        });

        // 阶段3: Validation Loop (使用 SandboxValidationSkill)
        const stagedFiles = this.multiFileEngineering.getAllStagedFiles();
        const fileCount = stagedFiles.size;

        onProgress({
          state: 'validation',
          message: '🔬 检查代码语法和类型...',
          progress: 55 + fixAttempts * 5,
          details: `对 ${fileCount} 个文件运行 TypeScript 编译检查`,
        });

        onProgress({
          state: 'validation',
          message: '⚙️ 运行 tsc --noEmit 类型检查...',
          progress: 58 + fixAttempts * 5,
          details: `检查文件: ${Array.from(stagedFiles.keys()).slice(0, 4).join('、')}${fileCount > 4 ? ` 等 ${fileCount} 个` : ''}`,
        });

        const validationReport = await this.sandboxValidation.validateInSandbox(stagedFiles);

        if (validationReport.success) {
          // 验证通过，检查 WebContainer 兼容性
          const warningCount = validationReport.warnings?.length || 0;
          onProgress({
            state: 'validation',
            message: `✅ TypeScript 类型检查通过${warningCount > 0 ? `，${warningCount} 个警告` : ''}`,
            progress: 65,
            details: warningCount > 0
              ? `警告: ${validationReport.warnings?.slice(0, 2).map((w: any) => w.message).join('; ')}`
              : '无类型错误，无语法错误',
          });

          onProgress({
            state: 'validation',
            message: '🌐 检查 WebContainer 兼容性...',
            progress: 67,
            details: '检查文件名大小写、路径格式、特殊字符等',
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
            message: '✅ 所有检查通过！',
            progress: 70,
            details: `类型检查 ✓  兼容性检查 ✓  路径格式 ✓  文件名规范 ✓`,
          });
          break;
        }

        // 验证失败，准备修复
        const errorCount = validationReport.errors.length;
        onProgress({
          state: 'validation',
          message: `❌ 发现 ${errorCount} 个类型/语法错误`,
          progress: 62,
          details: validationReport.errors.slice(0, 3).map((e: any) => `  • ${e.file}:${e.line} - ${e.message}`).join('\n'),
        });

        onProgress({
          state: 'fixing',
          message: `🔧 准备自动修复... (第 ${fixAttempts + 1}/${this.maxFixAttempts} 次尝试)`,
          progress: 64,
          details: '将错误信息反馈给 AI 进行修复',
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

        onProgress({
          state: 'reviewing',
          message: reviewAttempts > 0
            ? `🤖 AI 重新审查代码中... (第 ${reviewAttempts + 1} 次)`
            : '🤖 AI 审查代码质量中...',
          progress: 73 + reviewAttempts * 5,
          details: '正在评估代码逻辑、可维护性、最佳实践...',
        });

        const archInfoForReview: ArchInfoForReview = {
          type: detectedArch.type,
          label: detectedArch.spec.label,
          description: detectedArch.spec.description,
          requiredFiles: detectedArch.spec.requiredFiles,
          forbiddenExtensions: detectedArch.spec.forbiddenExtensions,
          codeGenInstructions: detectedArch.spec.codeGenInstructions,
        };

        const reviewReport = await this.codeReview.reviewCode(
          stagedFiles,
          prompt,
          plan,
          archInfoForReview
        );

        // 输出文件结构检查结果
        if (reviewReport.fileStructureIssues.length > 0) {
          onProgress({
            state: 'reviewing',
            message: `⚠️ 文件结构检查: ${reviewReport.fileStructureIssues.length} 个问题`,
            progress: 72,
            details: reviewReport.fileStructureIssues.map(i => `  [${i.severity}] ${i.message}`).join('\n'),
          });
        } else {
          onProgress({
            state: 'reviewing',
            message: `✅ 文件结构检查通过 (架构: ${detectedArch.spec.label})`,
            progress: 72,
            details: `必需文件均已生成: ${detectedArch.spec.requiredFiles.join(', ')}`,
          });
        }

        if (!reviewReport.needsRevision) {
          // 审查通过
          onProgress({
            state: 'reviewing',
            message: `✅ 代码审查通过 (质量评分: ${reviewReport.score}/100)`,
            progress: 78,
            details: reviewReport.summary,
          });
          needsReviewRevision = false;
          break;
        }

        // 审查发现问题，需要修改
        const structureIssueCount = reviewReport.fileStructureIssues.length;
        const issueCount = reviewReport.issues.length + structureIssueCount;
        onProgress({
          state: 'reviewing',
          message: `⚠️ 发现 ${issueCount} 个问题 (${structureIssueCount} 个结构问题, ${reviewReport.issues.length} 个质量问题)，准备修改...`,
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

      // ✅ 用 TemplateCompleter 补全缺失的关键文件（package.json、vite.config.ts 等）
      // 确保这些文件存在于数据库，避免热更新系统请求时出现 404
      const flatFiles: Record<string, string> = {};
      for (const [path, content] of stagedFiles.entries()) {
        flatFiles[path] = content;
      }
      const completed = templateCompleter.complete(flatFiles);
      for (const [filePath, fileContent] of Object.entries(completed)) {
        if (!flatFiles[filePath]) {
          stagedFiles.set(filePath, fileContent);
          logger.info(`  ✅ [TemplateCompleter] 补全文件: ${filePath}`);
        }
      }

      const stagedFileList = Array.from(stagedFiles.keys());
      
      onProgress({
        state: 'persistence',
        message: `💾 持久化 ${stagedFiles.size} 个文件到数据库...`,
        progress: 80,
        details: stagedFileList.slice(0, 5).map(f => `  📄 ${f}`).join('\n') + (stagedFileList.length > 5 ? `\n  ... 等 ${stagedFileList.length} 个文件` : ''),
      });

      const { persistence, reindex } = await this.persistence.commitAndRefresh(
        sessionId,
        projectId,
        stagedFiles
      );

      if (!persistence.success) {
        throw new Error(`持久化失败: ${persistence.errors?.join(', ')}`);
      }

      onProgress({
        state: 'persistence',
        message: `✅ ${stagedFiles.size} 个文件已保存`,
        progress: 85,
        details: `数据库写入成功，共 ${stagedFiles.size} 个文件`,
      });

      // ========== 阶段6: Reindex (已在 commitAndRefresh 中完成) ==========
      onProgress({
        state: 'reindexing',
        message: `🔄 更新代码符号索引...`,
        progress: 90,
        details: `已索引 ${reindex.updatedSymbols} 个符号（函数、组件、类型等），方便后续智能检索`,
      });

      // ========== 阶段7: 同步前端视图 (使用 EnvironmentSyncSkill) ==========
      onProgress({
        state: 'completed',
        message: '📡 通知编辑器刷新文件树...',
        progress: 95,
        details: `推送 ${stagedFileList.length} 个文件更新事件`,
      });

      await this.environmentSync.syncWebIdeView(
        sessionId,
        stagedFileList,
        'UPDATE'
      );

      // 清空暂存区
      this.multiFileEngineering.clearStaged();

      // ========== 完成 ==========
      const createCount = fileChanges.filter(fc => fc.action === 'CREATE').length;
      const updateCount = fileChanges.filter(fc => fc.action === 'UPDATE').length;
      const deleteCount = fileChanges.filter(fc => fc.action === 'DELETE').length;

      onProgress({
        state: 'completed',
        message: '🎉 生成完成！',
        progress: 100,
        details: [
          `共处理 ${fileChanges.length} 个文件`,
          createCount > 0 ? `  🆕 新建 ${createCount} 个` : '',
          updateCount > 0 ? `  ✏️  修改 ${updateCount} 个` : '',
          deleteCount > 0 ? `  🗑️  删除 ${deleteCount} 个` : '',
          plan ? `\n📋 ${plan.split('\n')[0]}` : '',
        ].filter(Boolean).join('\n'),
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
   * 阶段1: Intent & Retrieval（内部复用版，接受已提取的关键词）
   */
  private async intentAndRetrievalWithKeywords(
    keywords: string[],
    projectId: string
  ): Promise<{ keywords: string[]; symbols: any[] }> {
    logger.info(`🔍 使用关键词检索符号: ${keywords.join(', ')}`);

    let searchResults: any[] = [];
    try {
      if (!this.symbolicDiscovery || typeof this.symbolicDiscovery.searchSymbols !== 'function') {
        logger.warn('⚠️ symbolicDiscovery 不可用，返回空结果');
        return { keywords, symbols: [] };
      }

      searchResults = await this.symbolicDiscovery.searchSymbols(
        keywords,
        projectId,
        { limit: 20 }
      );

      if (!Array.isArray(searchResults)) {
        searchResults = [];
      }
    } catch (error: any) {
      logger.error('❌ 符号检索失败:', error);
      searchResults = [];
    }

    logger.info(`✅ 检索到 ${searchResults.length} 个相关符号`);

    const symbols = searchResults.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      snippet: s.snippet,
      line: s.line,
      file: s.file,
      keywords: s.keywords || [],
      signature: s.signature,
    }));

    return { keywords, symbols };
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
    let searchResults: any[] = [];
    try {
      if (!this.symbolicDiscovery) {
        logger.warn('⚠️ symbolicDiscovery 未初始化，返回空结果');
        return { keywords, symbols: [] };
      }

      if (typeof this.symbolicDiscovery.searchSymbols !== 'function') {
        logger.warn('⚠️ searchSymbols 方法不可用，返回空结果');
        return { keywords, symbols: [] };
      }

      searchResults = await this.symbolicDiscovery.searchSymbols(
        keywords,
        projectId,
        { limit: 20 }
      );

      // 确保返回的是数组
      if (!Array.isArray(searchResults)) {
        logger.warn('⚠️ searchSymbols 返回的不是数组，使用空数组');
        searchResults = [];
      }
    } catch (error: any) {
      logger.error('❌ 符号检索失败:', error);
      searchResults = [];
    }

    logger.info(`✅ 检索到 ${searchResults.length} 个相关符号`);

    // 转换为内部格式（保持兼容性）
    const symbols = searchResults.map(s => ({
      id: s.id,
      name: s.name,
      type: s.type,
      snippet: s.snippet,
      line: s.line,
      file: s.file,
      keywords: s.keywords || [],
      signature: s.signature,
    }));

    return { keywords, symbols };
  }

  /**
   * 根据用户 prompt 和现有文件检测前端架构
   * 优先级：现有文件扩展名 > prompt 关键词 > 默认(react-ts)
   */
  private detectArchitecture(
    prompt: string,
    currentFiles: Array<{ path: string; content: string }>
  ): { type: ArchitectureType; spec: ArchitectureSpec } {
    // 1. 优先根据现有文件扩展名判断（修改模式下）
    if (currentFiles.length > 0) {
      const paths = currentFiles.map(f => f.path);
      if (paths.some(p => p.endsWith('.vue'))) {
        return { type: 'vue3-ts', spec: ARCHITECTURE_SPECS['vue3-ts'] };
      }
      if (paths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'))) {
        return { type: 'react-ts', spec: ARCHITECTURE_SPECS['react-ts'] };
      }
      // 仅有 .html/.css/.js（无 ts/tsx/vue）→ html-only
      const hasOnlyHtmlFamily = paths.every(
        p => p.endsWith('.html') || p.endsWith('.css') || p.endsWith('.js') ||
             p.endsWith('.json') || p.endsWith('.md')
      );
      if (hasOnlyHtmlFamily) {
        return { type: 'html-only', spec: ARCHITECTURE_SPECS['html-only'] };
      }
      if (paths.some(p => p.endsWith('.ts') && !p.endsWith('.d.ts'))) {
        return { type: 'vanilla-ts', spec: ARCHITECTURE_SPECS['vanilla-ts'] };
      }
    }

    // 2. 根据 prompt 关键词检测
    const lp = prompt.toLowerCase();
    if (/\bvue\b|vue\s*3|vuejs/.test(lp)) {
      return { type: 'vue3-ts', spec: ARCHITECTURE_SPECS['vue3-ts'] };
    }
    if (/\breact\b|nextjs|next\.js/.test(lp)) {
      return { type: 'react-ts', spec: ARCHITECTURE_SPECS['react-ts'] };
    }
    if (/原生\s*js|纯\s*html|pure\s*html|html\s*only|vanilla\s*js|不.*框架/.test(lp)) {
      return { type: 'html-only', spec: ARCHITECTURE_SPECS['html-only'] };
    }
    if (/\bvanilla\b|原生\s*ts|vanilla\s*typescript/.test(lp)) {
      return { type: 'vanilla-ts', spec: ARCHITECTURE_SPECS['vanilla-ts'] };
    }

    // 3. 默认：React + TypeScript（最常见需求）
    return { type: 'react-ts', spec: ARCHITECTURE_SPECS['react-ts'] };
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
   * 分析修改意图
   */
  private async analyzeModificationIntent(
    prompt: string,
    currentFiles: Array<{ path: string; content: string }>
  ): Promise<{
    intent: 'modify' | 'add' | 'delete' | 'refactor' | 'fix';
    targetFiles: string[];
    confidence: number;
  }> {
    // 提取文件列表（用于上下文）
    const fileList = currentFiles.map(f => f.path).join(', ');

    const analysisPrompt = `分析用户的修改意图。用户说："${prompt}"

当前项目有以下文件：
${fileList}

请判断用户的意图类型：
1. modify - 修改现有文件的功能或样式
2. add - 添加新功能、新文件或新组件
3. delete - 删除功能或文件
4. refactor - 重构代码结构
5. fix - 修复bug或错误

请以JSON格式返回：
{
  "intent": "modify|add|delete|refactor|fix",
  "targetFiles": ["可能的文件路径列表"],
  "confidence": 0.8
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: '你是一个代码分析专家，能够准确理解用户的修改意图。' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content || '';
      
      // 尝试解析JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          intent: result.intent || 'modify',
          targetFiles: result.targetFiles || [],
          confidence: result.confidence || 0.5,
        };
      }

      // 如果无法解析JSON，使用简单的关键词匹配
      const lowerPrompt = prompt.toLowerCase();
      if (lowerPrompt.includes('添加') || lowerPrompt.includes('新增') || lowerPrompt.includes('add') || lowerPrompt.includes('create')) {
        return { intent: 'add', targetFiles: [], confidence: 0.7 };
      }
      if (lowerPrompt.includes('删除') || lowerPrompt.includes('移除') || lowerPrompt.includes('delete') || lowerPrompt.includes('remove')) {
        return { intent: 'delete', targetFiles: [], confidence: 0.7 };
      }
      if (lowerPrompt.includes('重构') || lowerPrompt.includes('优化') || lowerPrompt.includes('refactor') || lowerPrompt.includes('optimize')) {
        return { intent: 'refactor', targetFiles: [], confidence: 0.7 };
      }
      if (lowerPrompt.includes('修复') || lowerPrompt.includes('bug') || lowerPrompt.includes('fix') || lowerPrompt.includes('error')) {
        return { intent: 'fix', targetFiles: [], confidence: 0.7 };
      }

      return { intent: 'modify', targetFiles: [], confidence: 0.6 };
    } catch (error) {
      logger.warn('修改意图分析失败，使用默认值:', error);
      return { intent: 'modify', targetFiles: [], confidence: 0.5 };
    }
  }

  /**
   * 阶段2: MultiFileCodeGen
   * 生成XML格式的代码变更（支持流式进度回调）
   */
  private async generateCode(
    prompt: string,
    keywords: string[],
    symbols: any[],
    currentFiles: Array<{ path: string; content: string }>,
    isModificationMode: boolean = false,
    previousAttempt?: { fileChanges: FileChange[]; errors: string[] },
    onToken?: (charCount: number) => void,
    arch?: { type: ArchitectureType; spec: ArchitectureSpec }
  ): Promise<string> {
    // 构建符号上下文（包含签名）
    const symbolContext = symbols.map(s => `
[${s.type.toUpperCase()}] ${s.name}
${s.signature || s.snippet}
文件: ${s.file}
关键词: ${(s.keywords || []).slice(0, 5).join(', ')}
`).join('\n');

    // 构建当前文件上下文
    // 在修改模式下，提供完整文件内容；首次生成时只显示前500字符
    const filesContext = isModificationMode
      ? currentFiles.map(f => `
文件: ${f.path}
\`\`\`
${f.content}
\`\`\`
`).join('\n')
      : currentFiles.map(f => `
文件: ${f.path}
\`\`\`
${f.content.substring(0, 500)}${f.content.length > 500 ? '...' : ''}
\`\`\`
`).join('\n');

    // 构建修复上下文（如果有）
    const fixContext = previousAttempt 
      ? `\n\n**之前的修改（需要修复）:**\n${previousAttempt.fileChanges.map(fc => `- ${fc.path} (${fc.action})`).join('\n')}\n\n**错误信息:**\n${previousAttempt.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
      : '';

    // 修改模式下的特殊提示
    const modificationModeContext = isModificationMode
      ? `\n\n**⚠️ 重要：这是修改模式！**
- 当前项目已有 ${currentFiles.length} 个文件
- 请**只修改**与用户需求相关的文件，不要重新生成所有文件
- 使用增量更新模式（Search/Replace），保留现有代码结构
- 如果用户没有明确要求，不要删除或大幅修改无关文件
- 确保修改后的代码与现有代码风格一致
- 检查并更新相关的导入/导出语句`
      : '';

    // 构建架构约束提示
    const archConstraints = arch
      ? `
**【前端架构：${arch.spec.label}】**
${arch.spec.description}

**架构规范（必须严格遵守）：**
${arch.spec.codeGenInstructions}

**必需文件（必须生成）：**
${arch.spec.requiredFiles.map(f => `- ${f}`).join('\n')}
`
      : `
**技术栈：** React 18 + TypeScript + Vite（默认）
`;

    const systemPrompt = `你是一个专业的前端代码生成专家。请根据用户需求生成代码变更。
${modificationModeContext}
${archConstraints}
**重要要求：**
1. 必须使用XML格式输出，严格按照以下格式
2. 支持在一个任务中同时修改多个关联文件（如 Component.tsx 和 Style.css）
3. 使用Search/Replace模式生成代码增量，不要重写整个文件
4. 使用 // ... existing code ... 标记需要保留的代码部分
5. 确保代码符合上述架构规范和最佳实践
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

    const userPrompt = isModificationMode
      ? `用户需求：${prompt}

**当前项目文件列表：**
${currentFiles.map(f => `- ${f.path}`).join('\n')}

请根据用户需求，**只修改相关的文件**，确保：
1. 只修改与需求直接相关的文件，不要修改无关文件
2. 使用增量更新模式（Search/Replace），保留现有代码结构
3. 所有文件路径使用相对路径（相对于项目根目录）
4. 代码语法正确，无TypeScript错误
5. 导入/导出正确，确保与现有代码兼容
6. 类型定义完整
7. 保持代码风格与现有代码一致
8. 如果添加新功能，确保与现有代码集成良好`
      : `用户需求：${prompt}

请生成代码变更，确保：
1. 所有文件路径使用相对路径（相对于项目根目录）
2. 代码语法正确，无TypeScript错误
3. 导入/导出正确
4. 类型定义完整
5. 如果修改现有文件，使用增量更新模式`;

    let content = '';

    if (onToken) {
      // 流式模式：边生成边回调进度
      const stream = await this.client.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        stream: true,
      });

      let lastCallbackAt = 0;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        content += delta;
        // 每 200 个字符触发一次回调，避免过于频繁
        if (content.length - lastCallbackAt >= 200) {
          onToken(content.length);
          lastCallbackAt = content.length;
        }
      }
    } else {
      // 非流式模式（兜底）
      const response = await this.client.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
      });
      content = response.choices[0]?.message?.content || '';
    }
    
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
    try {
      const files = await this.fileManager.getFiles(sessionId);
      if (!files || !Array.isArray(files)) {
        return [];
      }
      const filesWithContent = await Promise.all(
        files.map(async (f) => {
          try {
            const content = await this.fileManager.getFile(sessionId, f.path);
            return {
              path: f.path,
              content: content?.content || '',
            };
          } catch (error) {
            logger.warn(`获取文件内容失败: ${f.path}`, error);
            return {
              path: f.path,
              content: '',
            };
          }
        })
      );
      return filesWithContent;
    } catch (error) {
      logger.warn('获取当前文件列表失败，返回空数组:', error);
      return [];
    }
  }
}
