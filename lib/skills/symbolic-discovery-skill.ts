/**
 * 🔍 符号导航与检索 Skill (Symbolic Discovery)
 * 职责：解决"上下文拼装"问题。Agent 不看全量代码，只看它需要的"定义"。
 */

import { prisma, ensureConnection } from '../db';
import { logger } from '../logger';
import { SymbolExtractor } from '../symbol-extractor';
import { FileManager } from '../file-manager';

export interface SymbolSearchResult {
  id: string;
  name: string;
  type: string;
  file: string;
  line: number;
  signature?: string;
  snippet: string;
  keywords: string[];
}

export interface ComponentProps {
  componentName: string;
  file: string;
  propsInterface?: string;
  propsDetails: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }>;
}

export class SymbolicDiscoverySkill {
  private symbolExtractor: SymbolExtractor;
  private fileManager: FileManager;

  constructor() {
    this.symbolExtractor = new SymbolExtractor();
    this.fileManager = new FileManager();
  }

  /**
   * 搜索符号
   * 在 PG 的 symbols 表中进行关键词匹配（Like 或 Full-text search）
   * 
   * @param keywords 关键词数组
   * @param projectId 项目ID
   * @param options 可选参数
   * @returns 命中符号的名称、文件路径、代码行号、以及函数签名/接口定义
   */
  async searchSymbols(
    keywords: string[],
    projectId: string,
    options?: {
      limit?: number;
      type?: string; // 'function' | 'variable' | 'class' | 'interface' | 'type' | 'event'
      file?: string; // 限制在特定文件
    }
  ): Promise<SymbolSearchResult[]> {
    if (!prisma) {
      logger.warn('⚠️ 数据库不可用，返回空结果');
      return [];
    }

    try {
      await ensureConnection();

      const limit = options?.limit || 20;
      const where: any = {
        projectId,
      };

      // 构建查询条件
      if (keywords.length > 0) {
        where.OR = [
          // 名称匹配（不区分大小写）
          {
            name: {
              in: keywords,
              mode: 'insensitive',
            },
          },
          // 关键词数组匹配（PostgreSQL数组操作）
          {
            keywords: {
              hasSome: keywords,
            },
          },
          // 名称包含关键词（LIKE查询）
          ...keywords.map(keyword => ({
            name: {
              contains: keyword,
              mode: 'insensitive',
            },
          })),
        ];
      }

      // 类型过滤
      if (options?.type) {
        where.type = options.type;
      }

      // 文件过滤
      if (options?.file) {
        where.file = options.file;
      }

      const symbols = await (prisma as any).symbol.findMany({
        where,
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
      });

      logger.info(`🔍 搜索符号: 关键词=${keywords.join(', ')}, 结果=${symbols.length} 个`);

      return symbols.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        file: s.file,
        line: s.line,
        signature: s.signature || undefined,
        snippet: s.snippet,
        keywords: s.keywords || [],
      }));
    } catch (error: any) {
      logger.error('❌ 搜索符号失败:', error);
      return [];
    }
  }

  /**
   * 获取组件 Props
   * 专门针对前端。从存储中提取特定组件的 interface Props
   * 
   * @param componentName 组件名称
   * @param projectId 项目ID
   * @param sessionId 会话ID（可选，用于从文件系统读取）
   * @returns 组件的 Props 定义
   */
  async getComponentProps(
    componentName: string,
    projectId: string,
    sessionId?: string
  ): Promise<ComponentProps | null> {
    if (!prisma) {
      logger.warn('⚠️ 数据库不可用');
      return null;
    }

    try {
      await ensureConnection();

      // 1. 先从 symbols 表中查找 interface 类型的符号
      const interfaceSymbol = await (prisma as any).symbol.findFirst({
        where: {
          projectId,
          name: componentName,
          type: 'interface',
          OR: [
            { name: `${componentName}Props` },
            { name: `${componentName}Interface` },
            { name: `I${componentName}` },
          ],
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (interfaceSymbol) {
        // 解析 interface 定义
        const propsDetails = this.parseInterfaceProps(interfaceSymbol.signature || interfaceSymbol.snippet);
        
        return {
          componentName,
          file: interfaceSymbol.file,
          propsInterface: interfaceSymbol.signature || interfaceSymbol.snippet,
          propsDetails,
        };
      }

      // 2. 如果没找到，尝试从文件系统中读取并解析
      if (sessionId) {
        const componentSymbol = await (prisma as any).symbol.findFirst({
          where: {
            projectId,
            name: componentName,
            type: { in: ['function', 'class'] },
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });

        if (componentSymbol) {
          const file = await this.fileManager.getFile(sessionId, componentSymbol.file);
          if (file?.content) {
            // 从文件内容中提取 Props interface
            const propsInterface = this.extractPropsInterface(file.content, componentName);
            if (propsInterface) {
              const propsDetails = this.parseInterfaceProps(propsInterface);
              return {
                componentName,
                file: componentSymbol.file,
                propsInterface,
                propsDetails,
              };
            }
          }
        }
      }

      logger.warn(`⚠️ 未找到组件 ${componentName} 的 Props 定义`);
      return null;
    } catch (error: any) {
      logger.error(`❌ 获取组件 Props 失败 (${componentName}):`, error);
      return null;
    }
  }

  /**
   * 解析 Interface Props 定义
   */
  private parseInterfaceProps(interfaceCode: string): Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string;
  }> {
    const props: Array<{
      name: string;
      type: string;
      required: boolean;
      description?: string;
    }> = [];

    // 简单的正则解析 interface
    // 匹配: propName: type; 或 propName?: type;
    const propRegex = /(\w+)(\?)?\s*:\s*([^;]+);/g;
    let match;

    while ((match = propRegex.exec(interfaceCode)) !== null) {
      const [, name, optional, type] = match;
      props.push({
        name: name.trim(),
        type: type.trim(),
        required: !optional,
        description: undefined, // TODO: 可以从注释中提取
      });
    }

    return props;
  }

  /**
   * 从文件内容中提取 Props interface
   */
  private extractPropsInterface(content: string, componentName: string): string | null {
    // 查找 interface ComponentNameProps 或 interface Props
    const patterns = [
      new RegExp(`interface\\s+${componentName}Props\\s*\\{([^}]+)\\}`, 's'),
      new RegExp(`interface\\s+Props\\s*\\{([^}]+)\\}`, 's'),
      new RegExp(`type\\s+${componentName}Props\\s*=\\s*\\{([^}]+)\\}`, 's'),
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  /**
   * 获取符号的完整定义（包括上下文）
   */
  async getSymbolDefinition(
    symbolName: string,
    projectId: string,
    sessionId?: string
  ): Promise<{
    symbol: SymbolSearchResult;
    fullDefinition?: string;
  } | null> {
    const symbols = await this.searchSymbols([symbolName], projectId, { limit: 1 });
    
    if (symbols.length === 0) {
      return null;
    }

    const symbol = symbols[0];
    let fullDefinition: string | undefined;

    // 如果提供了 sessionId，尝试读取完整文件内容
    if (sessionId && symbol.file) {
      const file = await this.fileManager.getFile(sessionId, symbol.file);
      if (file?.content) {
        // 提取符号所在行的上下文（前后各5行）
        const lines = file.content.split('\n');
        const startLine = Math.max(0, symbol.line - 6);
        const endLine = Math.min(lines.length, symbol.line + 5);
        fullDefinition = lines.slice(startLine, endLine).join('\n');
      }
    }

    return {
      symbol,
      fullDefinition,
    };
  }
}
