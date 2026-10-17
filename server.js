'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const game = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Ожидался JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Не найдено');
      return;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, game.publicState(url.searchParams.get('name')));
  }

  if (req.method !== 'POST') throw Object.assign(new Error('Метод не поддержан'), { status: 405 });
  const body = await readBody(req);

  switch (url.pathname) {
    case '/api/join': {
      const name = game.join(body.name, body.moves);
      return sendJson(res, 200, { name });
    }
    case '/api/round': {
      game.startRound(body.name);
      return sendJson(res, 200, game.publicState(body.name));
    }
    case '/api/reset': {
      game.reset(body.name);
      return sendJson(res, 200, game.publicState(body.name));
    }
    default:
      throw Object.assign(new Error('Не найдено'), { status: 404 });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message || 'Внутренняя ошибка' });
    }
    return;
  }

  if (url.pathname === '/') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
  if (url.pathname === '/room') return serveFile(res, path.join(PUBLIC_DIR, 'room.html'));

  // Защита от выхода за пределы public/.
  const target = path.join(PUBLIC_DIR, path.normalize(url.pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Запрещено');
    return;
  }
  serveFile(res, target);
});

server.listen(PORT, () => {
  console.log(`КАМЕНЬ · НОЖНИЦЫ · БУМАГА → http://localhost:${PORT}`);
  console.log(`Комната: http://localhost:${PORT}/room   Админ: «${game.ADMIN_NAME}»`);
});
