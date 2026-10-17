'use strict';

(function () {
  const MOVE_COUNT = 10;
  const MOVES = ['rock', 'paper', 'scissors'];

  const els = {
    name: document.getElementById('name'),
    slots: document.getElementById('slots'),
    submit: document.getElementById('submit'),
    undo: document.getElementById('undo'),
    clear: document.getElementById('clear'),
    random: document.getElementById('random'),
    error: document.getElementById('error'),
  };

  let chosen = [];

  // Уже отправлял выбор в этой сессии — сразу в комнату.
  if (localStorage.getItem('rsp-name')) {
    location.replace('/room');
    return;
  }

  function showError(message) {
    els.error.textContent = message;
    els.error.classList.toggle('hidden', !message);
  }

  function render() {
    els.slots.innerHTML = Array.from({ length: MOVE_COUNT }, (_, i) => {
      const move = chosen[i];
      return move
        ? `<div class="slot">${window.RSP.shapeHtml(move)}</div>`
        : `<div class="slot empty" data-index="${i + 1}"></div>`;
    }).join('');

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
      showError('');
      render();
    });
  });

  els.undo.addEventListener('click', () => { chosen.pop(); render(); });
  els.clear.addEventListener('click', () => { chosen = []; render(); });
  els.random.addEventListener('click', () => {
    chosen = Array.from({ length: MOVE_COUNT }, () => MOVES[Math.floor(Math.random() * 3)]);
    showError('');
    render();
  });
  els.name.addEventListener('input', () => { showError(''); render(); });

  els.submit.addEventListener('click', async () => {
    els.submit.disabled = true;
    showError('');
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: els.name.value, moves: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не получилось войти');
      localStorage.setItem('rsp-name', data.name);
      location.href = '/room';
    } catch (err) {
      showError(err.message);
      render();
    }
  });

  render();
})();
