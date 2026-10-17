// Общие помощники: как рисуется фигура и как она называется.
window.RSP = (function () {
  'use strict';

  const LABELS = { rock: 'Камень', paper: 'Бумага', scissors: 'Ножницы' };

  function shapeHtml(move) {
    if (move === 'scissors') {
      return '<span class="shape-scissors-wrap"><span class="shape shape-scissors"></span></span>';
    }
    return `<span class="shape shape-${move}"></span>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  return { LABELS, shapeHtml, escapeHtml };
})();
