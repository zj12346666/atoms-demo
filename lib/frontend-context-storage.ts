// 前端特化的上下文存储 - 使用 PostgreSQL + 内存缓存

import { ContextCache } from './context-cache';
import { SkeletonGenerator, ProjectSkeleton } from './skeleton-generator';
import { prisma } from './db';

// 内存缓存骨架（降级方案）
const skeletonCache = new Map<string, { skeleton: ProjectSkeleton; expiresAt: number }>();

export class FrontendContextStorage {
  private skeletonGen: SkeletonGenerator;
  private cache: ContextCache;

  constructor() {
    this.skeletonGen = new SkeletonGenerator();
    this.cache = new ContextCache();
  }

  // 初始化项目骨架（首次扫描）
  async initializeProjectSkeleton(
    projectId: string,
    projectRoot: string
  ): Promise<ProjectSkeleton> {
    console.log('🚀 初始化项目骨架...');

    // 1. 扫描项目
    const skeleton = await this.skeletonGen.scanProject(projectRoot);

    // 2. 缓存到内存（热数据）
    skeletonCache.set(projectId, {
      skeleton,
      expiresAt: Date.now() + 7200 * 1000, // 2小时过期
    });
    console.log('⚡ 骨架已缓存到内存');

    // 3. 存储到 PostgreSQL（持久化）
    if (prisma && 'componentRegistry' in prisma) {
      try {
        // 清理旧数据
        await (prisma as any).componentRegistry.deleteMany({
          where: { projectId },
        });

        // 批量插入组件注册表
        if (skeleton.components.length > 0) {
          await (prisma as any).componentRegistry.createMany({
            data: skeleton.components.map(comp => ({
              projectId,
              name: comp.name,
              filePath: comp.filePath,
              exportType: comp.exportType,
              description: comp.description,
            })),
          });
        }

        // 批量插入 Props Schema
        if (skeleton.propsSchemas.length > 0) {
          await (prisma as any).propsSchema.createMany({
            data: skeleton.propsSchemas.map(schema => ({
              projectId,
              componentName: schema.componentName,
              filePath: schema.filePath,
              props: JSON.stringify(schema.props),
              tsInterface: schema.tsInterface,
            })),
          });
        }

        console.log('💾 骨架已持久化到 PostgreSQL');
      } catch (dbError: any) {
        console.warn('⚠️ PostgreSQL 存储失败（非致命）:', dbError.message);
      }
    }

    return skeleton;
  }

  // 获取项目骨架（优先从缓存）
  async getProjectSkeleton(projectId: string): Promise<ProjectSkeleton | null> {
    // 1. 尝试从内存缓存获取
    const cached = skeletonCache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
      console.log('✅ 命中内存骨架缓存');
      return cached.skeleton;
    }

    // 2. 从 PostgreSQL 获取（暂不实现，返回 null）
    console.log('⚠️ 骨架缓存未命中，请重新初始化');
    return null;
  }

  // 查询组件上下文（视觉与语义映射）
  async queryComponentContext(
    projectId: string,
    query: string, // 如："登录按钮"、"Sidebar"
    options?: {
      includeParent?: boolean;
      includeChildren?: boolean;
    }
  ): Promise<string> {
    const skeleton = await this.getProjectSkeleton(projectId);
    if (!skeleton) {
      return '项目骨架未初始化，请先扫描项目。';
    }

    // 语义匹配：从查询中提取关键词
    const keywords = query.toLowerCase().split(/\s+/);
    
    // 查找匹配的组件
    const matchedComponents = skeleton.components.filter(comp => {
      const compName = comp.name.toLowerCase();
      const filePath = comp.filePath.toLowerCase();
      return keywords.some(kw => compName.includes(kw) || filePath.includes(kw));
    });

    if (matchedComponents.length === 0) {
      return `未找到与"${query}"相关的组件。`;
    }

    // 构建上下文
    let context = `# 检索结果：${query}\n\n`;
    context += `找到 ${matchedComponents.length} 个相关组件：\n\n`;

    matchedComponents.forEach(comp => {
      const componentContext = this.skeletonGen.buildComponentContext(
        comp.name,
        skeleton,
        options
      );
      context += `---\n${componentContext}\n`;
    });

    // 缓存查询结果
    await this.cache.cacheQueryResult(query, context);

    return context;
  }

  // 获取组件的完整上下文（用于代码生成）
  async getComponentContextBundle(
    projectId: string,
    componentName: string
  ): Promise<{
    component: string;
    props: string;
    children: string[];
    hooks: string[];
    parents: string[];
  }> {
    const skeleton = await this.getProjectSkeleton(projectId);
    if (!skeleton) {
      throw new Error('项目骨架未初始化');
    }

    const component = skeleton.components.find(c => c.name === componentName);
    if (!component) {
      throw new Error(`组件 ${componentName} 不存在`);
    }

    const propsSchema = this.skeletonGen.findPropsSchema(componentName, skeleton);
    const dep = skeleton.dependencyGraph.get(componentName);

    return {
      component: component.filePath,
      props: propsSchema?.tsInterface || '',
      children: dep?.imports || [],
      hooks: dep?.hooks || [],
      parents: dep?.importedBy || [],
    };
  }

  // 刷新组件索引（热更新后）
  async refreshComponent(
    projectId: string,
    componentFilePath: string,
    sourceCode: string
  ): Promise<void> {
    console.log('🔄 刷新组件索引:', componentFilePath);

    // TODO: 更新 Redis 和 PostgreSQL 中的特定组件信息
    // 这需要部分更新骨架，而不是完全重建
  }
}
