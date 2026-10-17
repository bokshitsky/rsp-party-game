// Общие помощники: как рисуется фигура и как она называется.
window.RSP = (function () {
  'use strict';

  const LABELS = { rock: 'Камень', paper: 'Бумага', scissors: 'Ножницы' };

  // Треугольнику нужна настоящая обводка, поэтому он SVG, а не div с clip-path:
  // так он одинаково выглядит и крупной кнопкой, и мелкой иконкой в паре.
  const TRIANGLE = '<svg class="shape shape-scissors" viewBox="0 0 100 100"'
    + ' preserveAspectRatio="none" aria-hidden="true"><polygon points="50,7 95,93 5,93"/></svg>';

  function shapeHtml(move) {
    return move === 'scissors' ? TRIANGLE : `<span class="shape shape-${move}"></span>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  return { LABELS, TRIANGLE, shapeHtml, escapeHtml };
})();
