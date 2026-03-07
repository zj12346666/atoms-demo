/**
 * POST /api/images
 * 接收 base64 图片，存入 PostgreSQL files 表，返回图片访问 URL
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, ensureConnection } from '@/lib/db';
import { logger } from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
  try {
    const { sessionId, projectId, dataUrl, mimeType } = await req.json();

    if (!dataUrl || !sessionId) {
      return NextResponse.json({ error: 'dataUrl and sessionId are required' }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json({ error: '数据库不可用' }, { status: 503 });
    }

    await ensureConnection();

    // 解析 base64（去掉 data:image/...;base64, 前缀）
    const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const actualMime = base64Match ? base64Match[1] : (mimeType || 'image/png');
    const base64Data = base64Match ? base64Match[2] : dataUrl;
    const buffer = Buffer.from(base64Data, 'base64');

    const ext = actualMime.split('/')[1] || 'png';
    const imageId = uuidv4();
    const path = `chat-images/${imageId}.${ext}`;
    const name = `${imageId}.${ext}`;

    const file = await (prisma as any).file.create({
      data: {
        sessionId,
        projectId: projectId || null,
        path,
        name,
        type: 'binary',
        binaryData: buffer,
        mimeType: actualMime,
        size: buffer.byteLength,
      },
    });

    logger.info(`🖼️ 图片已存储: ${path} (${buffer.byteLength} bytes)`);

    return NextResponse.json({
      id: file.id,
      url: `/api/images/${file.id}`,
    });
  } catch (error: any) {
    logger.error('❌ 图片上传失败:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
