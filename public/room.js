'use strict';

(function () {
  const { shapeHtml, escapeHtml, LABELS } = window.RSP;
  const POLL_MS = 3000;

  const els = {
    statusTitle: document.getElementById('status-title'),
    statusText: document.getElementById('status-text'),
    adminBar: document.getElementById('admin-bar'),
    adminAction: document.getElementById('admin-action'),
    error: document.getElementById('error'),
    players: document.getElementById('players'),
    playerCount: document.getElementById('player-count'),
    rounds: document.getElementById('rounds'),
    champion: document.getElementById('champion'),
    me: document.getElementById('me'),
    switchUser: document.getElementById('switch-user'),
  };

  let latest = null;

  function showError(message) {
    els.error.textContent = message || '';
    els.error.classList.toggle('hidden', !message);
  }

  const STATUS = {
    lobby: {
      title: 'Ждём начала',
      text: 'Все выбрали фигуры и ждут, пока админ запустит первый раунд.',
      action: 'Начать игру',
    },
    playing: {
      title: 'Турнир идёт',
      text: 'Победители пар проходят в следующий раунд.',
      action: 'Следующий раунд',
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
    els.playerCount.textContent = state.players.length;
    if (!state.players.length) {
      els.players.innerHTML = '<p class="hint">Пока никто не выбрал фигуры.</p>';
      return;
    }
    els.players.innerHTML = state.players.map((name) => {
      const classes = ['player'];
      if (name === state.you.name) classes.push('is-you');
      if (name.toLowerCase() === state.adminName) classes.push('is-admin');
      return `<div class="${classes.join(' ')}"><i></i>${escapeHtml(name)}</div>`;
    }).join('');
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
      const matches = round.matches.map(renderMatch).join('');
      const bye = round.bye
        ? `<div class="bye">${escapeHtml(round.bye)} — проходит без боя</div>`
        : '';
      const count = round.matches.length;
      return `
        <section class="block">
          <div class="round-label">
            <span>Раунд ${round.number}</span>
            <em>${count} ${plural(count, 'пара', 'пары', 'пар')}${round.bye ? ' + 1 без боя' : ''}</em>
          </div>
          ${matches}${bye}
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

    // Нас тут нет: либо админ сбросил игру, либо мы сменили личность.
    if (state.phase === 'lobby' && !state.you.joined) {
      location.replace('/');
      return;
    }

    const info = STATUS[state.phase];

    els.me.textContent = state.you.name
      ? `Ты: ${state.you.name}${state.you.isAdmin ? ' · админ' : ''}`
      : 'Наблюдатель';

    els.statusTitle.textContent = info.title;
    els.statusText.textContent = state.phase === 'lobby' && state.players.length < 2
      ? 'Нужно минимум два игрока. Отправь остальным ссылку на главную страницу.'
      : info.text;

    els.adminBar.classList.toggle('hidden', !state.you.isAdmin);
    els.adminAction.textContent = info.action;
    els.adminAction.disabled = state.phase === 'lobby' && state.players.length < 2;

    renderPlayers(state);
    renderRounds(state);
    renderChampion(state);
  }

  async function poll() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('Сервер недоступен');
      render(await res.json());
      showError('');
    } catch (err) {
      showError(err.message);
    }
  }

  els.adminAction.addEventListener('click', async () => {
    if (!latest) return;
    const endpoint = latest.phase === 'finished' ? '/api/reset' : '/api/round';
    els.adminAction.disabled = true;
    showError('');
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не получилось');
      render(data);
    } catch (err) {
      showError(err.message);
      if (latest) render(latest);
    }
  });

  // Выдаёт новую куку: прежний игрок остаётся в игре, а мы заходим ещё раз.
  els.switchUser.addEventListener('click', async () => {
    await fetch('/api/switch', { method: 'POST' });
    location.href = '/';
  });

  poll();
  setInterval(poll, POLL_MS);
})();
