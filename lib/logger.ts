// 日志工具 - 直接输出到标准输出（console）
// 不再写入文件，适用于服务器环境（如 AWS Lambda）

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
  
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

// 日志接口 - 直接输出到标准输出
export const logger = {
  log: (...args: any[]) => {
    console.log(formatLogMessage('info', ...args));
  },
  
  info: (...args: any[]) => {
    console.info(formatLogMessage('info', ...args));
  },
  
  warn: (...args: any[]) => {
    console.warn(formatLogMessage('warn', ...args));
  },
  
  error: (...args: any[]) => {
    console.error(formatLogMessage('error', ...args));
  },
  
  debug: (...args: any[]) => {
    // 检查环境变量（客户端和服务端都支持）
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
    if (isDev) {
      console.debug(formatLogMessage('debug', ...args));
    }
  },
};
