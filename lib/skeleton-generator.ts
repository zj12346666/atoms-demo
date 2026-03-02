// Project Skeleton Generator - 扫描项目并建立完整索引

import * as fs from 'fs';
import * as path from 'path';
import { FrontendIndexer, ComponentRegistry, PropsSchema, ComponentDependency, AssetMap } from './frontend-indexer';

export interface ProjectSkeleton {
  components: ComponentRegistry[];
  propsSchemas: PropsSchema[];
  dependencies: ComponentDependency[];
  assets: AssetMap[];
  dependencyGraph: Map<string, ComponentDependency>;
}

export class SkeletonGenerator {
  private indexer: FrontendIndexer;
  private scanPatterns = {
    components: /\.(tsx|jsx)$/,
    styles: /\.(css|scss|sass|less)$/,
    assets: /\.(svg|png|jpg|jpeg|gif|webp)$/,
  };

  constructor() {
    this.indexer = new FrontendIndexer();
  }

  // 扫描整个项目目录
  async scanProject(projectRoot: string, options?: {
    includeDirs?: string[];  // 只扫描这些目录（如 ['src', 'components']）
    excludeDirs?: string[];  // 排除这些目录（如 ['node_modules', '.next']）
  }): Promise<ProjectSkeleton> {
    const {
      includeDirs = ['src', 'app', 'components', 'lib'],
      excludeDirs = ['node_modules', '.next', 'dist', 'build', '.git'],
    } = options || {};

    console.log('🔍 开始扫描项目骨架...');
    console.log('📂 根目录:', projectRoot);

    const components: ComponentRegistry[] = [];
    const propsSchemas: PropsSchema[] = [];
    const dependencies: ComponentDependency[] = [];
    const assets: AssetMap[] = [];

    // 扫描所有符合条件的文件
    for (const dir of includeDirs) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath)) {
        await this.scanDirectory(fullPath, excludeDirs, {
          components,
          propsSchemas,
          dependencies,
          assets,
        });
      }
    }

    // 构建依赖图
    const dependencyGraph = this.indexer.buildDependencyGraph(dependencies);

    console.log('✅ 扫描完成');
    console.log(`📊 统计: ${components.length} 个组件, ${propsSchemas.length} 个 Props 定义, ${assets.length} 个资源`);

    return {
      components,
      propsSchemas,
      dependencies,
      assets,
      dependencyGraph,
    };
  }

  // 递归扫描目录
  private async scanDirectory(
    dirPath: string,
    excludeDirs: string[],
    collectors: {
      components: ComponentRegistry[];
      propsSchemas: PropsSchema[];
      dependencies: ComponentDependency[];
      assets: AssetMap[];
    }
  ) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // 跳过排除目录
      if (entry.isDirectory()) {
        if (excludeDirs.includes(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await this.scanDirectory(fullPath, excludeDirs, collectors);
        continue;
      }

      // 处理文件
      if (entry.isFile()) {
        await this.processFile(fullPath, collectors);
      }
    }
  }

  // 处理单个文件
  private async processFile(
    filePath: string,
    collectors: {
      components: ComponentRegistry[];
      propsSchemas: PropsSchema[];
      dependencies: ComponentDependency[];
      assets: AssetMap[];
    }
  ) {
    const ext = path.extname(filePath);

    // 处理组件文件 (.tsx, .jsx)
    if (this.scanPatterns.components.test(ext)) {
      try {
        const sourceCode = fs.readFileSync(filePath, 'utf-8');
        const result = this.indexer.extractComponentInfo(sourceCode, filePath);

        if (result.registry) {
          collectors.components.push(result.registry);
        }
        if (result.propsSchema) {
          collectors.propsSchemas.push(result.propsSchema);
        }
        if (result.dependencies) {
          collectors.dependencies.push(result.dependencies);
        }

        // 提取资源引用
        const fileAssets = this.indexer.extractAssets(sourceCode, filePath);
        collectors.assets.push(...fileAssets);
      } catch (error) {
        console.warn(`⚠️ 解析失败: ${filePath}`, error);
      }
    }

    // 处理样式文件 (.css, .scss)
    if (this.scanPatterns.styles.test(ext)) {
      try {
        const sourceCode = fs.readFileSync(filePath, 'utf-8');
        const styleAssets = this.indexer.extractAssets(sourceCode, filePath);
        collectors.assets.push(...styleAssets);
      } catch (error) {
        console.warn(`⚠️ 解析样式失败: ${filePath}`, error);
      }
    }

    // 处理资源文件 (.svg, .png, etc.)
    if (this.scanPatterns.assets.test(ext)) {
      collectors.assets.push({
        type: ext === '.svg' ? 'svg' : 'image',
        name: path.basename(filePath, ext),
        path: filePath,
      });
    }
  }

  // 生成可缓存的 JSON 格式
  serializeSkeleton(skeleton: ProjectSkeleton): string {
    return JSON.stringify({
      components: skeleton.components,
      propsSchemas: skeleton.propsSchemas,
      dependencies: skeleton.dependencies,
      assets: skeleton.assets,
      dependencyGraph: Array.from(skeleton.dependencyGraph.entries()),
    }, null, 2);
  }

  // 从 JSON 恢复骨架
  deserializeSkeleton(json: string): ProjectSkeleton {
    const data = JSON.parse(json);
    return {
      components: data.components,
      propsSchemas: data.propsSchemas,
      dependencies: data.dependencies,
      assets: data.assets,
      dependencyGraph: new Map(data.dependencyGraph),
    };
  }

  // 查询组件 Props
  findPropsSchema(componentName: string, skeleton: ProjectSkeleton): PropsSchema | undefined {
    return skeleton.propsSchemas.find(
      schema => schema.componentName === componentName
    );
  }

  // 查询组件依赖（向上或向下）
  getComponentDependencies(
    componentName: string,
    skeleton: ProjectSkeleton,
    direction: 'up' | 'down' = 'down'
  ): string[] {
    const dep = skeleton.dependencyGraph.get(componentName);
    if (!dep) return [];
    
    return direction === 'down' ? dep.imports : dep.importedBy;
  }

  // 智能上下文拼接（前端特化版）
  buildComponentContext(
    componentName: string,
    skeleton: ProjectSkeleton,
    options?: {
      includeParent?: boolean;   // 包含父组件
      includeChildren?: boolean; // 包含子组件
      includeProps?: boolean;    // 包含 Props 定义
      includeHooks?: boolean;    // 包含 Hooks 定义
    }
  ): string {
    const {
      includeParent = true,
      includeChildren = true,
      includeProps = true,
      includeHooks = true,
    } = options || {};

    let context = `# Component Context: ${componentName}\n\n`;

    // 1. 组件基本信息
    const component = skeleton.components.find(c => c.name === componentName);
    if (component) {
      context += `## Component Info\n`;
      context += `- **File**: ${component.filePath}\n`;
      context += `- **Export**: ${component.exportType}\n`;
      if (component.description) {
        context += `- **Description**: ${component.description}\n`;
      }
      context += '\n';
    }

    // 2. Props Schema
    if (includeProps) {
      const propsSchema = this.findPropsSchema(componentName, skeleton);
      if (propsSchema) {
        context += `## Props Definition\n\`\`\`typescript\n${propsSchema.tsInterface}\n\`\`\`\n\n`;
        context += `### Props Details\n`;
        propsSchema.props.forEach(prop => {
          context += `- **${prop.name}**: \`${prop.type}\` ${prop.required ? '(required)' : '(optional)'}\n`;
          if (prop.description) {
            context += `  - ${prop.description}\n`;
          }
        });
        context += '\n';
      }
    }

    // 3. 依赖关系
    const dep = skeleton.dependencyGraph.get(componentName);
    if (dep) {
      if (includeChildren && dep.imports.length > 0) {
        context += `## Child Components (Imports)\n`;
        dep.imports.forEach(child => {
          const childProps = this.findPropsSchema(child, skeleton);
          if (childProps) {
            context += `- **${child}**: ${childProps.props.map(p => p.name).join(', ')}\n`;
          } else {
            context += `- **${child}**\n`;
          }
        });
        context += '\n';
      }

      if (includeParent && dep.importedBy.length > 0) {
        context += `## Parent Components (Used By)\n`;
        dep.importedBy.forEach(parent => {
          context += `- **${parent}**\n`;
        });
        context += '\n';
      }

      if (includeHooks && dep.hooks.length > 0) {
        context += `## Hooks Used\n`;
        dep.hooks.forEach(hook => {
          context += `- \`${hook}\`\n`;
        });
        context += '\n';
      }
    }

    return context;
  }
}
