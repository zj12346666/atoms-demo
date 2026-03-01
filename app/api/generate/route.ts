import { NextRequest, NextResponse } from 'next/server';
import { CodeGenerationAgent } from '@/lib/agent';

export async function POST(req: NextRequest) {
  try {
    const { prompt, projectId } = await req.json();

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: 'Prompt is required' },
        { status: 400 }
      );
    }

    console.log('🚀 开始 Plan & Execute 模式生成代码...');
    console.log('📝 用户输入:', prompt);
    
    // 初始化 Agent
    const agent = new CodeGenerationAgent(
      'c7e235af6a364f07bdc5affc2c95e77c.tBJn3fOeeETiGBH0',
      'https://open.bigmodel.cn/api/paas/v4'
    );
    
    // 执行 Plan & Execute
    const code = await agent.generateCode(prompt, (progress) => {
      console.log(`📊 进度: [${progress.completed + 1}/${progress.total}] ${progress.currentTask}`);
    });
    
    console.log('✅ 代码生成成功（Plan & Execute 模式）');
    console.log('📊 HTML 长度:', code.html?.length || 0);
    console.log('📊 CSS 长度:', code.css?.length || 0);
    console.log('📊 JS 长度:', code.js?.length || 0);
    
    // 返回结果
    return NextResponse.json({
      success: true,
      code,
      projectId,
      mode: 'plan-and-execute', // 标识使用的模式
    });
  } catch (error: any) {
    console.error('❌ Generate error:', error);
    console.error('错误堆栈:', error.stack);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || 'Code generation failed',
        details: error.toString(),
      },
      { status: 500 }
    );
  }
}
