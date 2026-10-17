/* ==========================================================================
   KUROMI XP — cursor da Kuromi DENTRO dos painéis do jogo (<webview>)
   O CSS do launcher não atravessa o webview, então o cursor é injetado
   via webview.insertCSS quando um tema kuromi-xp* está ativo, e removido
   (removeInsertedCSS) ao trocar para outro tema.
   Os cursores vão como PNG data URI: o jogo roda em https e não consegue
   carregar arquivos file:// do launcher.
   ========================================================================== */
(() => {
  'use strict';

  const PNG = {
    normal: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFqSURBVFhH7VUxjoQwEONFlBQUtGnvddfxjuvvF9vwFU6D1pFjZiCRsluc1pK1SzIzdpIJDCmlHRzehEKTH1JKGvsSnAzM83w82K9RE3phWZbdyJp5gl29wgQEQdPMk3IM3U2oOJgDdKKXkUi42oDTE1/DMKw3tJgDyNe6xGsD4ziaOAo/tFc8Ps/2gTyroTFgXhYPasI0TblzW2g5lstjWjsbIFw6Bm1b9+/fgjdbfZB21EeNuFHFQY3z+DThQ4MjQoyFaw0YVRdYNTCirrxlB4zuMWjQHbkPas5fqfqhgW3bdsD+85x3z6/imarvGuBiDK9wS2yVASRG4MKRuIFrNRngAldGImie1lf90yc5SrxDFM9jxaeYUFxDL7GXAfcaGngXcK5RwQhePPdAtHpgZRNa9AS8hAQaL+L+6gnZRNTdnhlvzIDV14oDP95xMDCnqwX06rWIM4rG9Iwoegkrqj9UvYU/+OD/4w/p8TolEhzejAAAAABJRU5ErkJggg==',
    link: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAVMSURBVFhHzVdrTBRXFN5EJTTt7wbTYPurSV/Czs7rzp2ZnYXdRdANUt4oYLWY2kKq1lhLS63VtqLCRhvTVuojGjCNadQWH5GqC6m2AUQbgVqUrhSDrT8sjyAisqe5A7uZuQNYG0j6Jd+P4X7nfOeee+4FbLYxwCM4o4COjo4pOdNF6CZ+v39SznQn/t8FzPgsREdHw8kTJ6cynXbzVF8q0lTXLU+i56CNtbOgYCcUv1U8VQHTikSXu0xTXYCRPGBj7A6QJQUK8wsnKmBaUVnpn+1xe5dhJP8uI/lSqm+xzxYVFQWbPtoEIieC2+WG2NhYmDNnzrQWUL61fFZyUnIB4qUOLMohVXYCRnhdRBATM5e0A0hbFEkFJp4BgRM3FywtiDFlekzUVB+e5Un05Aqs8Ksk4hDJT0g6nupLzYsIC/MLRZFH+mKYpEqO4QYlUarKzcl73pT5X8Dr9i4SefSL0ThMxEuQkZ4hRcRr1qx9mrVzFiGhU9GAZ4URjOQjmRlZL5pcJkBmeuZzGMkBxEsT5iPkHHyosGDZvEjQH13ds0QeDdJCExUNNFU7bjSr/a42asfW7U/W1dXNDv9MQjhfkRRrvIEsw42c/eFstDGXLUFL+I0W0nSq2iUkoE9kJAckEf/FxDuGmXjHQ9bODcmSchMJ6JgsycexODZPk9GpaLdM5gRYxGdoYZhIkCD+FTsIrDjeCasmTAWr4LCzwMxnQMVOyzqhJOCfaX+bIqn7NDXBJCTnb5/PjBlPkGgqklgmjgHEmYebUMXqUdrfluRJKjPujiSIezle3xGdIEJFgyQ1gRyNdW2cvEMwbcClusDj9u6i/W3uRPdScj/DQtJydRLzZM0Dp9/dDnd2fQv9X3wPXRU18OXK9RZdmKydi7wz5Hq7nK61tL8tOzObZ+IcD8mOyZsgTtC6MM9s2AH9u4+Z2Lf7GJQXFlu0Yc5/KQ4kQWoVObE8KyNrLu2vIyc791lVVlcJrDBEJzAyuP0Q1G2ogB7/N7p5y+avoO3TvXBq/TaLNkxJkMC30JdOe1pQ9HrRC+ShoBMYWf/+Tqgu+RDu7DyiF3BlSxX8WPY57Fqx1qI10qloR2g/C1ya6w3y+4AOJiT3mwzU4oQF+m5JB25sOwhdO6ph35ul5HrpxzfZ4GIR36T9LFCwWklfRzKcFRWVEAwGoa+vD+rr62H126thdVo+lKQthVWL86Cqqkpff/DgAVy4cAGSk1IsBUgi7qX9LPC6vV8bCyDTe6L2BAz0D4ARoVAIOjs7IXA+AL29vaY1gqbGJvC6veYOIPlv2s8CBSvlxqA9e/ZAf38/+Cv90HKpBUZHR2kvE0gxh2sOQ92ZOmhoaDAdhywp7bSfBSkLUjIkEesB5Anu7u7WExcXl0BszDxobGykPU0oGdc1NTXByMgIpL+aESnAqWh7aT8Lyj4oewLx6E8SwDIc3L9/X0/82rLleuL29nba04Qtm7fouosXL+rfpe+V6uYiJ4ZysnNU2m9CLEpZtATxKMQ5eBgYGDv76x3X4fy586Yj6LreCS2Hjppm4Pbt23D61Gm4d++ers3KzNZfP1V21tA+U2KBN7mUtXOjzU3NkeRGkF113eyC1oafoKenR/+mQf7fINcWi/jcxrKNT9Eej4RvoS8lL3fJjWAwGDImHhwchOHhYdOEDw0NGSVw9+5dKCpaOehUtI+3flYeRed+LCiS2rfunXVQW1sLgUAArl27BlevXoXLl69AfX0DtLW16WxubobW1jY4sP8ApKWmtS5fvuIZOtd/Btnl+FlOyfBfQ8bYVdkFLuO3Ef8A6PtHORMsVKQAAAAASUVORK5CYII=',
    text: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABcSURBVFhH7ZTBCQAxCATT/8f+bMVHgqIdhAzH7YDvHWTZtYQQH2f3IWwzq6MkKtzdJcAJRAQrgH/g3wIZPh1oibdMcEr0GD2nBNAllMB0ABXAPyABUiBBw4W4wgGti6SAiPT5pwAAAABJRU5ErkJggg=='
  };
  const url = (k) => `url("data:image/png;base64,${PNG[k]}")`;

  // !important em tudo: o jogo define cursor em vários elementos
  const CSS = `
    html, body, body * { cursor: ${url('normal')} 0 0, auto !important; }
    a, a *, button, button *, summary, label, select, [role="button"], [role="button"] *,
    [onclick], [onclick] *, .clickable, [class*="btn"], [class*="button"] { cursor: ${url('link')} 0 0, pointer !important; }
    input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]),
    textarea, [contenteditable="true"] { cursor: ${url('text')} 16 16, text !important; }
  `;

  const isKuromi = () => (document.body?.dataset.theme || '').startsWith('kuromi-xp');
  const keys = new WeakMap();      // webview -> chave do insertCSS
  const hooked = new WeakSet();    // webviews que já recebem o listener

  /* Na barra lateral o botão "Abrir janela" fica escondido: a conta inteira abre. */
  function hookCardClicks() {
    document.getElementById('leafAccountList')?.addEventListener('click', e => {
      if (!isKuromi() || e.target.closest('[data-open]')) return;
      const card = e.target.closest('.leaf-account');
      if (!card) return;
      const btn = card.querySelector('[data-open]');
      if (btn) btn.click();
    });
  }

  async function apply(wv) {
    if (!wv || typeof wv.insertCSS !== 'function') return;
    try {
      const old = keys.get(wv);
      if (old) { keys.delete(wv); await wv.removeInsertedCSS(old).catch(() => {}); }
      if (isKuromi()) keys.set(wv, await wv.insertCSS(CSS));
    } catch { /* webview ainda não pronto: o dom-ready tenta de novo */ }
  }

  function hook(wv) {
    if (hooked.has(wv)) return;
    hooked.add(wv);
    // a cada página carregada o CSS injetado some: reaplica
    wv.addEventListener('dom-ready', () => { keys.delete(wv); apply(wv); });
    apply(wv);
  }

  const all = () => document.querySelectorAll('webview');
  const scan = () => all().forEach(hook);

  window.addEventListener('piw-theme-changed', () => all().forEach(apply));
  document.addEventListener('DOMContentLoaded', () => {
    hookCardClicks();
    scan();
    // painéis são criados/recriados ao mudar a quantidade de contas
    const grid = document.getElementById('grid');
    if (grid) new MutationObserver(scan).observe(grid, { childList: true, subtree: true });
  });
})();
