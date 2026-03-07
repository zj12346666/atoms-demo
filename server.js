/**
 * Next.js 自定义服务器
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');

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

  httpServer.listen(port, (err) => {
    if (err) {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ 端口 ${port} 已被占用！`);
        console.error(`  lsof -ti:${port} | xargs kill -9\n`);
        process.exit(1);
      } else {
        throw err;
      }
    }
    console.log(`> Ready on http://${hostname}:${port}`);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ 端口 ${port} 已被占用！`);
      console.error(`  lsof -ti:${port} | xargs kill -9\n`);
      process.exit(1);
    } else {
      console.error('服务器错误:', err);
      process.exit(1);
    }
  });
});
