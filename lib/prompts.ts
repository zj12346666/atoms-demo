// AI Prompt 工程

import { ASTParser } from './ast-parser';
import { ASTNodeLocator, ErrorLocation } from './ast-node-locator';
import { CodeExtractor } from './code-extractor';
import { logger } from './logger';

/**
 * BuildContextInput - 构建运行时上下文的输入
 */
export interface BuildContextInput {
  error: {
    message: string;
    file?: string;
    line?: number;
    column?: number;
    type?: string;
  };
  projectFiles: Array<{
    path: string;
    source: string;
  }>;
}

/**
 * RepairContext - 修复上下文（最小版本）
 */
export interface RepairContext {
  error: BuildContextInput['error'];
  primarySnippet: {
    code: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  } | null;
  component?: {
    code: string;
    startLine: number;
    endLine: number;
    startColumn: number;
    endColumn: number;
  };
}

/**
 * 构建运行时上下文
 * 从错误信息和项目文件中提取修复所需的上下文
 */
export function buildRuntimeContext(input: BuildContextInput): RepairContext {
  try {
    const { error, projectFiles } = input;

    // 1. 从 projectFiles 中获取 source
    const errorFile = error.file;
    if (!errorFile) {
      logger.warn('⚠️ 错误信息缺少文件路径，无法构建上下文');
      return {
        error,
        primarySnippet: null,
        component: undefined,
      };
    }

    const projectFile = projectFiles.find(f => f.path === errorFile);
    if (!projectFile) {
      logger.warn(`⚠️ 未找到错误文件: ${errorFile}`);
      return {
        error,
        primarySnippet: null,
        component: undefined,
      };
    }

    const source = projectFile.source;

    // 2. 使用 ASTParser 解析 AST
    const astParser = new ASTParser();
    const ast = astParser.parse(source, errorFile);

    // 3. 使用 ASTNodeLocator 定位错误节点
    const nodeLocator = new ASTNodeLocator();
    const errorLocation: ErrorLocation = {
      file: errorFile,
      line: error.line,
      column: error.column,
    };

    const locatedNode = nodeLocator.locateErrorNode(ast, errorLocation);
    
    if (!locatedNode) {
      logger.warn('⚠️ 无法定位错误节点，返回空片段');
      return {
        error,
        primarySnippet: null,
        component: undefined,
      };
    }

    // 4. 使用 CodeExtractor.extractSnippet 提取 primarySnippet
    const codeExtractor = new CodeExtractor();
    const primarySnippet = codeExtractor.extractSnippet(ast, locatedNode);

    // 5. 使用 locator.findEnclosingFunction 查找包含函数
    const enclosingFunction = nodeLocator.findEnclosingFunction(ast, locatedNode);
    
    // 6. 如果找到函数，使用 extractor.extractComponent 提取组件代码
    let component: RepairContext['component'] = undefined;
    if (enclosingFunction) {
      component = codeExtractor.extractComponent(ast, enclosingFunction);
    }

    // 7. 返回最小 RepairContext
    return {
      error,
      primarySnippet,
      component,
    };
  } catch (error: any) {
    logger.error('❌ 构建运行时上下文失败:', error);
    return {
      error: input.error,
      primarySnippet: null,
      component: undefined,
    };
  }
}

export const SYSTEM_PROMPT = `你是一个专业的前端代码生成助手。

用户会描述他们想要的应用，你需要生成完整的、可运行的代码。

## 技术要求
- 使用纯 HTML + CSS + JavaScript (ES6+)
- 使用 Tailwind CSS (通过 CDN)
- 代码必须完整可运行，不依赖外部文件
- 适配移动端，响应式设计
- 注重用户体验和交互细节

## 输出格式
必须严格按照以下 JSON 格式返回，不要包含任何其他文字说明：

\`\`\`json
{
  "html": "完整的 HTML body 内容（不包含 <html>, <head>, <body> 标签）",
  "css": "自定义 CSS 样式（如果需要）",
  "js": "JavaScript 代码",
  "description": "简短的功能说明"
}
\`\`\`

## 示例 1：计数器
用户: 创建一个计数器
你的回复:
\`\`\`json
{
  "html": "<div class='flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100'><div class='bg-white p-8 rounded-2xl shadow-xl'><h1 class='text-6xl font-bold text-center mb-8 text-gray-800' id='count'>0</h1><div class='flex gap-4'><button id='decrease' class='px-8 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all transform hover:scale-105 font-semibold'>-</button><button id='reset' class='px-8 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-all transform hover:scale-105 font-semibold'>重置</button><button id='increase' class='px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all transform hover:scale-105 font-semibold'>+</button></div></div></div>",
  "css": "",
  "js": "let count = 0; const countEl = document.getElementById('count'); const updateCount = () => { countEl.textContent = count; countEl.classList.add('scale-110'); setTimeout(() => countEl.classList.remove('scale-110'), 200); }; document.getElementById('increase').onclick = () => { count++; updateCount(); }; document.getElementById('decrease').onclick = () => { count--; updateCount(); }; document.getElementById('reset').onclick = () => { count = 0; updateCount(); };",
  "description": "一个带有动画效果的计数器，支持增加、减少和重置功能"
}
\`\`\`

## 示例 2：待办事项
用户: 创建一个待办事项应用
你的回复:
\`\`\`json
{
  "html": "<div class='min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-8'><div class='max-w-2xl mx-auto'><h1 class='text-4xl font-bold text-center mb-8 text-gray-800'>📝 我的待办</h1><div class='bg-white rounded-2xl shadow-xl p-6 mb-6'><div class='flex gap-2 mb-4'><input type='text' id='todoInput' placeholder='添加新任务...' class='flex-1 px-4 py-3 border-2 border-gray-200 rounded-lg focus:outline-none focus:border-purple-500 transition-colors' /><button id='addBtn' class='px-6 py-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-all font-semibold'>添加</button></div><ul id='todoList' class='space-y-2'></ul></div></div></div>",
  "css": ".todo-item { transition: all 0.3s; } .todo-item:hover { transform: translateX(5px); } .completed { text-decoration: line-through; opacity: 0.6; }",
  "js": "const input = document.getElementById('todoInput'); const list = document.getElementById('todoList'); const addBtn = document.getElementById('addBtn'); let todos = []; const render = () => { list.innerHTML = todos.map((todo, i) => \`<li class='todo-item flex items-center gap-3 p-3 bg-gray-50 rounded-lg'><input type='checkbox' \${todo.done ? 'checked' : ''} onchange='toggleTodo(\${i})' class='w-5 h-5 cursor-pointer' /><span class='\${todo.done ? 'completed' : ''} flex-1 text-lg'>\${todo.text}</span><button onclick='deleteTodo(\${i})' class='px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm'>删除</button></li>\`).join(''); }; const addTodo = () => { const text = input.value.trim(); if (text) { todos.push({ text, done: false }); input.value = ''; render(); } }; window.toggleTodo = (i) => { todos[i].done = !todos[i].done; render(); }; window.deleteTodo = (i) => { todos.splice(i, 1); render(); }; addBtn.onclick = addTodo; input.onkeypress = (e) => { if (e.key === 'Enter') addTodo(); };",
  "description": "一个功能完整的待办事项应用，支持添加、完成标记和删除任务"
}
\`\`\`

记住：
1. 必须返回有效的 JSON 格式！
2. HTML 要使用 Tailwind CSS 类名
3. 代码要完整可运行，不能有任何依赖
4. 注重美观和交互体验
5. 不要在 JSON 之外添加任何解释文字`;
