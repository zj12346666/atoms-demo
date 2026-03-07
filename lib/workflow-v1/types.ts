/**
 * AI Coding Agent Runtime Workflow V1 - 类型定义
 */

// ==================== 1. IntentAnalyzer ====================

export interface IntentAnalyzerInput {
  userPrompt: string;
  projectContext?: {
    fileTree?: string[];
    currentFile?: string;
  };
}

export interface IntentAnalyzerOutput {
  targetFilePath: string;
  confidence: number;
  reasoning?: string;
}

export interface IIntentAnalyzer {
  analyze(input: IntentAnalyzerInput): Promise<IntentAnalyzerOutput>;
}

// ==================== 2. ContextBuilder ====================

export interface ContextBuilderInput {
  filePath: string;
  fileContent: string;
  userPrompt: string;
  projectContext?: {
    fileTree?: string[];
    relatedFiles?: Array<{ path: string; content: string }>;
  };
}

export interface ContextBuilderOutput {
  llmPrompt: string;
  metadata?: {
    filePath: string;
    lineCount: number;
    language: string;
  };
}

export interface IContextBuilder {
  build(input: ContextBuilderInput): Promise<ContextBuilderOutput>;
}

// ==================== 3. CodeGenerator ====================

export interface CodeGeneratorInput {
  llmPrompt: string;
  modelConfig?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface CodeGeneratorOutput {
  generatedCode: string;
  metadata?: {
    model: string;
    tokensUsed?: number;
  };
}

export interface ICodeGenerator {
  generate(input: CodeGeneratorInput): Promise<CodeGeneratorOutput>;
}

// ==================== 4. ASTValidator ====================

export interface SyntaxError {
  message: string;
  line: number;
  column: number;
  code: string;
  severity: 'error' | 'warning';
}

export interface ASTValidatorInput {
  code: string;
  filePath: string;
  language?: 'typescript' | 'javascript';
}

export interface ASTValidatorOutput {
  isValid: boolean;
  errors: SyntaxError[];
  warnings?: SyntaxError[];
}

export interface IASTValidator {
  validate(input: ASTValidatorInput): Promise<ASTValidatorOutput>;
}

// ==================== 5. FileWriter ====================

export interface FileWriterInput {
  filePath: string;
  content: string;
  encoding?: 'utf-8' | 'utf8';
}

export interface FileWriterOutput {
  success: boolean;
  error?: string;
  bytesWritten?: number;
}

export interface IFileWriter {
  write(input: FileWriterInput): Promise<FileWriterOutput>;
}

// ==================== 6. RuntimeExecutor ====================

export interface RuntimeError {
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  type: 'syntax' | 'runtime' | 'type' | 'build' | 'unknown';
}

export interface RuntimeLog {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

export interface RuntimeExecutorInput {
  projectPath: string;
  command?: string;
  timeout?: number;
}

export interface RuntimeExecutorOutput {
  success: boolean;
  logs: RuntimeLog[];
  errors: RuntimeError[];
  exitCode?: number;
  executionTime?: number;
}

export interface IRuntimeExecutor {
  execute(input: RuntimeExecutorInput): Promise<RuntimeExecutorOutput>;
}

// ==================== 7. ErrorContextBuilder ====================

export interface ErrorContextBuilderInput {
  error: RuntimeError | SyntaxError;
  filePath: string;
  fileContent: string;
  originalPrompt?: string;
  executionLogs?: RuntimeLog[];
}

export interface ErrorContextBuilderOutput {
  fixPrompt: string;
  errorAnalysis?: {
    errorType: string;
    possibleCauses: string[];
    suggestedFix?: string;
  };
}

export interface IErrorContextBuilder {
  build(input: ErrorContextBuilderInput): Promise<ErrorContextBuilderOutput>;
}

// ==================== 8. Workflow Orchestrator (单文件修改版) ====================

export interface WorkflowStep {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
  timestamp: number;
}

export interface WorkflowInput {
  userPrompt: string;
  projectPath: string;
  maxRetries?: number;
}

export interface WorkflowOutput {
  success: boolean;
  finalFilePath?: string;
  finalCode?: string;
  steps: WorkflowStep[];
  totalRetries: number;
  executionTime: number;
}

export interface IWorkflowOrchestrator {
  run(input: WorkflowInput): Promise<WorkflowOutput>;
}

// ==================== 9. RuntimePreprocessor ====================

/**
 * LLM 生成的扁平文件结构
 * key: 文件路径（如 "src/App.tsx"）
 * value: 文件内容
 */
export type FlatFileStructure = Record<string, string>;

export interface RuntimePreprocessorInput {
  /** LLM 生成的扁平文件结构 */
  files: FlatFileStructure;
}

export interface RuntimePreprocessorOutput {
  /** 预处理后的文件结构 */
  files: FlatFileStructure;
  /** 应用的修复列表 */
  fixes: string[];
  /** 检测到的项目类型 */
  projectType: 'react' | 'vue' | 'vanilla';
}

export interface IRuntimePreprocessor {
  preprocess(input: RuntimePreprocessorInput): Promise<RuntimePreprocessorOutput>;
}

// ==================== 10. Build Error & Monitor ====================

export interface BuildError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  type: 'syntax' | 'type' | 'build' | 'runtime' | 'unknown';
  raw?: string;
}

export interface BuildOutput {
  success: boolean;
  errors: BuildError[];
  logs: string[];
  exitCode?: number;
}

// ==================== 11. Pipeline (全项目生成工作流) ====================

export type PipelineStepStatus = 'pending' | 'running' | 'success' | 'error' | 'retrying';

export interface PipelineStep {
  name: string;
  status: PipelineStepStatus;
  startTime?: number;
  endTime?: number;
  error?: string;
  details?: unknown;
}

export interface PipelineInput {
  /** 用户需求描述 */
  userPrompt: string;
  /** 会话 ID（用于 WebContainer 缓存） */
  sessionId?: string;
  /** 最大自动修复次数（默认 3） */
  maxRetries?: number;
  /** 进度回调 */
  onProgress?: (step: PipelineStep, allSteps: PipelineStep[]) => void;
  /** LLM 模型配置 */
  modelConfig?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export interface PipelineOutput {
  success: boolean;
  /** WebContainer 预览 URL */
  previewUrl?: string;
  /** 最终文件结构 */
  files: FlatFileStructure;
  /** 流水线各步骤状态 */
  steps: PipelineStep[];
  /** 实际执行的修复次数 */
  totalRetries: number;
  /** 总执行时间（ms） */
  executionTime: number;
  /** 失败时的错误信息 */
  error?: string;
}

export interface IWorkflowPipeline {
  run(input: PipelineInput): Promise<PipelineOutput>;
}
