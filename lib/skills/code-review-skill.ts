/**
 * 🔍 代码审查 Skill (Code Review)
 * 职责：在代码验证通过后，进行代码质量审查，提供改进建议
 */

import OpenAI from 'openai';
import { logger } from '../logger';

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'high' | 'medium' | 'low';
  category: 'logic' | 'performance' | 'maintainability' | 'best-practice' | 'security' | 'other';
  message: string;
  suggestion?: string;
}

export interface ReviewReport {
  needsRevision: boolean; // 是否需要修改
  score: number; // 代码质量评分 0-100
  issues: ReviewIssue[];
  summary: string;
  suggestions: string[]; // 总体改进建议
}

export class CodeReviewSkill {
  private client: OpenAI;

  constructor(apiKey: string, baseURL: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  /**
   * 审查代码质量
   * 对暂存的代码进行审查，检查代码逻辑、最佳实践、可维护性等
   * 
   * @param stagedFiles 暂存的文件系统（从 MultiFileEngineeringSkill 获取）
   * @param originalPrompt 原始用户需求
   * @param plan 代码生成计划
   * @returns 审查报告
   */
  async reviewCode(
    stagedFiles: Map<string, string>,
    originalPrompt: string,
    plan?: string
  ): Promise<ReviewReport> {
    try {
      logger.info(`🔍 开始审查 ${stagedFiles.size} 个文件...`);

      // 构建文件内容上下文（限制长度）
      const filesContext = Array.from(stagedFiles.entries())
        .map(([path, content]) => {
          // 限制每个文件最多显示2000字符
          const preview = content.length > 2000 
            ? content.substring(0, 2000) + '\n... (文件过长，已截断)'
            : content;
          return `文件: ${path}\n\`\`\`\n${preview}\n\`\`\``;
        })
        .join('\n\n');

      const systemPrompt = `你是一个专业的代码审查专家。请对生成的代码进行质量审查。

**审查重点：**
1. **逻辑正确性**：代码是否实现了用户需求，逻辑是否正确
2. **最佳实践**：是否符合 TypeScript/React 最佳实践
3. **代码质量**：可读性、可维护性、性能
4. **安全性**：是否有潜在的安全问题
5. **完整性**：是否完整实现了需求，是否有遗漏

**输出格式（严格使用JSON）：**
\`\`\`json
{
  "needsRevision": true/false,
  "score": 85,
  "issues": [
    {
      "file": "src/components/Button.tsx",
      "line": 15,
      "severity": "medium",
      "category": "best-practice",
      "message": "建议使用 useCallback 优化事件处理函数",
      "suggestion": "使用 useCallback 包装 handleClick 函数以避免不必要的重渲染"
    }
  ],
  "summary": "代码整体质量良好，但有几处可以改进",
  "suggestions": [
    "建议添加错误边界处理",
    "建议优化组件性能"
  ]
}
\`\`\`

**重要：**
- needsRevision: 如果发现严重问题（high severity）或逻辑错误，设为 true
- score: 代码质量评分 0-100
- issues: 具体问题列表，按严重程度排序
- 只报告真正需要改进的问题，不要过于严格`;

      const userPrompt = `用户需求：${originalPrompt}

${plan ? `实现计划：${plan}\n\n` : ''}生成的代码：

${filesContext}

请进行代码审查，重点关注：
1. 代码是否完整实现了用户需求
2. 是否有逻辑错误或潜在bug
3. 是否符合最佳实践
4. 是否有性能或安全问题`;

      const response = await this.client.chat.completions.create({
        model: 'glm-4-plus',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content || '';
      
      // 提取JSON部分
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || 
                        content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('未找到有效的JSON格式输出');
      }

      const reviewData = JSON.parse(jsonMatch[1] || jsonMatch[0]);

      const report: ReviewReport = {
        needsRevision: reviewData.needsRevision || false,
        score: reviewData.score || 0,
        issues: reviewData.issues || [],
        summary: reviewData.summary || '审查完成',
        suggestions: reviewData.suggestions || [],
      };

      logger.info(`✅ 代码审查完成: ${report.summary} (评分: ${report.score})`);
      if (report.needsRevision) {
        logger.warn(`⚠️ 需要修改: 发现 ${report.issues.length} 个问题`);
      }

      return report;
    } catch (error: any) {
      logger.error('❌ 代码审查失败:', error);
      return {
        needsRevision: false,
        score: 0,
        issues: [],
        summary: `审查过程出错: ${error.message}`,
        suggestions: [],
      };
    }
  }

  /**
   * 根据审查意见修改代码
   * 将代码和修改意见一起给LLM，让LLM进行修改
   * 
   * @param stagedFiles 暂存的文件系统
   * @param originalPrompt 原始用户需求
   * @param reviewReport 审查报告
   * @returns 修改后的代码（XML格式）
   */
  async reviseCodeBasedOnReview(
    stagedFiles: Map<string, string>,
    originalPrompt: string,
    reviewReport: ReviewReport
  ): Promise<string> {
    try {
      logger.info(`🔧 根据审查意见修改代码...`);

      // 构建文件内容上下文
      const filesContext = Array.from(stagedFiles.entries())
        .map(([path, content]) => {
          return `文件: ${path}\n\`\`\`\n${content}\n\`\`\``;
        })
        .join('\n\n');

      // 构建审查问题列表
      const issuesList = reviewReport.issues
        .map((issue, i) => {
          const location = issue.line 
            ? `${issue.file}:${issue.line}` 
            : issue.file;
          return `${i + 1}. [${issue.severity.toUpperCase()}] ${location}
   类别: ${issue.category}
   问题: ${issue.message}
   ${issue.suggestion ? `建议: ${issue.suggestion}` : ''}`;
        })
        .join('\n\n');

      const systemPrompt = `你是一个专业的代码修改专家。请根据审查意见修改代码。

**重要要求：**
1. 必须使用XML格式输出，严格按照以下格式
2. 只修改需要修改的文件，其他文件保持不变
3. 使用Search/Replace模式生成代码增量，不要重写整个文件
4. 使用 // ... existing code ... 标记需要保留的代码部分
5. 确保修改后的代码符合审查建议
6. 保持代码风格一致

**输出格式（严格遵循）：**
\`\`\`xml
<plan>
  简述本次修改的逻辑步骤（1-3句话）
</plan>

<file_change path="src/components/MyComponent.tsx">
  <action>UPDATE</action>
  <code>
    // 修改后的代码或增量代码
    // 使用 // ... existing code ... 标记保留的部分
  </code>
</file_change>
\`\`\`

**审查意见：**
${reviewReport.summary}

**具体问题：**
${issuesList}

**总体建议：**
${reviewReport.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;

      const userPrompt = `原始需求：${originalPrompt}

**当前代码：**
${filesContext}

请根据上述审查意见修改代码，确保：
1. 解决所有 high 和 medium 严重程度的问题
2. 遵循审查建议
3. 保持代码功能不变，只进行改进
4. 确保修改后的代码可以正常编译和运行`;

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
    } catch (error: any) {
      logger.error('❌ 根据审查意见修改代码失败:', error);
      throw error;
    }
  }
}
