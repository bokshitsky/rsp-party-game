'use strict';

(function () {
  const create = document.getElementById('create');
  const error = document.getElementById('error');

  create.addEventListener('click', async () => {
    create.disabled = true;
    error.classList.add('hidden');
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не получилось создать комнату');
      location.href = `/room/${data.code}`;
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
      create.disabled = false;
    }
  });
})();
