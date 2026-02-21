import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const apiMiddleware = (req, res, next) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (!pathname.startsWith('/api/')) {
    return next();
  }

  console.log(`[API] ${req.method} ${pathname}`);

  if (pathname === '/api/levels') {
    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (req.method === 'GET') {
      const name = url.searchParams.get('name');

      if (name) {
        // Load specific level file
        const filePath = path.join(dataDir, name.endsWith('.json') ? name : `${name}.json`);
        if (fs.existsSync(filePath)) {
          res.setHeader('Content-Type', 'application/json');
          res.end(fs.readFileSync(filePath));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Level not found' }));
        }
      } else {
        // List all JSON levels in data/
        const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(files));
      }
      return;
    }

    if (req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (!name) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Name parameter required' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const filePath = path.join(dataDir, name.endsWith('.json') ? name : `${name}.json`);
          fs.writeFileSync(filePath, body);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'success' }));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'API route not found' }));
};

export const apiPlugin = {
  name: 'api-plugin',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use(apiMiddleware);
  }
};

