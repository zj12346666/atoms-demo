import { NextRequest, NextResponse } from 'next/server';
import { FrontendAgent } from '@/lib/frontend-agent';
import { FileManager } from '@/lib/file-manager';
import { logger } from '@/lib/logger';
import OpenAI from 'openai';

const fileManager = new FileManager();

export async function POST(req: NextRequest) {
  try {
    const { sessionId, errors, files } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      );
    }

    if (!errors || errors.length === 0) {
      return NextResponse.json(
        { success: false, error: 'errors are required' },
        { status: 400 }
      );
    }

    logger.info(`🔧 开始修复错误 (sessionId: ${sessionId})`);
    logger.info(`📋 错误数量: ${errors.length}`);
    
    // 获取当前文件内容
    const currentFiles = await fileManager.getFiles(sessionId);
    const filesWithContent = await Promise.all(
      currentFiles.map(async (file) => {
        const content = await fileManager.getFile(sessionId, file.path);
        return {
          path: file.path,
          content: content?.content || '',
        };
      })
    );

    // 构建错误报告
    const errorReport = errors.map((err: any) => {
      if (typeof err === 'string') {
        return err;
      }
      return `${err.message || err}\n${err.stack || ''}\n${err.file || ''}`;
    }).join('\n\n');

    // 构建修复提示
    const fixPrompt = `请修复以下代码错误。当前项目文件如下：

${filesWithContent.map(f => `文件: ${f.path}\n\`\`\`\n${f.content.substring(0, 500)}\n\`\`\`\n`).join('\n')}

错误信息：
${errorReport}

请分析错误原因并修复所有文件中的问题。确保：
1. 修复所有语法错误
2. 修复所有导入/导出错误
3. 修复所有类型错误
4. 确保代码可以正常运行

请返回修复后的完整文件内容，格式为 JSON：
{
  "files": [
    {
      "path": "文件路径",
      "content": "修复后的完整文件内容"
    }
  ]
}`;

    // 调用 LLM 进行修复
    const client = new OpenAI({
      apiKey: 'c7e235af6a364f07bdc5affc2c95e77c.tBJn3fOeeETiGBH0',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    });

    const response = await client.chat.completions.create({
      model: 'glm-4-plus',
      messages: [
        {
          role: 'system',
          content: '你是一个专业的前端代码修复专家。请仔细分析错误信息，修复代码中的所有问题，并返回修复后的完整文件内容。',
        },
        {
          role: 'user',
          content: fixPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content || '';
    
    // 解析修复后的文件
    let fixedFiles: Array<{ path: string; content: string }> = [];
    
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0];
        const parsed = JSON.parse(jsonStr);
        if (parsed.files && Array.isArray(parsed.files)) {
          fixedFiles = parsed.files;
        }
      }
    } catch (parseError) {
      logger.error('❌ 解析修复结果失败:', parseError);
      // 如果解析失败，尝试从文本中提取
      // 这里可以添加更智能的解析逻辑
    }

    if (fixedFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: '无法解析修复结果' },
        { status: 500 }
      );
    }

    // 保存修复后的文件
    for (const file of fixedFiles) {
      await fileManager.saveFile(sessionId, file.path, file.content);
      logger.info(`✅ 已保存修复后的文件: ${file.path}`);
    }

    logger.info(`✅ 错误修复完成，共修复 ${fixedFiles.length} 个文件`);

    return NextResponse.json({
      success: true,
      message: `已修复 ${fixedFiles.length} 个文件`,
      files: fixedFiles.map(f => f.path),
      fixedFiles: fixedFiles, // 返回完整的文件内容
    });
  } catch (error: any) {
    logger.error('❌ 错误修复失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '修复失败' },
      { status: 500 }
    );
  }
}
