'use strict';

const crypto = require('crypto');

const MOVES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const MOVE_COUNT = 10;
const MAX_NAME_LENGTH = 24;
const CODE_LENGTH = 6;
// Без I, O, 0 и 1 — чтобы код из ссылки нельзя было прочитать двояко.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

// Всё живёт в памяти процесса: перезапуск сервера = все комнаты исчезли.
const rooms = new Map(); // код -> комната

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function newCode() {
  let code;
  do {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(sid) {
  const room = {
    code: newCode(),
    adminSid: sid, // админ — тот, кто создал комнату
    phase: 'lobby', // lobby | draw | revealed | finished
    players: new Map(), // sid -> { name, moves, hash }
    pending: null, // объявленные пары следующего раунда, ещё без результата
    rounds: [],
    champion: null,
    touchedAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function getRoom(rawCode) {
  const room = rooms.get(String(rawCode || '').toUpperCase());
  if (!room) throw fail(404, 'Комната не найдена');
  room.touchedAt = Date.now();
  return room;
}

function isAdmin(room, sid) {
  return room.adminSid === sid;
}

function requireAdmin(room, sid) {
  if (!isAdmin(room, sid)) throw fail(403, 'Это может только админ комнаты');
}

function byName(room, name) {
  const lower = String(name).toLowerCase();
  return [...room.players.values()].find((player) => player.name.toLowerCase() === lower);
}

// Отпечаток игрока: имя + его выборы. От него зависит порядок в сетке,
// поэтому разбиение на пары одинаково на любом запуске с теми же данными.
function fingerprint(name, moves) {
  return crypto.createHash('sha256').update(`${name}|${moves.join(',')}`).digest('hex');
}

function join(room, sid, rawName, moves) {
  if (room.phase !== 'lobby') throw fail(409, 'Набор в эту игру уже закрыт');
  if (room.players.has(sid)) throw fail(409, 'Ты уже в игре');

  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw fail(400, 'Введите имя');
  if (!Array.isArray(moves) || moves.length !== MOVE_COUNT) {
    throw fail(400, `Нужно выбрать ровно ${MOVE_COUNT} фигур`);
  }
  if (!moves.every((move) => MOVES.includes(move))) throw fail(400, 'Недопустимая фигура');
  if (byName(room, name)) throw fail(409, 'Это имя уже занято');

  room.players.set(sid, { name, moves: moves.slice(), hash: fingerprint(name, moves) });
  return name;
}

// Сравниваем фигуры по порядку: решает первая несовпавшая пара.
function duel(a, b) {
  const steps = [];
  let winner = null;
  let decidedAt = null;

  for (let i = 0; i < MOVE_COUNT; i += 1) {
    const moveA = a.moves[i];
    const moveB = b.moves[i];
    const result = moveA === moveB ? 'tie' : (BEATS[moveA] === moveB ? 'a' : 'b');
    steps.push({ a: moveA, b: moveB, result });

    if (result !== 'tie' && winner === null) {
      winner = result === 'a' ? a : b;
      decidedAt = i;
    }
  }

  // Все десять фигур совпали — бросаем монетку.
  const tiebreak = winner === null;
  if (tiebreak) winner = Math.random() < 0.5 ? a : b;

  return { steps, winner: winner.name, decidedAt, tiebreak };
}

function advancing(room, round) {
  const names = round.matches.map((match) => match.winner);
  if (round.bye) names.push(round.bye);
  return names.map((name) => byName(room, name));
}

// Шаг первый: объявляем, кто с кем играет. Фигуры при этом не раскрываются.
function drawPairs(room, sid) {
  requireAdmin(room, sid);
  if (room.phase === 'draw') throw fail(409, 'Пары уже объявлены');
  if (room.phase === 'finished') throw fail(409, 'Игра уже завершена');

  const contenders = room.rounds.length === 0
    ? [...room.players.values()]
    : advancing(room, room.rounds[room.rounds.length - 1]);
  if (contenders.length < 2) throw fail(409, 'Нужно минимум два игрока');

  contenders.sort((x, y) => x.hash.localeCompare(y.hash));

  const pairs = [];
  let bye = null;
  for (let i = 0; i < contenders.length; i += 2) {
    if (i + 1 >= contenders.length) {
      bye = contenders[i].name;
      break;
    }
    pairs.push({ a: contenders[i].name, b: contenders[i + 1].name });
  }

  room.pending = { number: room.rounds.length + 1, pairs, bye };
  room.phase = 'draw';
  return room.pending;
}

// Шаг второй: играем объявленные пары и показываем результат.
function runRound(room, sid) {
  requireAdmin(room, sid);
  if (room.phase !== 'draw') throw fail(409, 'Сначала нужно объявить пары');

  const matches = room.pending.pairs.map(({ a, b }) => ({
    a, b, ...duel(byName(room, a), byName(room, b)),
  }));

  const round = { number: room.pending.number, matches, bye: room.pending.bye };
  room.rounds.push(round);
  room.pending = null;
  room.phase = 'revealed';

  const next = advancing(room, round);
  if (next.length === 1) {
    room.champion = next[0].name;
    room.phase = 'finished';
  }

  return round;
}

function reset(room, sid) {
  requireAdmin(room, sid);
  room.phase = 'lobby';
  room.players.clear();
  room.pending = null;
  room.rounds = [];
  room.champion = null;
}

function publicState(room, sid) {
  const me = room.players.get(sid);
  return {
    code: room.code,
    phase: room.phase,
    moveCount: MOVE_COUNT,
    players: [...room.players.values()].map((player) => player.name),
    // В pending только имена: кто с кем играет видно, а чужие фигуры — нет.
    pending: room.pending,
    // Фигуры раскрываются только внутри уже сыгранных пар.
    rounds: room.rounds,
    champion: room.champion,
    you: {
      name: me?.name || null,
      joined: Boolean(me),
      isAdmin: isAdmin(room, sid),
    },
  };
}

// Комнаты, в которые полсуток никто не заходил, занимают память зря.
function sweep(now = Date.now()) {
  let removed = 0;
  for (const [code, room] of rooms) {
    if (now - room.touchedAt > ROOM_TTL_MS) {
      rooms.delete(code);
      removed += 1;
    }
  }
  return removed;
}

module.exports = {
  MOVES, MOVE_COUNT, createRoom, getRoom, join, drawPairs, runRound, reset, publicState, sweep,
};
