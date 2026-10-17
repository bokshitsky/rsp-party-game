'use strict';

const crypto = require('crypto');

const MOVES = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const MOVE_COUNT = 10;
const ADMIN_NAME = 'boksh';
const MAX_NAME_LENGTH = 24;

// Всё состояние живёт в памяти процесса: перезапуск сервера = новая игра.
// Ключ игрока — случайный идентификатор из куки, а не имя.
const state = {
  phase: 'lobby', // lobby | playing | finished
  players: new Map(), // sid -> { name, moves, hash }
  rounds: [], // [{ number, matches, bye }]
  champion: null,
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function byName(name) {
  const lower = String(name).toLowerCase();
  return [...state.players.values()].find((player) => player.name.toLowerCase() === lower);
}

function isAdmin(sid) {
  return state.players.get(sid)?.name.toLowerCase() === ADMIN_NAME;
}

// Отпечаток игрока: имя + его выборы. От него зависит порядок в сетке,
// поэтому разбиение на пары одинаково на любом запуске с теми же данными.
function fingerprint(name, moves) {
  return crypto.createHash('sha256').update(`${name}|${moves.join(',')}`).digest('hex');
}

function join(sid, rawName, moves) {
  if (state.phase !== 'lobby') throw fail(409, 'Игра уже началась');
  if (state.players.has(sid)) throw fail(409, 'Ты уже в игре');

  const name = String(rawName || '').trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw fail(400, 'Введите имя');
  if (!Array.isArray(moves) || moves.length !== MOVE_COUNT) {
    throw fail(400, `Нужно выбрать ровно ${MOVE_COUNT} фигур`);
  }
  if (!moves.every((move) => MOVES.includes(move))) throw fail(400, 'Недопустимая фигура');
  if (byName(name)) throw fail(409, 'Это имя уже занято');

  state.players.set(sid, { name, moves: moves.slice(), hash: fingerprint(name, moves) });
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

function advancing(round) {
  const names = round.matches.map((match) => match.winner);
  if (round.bye) names.push(round.bye);
  return names.map(byName);
}

function startRound(sid) {
  if (!isAdmin(sid)) throw fail(403, 'Раунды запускает только админ');
  if (state.phase === 'finished') throw fail(409, 'Игра уже завершена');

  let contenders;
  if (state.rounds.length === 0) {
    if (state.players.size < 2) throw fail(409, 'Нужно минимум два игрока');
    contenders = [...state.players.values()];
  } else {
    contenders = advancing(state.rounds[state.rounds.length - 1]);
  }

  state.phase = 'playing';
  contenders.sort((x, y) => x.hash.localeCompare(y.hash));

  const matches = [];
  let bye = null;
  for (let i = 0; i < contenders.length; i += 2) {
    if (i + 1 >= contenders.length) {
      bye = contenders[i].name;
      break;
    }
    const a = contenders[i];
    const b = contenders[i + 1];
    matches.push({ a: a.name, b: b.name, ...duel(a, b) });
  }

  const round = { number: state.rounds.length + 1, matches, bye };
  state.rounds.push(round);

  const next = advancing(round);
  if (next.length === 1) {
    state.champion = next[0].name;
    state.phase = 'finished';
  }

  return round;
}

function reset(sid) {
  if (!isAdmin(sid)) throw fail(403, 'Сбросить игру может только админ');
  state.phase = 'lobby';
  state.players.clear();
  state.rounds = [];
  state.champion = null;
}

function publicState(sid) {
  const me = state.players.get(sid);
  return {
    phase: state.phase,
    adminName: ADMIN_NAME,
    moveCount: MOVE_COUNT,
    players: [...state.players.values()].map((player) => player.name),
    // Чужие фигуры видны только внутри уже сыгранных пар — до этого они секрет.
    rounds: state.rounds,
    champion: state.champion,
    you: {
      name: me?.name || null,
      joined: Boolean(me),
      isAdmin: isAdmin(sid),
    },
  };
}

module.exports = { MOVES, MOVE_COUNT, ADMIN_NAME, join, startRound, reset, publicState };
