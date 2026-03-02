/**
 * Next.js 自定义服务器 - 支持 WebSocket
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // 初始化 Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: dev ? ['http://localhost:3000'] : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
  });

  // 初始化 WebSocketManager
  try {
    // 使用 CommonJS 版本（server.js 是 CommonJS）
    const { WebSocketManager } = require('./lib/websocket-manager.cjs');
    const wsManager = WebSocketManager.getInstance();
    wsManager.initialize(io);
    
    // 将 io 实例存储到全局，供 API 路由使用
    if (typeof global !== 'undefined') {
      global.__socketIO = io;
    }
    
    console.log('✅ WebSocketManager 已初始化');
  } catch (error) {
    console.error('❌ WebSocketManager 初始化失败:', error.message);
    console.warn('⚠️ WebSocket 功能将不可用，但服务器仍可正常运行');
  }

  httpServer.listen(port, (err) => {
    if (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ 端口 ${port} 已被占用！`);
        console.error(`\n请执行以下命令之一来释放端口：`);
        console.error(`  1. 查找并终止占用端口的进程：`);
        console.error(`     lsof -ti:${port} | xargs kill -9`);
        console.error(`  2. 或者手动终止进程：`);
        console.error(`     lsof -ti:${port}  # 查看进程ID`);
        console.error(`     kill -9 <进程ID>  # 终止进程`);
        console.error(`\n或者使用其他端口：`);
        console.error(`  PORT=3001 npm run dev\n`);
        process.exit(1);
      } else {
        throw err;
      }
    }
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket server ready on ws://${hostname}:${port}`);
  });

  // 处理未捕获的异常
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ 端口 ${port} 已被占用！`);
      console.error(`\n请执行以下命令来释放端口：`);
      console.error(`  lsof -ti:${port} | xargs kill -9\n`);
      process.exit(1);
    } else {
      console.error('服务器错误:', err);
      process.exit(1);
    }
  });
});
