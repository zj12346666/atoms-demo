/**
 * 🔍 WebContainer 兼容性检查 Skill
 * 职责：检查代码是否符合 WebContainer 文件系统要求，特别是文件名大小写规范
 * 
 * WebContainer 对文件名大小写敏感，全小写的 React 组件文件名会导致挂载失败
 * 例如：snakegame.tsx 应该改为 SnakeGame.tsx
 */

import { logger } from '../logger';

export interface CompatibilityIssue {
  file: string;
  line?: number;
  severity: 'high' | 'medium' | 'low';
  category: 'filename-case' | 'path-format' | 'import-reference' | 'other';
  message: string;
  suggestion: string;
  reason: string; // 为什么需要修改
  fixAction: {
    type: 'rename' | 'update-import' | 'update-content';
    oldValue: string;
    newValue: string;
    description: string;
  };
}

export interface CompatibilityReport {
  passed: boolean; // 是否通过检查
  issues: CompatibilityIssue[];
  summary: string;
  fixInstructions: string; // 结构化的修复指令，用于拼接到代码生成上下文
}

export class WebContainerCompatibilitySkill {
  /**
   * 检查代码是否符合 WebContainer 兼容性要求
   * 
   * @param stagedFiles 暂存的文件系统（从 MultiFileEngineeringSkill 获取）
   * @returns 兼容性检查报告
   */
  async checkCompatibility(
    stagedFiles: Map<string, string>
  ): Promise<CompatibilityReport> {
    try {
      logger.info(`🔍 开始检查 WebContainer 兼容性 (${stagedFiles.size} 个文件)...`);

      const issues: CompatibilityIssue[] = [];

      // 1. 检查文件名大小写问题
      for (const [filePath, content] of stagedFiles.entries()) {
        const pathParts = filePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        
        // 检查是否是全小写的 React 组件文件（.tsx, .ts, .jsx, .js）
        if (fileName.match(/^[a-z]+\.(tsx?|jsx?)$/)) {
          const fileNameWithoutExt = fileName.replace(/\.[^.]*$/, '');
          const fileExt = fileName.match(/\.[^.]*$/)?.[0] || '';
          const pascalCaseName = this.toPascalCase(fileNameWithoutExt);
          
          if (pascalCaseName !== fileNameWithoutExt) {
            const newFileName = pascalCaseName + fileExt;
            const newPath = pathParts.slice(0, -1).concat([newFileName]).join('/');
            
            issues.push({
              file: filePath,
              severity: 'high',
              category: 'filename-case',
              message: `文件名 "${fileName}" 是全小写，不符合 WebContainer 要求`,
              suggestion: `将文件名改为 "${newFileName}" (PascalCase)`,
              reason: 'WebContainer 文件系统对大小写敏感，全小写的 React 组件文件名会导致挂载失败（EIO: invalid file name）。React 组件文件应使用 PascalCase 命名（如 SnakeGame.tsx）。',
              fixAction: {
                type: 'rename',
                oldValue: filePath,
                newValue: newPath,
                description: `重命名文件: ${filePath} -> ${newPath}`,
              },
            });
          }
        }

        // 2. 检查导入语句中的文件名大小写问题
        const importIssues = this.checkImportStatements(filePath, content, stagedFiles);
        issues.push(...importIssues);
      }

      // 3. 检查路径格式问题
      for (const filePath of stagedFiles.keys()) {
        if (filePath.startsWith('/')) {
          issues.push({
            file: filePath,
            severity: 'medium',
            category: 'path-format',
            message: `文件路径不应以 "/" 开头`,
            suggestion: `移除路径开头的 "/"`,
            reason: 'WebContainer 文件系统要求路径是相对路径，不能以 "/" 开头',
            fixAction: {
              type: 'update-content',
              oldValue: filePath,
              newValue: filePath.slice(1),
              description: `修正路径格式: ${filePath} -> ${filePath.slice(1)}`,
            },
          });
        }
      }

      const passed = issues.length === 0;
      const summary = passed
        ? `✅ WebContainer 兼容性检查通过：${stagedFiles.size} 个文件符合要求`
        : `❌ WebContainer 兼容性检查失败：发现 ${issues.length} 个问题`;

      // 生成结构化的修复指令
      const fixInstructions = this.generateFixInstructions(issues);

      logger.info(summary);
      if (issues.length > 0) {
        logger.warn(`发现的问题：${issues.map(i => `${i.file}: ${i.message}`).join('; ')}`);
      }

      return {
        passed,
        issues,
        summary,
        fixInstructions,
      };
    } catch (error: any) {
      logger.error('❌ WebContainer 兼容性检查失败:', error);
      return {
        passed: false,
        issues: [{
          file: 'unknown',
          severity: 'high',
          category: 'other',
          message: `检查过程出错: ${error.message}`,
          suggestion: '请检查代码生成流程',
          reason: '兼容性检查过程中发生错误',
          fixAction: {
            type: 'update-content',
            oldValue: '',
            newValue: '',
            description: '检查流程错误',
          },
        }],
        summary: `❌ 兼容性检查失败: ${error.message}`,
        fixInstructions: '',
      };
    }
  }

  /**
   * 检查导入语句中的文件名大小写问题
   */
  private checkImportStatements(
    filePath: string,
    content: string,
    allFiles: Map<string, string>
  ): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];
    const lines = content.split('\n');

    // 匹配导入语句
    const importPatterns = [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g,
      /require\(['"]([^'"]+)['"]\)/g,
    ];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      
      for (const pattern of importPatterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const importPath = match[1];
          
          // 检查导入路径是否指向全小写的文件
          if (importPath.includes('./') || importPath.startsWith('../')) {
            // 解析导入路径
            const pathParts = importPath.split('/');
            const importedFileName = pathParts[pathParts.length - 1];
            
            // 检查是否是全小写的文件名
            if (importedFileName.match(/^[a-z]+\.(tsx?|jsx?)$/)) {
              const fileNameWithoutExt = importedFileName.replace(/\.[^.]*$/, '');
              const fileExt = importedFileName.match(/\.[^.]*$/)?.[0] || '';
              const pascalCaseName = this.toPascalCase(fileNameWithoutExt);
              
              if (pascalCaseName !== fileNameWithoutExt) {
                const newFileName = pascalCaseName + fileExt;
                const newImportPath = pathParts.slice(0, -1).concat([newFileName]).join('/');
                
                // 检查目标文件是否存在（大小写不敏感）
                const targetFile = Array.from(allFiles.keys()).find(f => 
                  f.toLowerCase().endsWith(importedFileName.toLowerCase())
                );
                
                if (targetFile) {
                  issues.push({
                    file: filePath,
                    line: lineIndex + 1,
                    severity: 'high',
                    category: 'import-reference',
                    message: `导入语句引用了全小写文件名 "${importedFileName}"`,
                    suggestion: `将导入路径改为 "${newImportPath}"`,
                    reason: '导入语句中的文件名大小写必须与实际文件名一致。如果实际文件是 PascalCase（如 SnakeGame.tsx），导入语句也必须使用相同的大小写，否则 WebContainer 挂载时会失败。',
                    fixAction: {
                      type: 'update-import',
                      oldValue: importPath,
                      newValue: newImportPath,
                      description: `更新第 ${lineIndex + 1} 行的导入语句: ${importPath} -> ${newImportPath}`,
                    },
                  });
                }
              }
            }
          }
        }
      }
    }

    return issues;
  }

  /**
   * 将全小写文件名转换为 PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * 生成结构化的修复指令，用于拼接到代码生成上下文
   */
  private generateFixInstructions(issues: CompatibilityIssue[]): string {
    if (issues.length === 0) {
      return '';
    }

    const instructions = issues.map((issue, index) => {
      const location = issue.line 
        ? `文件: ${issue.file}, 第 ${issue.line} 行`
        : `文件: ${issue.file}`;
      
      return `
**问题 ${index + 1}: ${issue.category}**
- 位置: ${location}
- 问题: ${issue.message}
- 原因: ${issue.reason}
- 修复建议: ${issue.suggestion}
- 修复操作: ${issue.fixAction.description}
  - 类型: ${issue.fixAction.type}
  - 旧值: ${issue.fixAction.oldValue}
  - 新值: ${issue.fixAction.newValue}
`;
    }).join('\n');

    return `
**WebContainer 兼容性检查失败，需要修复以下问题：**

${instructions}

**重要修复要求：**
1. 所有 React 组件文件（.tsx, .ts, .jsx, .js）必须使用 PascalCase 命名（如 SnakeGame.tsx，不能是 snakegame.tsx）
2. 所有导入语句中的文件名大小写必须与实际文件名完全一致
3. 所有文件路径必须是相对路径，不能以 "/" 开头
4. 如果文件被重命名，必须同时更新所有引用该文件的导入语句

请根据上述修复建议，修改代码以确保 WebContainer 能正常挂载。
`;
  }
}
