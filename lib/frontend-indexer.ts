// 前端代码索引器 - 专注于组件、Props、依赖图

import * as ts from 'typescript';

// 组件注册信息
export interface ComponentRegistry {
  name: string;                    // 组件名
  filePath: string;                // 文件路径
  exportType: 'default' | 'named'; // 导出类型
  description?: string;            // JSDoc 注释
}

// Props 属性定义
export interface PropDefinition {
  name: string;           // 属性名
  type: string;           // 类型（string, number, etc.）
  required: boolean;      // 是否必需
  defaultValue?: string;  // 默认值
  description?: string;   // 注释说明
}

// 组件 Props Schema
export interface PropsSchema {
  componentName: string;
  filePath: string;
  props: PropDefinition[];
  tsInterface?: string; // 完整的 TypeScript Interface 定义
}

// 资源映射
export interface AssetMap {
  type: 'svg' | 'image' | 'css-var' | 'tailwind-class';
  name: string;
  path: string;
  usage?: string; // 使用示例
}

// 依赖关系
export interface ComponentDependency {
  component: string;      // 当前组件
  imports: string[];      // 导入的组件
  importedBy: string[];   // 被谁导入
  hooks: string[];        // 使用的 Hooks
  stateManagement?: string[]; // 使用的状态管理（Redux/Context）
}

export class FrontendIndexer {
  // 扫描并提取组件信息
  extractComponentInfo(sourceCode: string, filePath: string): {
    registry: ComponentRegistry | null;
    propsSchema: PropsSchema | null;
    dependencies: ComponentDependency | null;
  } {
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    let registry: ComponentRegistry | null = null;
    let propsSchema: PropsSchema | null = null;
    const imports: string[] = [];
    const hooks: string[] = [];

    // 遍历 AST
    const visit = (node: ts.Node) => {
      // 1. 提取组件导出
      if (ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) {
        const componentInfo = this.extractComponent(node, sourceCode);
        if (componentInfo) {
          registry = {
            name: componentInfo.name,
            filePath,
            exportType: componentInfo.exportType,
            description: componentInfo.description,
          };
        }
      }

      // 2. 提取 Props Interface
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        const propsInfo = this.extractPropsSchema(node, sourceCode);
        if (propsInfo && propsInfo.name.includes('Props')) {
          propsSchema = {
            componentName: propsInfo.name.replace('Props', ''),
            filePath,
            props: propsInfo.props,
            tsInterface: propsInfo.interfaceText,
          };
        }
      }

      // 3. 提取 Import 语句
      if (ts.isImportDeclaration(node)) {
        const importInfo = this.extractImport(node);
        if (importInfo) {
          imports.push(...importInfo.components);
          hooks.push(...importInfo.hooks);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    // 构建依赖信息
    const dependencies: ComponentDependency | null = registry
      ? {
          component: (registry as ComponentRegistry).name,
          imports,
          importedBy: [],
          hooks,
        }
      : null;

    return { registry, propsSchema, dependencies };
  }

  // 提取组件声明
  private extractComponent(node: ts.Node, sourceCode: string): {
    name: string;
    exportType: 'default' | 'named';
    description?: string;
  } | null {
    let componentName = '';
    let exportType: 'default' | 'named' = 'named';
    let description: string | undefined;

    // 函数组件：export function Button() {}
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) {
        componentName = node.name.text;
        // 检查是否是 export default
        const modifiers = node.modifiers;
        if (modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
          if (modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
            exportType = 'default';
          }
        }
      }
    }

    // 箭头函数组件：export const Button = () => {}
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        componentName = declaration.name.text;
        // 检查是否以大写字母开头（React 组件约定）
        if (componentName[0] === componentName[0].toUpperCase()) {
          const modifiers = node.modifiers;
          if (modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
            if (modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
              exportType = 'default';
            }
          }
        }
      }
    }

    // 提取 JSDoc 注释
    const jsDocTags = (node as any).jsDoc;
    if (jsDocTags && jsDocTags.length > 0) {
      description = jsDocTags[0].comment;
    }

    return componentName ? { name: componentName, exportType, description } : null;
  }

  // 提取 Props Interface/Type
  private extractPropsSchema(node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration, sourceCode: string): {
    name: string;
    props: PropDefinition[];
    interfaceText: string;
  } | null {
    const name = node.name.text;
    const props: PropDefinition[] = [];

    // 获取完整的 Interface 文本
    const interfaceText = sourceCode.substring(node.pos, node.end).trim();

    // 遍历 Interface 成员
    if (ts.isInterfaceDeclaration(node)) {
      node.members.forEach(member => {
        if (ts.isPropertySignature(member)) {
          const propName = (member.name as ts.Identifier).text;
          const propType = member.type ? member.type.getText() : 'any';
          const required = !member.questionToken;

          // 提取注释
          let description: string | undefined;
          const jsDoc = (member as any).jsDoc;
          if (jsDoc && jsDoc.length > 0) {
            description = jsDoc[0].comment;
          }

          props.push({
            name: propName,
            type: propType,
            required,
            description,
          });
        }
      });
    }

    return { name, props, interfaceText };
  }

  // 提取 Import 信息
  private extractImport(node: ts.ImportDeclaration): {
    components: string[];
    hooks: string[];
  } | null {
    const components: string[] = [];
    const hooks: string[] = [];

    if (node.importClause) {
      const namedBindings = node.importClause.namedBindings;
      
      // import { Button, Input } from './components'
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        namedBindings.elements.forEach(element => {
          const name = element.name.text;
          
          // 判断是否是 Hook（以 use 开头）
          if (name.startsWith('use')) {
            hooks.push(name);
          } else if (name[0] === name[0].toUpperCase()) {
            // 判断是否是组件（首字母大写）
            components.push(name);
          }
        });
      }

      // import Button from './Button'
      if (node.importClause.name) {
        const defaultImport = node.importClause.name.text;
        if (defaultImport[0] === defaultImport[0].toUpperCase()) {
          components.push(defaultImport);
        }
      }
    }

    return components.length > 0 || hooks.length > 0
      ? { components, hooks }
      : null;
  }

  // 扫描项目提取所有资源
  extractAssets(sourceCode: string, filePath: string): AssetMap[] {
    const assets: AssetMap[] = [];

    // CSS Variables: --color-primary
    const cssVarRegex = /--([\w-]+):\s*([^;]+);/g;
    let match;
    while ((match = cssVarRegex.exec(sourceCode)) !== null) {
      assets.push({
        type: 'css-var',
        name: match[1],
        path: filePath,
        usage: `var(--${match[1]})`,
      });
    }

    // Tailwind Classes（简化版，实际应解析 tailwind.config.js）
    const tailwindRegex = /className=["']([^"']+)["']/g;
    while ((match = tailwindRegex.exec(sourceCode)) !== null) {
      const classes = match[1].split(' ');
      classes.forEach(cls => {
        if (cls && !assets.find(a => a.name === cls)) {
          assets.push({
            type: 'tailwind-class',
            name: cls,
            path: filePath,
          });
        }
      });
    }

    return assets;
  }

  // 构建依赖图（需要所有组件信息）
  buildDependencyGraph(allComponents: ComponentDependency[]): Map<string, ComponentDependency> {
    const graph = new Map<string, ComponentDependency>();

    // 第一步：建立 component -> imports 映射
    allComponents.forEach(comp => {
      graph.set(comp.component, comp);
    });

    // 第二步：反向建立 importedBy 关系
    allComponents.forEach(comp => {
      comp.imports.forEach(importedComp => {
        const target = graph.get(importedComp);
        if (target && !target.importedBy.includes(comp.component)) {
          target.importedBy.push(comp.component);
        }
      });
    });

    return graph;
  }
}
