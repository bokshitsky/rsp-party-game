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
// /room/<код> — играем, /room/<код>/watch — только смотрим
const ROOM_PATH = /^\/room\/[A-Za-z0-9]{4,12}(\/watch)?\/?$/;

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

// /api/rooms                 POST   создать комнату
// /api/rooms/:code           GET    состояние для опроса
// /api/rooms/:code/join      POST   войти в игру
// /api/rooms/:code/draw      POST   объявить пары (админ)
// /api/rooms/:code/round     POST   сыграть объявленные пары (админ)
// /api/rooms/:code/reset     POST   собрать всех заново (админ)
// /api/switch                POST   новая кука, чтобы зайти другим игроком
async function handleApi(req, res, url, sid) {
  const segments = url.pathname.split('/').filter(Boolean); // ['api', 'rooms', code, action?]
  const post = req.method === 'POST';

  if (segments[1] === 'switch' && post) {
    // Прежний игрок остаётся в своей комнате, а мы начинаем с чистого листа.
    issueSession(res);
    return sendJson(res, 200, { ok: true });
  }

  if (segments[1] !== 'rooms') throw Object.assign(new Error('Не найдено'), { status: 404 });

  if (segments.length === 2) {
    if (!post) throw Object.assign(new Error('Метод не поддержан'), { status: 405 });
    const room = game.createRoom(sid);
    return sendJson(res, 200, { code: room.code });
  }

  const room = game.getRoom(segments[2]);
  const action = segments[3];

  if (!action) {
    if (req.method !== 'GET') throw Object.assign(new Error('Метод не поддержан'), { status: 405 });
    return sendJson(res, 200, game.publicState(room, sid));
  }

  if (!post) throw Object.assign(new Error('Метод не поддержан'), { status: 405 });

  switch (action) {
    case 'join': {
      const body = await readBody(req);
      game.join(room, sid, body.name, body.moves);
      break;
    }
    case 'draw':
      game.drawPairs(room, sid);
      break;
    case 'round':
      game.runRound(room, sid);
      break;
    case 'reset':
      game.reset(room, sid);
      break;
    default:
      throw Object.assign(new Error('Не найдено'), { status: 404 });
  }

  return sendJson(res, 200, game.publicState(room, sid));
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
  if (ROOM_PATH.test(url.pathname)) return serveFile(res, path.join(PUBLIC_DIR, 'room.html'));

  // Защита от выхода за пределы public/.
  const target = path.join(PUBLIC_DIR, path.normalize(url.pathname));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Запрещено');
    return;
  }
  serveFile(res, target);
});

setInterval(() => game.sweep(), 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`КАМЕНЬ · НОЖНИЦЫ · БУМАГА → http://localhost:${PORT}`);
});
