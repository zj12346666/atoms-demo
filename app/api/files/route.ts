// 文件管理 API

import { NextRequest, NextResponse } from 'next/server';
import { FileManager } from '@/lib/file-manager';
import { SessionManager } from '@/lib/session-manager';
import { logger } from '@/lib/logger';

const fileManager = new FileManager();
const sessionManager = new SessionManager();

// GET /api/files?sessionId=xxx&userId=xxx - 获取文件列表或文件树
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');
    const userId = searchParams.get('userId');
    const path = searchParams.get('path');
    const tree = searchParams.get('tree') === 'true';

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'sessionId is required' },
        { status: 400 }
      );
    }

    // 验证 userId 和 session 的所有权
    if (userId) {
      const isOwner = await sessionManager.verifySessionOwnership(sessionId, userId);
      if (!isOwner) {
        logger.warn(`⚠️ 用户 ${userId} 尝试访问不属于自己的 session ${sessionId}`);
        return NextResponse.json(
          { success: false, error: 'Access denied: Session does not belong to this user' },
          { status: 403 }
        );
      }
    } else {
      logger.warn('⚠️ userId 未提供，跳过所有权验证（仅用于开发调试）');
    }

    if (tree) {
      // 返回文件树结构
      const fileTree = await fileManager.getFileTree(sessionId);
      logger.info(`📁 获取文件树 (session: ${sessionId}):`, Object.keys(fileTree).length, '个文件/文件夹');
      return NextResponse.json({
        success: true,
        tree: fileTree,
      });
    } else if (path) {
      // 返回单个文件内容
      const file = await fileManager.getFile(sessionId, path);
      if (!file) {
        return NextResponse.json(
          { success: false, error: 'File not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        file: {
          id: file.id,
          path: file.path,
          name: file.name,
          type: file.type,
          content: file.content,
          mimeType: file.mimeType,
          size: file.size,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        },
      });
    } else {
      // 返回文件列表（不包含内容，按需加载）
      const files = await fileManager.getFiles(sessionId);
      return NextResponse.json({
        success: true,
        files: files.map(f => ({
          id: f.id,
          path: f.path,
          name: f.name,
          type: f.type,
          size: f.size,
          mimeType: f.mimeType,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        })),
      });
    }
  } catch (error: any) {
    logger.error('❌ Get files error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
