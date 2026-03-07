'use client';

import { useEffect, useRef, useState } from 'react';
import { WebContainer } from '@webcontainer/api';
import { webContainerManager } from '@/lib/webcontainer-manager';
import { webContainerHealer, CapturedError } from '@/lib/webcontainer-healer';
import { webContainerHotReload } from '@/lib/webcontainer-hot-reload';

interface WebContainerPreviewProps {
  sessionId: string;
}

export function WebContainerPreview({ sessionId }: WebContainerPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const isInitializingRef = useRef(false);
  const isFixingRef = useRef(false);
  const errorCountRef = useRef(0);
  const collectedErrorsRef = useRef<Array<{ message: string; source: string; timestamp: number }>>([]);
  const [status, setStatus] = useState<'initializing' | 'loading' | 'installing' | 'starting' | 'ready' | 'error' | 'fixing'>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    errorCountRef.current = 0; // 重置错误计数
    collectedErrorsRef.current = []; // 清空错误收集

    // 自动修复错误的函数
    const attemptAutoFix = async (
      sessionId: string,
      errors: string[],
      shouldRetry: () => void
    ) => {
      if (isFixingRef.current || errorCountRef.current >= 3) {
        return;
      }

      try {
        isFixingRef.current = true;
        errorCountRef.current++;
        setStatus('fixing');
        console.log(`🔧 [WebContainer] 开始自动修复错误 (尝试 ${errorCountRef.current}/3)...`);
        console.log(`📋 [WebContainer] 收集到的错误:`, errors);
        
        // 调用修复 API
        const fixResponse = await fetch('/api/fix-errors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            errors: errors.slice(-10), // 只发送最近10个错误
          }),
        });

        const fixData = await fixResponse.json();
        
        if (fixData.success) {
          console.log(`✅ [WebContainer] 错误修复成功，修复了 ${fixData.files?.length || 0} 个文件`);
          
          // 等待一下让文件保存完成
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // 重新初始化 WebContainer
          if (mounted) {
            console.log('🔄 [WebContainer] 重新初始化...');
            isInitializingRef.current = false;
            shouldRetry();
          }
        } else {
          console.error('❌ [WebContainer] 自动修复失败:', fixData.error);
          if (mounted) {
            setError(`自动修复失败: ${fixData.error}`);
            setStatus('error');
          }
        }
      } catch (fixError: any) {
        console.error('❌ [WebContainer] 修复过程出错:', fixError);
        if (mounted) {
          setError(`修复过程出错: ${fixError.message}`);
          setStatus('error');
        }
      } finally {
        isFixingRef.current = false;
      }
    };

    const initWebContainer = async () => {
      // 防止并发初始化
      if (isInitializingRef.current) {
        console.log('⚠️ [WebContainer] 初始化已在进行中，跳过重复调用');
        return;
      }

      try {
        isInitializingRef.current = true;
        console.log('🚀 [WebContainer] 开始初始化...');
        setStatus('initializing');

        if (!mounted) {
          isInitializingRef.current = false;
          return;
        }
        
        // 检查浏览器支持
        console.log('🔍 [WebContainer] 检查 Cross-Origin Isolation:', window.crossOriginIsolated);
        if (!window.crossOriginIsolated) {
          const errorMsg = 'WebContainer 需要 Cross-Origin Isolation。请确保服务器设置了正确的响应头：Cross-Origin-Opener-Policy: same-origin 和 Cross-Origin-Embedder-Policy: require-corp';
          console.error('❌ [WebContainer]', errorMsg);
          throw new Error(errorMsg);
        }

        // 1. 获取项目文件结构
        console.log('📁 [WebContainer] 获取文件列表 (sessionId:', sessionId, ')');
        setStatus('loading');
        const filesResponse = await fetch(`/api/files?sessionId=${sessionId}`);
        const filesData = await filesResponse.json();
        console.log('📥 [WebContainer] 文件列表响应:', {
          success: filesData.success,
          filesCount: filesData.files?.length || 0,
          files: filesData.files?.map((f: any) => ({ path: f.path, name: f.name, type: f.type }))
        });

        if (!filesData.success || !filesData.files || filesData.files.length === 0) {
          const errorMsg = '项目文件为空，请先生成代码';
          console.error('❌ [WebContainer]', errorMsg);
          throw new Error(errorMsg);
        }

        if (!mounted) {
          isInitializingRef.current = false;
          return;
        }

        // 获取所有文件的内容
        console.log('📥 [WebContainer] 开始获取文件内容...');
        const filesWithContent = await Promise.all(
          filesData.files.map(async (file: any) => {
            if (file.type === 'text') {
              try {
                console.log(`  📄 [WebContainer] 加载文件: ${file.path}`);
                const fileResponse = await fetch(`/api/files?sessionId=${sessionId}&path=${encodeURIComponent(file.path)}`);
                const fileData = await fileResponse.json();
                const content = fileData.success && fileData.file ? fileData.file.content : '';
                console.log(`  ✅ [WebContainer] 文件 ${file.path} 加载成功，内容长度: ${content.length} 字符`);
                // 检查代码语法错误
                if (file.path.endsWith('.js') || file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
                  try {
                    // 简单的语法检查
                    if (content.includes('Position') && !content.includes('interface Position') && !content.includes('type Position')) {
                      console.warn(`  ⚠️ [WebContainer] 文件 ${file.path} 可能包含语法错误: 'Position' 未定义`);
                    }
                  } catch (e) {
                    console.warn(`  ⚠️ [WebContainer] 文件 ${file.path} 语法检查失败:`, e);
                  }
                }
                return {
                  ...file,
                  content,
                };
              } catch (error) {
                console.error(`  ❌ [WebContainer] 加载文件 ${file.path} 失败:`, error);
                return { ...file, content: '' };
              }
            }
            return file;
          })
        );
        console.log('✅ [WebContainer] 所有文件内容加载完成，共', filesWithContent.length, '个文件');

        if (!mounted) {
          isInitializingRef.current = false;
          return;
        }

        // 2. 初始化 WebContainer（使用全局管理器）
        console.log('🔧 [WebContainer] 启动 WebContainer...');
        const webcontainer = await webContainerManager.boot();
        if (!mounted) {
          isInitializingRef.current = false;
          return;
        }
        
        webcontainerRef.current = webcontainer;
        console.log('✅ [WebContainer] WebContainer 启动成功');
        setStatus('installing');

        // 3. 构建文件系统映射
        console.log('📦 [WebContainer] 构建文件系统映射...');
        const fileSystem: Record<string, { file: { contents: string } }> = {};
        
        // 查找关键文件
        const htmlFile = filesWithContent.find((f: any) => f.path === 'index.html' || f.name === 'index.html' || f.path.endsWith('/index.html'));
        const cssFile = filesWithContent.find((f: any) => 
          f.path === 'styles.css' || 
          f.name === 'styles.css' || 
          f.name === 'style.css' ||
          f.path.endsWith('/styles.css') ||
          f.path.endsWith('/style.css')
        );
        const jsFile = filesWithContent.find((f: any) => 
          f.path === 'script.js' || 
          f.name === 'script.js' || 
          f.name === 'main.js' ||
          f.path.endsWith('/script.js') ||
          f.path.endsWith('/main.js') ||
          f.path.endsWith('.tsx') ||
          f.path.endsWith('.ts')
        );
        
        console.log('📄 [WebContainer] 关键文件:', {
          htmlFile: htmlFile ? htmlFile.path : '未找到',
          cssFile: cssFile ? cssFile.path : '未找到',
          jsFile: jsFile ? jsFile.path : '未找到',
        });
        
        // 检查是否有 React/TypeScript 文件
        const hasReactFiles = filesWithContent.some((f: any) => 
          f.path.endsWith('.tsx') || f.path.endsWith('.jsx') || f.path.includes('react')
        );
        console.log('⚛️ [WebContainer] 检测到 React 项目:', hasReactFiles);
        
        // 添加 package.json（根据项目类型调整）
        const packageJson = hasReactFiles ? {
          name: 'generated-project',
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite --host',
            build: 'vite build',
            preview: 'vite preview'
          },
          dependencies: {
            'react': '^18.2.0',
            'react-dom': '^18.2.0',
            '@types/react': '^18.2.0',
            '@types/react-dom': '^18.2.0',
            'vite': '^5.0.0',
            '@vitejs/plugin-react': '^4.2.0'
          }
        } : {
          name: 'generated-project',
          version: '1.0.0',
          type: 'module',
          scripts: {
            dev: 'vite --host',
            build: 'vite build',
            preview: 'vite preview'
          },
          dependencies: {
            'vite': '^5.0.0'
          }
        };
        
        fileSystem['package.json'] = {
          file: {
            contents: JSON.stringify(packageJson, null, 2)
          }
        };

        // 添加 vite.config.js（根据项目类型调整）
        const viteConfig = hasReactFiles ? `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    port: 3000,\n    strictPort: true,\n    host: true\n  }\n});` : `import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  server: {\n    port: 3000,\n    strictPort: true,\n    host: true\n  }\n});`;
        
        fileSystem['vite.config.js'] = {
          file: {
            contents: viteConfig
          }
        };

        // 构建 index.html
        if (htmlFile && htmlFile.content) {
          // 如果已有完整的 HTML 文件，检查是否需要修改入口文件引用
          let htmlContent = htmlFile.content;
          
          // 如果是 React 项目，确保入口文件引用正确
          if (hasReactFiles) {
            // 检查是否引用了错误的入口文件（如 src/app.tsx）
            htmlContent = htmlContent.replace(
              /src\/["']app\.tsx["']/gi,
              'src/main.tsx'
            );
            // 确保引用了正确的入口文件
            if (!htmlContent.includes('src/main.tsx') && !htmlContent.includes('src/main.js')) {
              // 如果没有入口文件引用，添加一个
              htmlContent = htmlContent.replace(
                /<\/body>/i,
                '<script type="module" src="/src/main.tsx"></script></body>'
              );
            }
          }
          
          fileSystem['index.html'] = {
            file: {
              contents: htmlContent
            }
          };
        } else {
          // 从分离的文件构建 index.html
          const htmlContent = htmlFile?.content || '<div id="root"></div>';
          const cssPath = cssFile ? (cssFile.path.startsWith('/') ? cssFile.path.slice(1) : cssFile.path) : null;
          
          // 对于 React 项目，使用标准的入口文件
          const entryPath = hasReactFiles ? 'src/main.tsx' : (jsFile ? (jsFile.path.startsWith('/') ? jsFile.path.slice(1) : jsFile.path) : null);
          
          fileSystem['index.html'] = {
            file: {
              contents: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated App</title>
  ${cssPath ? `<link rel="stylesheet" href="/${cssPath}">` : ''}
</head>
<body>
  ${htmlContent}
  ${entryPath ? `<script type="module" src="/${entryPath}"></script>` : ''}
</body>
</html>`
            }
          };
        }
        
        // 辅助函数：规范化文件路径
        const normalizePath = (filePath: string): string | null => {
          // 移除开头的斜杠
          let path = filePath.startsWith('/') ? filePath.slice(1) : filePath;
          
          // 移除相对路径前缀
          path = path.replace(/^\.\//, '').trim();
          
          // 规范化斜杠（多个斜杠合并为一个）
          path = path.replace(/\/+/g, '/');
          
          // 移除末尾的斜杠（文件不能以斜杠结尾）
          path = path.replace(/\/$/, '');
          
          // 验证路径：不允许包含危险字符
          // WebContainer 不允许：.., 空字符串, 以 / 开头, 包含控制字符
          if (!path || 
              path.includes('..') || 
              path.startsWith('/') ||
              path.includes('\0') ||
              path.includes('\r') ||
              path.includes('\n') ||
              /[<>:"|?*]/.test(path)) {
            return null;
          }
          
          return path;
        };

        // 辅助函数：将全小写文件名转换为驼峰命名（PascalCase）
        const toPascalCase = (str: string): string => {
          return str
            .split(/[-_\s]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
        };

        // 不应该被 PascalCase 转换的特殊入口文件名（这些文件名应保持小写）
        const ENTRY_FILE_NAMES = new Set(['main', 'index', 'vite.config', 'app.config']);

        // 先收集所有需要创建的目录
        const directories = new Set<string>();
        
        // 映射所有文件到文件系统
        for (const file of filesWithContent) {
          if (file.type === 'text' && file.content) {
            // 规范化路径
            const normalizedPath = normalizePath(file.path);
            
            if (!normalizedPath) {
              console.warn(`⚠️ [WebContainer] 跳过无效路径: ${file.path}`);
              continue;
            }
            
            // 跳过根目录的 index.html、package.json、vite.config.*，因为我们已经处理过了
            if (normalizedPath === 'index.html' ||
                normalizedPath === 'package.json' ||
                normalizedPath === 'vite.config.js' ||
                normalizedPath === 'vite.config.ts' ||
                normalizedPath === 'vite.config.mts') {
              continue;
            }
            
            // 收集所有父目录
            const pathParts = normalizedPath.split('/');
            if (pathParts.length > 1) {
              // 构建所有父目录路径
              let currentDir = '';
              for (let i = 0; i < pathParts.length - 1; i++) {
                currentDir = currentDir ? `${currentDir}/${pathParts[i]}` : pathParts[i];
                directories.add(currentDir);
              }
            }
          }
        }
        
        // WebContainer 会自动创建目录，我们不需要显式创建
        // 但为了确保结构正确，我们仍然收集目录信息用于验证
        console.log(`📁 [WebContainer] 需要创建的目录:`, Array.from(directories).sort());
        
        // 然后添加所有文件
        for (const file of filesWithContent) {
          if (file.type === 'text' && file.content) {
            // 规范化路径
            const normalizedPath = normalizePath(file.path);
            
            if (!normalizedPath) {
              continue;
            }
            
            // 跳过根目录的 index.html、package.json、vite.config.*，因为我们已经处理过了
            if (normalizedPath === 'index.html' ||
                normalizedPath === 'package.json' ||
                normalizedPath === 'vite.config.js' ||
                normalizedPath === 'vite.config.ts' ||
                normalizedPath === 'vite.config.mts') {
              continue;
            }
            
            // 检查文件名大小写问题（WebContainer 对大小写敏感）
            const pathParts = normalizedPath.split('/');
            const fileName = pathParts[pathParts.length - 1];
            const fileNameWithoutExt = fileName.replace(/\.[^.]*$/, '');
            const fileExt = fileName.match(/\.[^.]*$/)?.[0] || '';
            
            let correctCasePath = normalizedPath;
            let foundCorrectCase = false;
            
            // 1. 首先检查是否有其他文件引用了这个文件，但使用了不同的大小写
            const importPatterns = [
              new RegExp(`import.*from.*['"]\\.?/?([^'"]*${fileNameWithoutExt}[^'"]*)['"]`, 'i'),
              new RegExp(`import.*['"]\\.?/?([^'"]*${fileNameWithoutExt}[^'"]*)['"]`, 'i'),
              new RegExp(`require\\(['"]\\.?/?([^'"]*${fileNameWithoutExt}[^'"]*)['"]\\)`, 'i'),
            ];
            
            let correctCaseFromImport: string | null = null;
            
            for (const otherFile of filesWithContent) {
              if (otherFile.type === 'text' && otherFile.content && otherFile.path !== file.path) {
                for (const pattern of importPatterns) {
                  const match = otherFile.content.match(pattern);
                  if (match && match[1]) {
                    const importedPath = match[1];
                    // 检查导入的路径是否与当前路径大小写不同但指向同一个文件
                    if (importedPath.toLowerCase() === normalizedPath.toLowerCase() && importedPath !== normalizedPath) {
                      console.warn(`⚠️ [WebContainer] 检测到文件名大小写不匹配: 文件路径是 ${normalizedPath}，但导入语句引用的是 ${importedPath}`);
                      const normalizedImportedPath = normalizePath(importedPath);
                      if (normalizedImportedPath) {
                        correctCasePath = normalizedImportedPath;
                        correctCaseFromImport = normalizedImportedPath;
                        foundCorrectCase = true;
                        break;
                      }
                    }
                  }
                }
                if (foundCorrectCase) break;
              }
            }
            
            // 如果从导入语句中找到了正确的大小写，更新所有文件中的导入语句
            if (correctCaseFromImport && correctCaseFromImport !== normalizedPath) {
              const correctFileName = correctCaseFromImport.split('/').pop()?.replace(/\.[^.]*$/, '') || fileNameWithoutExt;
              const escapedOldFileName = fileNameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const escapedNewFileName = correctFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              
              // 更新所有文件中的导入语句
              for (const otherFile of filesWithContent) {
                if (otherFile.type === 'text' && otherFile.content) {
                  const importUpdatePatterns = [
                    new RegExp(`(['"]\\.?/?[^'"]*?/)${escapedOldFileName}(['"])`, 'gi'),
                    new RegExp(`(['"]\\.?/?)${escapedOldFileName}(['"])`, 'gi'),
                    new RegExp(`(['"]\\.?/?[^'"]*?)${escapedOldFileName}([^'"]*?['"])`, 'gi'),
                  ];
                  
                  let updated = false;
                  let newContent = otherFile.content;
                  
                  for (const pattern of importUpdatePatterns) {
                    newContent = newContent.replace(pattern, (match: string, prefix: string, suffix: string) => {
                      const matchedPath = (prefix + fileNameWithoutExt + suffix).replace(/['"]/g, '');
                      const normalizedMatchedPath = matchedPath.replace(/^\.\//, '').replace(/\/$/, '');
                      
                      if (normalizedMatchedPath.toLowerCase() === normalizedPath.toLowerCase()) {
                        const pathBeforeFileName = prefix.replace(/\/$/, '');
                        const newImportPath = pathBeforeFileName 
                          ? `${pathBeforeFileName}/${correctFileName}${suffix}` 
                          : `./${correctFileName}${suffix}`;
                        updated = true;
                        console.log(`  📝 [WebContainer] 根据导入语句修正，更新文件 ${otherFile.path} 中的导入: ${match} -> ${newImportPath}`);
                        return newImportPath;
                      }
                      return match;
                    });
                  }
                  
                  if (updated) {
                    otherFile.content = newContent;
                  }
                }
              }
            }
            
            // 2. 如果没有找到导入引用，检查文件名是否应该是驼峰命名（React组件文件）
            // 对于全小写的 React 组件文件，强制转换为驼峰命名（WebContainer 对大小写敏感）
            // 注意：main、index 等入口文件名不应被转换
            if (!foundCorrectCase && fileName.match(/^[a-z]+\.(tsx?|jsx?)$/) && !ENTRY_FILE_NAMES.has(fileNameWithoutExt)) {
              // 对于全小写的 React 组件文件，强制转换为驼峰命名
              const pascalCaseName = toPascalCase(fileNameWithoutExt);
              if (pascalCaseName !== fileNameWithoutExt) {
                const suggestedPath = pathParts.slice(0, -1).concat([pascalCaseName + fileExt]).join('/');
                // 检查是否有其他文件使用了这个建议的路径
                const hasConflict = filesWithContent.some(f => {
                  const normalized = normalizePath(f.path);
                  return normalized && normalized.toLowerCase() === suggestedPath.toLowerCase() && normalized !== suggestedPath;
                });
                
                if (!hasConflict) {
                  console.log(`🔧 [WebContainer] 自动修正文件名大小写: ${normalizedPath} -> ${suggestedPath} (全小写文件名可能导致 WebContainer 挂载失败)`);
                  correctCasePath = suggestedPath;
                  foundCorrectCase = true;
                  
                  // 更新当前文件内容中的导入语句
                  if (file.content) {
                    const oldImportPattern = new RegExp(`(['"]\\.?/?[^'"]*?)${fileNameWithoutExt}([^'"]*?['"])`, 'gi');
                    const newContent = file.content.replace(oldImportPattern, (match: string, prefix: string, suffix: string) => {
                      // 只替换路径中的文件名部分，保留路径的其他部分
                      const pathBeforeFileName = prefix.replace(/\/$/, '');
                      const newImportPath = pathBeforeFileName ? `${pathBeforeFileName}/${pascalCaseName}${suffix}` : `./${pascalCaseName}${suffix}`;
                      console.log(`  📝 [WebContainer] 更新当前文件导入语句: ${match} -> ${newImportPath}`);
                      return newImportPath;
                    });
                    file.content = newContent;
                  }
                  
                  // 重要：更新所有其他文件中引用这个文件的导入语句
                  // 因为其他文件可能引用了旧的小写文件名
                  const escapedOldFileName = fileNameWithoutExt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const escapedNewFileName = pascalCaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  
                  for (const otherFile of filesWithContent) {
                    if (otherFile.type === 'text' && otherFile.content && otherFile.path !== file.path) {
                      const oldPathLower = normalizedPath.toLowerCase();
                      const newPathLower = suggestedPath.toLowerCase();
                      
                      // 匹配各种导入格式
                      const importPatterns = [
                        // 匹配 './snakegame' 或 './components/snakegame'
                        new RegExp(`(['"]\\.?/?[^'"]*?/)${escapedOldFileName}(['"])`, 'gi'),
                        // 匹配 './snakegame'（无路径前缀）
                        new RegExp(`(['"]\\.?/?)${escapedOldFileName}(['"])`, 'gi'),
                        // 匹配完整路径
                        new RegExp(`(['"]\\.?/?[^'"]*?)${escapedOldFileName}([^'"]*?['"])`, 'gi'),
                      ];
                      
                      let updated = false;
                      let newContent = otherFile.content;
                      
                      for (const pattern of importPatterns) {
                        newContent = newContent.replace(pattern, (match: string, prefix: string, suffix: string) => {
                          // 检查匹配的路径是否指向旧文件
                          const matchedPath = (prefix + fileNameWithoutExt + suffix).replace(/['"]/g, '');
                          const normalizedMatchedPath = matchedPath.replace(/^\.\//, '').replace(/\/$/, '');
                          
                          // 如果匹配的路径（大小写不敏感）指向旧文件，则替换
                          if (normalizedMatchedPath.toLowerCase() === oldPathLower) {
                            const pathBeforeFileName = prefix.replace(/\/$/, '');
                            const newImportPath = pathBeforeFileName 
                              ? `${pathBeforeFileName}/${pascalCaseName}${suffix}` 
                              : `./${pascalCaseName}${suffix}`;
                            updated = true;
                            console.log(`  📝 [WebContainer] 更新其他文件 ${otherFile.path} 中的导入语句: ${match} -> ${newImportPath}`);
                            return newImportPath;
                          }
                          return match;
                        });
                      }
                      
                      if (updated) {
                        otherFile.content = newContent;
                      }
                    }
                  }
                } else {
                  console.warn(`⚠️ [WebContainer] 检测到全小写文件名 ${normalizedPath}，但建议的路径 ${suggestedPath} 已存在，跳过转换`);
                }
              }
            }
            
            // 3. 检查是否有大小写冲突（同一个文件的不同大小写版本）
            const conflictingPath = Array.from(Object.keys(fileSystem)).find(existingPath => {
              return existingPath.toLowerCase() === correctCasePath.toLowerCase() && existingPath !== correctCasePath;
            });
            
            if (conflictingPath) {
              console.error(`❌ [WebContainer] 检测到大小写冲突: ${conflictingPath} 和 ${correctCasePath} 指向同一个文件`);
              // 使用已存在的路径，避免重复
              correctCasePath = conflictingPath;
            }
            
            // 添加文件（使用正确的大小写路径）
            fileSystem[correctCasePath] = {
              file: {
                contents: file.content
              }
            };
            if (correctCasePath !== normalizedPath) {
              console.log(`📄 [WebContainer] 添加文件: ${normalizedPath} -> ${correctCasePath} (修正大小写)`);
            } else {
              console.log(`📄 [WebContainer] 添加文件: ${normalizedPath}`);
            }
          }
        }
        
        // 对于 React 项目，创建 src/main.tsx 入口文件（如果不存在）
        // 注意：必须在所有文件添加完成后，在目录创建之后
        if (hasReactFiles) {
          const mainPath = 'src/main.tsx';
          const normalizedMainPath = normalizePath(mainPath);
          
          if (normalizedMainPath && !fileSystem[normalizedMainPath]) {
            const appFile = filesWithContent.find((f: any) => {
              const normalized = normalizePath(f.path);
              return normalized && (
                normalized.toLowerCase().endsWith('app.tsx') || 
                normalized.toLowerCase().endsWith('app.jsx')
              );
            });
            
            // 查找 App 文件，或回退到任意 .tsx/.jsx 文件
            let targetFile = appFile;
            let targetFileName = 'App';
            let targetImportPath = './App';

            if (appFile) {
              const appPath = normalizePath(appFile.path);
              if (appPath) {
                targetFileName = appPath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'App';
                if (appPath === 'src/App.tsx' || appPath === 'src/App.jsx') {
                  targetImportPath = './App';
                } else if (appPath.startsWith('src/')) {
                  targetImportPath = './' + appPath.replace(/^src\//, '').replace(/\.(tsx|jsx)$/i, '');
                } else {
                  targetImportPath = '../' + targetFileName;
                }
              }
            } else {
              // 没有找到 App 文件，尝试找任意 .tsx/.jsx 文件作为入口
              const anyTsxFile = filesWithContent.find((f: any) => {
                const normalized = normalizePath(f.path);
                return normalized && (normalized.endsWith('.tsx') || normalized.endsWith('.jsx'));
              });
              if (anyTsxFile) {
                const anyPath = normalizePath(anyTsxFile.path);
                if (anyPath) {
                  targetFileName = anyPath.split('/').pop()?.replace(/\.(tsx|jsx)$/i, '') || 'App';
                  if (anyPath.startsWith('src/')) {
                    targetImportPath = './' + anyPath.replace(/^src\//, '').replace(/\.(tsx|jsx)$/i, '');
                  } else {
                    targetImportPath = '../' + targetFileName;
                  }
                  targetFile = anyTsxFile;
                  console.warn(`⚠️ [WebContainer] 未找到 App 文件，使用 ${anyPath} 作为回退入口`);
                }
              }
            }

            if (targetFile) {
              // 创建入口文件内容（确保内容格式正确）
              const mainContent = [
                `import React from 'react';`,
                `import ReactDOM from 'react-dom/client';`,
                `import ${targetFileName} from '${targetImportPath}';`,
                ``,
                `ReactDOM.createRoot(document.getElementById('root')!).render(`,
                `  <React.StrictMode>`,
                `    <${targetFileName} />`,
                `  </React.StrictMode>`,
                `);`
              ].join('\n');
              
              // 检查是否与目录冲突
              if (fileSystem[normalizedMainPath]) {
                if ('directory' in fileSystem[normalizedMainPath]) {
                  console.error(`❌ [WebContainer] 无法创建文件 ${normalizedMainPath}，因为该路径已存在目录`);
                } else {
                  console.log(`ℹ️ [WebContainer] ${normalizedMainPath} 已存在，跳过创建`);
                }
              } else {
                // 验证文件内容是否有效
                if (mainContent && mainContent.length > 0 && !mainContent.includes('\0')) {
                  fileSystem[normalizedMainPath] = {
                    file: {
                      contents: mainContent
                    }
                  };
                  console.log(`📄 [WebContainer] 创建 React 入口文件: ${normalizedMainPath} (导入 ${targetFileName} from ${targetImportPath})`);
                  console.log(`📝 [WebContainer] 文件内容预览:`, mainContent.substring(0, 100) + '...');
                } else {
                  console.error(`❌ [WebContainer] 文件内容无效: ${normalizedMainPath}`);
                }
              }
            } else {
              console.warn(`⚠️ [WebContainer] 未找到任何可用的组件文件，无法创建 ${normalizedMainPath}`);
            }
          } else if (!normalizedMainPath) {
            console.warn('⚠️ [WebContainer] 无法规范化 src/main.tsx 路径');
          } else {
            console.log('ℹ️ [WebContainer] src/main.tsx 已存在，跳过创建');
          }
        }

        // 辅助函数：将扁平文件结构（key 为完整路径）转换为 WebContainer 需要的嵌套树结构
        // WebContainer mount() 不接受 key 包含斜杠的扁平对象，必须转换为嵌套目录树
        const buildNestedFileTree = (flatFiles: Record<string, { file: { contents: string } }>) => {
          const tree: Record<string, any> = {};
          for (const [filePath, fileEntry] of Object.entries(flatFiles)) {
            const parts = filePath.split('/');
            let current = tree;
            for (let i = 0; i < parts.length - 1; i++) {
              const dirName = parts[i];
              if (!current[dirName]) {
                current[dirName] = { directory: {} };
              } else if (!('directory' in current[dirName])) {
                // 路径冲突（文件与目录同名），跳过
                console.error(`❌ [WebContainer] 路径冲突: ${parts.slice(0, i + 1).join('/')} 既是文件又是目录`);
                break;
              }
              current = current[dirName].directory;
            }
            const fileName = parts[parts.length - 1];
            current[fileName] = fileEntry;
          }
          return tree;
        };

        // 4. 挂载前最终检查和修复文件名大小写
        console.log('💾 [WebContainer] 挂载文件系统，文件数量:', Object.keys(fileSystem).length);
        console.log('📋 [WebContainer] 文件系统文件列表:', Object.keys(fileSystem).sort());
        
        // 统一收集所有需要修正的文件名（用于后续统一更新导入语句）
        const allPathsToFix: Array<{ oldPath: string; newPath: string }> = [];
        const pathsToRemove: string[] = [];
        
        for (const path of Object.keys(fileSystem)) {
          const entry = fileSystem[path];
          if ('file' in entry && entry.file && 'contents' in entry.file) {
            const pathParts = path.split('/');
            const fileName = pathParts[pathParts.length - 1];
            
            // 检查是否是全小写的 React 组件文件（这会导致 WebContainer 挂载失败）
            // 注意：main、index 等入口文件名不应被转换
            const fileNameWithoutExtCheck = fileName.replace(/\.[^.]*$/, '');
            if (fileName.match(/^[a-z]+\.(tsx?|jsx?)$/) && !ENTRY_FILE_NAMES.has(fileNameWithoutExtCheck)) {
              const fileNameWithoutExt = fileNameWithoutExtCheck;
              const fileExt = fileName.match(/\.[^.]*$/)?.[0] || '';
              const pascalCaseName = toPascalCase(fileNameWithoutExt);
              
              if (pascalCaseName !== fileNameWithoutExt) {
                const newPath = pathParts.slice(0, -1).concat([pascalCaseName + fileExt]).join('/');
                // 检查新路径是否已存在
                if (!fileSystem[newPath]) {
                  console.warn(`⚠️ [WebContainer] 发现全小写文件名 ${path}，将修正为 ${newPath}`);
                  allPathsToFix.push({ oldPath: path, newPath });
                } else {
                  console.warn(`⚠️ [WebContainer] 发现全小写文件名 ${path}，但目标路径 ${newPath} 已存在，将删除旧文件`);
                  pathsToRemove.push(path);
                }
              }
            }
          }
        }
        
        // 检查并修复文件名大小写问题
        const pathCaseMap = new Map<string, string>(); // 存储路径的小写版本到实际路径的映射
        const caseConflicts: Array<{ original: string; corrected: string }> = [];
        
        // 先收集所有路径，避免在遍历时修改
        const allPaths = Array.from(Object.keys(fileSystem));
        
        // 第二遍：强制修复所有全小写的 React 组件文件名（处理动态添加的情况）
        for (const path of allPaths) {
          if (pathsToRemove.includes(path)) continue;
          
          const pathParts = path.split('/');
          const fileName = pathParts[pathParts.length - 1];
          
          // 检查是否是全小写的 React 组件文件（这会导致 WebContainer 挂载失败）
          // 注意：main、index 等入口文件名不应被转换
          const fileNameWithoutExtPass2 = fileName.replace(/\.[^.]*$/, '');
          if (fileName.match(/^[a-z]+\.(tsx?|jsx?)$/) && !ENTRY_FILE_NAMES.has(fileNameWithoutExtPass2)) {
            const fileNameWithoutExt = fileNameWithoutExtPass2;
            const fileExt = fileName.match(/\.[^.]*$/)?.[0] || '';
            const pascalCaseName = toPascalCase(fileNameWithoutExt);
            
            if (pascalCaseName !== fileNameWithoutExt) {
              const newPath = pathParts.slice(0, -1).concat([pascalCaseName + fileExt]).join('/');
              const lowerNewPath = newPath.toLowerCase();
              const lowerOldPath = path.toLowerCase();
              
              // 检查是否已经在 allPathsToFix 中
              const alreadyFixed = allPathsToFix.some(fix => fix.oldPath === path);
              if (alreadyFixed) continue;
              
              // 检查新路径是否已存在（大小写不敏感）
              const existingPath = Array.from(Object.keys(fileSystem)).find(p => 
                p.toLowerCase() === lowerNewPath && p !== newPath
              );
              
              if (existingPath) {
                // 如果已存在，检查哪个更符合规范
                const existingFileName = existingPath.split('/').pop() || '';
                const isPascalCase = (name: string) => /^[A-Z][a-zA-Z0-9]*\.(tsx?|jsx?)$/.test(name);
                
                if (isPascalCase(pascalCaseName + fileExt) && !isPascalCase(existingFileName)) {
                  // 新路径更符合规范，替换旧路径
                  console.warn(`⚠️ [WebContainer] 强制修正文件名: ${existingPath} -> ${newPath}`);
                  allPathsToFix.push({ oldPath: existingPath, newPath });
                  pathsToRemove.push(existingPath);
                } else {
                  // 旧路径更符合规范，删除新路径
                  console.warn(`⚠️ [WebContainer] 删除全小写文件名: ${path} (已存在更规范的 ${existingPath})`);
                  pathsToRemove.push(path);
                }
              } else {
                // 新路径不存在，直接修正
                console.warn(`⚠️ [WebContainer] 强制修正全小写文件名: ${path} -> ${newPath}`);
                allPathsToFix.push({ oldPath: path, newPath });
                pathsToRemove.push(path);
              }
            }
          }
        }
        
        // 应用所有文件名修正
        for (const { oldPath, newPath } of allPathsToFix) {
          if (!fileSystem[oldPath]) continue; // 可能已被删除
          const entry = fileSystem[oldPath];
          delete fileSystem[oldPath];
          fileSystem[newPath] = entry;
          console.log(`✅ [WebContainer] 已修正文件名: ${oldPath} -> ${newPath}`);
        }
        
        // 第二遍：检查并修复大小写冲突
        for (const path of allPaths) {
          // 跳过已标记为删除的路径
          if (pathsToRemove.includes(path)) continue;
          
          const lowerPath = path.toLowerCase();
          if (pathCaseMap.has(lowerPath)) {
            const existingPath = pathCaseMap.get(lowerPath)!;
            if (existingPath !== path) {
              // 发现大小写冲突，保留更符合规范的版本（优先使用驼峰命名）
              const pathParts = path.split('/');
              const fileName = pathParts[pathParts.length - 1];
              const existingFileName = existingPath.split('/').pop() || '';
              
              // 判断哪个更符合规范（驼峰命名优先）
              const isPascalCase = (name: string) => /^[A-Z][a-zA-Z0-9]*\.(tsx?|jsx?)$/.test(name);
              const shouldUseNew = isPascalCase(fileName) && !isPascalCase(existingFileName);
              
              if (shouldUseNew) {
                console.warn(`⚠️ [WebContainer] 发现大小写冲突，使用更规范的版本: ${existingPath} -> ${path}`);
                // 删除旧版本，使用新版本
                const oldEntry = fileSystem[existingPath];
                delete fileSystem[existingPath];
                fileSystem[path] = oldEntry;
                pathCaseMap.set(lowerPath, path);
                caseConflicts.push({ original: existingPath, corrected: path });
                pathsToRemove.push(existingPath);
              } else {
                console.warn(`⚠️ [WebContainer] 发现大小写冲突，保留现有版本: ${path} (已存在 ${existingPath})`);
                // 删除新版本，保留旧版本
                delete fileSystem[path];
                caseConflicts.push({ original: path, corrected: existingPath });
                pathsToRemove.push(path);
              }
            }
          } else {
            pathCaseMap.set(lowerPath, path);
          }
        }
        
        // 删除标记为删除的路径
        for (const path of pathsToRemove) {
          if (fileSystem[path]) {
            delete fileSystem[path];
            console.log(`🗑️ [WebContainer] 已删除路径: ${path}`);
          }
        }
        
        // 统一更新所有文件内容中的导入语句，确保引用正确的文件名
        if (allPathsToFix.length > 0) {
          console.log(`🔄 [WebContainer] 开始更新 ${allPathsToFix.length} 个文件的导入语句...`);
          
          // 构建路径映射（支持大小写不敏感匹配）
          const pathMappings = new Map<string, { oldPath: string; newPath: string; oldFileName: string; newFileName: string }>();
          for (const { oldPath, newPath } of allPathsToFix) {
            const oldPathParts = oldPath.split('/');
            const newPathParts = newPath.split('/');
            const oldFileName = oldPathParts[oldPathParts.length - 1];
            const newFileName = newPathParts[newPathParts.length - 1];
            const oldFileNameWithoutExt = oldFileName.replace(/\.[^.]*$/, '');
            const newFileNameWithoutExt = newFileName.replace(/\.[^.]*$/, '');
            
            // 存储原始路径和文件名（用于精确匹配）
            pathMappings.set(oldPath.toLowerCase(), {
              oldPath,
              newPath,
              oldFileName: oldFileNameWithoutExt,
              newFileName: newFileNameWithoutExt
            });
          }
          
          // 更新所有文件中的导入语句
          for (const [path, entry] of Object.entries(fileSystem)) {
            if ('file' in entry && entry.file && 'contents' in entry.file) {
              let contents = entry.file.contents as string;
              let updated = false;
              
              // 遍历所有路径映射，更新导入语句
              for (const mapping of pathMappings.values()) {
                const { oldFileName, newFileName, oldPath: oldFullPath, newPath: newFullPath } = mapping;
                
                // 匹配各种导入语句格式
                // 1. import ... from './tetrisgame' 或 './TetrisGame'
                // 2. import ... from './components/tetrisgame' 或 './components/TetrisGame'
                // 3. import ... from 'tetrisgame' 或 'TetrisGame'
                
                // 构建匹配模式（大小写不敏感，匹配旧文件名）
                const escapedOldFileName = oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedNewFileName = newFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // 匹配导入路径中的文件名（支持相对路径和绝对路径）
                const importPatterns = [
                  // 匹配 './tetrisgame' 或 './TetrisGame' 或 './components/tetrisgame'
                  new RegExp(`(['"]\\.?/?[^'"]*?/)${escapedOldFileName}(['"])`, 'gi'),
                  // 匹配 './tetrisgame' 或 './TetrisGame'（无路径前缀）
                  new RegExp(`(['"]\\.?/?)${escapedOldFileName}(['"])`, 'gi'),
                  // 匹配完整路径（大小写不敏感）
                  new RegExp(`(['"]\\.?/?[^'"]*?)${escapedOldFileName}([^'"]*?['"])`, 'gi'),
                ];
                
                for (const pattern of importPatterns) {
                  const newContents = contents.replace(pattern, (match: string, prefix: string, suffix: string) => {
                    // 检查匹配的路径是否真的指向旧文件
                    const matchedPath = (prefix + oldFileName + suffix).replace(/['"]/g, '');
                    const normalizedMatchedPath = matchedPath.replace(/^\.\//, '').replace(/\/$/, '');
                    const oldPathNormalized = oldFullPath.replace(/^\.\//, '').replace(/\/$/, '');
                    
                    // 如果匹配的路径（大小写不敏感）指向旧文件，则替换
                    if (normalizedMatchedPath.toLowerCase() === oldPathNormalized.toLowerCase()) {
                      const pathBeforeFileName = prefix.replace(/\/$/, '');
                      const newImportPath = pathBeforeFileName 
                        ? `${pathBeforeFileName}/${newFileName}${suffix}` 
                        : `./${newFileName}${suffix}`;
                      updated = true;
                      return newImportPath;
                    }
                    return match; // 不匹配，保持原样
                  });
                  
                  if (newContents !== contents) {
                    contents = newContents;
                  }
                }
              }
              
              if (updated) {
                fileSystem[path] = {
                  file: {
                    contents
                  }
                };
                console.log(`📝 [WebContainer] 已更新文件 ${path} 中的导入语句`);
              }
            }
          }
          
          console.log(`✅ [WebContainer] 完成导入语句更新`);
        }
        
        if (caseConflicts.length > 0) {
          console.warn(`⚠️ [WebContainer] 修复了 ${caseConflicts.length} 个文件名大小写冲突`);
        }
        
        // 验证文件系统结构
        const invalidEntries: string[] = [];
        for (const [path, entry] of Object.entries(fileSystem)) {
          if (!entry || (typeof entry !== 'object')) {
            invalidEntries.push(path);
            console.error(`❌ [WebContainer] 无效的文件系统条目: ${path}`, entry);
          } else if (!('file' in entry) && !('directory' in entry)) {
            invalidEntries.push(path);
            console.error(`❌ [WebContainer] 无效的文件系统条目类型: ${path}`, entry);
          } else if ('file' in entry && entry.file && typeof entry.file === 'object' && 'contents' in entry.file) {
            // 验证文件路径
            const pathParts = path.split('/');
            const fileName = pathParts[pathParts.length - 1];
            
            // WebContainer 对文件名大小写敏感，检查是否有问题
            // 检查文件名是否全小写但应该是驼峰命名（如 snakegame.tsx -> SnakeGame.tsx）
            if (fileName.match(/^[a-z]+\.(tsx?|jsx?)$/)) {
              // 检查是否有导入语句引用了这个文件但使用了不同的大小写
              let foundCorrectCase = false;
              for (const [otherPath, otherEntry] of Object.entries(fileSystem)) {
                if (otherPath !== path && 'file' in otherEntry && otherEntry.file && 'contents' in otherEntry.file) {
                  const contents = otherEntry.file.contents as string;
                  // 查找导入语句
                  const importRegex = new RegExp(`import.*from.*['"]\\.?/?([^'"]*${fileName.replace(/\.[^.]*$/, '')}[^'"]*)['"]`, 'i');
                  const match = contents.match(importRegex);
                  if (match && match[1]) {
                    const importedPath = match[1].toLowerCase();
                    const currentPathLower = path.toLowerCase();
                    if (importedPath === currentPathLower && match[1] !== path) {
                      console.warn(`⚠️ [WebContainer] 检测到文件名大小写不匹配: ${path} 可能应该是 ${match[1]}`);
                      // 不自动修复，只记录警告，让用户知道问题
                    }
                  }
                }
              }
            }
            
            // 验证文件内容
            const contents = entry.file.contents;
            if (typeof contents !== 'string') {
              invalidEntries.push(path);
              console.error(`❌ [WebContainer] 文件内容类型错误: ${path}`, typeof contents);
            } else if (contents.includes('\0')) {
              invalidEntries.push(path);
              console.error(`❌ [WebContainer] 文件包含空字符: ${path}`);
            }
          }
        }
        
        if (invalidEntries.length > 0) {
          console.error(`❌ [WebContainer] 发现 ${invalidEntries.length} 个无效条目，将在挂载前移除`);
          for (const path of invalidEntries) {
            delete fileSystem[path];
          }
        }
        
        try {
          // 将扁平路径结构转换为 WebContainer 需要的嵌套目录树，避免 EIO: invalid file name 错误
          const nestedFileTree = buildNestedFileTree(fileSystem);
          console.log('🌳 [WebContainer] 嵌套文件树根节点:', Object.keys(nestedFileTree).sort());
          await webcontainer.mount(nestedFileTree);
          if (!mounted) return;
          console.log('✅ [WebContainer] 文件系统挂载成功');
        } catch (mountError: any) {
          console.error('❌ [WebContainer] 文件系统挂载失败:', mountError);
          console.error('📋 [WebContainer] 挂载时的文件列表:', Object.keys(fileSystem).sort());
          
          // 检查是否有问题文件
          const problemFiles = Object.keys(fileSystem).filter(path => {
            const entry = fileSystem[path];
            if ('file' in entry && entry.file && 'contents' in entry.file) {
              const contents = entry.file.contents;
              return typeof contents === 'string' && (
                contents.includes('\0') ||
                contents.includes('\r') ||
                path.includes('..') ||
                path.startsWith('/')
              );
            }
            return false;
          });
          
          if (problemFiles.length > 0) {
            console.error('❌ [WebContainer] 可能有问题的文件:', problemFiles);
          }
          
          // 只输出文件系统结构，不输出完整内容（可能太大）
          const fileSystemSummary = Object.keys(fileSystem).reduce((acc, path) => {
            const entry = fileSystem[path];
            acc[path] = 'file' in entry ? 'file' : 'directory';
            return acc;
          }, {} as Record<string, string>);
          console.error('📋 [WebContainer] 文件系统结构摘要:', fileSystemSummary);
          
          throw mountError;
        }

        // 5. 静默重装：检查 package.json 是否变化
        console.log('📦 [WebContainer] 检查 package.json 变化...');
        setStatus('installing');
        
        // 检查是否需要安装依赖（通过尝试读取 node_modules 或检查 package.json 变化）
        let needsInstall = true;
        try {
          // 尝试读取 package-lock.json 来判断是否需要安装
          const packageLockExists = await webcontainer.fs.readFile('package-lock.json', 'utf-8').catch(() => null);
          if (packageLockExists) {
            // 如果存在 package-lock.json，检查是否需要重新安装
            // 这里简化处理：每次都检查，实际可以通过比较 hash 来判断
            needsInstall = true; // 首次挂载总是需要安装
          }
        } catch (e) {
          // 文件不存在，需要安装
          needsInstall = true;
        }

        if (needsInstall) {
          if (!mounted) {
            isInitializingRef.current = false;
            return;
          }
          console.log('📦 [WebContainer] 开始安装依赖...');
          const installProcess = await webcontainer.spawn('npm', ['install']);
          
          // 监听安装输出并收集错误
          const installErrors: string[] = [];
          installProcess.output.pipeTo(
            new WritableStream({
              write(data) {
                console.log('📦 [WebContainer Install]', data);
                // 检测错误信息
                if (data.includes('ERROR') || data.includes('Error') || data.includes('error') || 
                    data.includes('failed') || data.includes('Failed') || data.includes('FAILED')) {
                  installErrors.push(data);
                  collectedErrorsRef.current.push({
                    message: data,
                    source: 'npm-install',
                    timestamp: Date.now(),
                  });
                }
              }
            })
          );
          
          const installExitCode = await installProcess.exit;
          console.log('📦 [WebContainer] 依赖安装完成，退出码:', installExitCode);
          
          if (installExitCode !== 0) {
            const errorMsg = '依赖安装失败，退出码: ' + installExitCode;
            console.error('❌ [WebContainer]', errorMsg);
            
            // 收集错误并尝试修复
            if (!isFixingRef.current && errorCountRef.current < 3) {
              await attemptAutoFix(sessionId, [...installErrors, errorMsg], () => {
                initWebContainer();
              });
              return; // 修复后会重新初始化
            }
            
            throw new Error(errorMsg);
          }
        } else {
          console.log('📦 [WebContainer] 跳过依赖安装（package.json 未变化）');
        }
        if (!mounted) return;

        // 6. 初始化热更新系统
        await webContainerHotReload.initialize(
          webcontainer,
          sessionId,
          async () => {
            // package.json 变化时的回调：静默重装
            console.log('📦 [WebContainer] package.json 已变化，执行静默重装...');
            setStatus('installing');
            try {
              const installProcess = await webcontainer.spawn('npm', ['install']);
              const installExitCode = await installProcess.exit;
              if (installExitCode === 0) {
                console.log('✅ [WebContainer] 静默重装完成');
              } else {
                console.warn('⚠️ [WebContainer] 静默重装失败，退出码:', installExitCode);
              }
            } catch (error) {
              console.error('❌ [WebContainer] 静默重装出错:', error);
            }
          }
        );

        // 7. 启动开发服务器
        if (!mounted) {
          isInitializingRef.current = false;
          return;
        }
        console.log('🚀 [WebContainer] 启动开发服务器...');
        setStatus('starting');
        const devProcess = await webcontainer.spawn('npm', ['run', 'dev']);
        
        // 8. 启动错误捕获器（The Healer）
        await webContainerHealer.startMonitoring(webcontainer, async (errors: CapturedError[]) => {
          // 静默模式：不通知用户，直接发送给 Agent
          if (errors.length > 0 && !isFixingRef.current && errorCountRef.current < 3) {
            console.log(`🔧 [Healer] 检测到 ${errors.length} 个错误，自动发送给 Agent 修复...`);
            try {
              const response = await fetch('/api/webcontainer/errors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId,
                  errors: errors.map(e => ({
                    type: e.type,
                    message: e.message,
                    file: e.file,
                    line: e.line,
                    column: e.column,
                    stack: e.stack,
                  })),
                }),
              });
              
              const result = await response.json();
              if (result.success) {
                console.log(`✅ [Healer] Agent 已修复 ${result.filesFixed || 0} 个文件`);
                // 等待文件同步完成
                await new Promise(resolve => setTimeout(resolve, 2000));
                // 热更新会自动同步文件，无需重新初始化
              }
            } catch (error) {
              console.error('❌ [Healer] 发送错误给 Agent 失败:', error);
            }
          }
        });
        
        // 监听 dev 进程输出（healer 内部会 pipeTo，stream 只能被 pipe 一次）
        // URL 检测通过下方的 server-ready 事件完成，无需再次 pipeTo
        await webContainerHealer.monitorDevProcess(devProcess);

        // 等待服务器就绪
        let urlSet = false;
        webcontainer.on('server-ready', (port, url) => {
          if (!mounted) return;
          urlSet = true;
          console.log('✅ [WebContainer] 服务器就绪事件触发，端口:', port, 'URL:', url);
          setUrl(url);
          setStatus('ready');
        });

        // 设置超时，如果 10 秒内没有收到 server-ready 事件，尝试使用默认 URL
        const timeoutId = setTimeout(() => {
          if (mounted && !urlSet) {
            // 尝试从 WebContainer 获取 URL
            const defaultUrl = `http://localhost:3000`;
            console.log('⚠️ [WebContainer] 超时，使用默认 URL:', defaultUrl);
            setUrl(defaultUrl);
            setStatus('ready');
          }
        }, 10000);
        
        // 清理超时（在组件卸载时）
        return () => {
          clearTimeout(timeoutId);
        };

      } catch (err: any) {
        // 如果组件已卸载且错误是 "Process aborted"，这是预期的正常行为：
        // teardown() 会中止所有正在进行中的进程（npm install / dev server）
        if (!mounted && (err.message?.includes('Process aborted') || err.message?.includes('aborted'))) {
          console.log('ℹ️ [WebContainer] 组件已卸载，WebContainer 进程被中止 (正常行为，非错误)');
          isInitializingRef.current = false;
          return;
        }

        console.error('❌ [WebContainer] 初始化失败:', err);
        console.error('❌ [WebContainer] 错误详情:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
        });
        
        // 收集错误信息
        const errorMessage = err.message || 'WebContainer 初始化失败';
        collectedErrorsRef.current.push({
          message: errorMessage,
          source: 'initialization',
          timestamp: Date.now(),
        });
        
        // 如果是文件系统错误，尝试自动修复
        if ((err.message?.includes('invalid file name') || 
             err.message?.includes('EIO') ||
             err.message?.includes('mount')) && 
            !isFixingRef.current && 
            errorCountRef.current < 3) {
          console.log('🔧 [WebContainer] 检测到文件系统错误，尝试自动修复...');
          await attemptAutoFix(sessionId, [errorMessage], () => {
            initWebContainer();
          });
          return;
        }
        
        // 如果已经获取了实例但后续步骤失败，释放引用
        if (webcontainerRef.current) {
          webContainerManager.release().catch((e) => {
            console.warn('⚠️ [WebContainer] 错误时释放引用失败:', e);
          });
          webcontainerRef.current = null;
        }
        
        if (mounted) {
          setError(errorMessage);
          setStatus('error');
        }
      } finally {
        isInitializingRef.current = false;
      }
    };

    initWebContainer();

    return () => {
      mounted = false;
      isInitializingRef.current = false;
      
      // 停止错误捕获器
      webContainerHealer.stopMonitoring();
      
      // 清理热更新系统
      webContainerHotReload.cleanup();
      
      // 释放对 WebContainer 的引用（使用全局管理器）
      // 管理器会使用引用计数，只有当所有组件都释放时才真正清理
      if (webcontainerRef.current) {
        webContainerManager.release().catch((e) => {
          console.warn('⚠️ [WebContainer] 释放引用时出错:', e);
        });
        webcontainerRef.current = null;
        console.log('🧹 [WebContainer] 组件卸载，释放引用');
      }
    };
  }, [sessionId]);

  // 更新 iframe URL 并监听运行时错误
  useEffect(() => {
    if (url && iframeRef.current) {
      iframeRef.current.src = url;
      
      // 监听 iframe 中的错误消息
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'console' && event.data?.level === 'error') {
          const errorMsg = event.data.message || '';
          console.error('🚨 [WebContainer Runtime Error]', errorMsg);
          
          collectedErrorsRef.current.push({
            message: errorMsg,
            source: 'runtime',
            timestamp: Date.now(),
          });
          
          // 如果运行时错误较多，尝试修复（延迟执行，避免频繁修复）
          const runtimeErrors = collectedErrorsRef.current.filter(e => e.source === 'runtime');
          if (runtimeErrors.length >= 5 && !isFixingRef.current && errorCountRef.current < 3) {
            console.log('🔧 [WebContainer] 检测到多个运行时错误，将在 3 秒后尝试自动修复...');
            setTimeout(() => {
              if (!isFixingRef.current && errorCountRef.current < 3) {
                // 重新初始化 WebContainer
                window.location.reload();
              }
            }, 3000);
          }
        }
      };
      
      window.addEventListener('message', handleMessage);
      
      return () => {
        window.removeEventListener('message', handleMessage);
      };
    }
  }, [url, sessionId]);

  if (error) {
    // 检查是否是 COEP 相关错误
    const isCoepError = error.includes('Cross-Origin') || error.includes('COEP') || error.includes('NotSameOriginAfterDefaultedToSameOriginByCoep');
    
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-50">
        <div className="text-red-500 mb-4">
          <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">WebContainer 初始化失败</h3>
        <p className="text-sm text-gray-600 mb-4 max-w-md">{error}</p>
        {isCoepError && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 max-w-md">
            <p className="text-sm text-yellow-800 mb-2">
              <strong>💡 建议：</strong>WebContainer 需要严格的 Cross-Origin Isolation，某些资源可能不支持。
            </p>
            <p className="text-xs text-yellow-700">
              请尝试切换到 <strong>"简单预览"</strong> 模式，它不需要 Cross-Origin Isolation，可以正常预览你的应用。
            </p>
          </div>
        )}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md">
          <p className="text-xs text-blue-800 mb-2">
            <strong>📋 调试信息：</strong>
          </p>
          <p className="text-xs text-blue-700 font-mono text-left break-all">
            {error}
          </p>
          <p className="text-xs text-blue-600 mt-2">
            查看浏览器控制台获取更多详细信息（已添加详细日志）
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="bg-gray-800 text-white px-4 py-2 text-xs flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          status === 'ready' ? 'bg-green-400' :
          status === 'error' ? 'bg-red-400' :
          status === 'fixing' ? 'bg-blue-400 animate-pulse' :
          'bg-yellow-400 animate-pulse'
        }`} />
        <span>
          {status === 'initializing' && '初始化中...'}
          {status === 'loading' && '加载文件...'}
          {status === 'installing' && '安装依赖...'}
          {status === 'starting' && '启动服务器...'}
          {status === 'fixing' && `自动修复中... (${errorCountRef.current}/3)`}
          {status === 'ready' && `运行中 ${url ? `(${url})` : ''}`}
        </span>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 relative bg-white">
        {status === 'ready' && url ? (
          <iframe
            ref={iframeRef}
            src={url}
            className="w-full h-full border-0"
            title="WebContainer Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
              {status === 'initializing' && <p className="text-sm">正在初始化 WebContainer...</p>}
              {status === 'loading' && <p className="text-sm">正在加载项目文件...</p>}
              {status === 'installing' && <p className="text-sm">正在安装依赖...</p>}
              {status === 'starting' && <p className="text-sm">正在启动开发服务器...</p>}
              {status === 'fixing' && (
                <div className="text-center">
                  <p className="text-lg font-semibold mb-2">🔧 正在自动修复错误...</p>
                  <p className="text-sm text-gray-600 mb-4">
                    已检测到代码错误，正在使用 AI 自动修复 (尝试 {errorCountRef.current}/3)
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
