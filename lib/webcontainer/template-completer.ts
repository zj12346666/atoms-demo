/**
 * TemplateCompleter - 自动补全缺失的关键文件
 * 
 * 检测项目类型并生成最小可用的 Vite 模板
 */

import { logger } from '../logger';
import type { FlatFileStructure } from './file-tree-builder';

/**
 * 项目类型
 */
export type ProjectType = 'react' | 'vue' | 'vanilla';

/**
 * 模板补全器
 */
export class TemplateCompleter {
  /**
   * 补全缺失的关键文件
   */
  complete(flatFiles: FlatFileStructure): FlatFileStructure {
    const completed = { ...flatFiles };
    const projectType = this.detectProjectType(completed);

    logger.info(`📦 [TemplateCompleter] 检测到项目类型: ${projectType}`);

    // 补全 index.html
    if (!this.hasIndexHtml(completed)) {
      logger.info('📄 [TemplateCompleter] 生成 index.html');
      completed['index.html'] = this.generateIndexHtml(projectType);
    }

    // 补全 package.json
    if (!this.hasPackageJson(completed)) {
      logger.info('📦 [TemplateCompleter] 生成 package.json');
      completed['package.json'] = this.generatePackageJson(projectType);
    } else {
      // 确保 package.json 包含必要的 scripts
      completed['package.json'] = this.ensurePackageJsonScripts(
        completed['package.json'],
        projectType
      );
    }

    // 补全 vite.config.ts
    if (!this.hasViteConfig(completed)) {
      logger.info('⚙️ [TemplateCompleter] 生成 vite.config.ts');
      completed['vite.config.ts'] = this.generateViteConfig(projectType);
    }

    // 对于 React 项目，确保有入口文件
    if (projectType === 'react' && !this.hasMainEntry(completed)) {
      logger.info('📝 [TemplateCompleter] 生成 src/main.tsx');
      completed['src/main.tsx'] = this.generateMainEntry(completed);
    }

    return completed;
  }

  /**
   * 检测项目类型
   */
  detectProjectType(files: FlatFileStructure): ProjectType {
    // 检查是否有 React 文件
    const hasReact = Object.keys(files).some(
      (path) =>
        path.endsWith('.tsx') ||
        path.endsWith('.jsx') ||
        path.includes('react') ||
        files[path]?.includes('from "react"') ||
        files[path]?.includes("from 'react'")
    );

    if (hasReact) {
      return 'react';
    }

    // 检查是否有 Vue 文件
    const hasVue = Object.keys(files).some(
      (path) =>
        path.endsWith('.vue') ||
        path.includes('vue') ||
        files[path]?.includes('from "vue"') ||
        files[path]?.includes("from 'vue'")
    );

    if (hasVue) {
      return 'vue';
    }

    return 'vanilla';
  }

  /**
   * 检查是否有 index.html
   */
  private hasIndexHtml(files: FlatFileStructure): boolean {
    return (
      'index.html' in files ||
      Object.keys(files).some((path) => path.endsWith('/index.html'))
    );
  }

  /**
   * 检查是否有 package.json
   */
  private hasPackageJson(files: FlatFileStructure): boolean {
    return 'package.json' in files;
  }

  /**
   * 检查是否有 vite.config
   */
  private hasViteConfig(files: FlatFileStructure): boolean {
    return (
      'vite.config.ts' in files ||
      'vite.config.js' in files ||
      'vite.config.mts' in files
    );
  }

  /**
   * 检查是否有主入口文件
   */
  private hasMainEntry(files: FlatFileStructure): boolean {
    return (
      'src/main.tsx' in files ||
      'src/main.jsx' in files ||
      'src/main.ts' in files ||
      'src/main.js' in files
    );
  }

  /**
   * 生成 index.html
   */
  private generateIndexHtml(projectType: ProjectType): string {
    const entryPoint =
      projectType === 'react'
        ? '/src/main.tsx'
        : projectType === 'vue'
        ? '/src/main.js'
        : '/src/main.js';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${entryPoint}"></script>
</body>
</html>`;
  }

  /**
   * 生成 package.json
   */
  private generatePackageJson(projectType: ProjectType): string {
    const basePackage = {
      name: 'generated-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite --host',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {} as Record<string, string>,
      devDependencies: {
        vite: '^5.0.0',
      } as Record<string, string>,
    };

    if (projectType === 'react') {
      basePackage.dependencies = {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      };
      basePackage.devDependencies = {
        ...basePackage.devDependencies,
        '@types/react': '^18.2.0',
        '@types/react-dom': '^18.2.0',
        '@vitejs/plugin-react': '^4.2.0',
      };
    } else if (projectType === 'vue') {
      basePackage.dependencies = {
        vue: '^3.3.0',
      };
      basePackage.devDependencies = {
        ...basePackage.devDependencies,
        '@vitejs/plugin-vue': '^4.5.0',
      };
    }

    return JSON.stringify(basePackage, null, 2);
  }

  /**
   * 确保 package.json 包含必要的 scripts
   */
  private ensurePackageJsonScripts(
    packageJsonContent: string,
    projectType: ProjectType
  ): string {
    try {
      const pkg = JSON.parse(packageJsonContent);

      // 确保 scripts 存在
      if (!pkg.scripts) {
        pkg.scripts = {};
      }

      // 确保 dev script 存在
      if (!pkg.scripts.dev) {
        pkg.scripts.dev = 'vite --host';
        logger.info('📝 [TemplateCompleter] 添加缺失的 dev script');
      }

      // 确保 build script 存在
      if (!pkg.scripts.build) {
        pkg.scripts.build = 'vite build';
      }

      // 确保 preview script 存在
      if (!pkg.scripts.preview) {
        pkg.scripts.preview = 'vite preview';
      }

      return JSON.stringify(pkg, null, 2);
    } catch (error) {
      logger.error('❌ [TemplateCompleter] 解析 package.json 失败:', error);
      // 如果解析失败，返回生成的默认 package.json
      return this.generatePackageJson(projectType);
    }
  }

  /**
   * 生成 vite.config.ts
   */
  private generateViteConfig(projectType: ProjectType): string {
    if (projectType === 'react') {
      return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    host: true,
  },
});`;
    } else if (projectType === 'vue') {
      return `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    strictPort: true,
    host: true,
  },
});`;
    } else {
      return `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    host: true,
  },
});`;
    }
  }

  /**
   * 生成主入口文件（React）
   */
  private generateMainEntry(files: FlatFileStructure): string {
    // 查找 App 组件
    const appFile = Object.entries(files).find(
      ([path]) =>
        path.endsWith('App.tsx') ||
        path.endsWith('App.jsx') ||
        path.toLowerCase().includes('app.tsx') ||
        path.toLowerCase().includes('app.jsx')
    );

    if (appFile) {
      const [appPath, appContent] = appFile;
      // 提取组件名（从文件内容或路径）
      const componentNameMatch =
        appContent.match(/export\s+(?:default\s+)?(?:function|const)\s+(\w+)/) ||
        appContent.match(/export\s+default\s+(\w+)/);

      const componentName = componentNameMatch
        ? componentNameMatch[1]
        : 'App';

      // 计算导入路径
      let importPath = './App';
      if (appPath.startsWith('src/')) {
        const relativePath = appPath
          .replace(/^src\//, '')
          .replace(/\.(tsx|jsx)$/, '');
        importPath = `./${relativePath}`;
      }

      return `import React from 'react';
import ReactDOM from 'react-dom/client';
import ${componentName} from '${importPath}';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <${componentName} />
  </React.StrictMode>
);`;
    }

    // 如果没有找到 App 组件，生成默认入口
    return `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div>
      <h1>Hello, World!</h1>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`;
  }
}

/**
 * 单例导出
 */
export const templateCompleter = new TemplateCompleter();
