// 日志工具 - 将日志写入 log 目录（仅在服务端）
// 客户端环境只使用 console

// 检测是否在服务端环境
const isServer = typeof window === 'undefined';

let fs: typeof import('fs') | null = null;
let path: typeof import('path') | null = null;
let LOG_DIR: string = '';

// 仅在服务端加载 fs 和 path
if (isServer) {
  try {
    fs = require('fs');
    path = require('path');
    // 安全访问 process.cwd()
    const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : '.';
    LOG_DIR = path.join(cwd, 'log');

    // 确保 log 目录存在
    if (fs && !fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (error) {
    // 如果加载失败，降级到仅 console
    console.warn('Failed to load fs module, using console only:', error);
  }
}

// 获取日志文件名（按日期）
function getLogFileName(level: string): string {
  if (!path || !LOG_DIR) return '';
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `${dateStr}-${level}.log`);
}

// 格式化日志消息
function formatLogMessage(level: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
  
  return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
}

// 写入日志文件（仅在服务端）
function writeLog(level: string, ...args: any[]): void {
  // 客户端环境：只输出到控制台
  if (!isServer || !fs) {
    return;
  }

  const logFile = getLogFileName(level);
  if (!logFile) return;

  const logMessage = formatLogMessage(level, ...args);
  
  try {
    fs.appendFileSync(logFile, logMessage, 'utf8');
  } catch (error) {
    // 如果写入失败，至少输出到控制台
    console.error('Failed to write log:', error);
  }
}

// 日志接口
export const logger = {
  log: (...args: any[]) => {
    writeLog('info', ...args);
    console.log(...args);
  },
  
  info: (...args: any[]) => {
    writeLog('info', ...args);
    console.info(...args);
  },
  
  warn: (...args: any[]) => {
    writeLog('warn', ...args);
    console.warn(...args);
  },
  
  error: (...args: any[]) => {
    writeLog('error', ...args);
    console.error(...args);
  },
  
  debug: (...args: any[]) => {
    // 检查环境变量（客户端和服务端都支持）
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
    if (isDev) {
      writeLog('debug', ...args);
      console.debug(...args);
    }
  },
};

// 清理旧日志文件（保留最近7天，仅在服务端）
export function cleanupOldLogs(): void {
  if (!isServer || !fs || !path || !LOG_DIR) {
    return;
  }

  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    
    files.forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtimeMs < sevenDaysAgo) {
        fs.unlinkSync(filePath);
        logger.info(`Deleted old log file: ${file}`);
      }
    });
  } catch (error) {
    logger.error('Failed to cleanup old logs:', error);
  }
}

// 启动时清理旧日志（仅在服务端）
if (isServer) {
  cleanupOldLogs();
}
