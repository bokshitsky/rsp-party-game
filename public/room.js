'use strict';

(function () {
  const { shapeHtml, escapeHtml, LABELS } = window.RSP;
  const POLL_MS = 3000;
  const MOVE_COUNT = 10;
  const MOVES = ['rock', 'paper', 'scissors'];
  const CODE = location.pathname.split('/').filter(Boolean)[1].toUpperCase();
  const API = `/api/rooms/${encodeURIComponent(CODE)}`;

  const els = {};
  for (const id of ['missing', 'join-view', 'room-view', 'name', 'slots', 'submit', 'undo',
    'clear', 'random', 'join-error', 'status-title', 'status-text', 'admin-bar', 'admin-action',
    'error', 'invite-block', 'invite-link', 'copy', 'players', 'player-count', 'pending',
    'rounds', 'champion', 'me', 'switch-user']) {
    els[id] = document.getElementById(id);
  }

  let latest = null;
  let chosen = [];

  function show(el, visible) {
    el.classList.toggle('hidden', !visible);
  }

  function setError(el, message) {
    el.textContent = message || '';
    show(el, Boolean(message));
  }

  /* ── Выбор имени и фигур ─────────────────────────── */

  function renderPicker() {
    els.slots.innerHTML = Array.from({ length: MOVE_COUNT }, (_, i) => (chosen[i]
      ? `<div class="slot">${shapeHtml(chosen[i])}</div>`
      : `<div class="slot empty" data-index="${i + 1}"></div>`)).join('');

    const full = chosen.length === MOVE_COUNT;
    els.submit.disabled = !(full && els.name.value.trim());
    els.undo.disabled = chosen.length === 0;
    els.clear.disabled = chosen.length === 0;
    document.querySelectorAll('.pick').forEach((btn) => { btn.disabled = full; });
  }

  document.querySelectorAll('.pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (chosen.length >= MOVE_COUNT) return;
      chosen.push(btn.dataset.move);
      setError(els['join-error'], '');
      renderPicker();
    });
  });

  els.undo.addEventListener('click', () => { chosen.pop(); renderPicker(); });
  els.clear.addEventListener('click', () => { chosen = []; renderPicker(); });
  els.random.addEventListener('click', () => {
    chosen = Array.from({ length: MOVE_COUNT }, () => MOVES[Math.floor(Math.random() * 3)]);
    setError(els['join-error'], '');
    renderPicker();
  });
  els.name.addEventListener('input', () => { setError(els['join-error'], ''); renderPicker(); });

  els.submit.addEventListener('click', async () => {
    els.submit.disabled = true;
    setError(els['join-error'], '');
    const state = await post('join', { name: els.name.value, moves: chosen }, els['join-error']);
    if (state) {
      chosen = [];
      render(state);
    } else {
      renderPicker();
    }
  });

  /* ── Комната ─────────────────────────────────────── */

  const STATUS = {
    lobby: {
      title: 'Набор игроков',
      text: 'Когда все выберут фигуры, админ объявит пары первого раунда.',
      action: 'Объявить пары',
    },
    draw: {
      title: 'Пары объявлены',
      text: 'Фигуры пока закрыты. Админ запускает раунд, и все увидят результат.',
      action: 'Запустить раунд',
    },
    revealed: {
      title: 'Раунд сыгран',
      text: 'Победители пар идут дальше — админ объявит пары следующего раунда.',
      action: 'Объявить пары следующего раунда',
    },
    finished: {
      title: 'Игра завершена',
      text: 'Можно собрать всех заново.',
      action: 'Новая игра',
    },
  };

  function plural(count, one, few, many) {
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    const mod10 = count % 10;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function renderPlayers(state) {
    els['player-count'].textContent = state.players.length;
    els.players.innerHTML = state.players.length
      ? state.players.map((name) => {
        const you = name === state.you.name ? ' is-you' : '';
        return `<div class="player${you}"><i></i>${escapeHtml(name)}</div>`;
      }).join('')
      : '<p class="hint">Пока никто не выбрал фигуры.</p>';
  }

  // Пары следующего раунда: только имена, фигуры ещё закрыты.
  function renderPending(state) {
    const pending = state.pending;
    if (!pending) {
      els.pending.innerHTML = '';
      return;
    }
    const pairs = pending.pairs.map((pair) => `
      <div class="pair">
        <span class="pair-side">${escapeHtml(pair.a)}</span>
        <span class="pair-vs">против</span>
        <span class="pair-side">${escapeHtml(pair.b)}</span>
      </div>`).join('');
    const bye = pending.bye
      ? `<div class="bye">${escapeHtml(pending.bye)} — проходит без боя</div>`
      : '';
    const count = pending.pairs.length;
    els.pending.innerHTML = `
      <section class="block">
        <div class="round-label">
          <span>Раунд ${pending.number} · кто с кем</span>
          <em>${count} ${plural(count, 'пара', 'пары', 'пар')}${pending.bye ? ' + 1 без боя' : ''}</em>
        </div>
        ${pairs}${bye}
      </section>`;
  }

  function renderStrip(steps, side, decidedAt) {
    return steps.map((step, i) => {
      const classes = ['cell'];
      if (decidedAt !== null && i === decidedAt) classes.push('decider');
      if (decidedAt !== null && i > decidedAt) classes.push('after');
      const move = step[side];
      return `<div class="${classes.join(' ')}" title="${LABELS[move]}">${shapeHtml(move)}</div>`;
    }).join('');
  }

  function renderMatch(match) {
    const sideHtml = (name, key) => `
      <div class="side${match.winner === name ? ' won' : ''}">
        <div class="side-name">${escapeHtml(name)}</div>
        <div class="strip">${renderStrip(match.steps, key, match.decidedAt)}</div>
      </div>`;
    const note = match.tiebreak
      ? '<div class="match-note">Все десять фигур совпали — победителя выбрала монетка</div>'
      : '';
    return `<div class="match">${sideHtml(match.a, 'a')}${sideHtml(match.b, 'b')}${note}</div>`;
  }

  function renderRounds(state) {
    els.rounds.innerHTML = state.rounds.map((round) => {
      const bye = round.bye
        ? `<div class="bye">${escapeHtml(round.bye)} — прошёл без боя</div>`
        : '';
      const count = round.matches.length;
      return `
        <section class="block">
          <div class="round-label">
            <span>Раунд ${round.number}</span>
            <em>${count} ${plural(count, 'пара', 'пары', 'пар')}${round.bye ? ' + 1 без боя' : ''}</em>
          </div>
          ${round.matches.map(renderMatch).join('')}${bye}
        </section>`;
    }).join('');
  }

  function renderChampion(state) {
    els.champion.innerHTML = state.champion
      ? `<div class="champion"><small>Победитель</small><strong>${escapeHtml(state.champion)}</strong></div>`
      : '';
  }

  function render(state) {
    latest = state;
    const info = STATUS[state.phase];
    const canJoin = state.phase === 'lobby' && !state.you.joined;

    show(els.missing, false);
    show(els['room-view'], true);
    show(els['join-view'], canJoin);
    if (canJoin) renderPicker();

    els.me.textContent = state.you.name
      ? `Ты: ${state.you.name}${state.you.isAdmin ? ' · ведёшь игру' : ''}`
      : (state.you.isAdmin ? 'Ты ведёшь игру' : 'Наблюдатель');

    els['status-title'].textContent = info.title;
    els['status-text'].textContent = state.phase === 'lobby' && state.players.length < 2
      ? 'Нужно минимум два игрока — отправь остальным ссылку ниже.'
      : info.text;

    show(els['admin-bar'], state.you.isAdmin);
    els['admin-action'].textContent = info.action;
    els['admin-action'].disabled = state.phase === 'lobby' && state.players.length < 2;

    show(els['invite-block'], state.phase === 'lobby');
    els['invite-link'].textContent = `${location.origin}/room/${state.code}`;

    renderPlayers(state);
    renderPending(state);
    renderRounds(state);
    renderChampion(state);
  }

  /* ── Обмен с сервером ────────────────────────────── */

  async function post(action, body, errorEl) {
    try {
      const res = await fetch(`${API}/${action}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не получилось');
      return data;
    } catch (err) {
      setError(errorEl, err.message);
      return null;
    }
  }

  async function poll() {
    try {
      const res = await fetch(API, { cache: 'no-store' });
      if (res.status === 404) {
        show(els.missing, true);
        show(els['room-view'], false);
        show(els['join-view'], false);
        return;
      }
      if (!res.ok) throw new Error('Сервер недоступен');
      render(await res.json());
      setError(els.error, '');
    } catch (err) {
      setError(els.error, err.message);
    }
  }

  els['admin-action'].addEventListener('click', async () => {
    if (!latest) return;
    const action = { lobby: 'draw', draw: 'round', revealed: 'draw', finished: 'reset' }[latest.phase];
    els['admin-action'].disabled = true;
    setError(els.error, '');
    const state = await post(action, null, els.error);
    if (state) render(state);
    else if (latest) render(latest);
  });

  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els['invite-link'].textContent);
      els.copy.textContent = 'Скопировано';
    } catch {
      // Буфер недоступен (например, по http не на localhost) — ссылка и так на виду.
      els.copy.textContent = 'Скопируй вручную';
    }
    setTimeout(() => { els.copy.textContent = 'Скопировать'; }, 2000);
  });

  // Выдаёт новую куку: прежний игрок остаётся в комнате, а мы заходим ещё раз.
  els['switch-user'].addEventListener('click', async () => {
    await fetch('/api/switch', { method: 'POST' });
    location.reload();
  });

  poll();
  setInterval(poll, POLL_MS);
})();
