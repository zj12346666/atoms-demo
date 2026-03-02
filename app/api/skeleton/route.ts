// API: 初始化和查询项目骨架

import { NextRequest, NextResponse } from 'next/server';
import { FrontendContextStorage } from '@/lib/frontend-context-storage';
import { logger } from '@/lib/logger';
import path from 'path';

const storage = new FrontendContextStorage();

// POST /api/skeleton - 初始化项目骨架
export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: 'projectId is required' },
        { status: 400 }
      );
    }

    logger.info('🚀 开始扫描项目骨架...');
    
    // 扫描当前项目（实际应该是用户上传的项目）
    const projectRoot = path.join(process.cwd());
    
    const skeleton = await storage.initializeProjectSkeleton(projectId, projectRoot);

    return NextResponse.json({
      success: true,
      skeleton: {
        componentsCount: skeleton.components.length,
        propsCount: skeleton.propsSchemas.length,
        assetsCount: skeleton.assets.length,
        components: skeleton.components.slice(0, 10), // 只返回前10个作为预览
        propsSchemas: skeleton.propsSchemas.slice(0, 5),
      },
      message: '项目骨架初始化成功',
    });
  } catch (error: any) {
    logger.error('❌ Skeleton init error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// GET /api/skeleton?projectId=xxx&query=Button - 查询组件
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    const query = searchParams.get('query');

    if (!projectId || !query) {
      return NextResponse.json(
        { success: false, error: 'projectId and query are required' },
        { status: 400 }
      );
    }

    logger.info('🔍 查询组件上下文:', query);

    const context = await storage.queryComponentContext(projectId, query, {
      includeParent: true,
      includeChildren: true,
    });

    return NextResponse.json({
      success: true,
      context,
      query,
    });
  } catch (error: any) {
    logger.error('❌ Query error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
