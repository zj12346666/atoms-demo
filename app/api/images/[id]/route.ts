/**
 * GET /api/images/[id]
 * 从 PostgreSQL 读取图片并返回
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma, ensureConnection } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!prisma) {
    return new NextResponse('数据库不可用', { status: 503 });
  }

  try {
    await ensureConnection();

    const file = await (prisma as any).file.findUnique({
      where: { id },
      select: { binaryData: true, mimeType: true, name: true },
    });

    if (!file || !file.binaryData) {
      return new NextResponse('图片不存在', { status: 404 });
    }

    return new NextResponse(file.binaryData, {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="${file.name}"`,
      },
    });
  } catch (error: any) {
    return new NextResponse('读取图片失败', { status: 500 });
  }
}
