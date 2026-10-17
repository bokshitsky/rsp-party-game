'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const game = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE_NAME = 'rsp_sid';
const COOKIE_MAX_AGE = 12 * 60 * 60; // 12 часов — на один вечер хватает

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function parseCookies(header) {
  const jar = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    jar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return jar;
}

function issueSession(res) {
  const sid = crypto.randomBytes(16).toString('hex');
  // HttpOnly: личность живёт только на сервере, подменить её из консоли нельзя.
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${sid}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly`);
  return sid;
}

// Личность игрока — случайный идентификатор в куке, а не присланное имя.
function sessionId(req, res) {
  const existing = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return /^[a-f0-9]{32}$/.test(existing || '') ? existing : issueSession(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
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

async function handleApi(req, res, url, sid) {
  if (url.pathname === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, game.publicState(sid));
  }

  if (req.method !== 'POST') throw Object.assign(new Error('Метод не поддержан'), { status: 405 });
  const body = await readBody(req);

  switch (url.pathname) {
    case '/api/join': {
      const name = game.join(sid, body.name, body.moves);
      return sendJson(res, 200, { name });
    }
    case '/api/round': {
      game.startRound(sid);
      return sendJson(res, 200, game.publicState(sid));
    }
    case '/api/reset': {
      game.reset(sid);
      return sendJson(res, 200, game.publicState(sid));
    }
    case '/api/switch': {
      // Новая кука = чистая личность. Прежний игрок остаётся в игре —
      // так из одного браузера можно завести ещё одного участника.
      issueSession(res);
      return sendJson(res, 200, { ok: true });
    }
    default:
      throw Object.assign(new Error('Не найдено'), { status: 404 });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const sid = sessionId(req, res);

  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url, sid);
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
