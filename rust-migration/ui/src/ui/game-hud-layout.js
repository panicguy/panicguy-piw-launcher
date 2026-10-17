// Optional presentation of the game's existing dock. Buttons and handlers stay intact.
(function (root) {
  const modes = ['original', 'icons', 'labels'];
  const normalize = mode => modes.includes(mode) ? mode : 'original';

  function install(mode) {
    const key = '__rebosteioHudLayout';
    if (window[key]?.version === 4) { window[key].setMode(mode); return; }
    if (window[key]) window[key].setMode('original');
    if (mode === 'original') return; // No guest hooks or DOM changes until enabled.

    const style = document.createElement('style');
    style.id = 'rb-hud-layout';
    const saved = new Map();
    let dock = null;
    let current = mode;
    const observer = new MutationObserver(refresh);
    const secondaryActions = new Set(['casa', 'campeonato', 'ginasios', 'pvp', 'ranking']);
    const moved = new Map();
    let moreButton = null;
    let moreMenu = null;
    const icons = [
      [/pok[eé]dex/i, '◉'], [/mapa|map/i, '⌖'], [/market|mercado/i, '▣'],
      [/passe|pass/i, '✦'], [/rank/i, '▤'], [/boss/i, '♜'], [/pvp/i, '⚔'],
      [/gin[aá]sio|gym/i, '◆'], [/torneio|tournament/i, '⚑'], [/rmt/i, '⇄'],
      [/casa|house|home/i, '⌂'], [/shop|loja/i, '▱'], [/wiki/i, '?']
    ];
    const css = `
      nav[data-rb-hud] {
        grid-template-columns: none !important; grid-auto-flow: column !important;
        gap: 4px !important; padding: 4px !important;
        min-height: 0 !important; height: auto !important;
        flex-wrap: wrap !important; align-items: center !important;
      }
      html:not(.modo-imersivo) nav[data-rb-hud]:not([hidden]):not([style*="display: none"]) { display: flex !important; }
      nav[data-rb-hud] [data-rb-hud-icon] {
        flex: 0 0 auto !important; min-height: 32px !important; height: 32px !important;
        display: flex !important; flex-direction: row !important; align-items: center !important;
        justify-content: center !important; gap: 5px !important;
        margin: 0 !important; padding: 4px 6px !important;
        font-size: 12px !important; line-height: 1 !important;
        box-shadow: inset 0 0 0 1px #ffffff40 !important;
        background: #68358c !important; border-radius: 5px !important;
        text-shadow: none !important;
      }
      nav[data-rb-hud] [data-rb-hud-icon]:not([data-rb-hud-native])::before {
        content: attr(data-rb-hud-icon); display: inline-block !important;
        font: 18px/1 system-ui !important; color: inherit;
      }
      nav[data-rb-hud] [data-rb-hud-icon] > :is(img, svg, .ico) {
        display: block !important; width: 20px !important; height: 20px !important;
        flex: 0 0 20px !important; object-fit: contain !important;
        box-shadow: none !important; background-color: transparent !important;
      }
      nav[data-rb-hud="icons"] [data-rb-hud-icon] {
        width: 36px !important; min-width: 36px !important; max-width: 36px !important;
        font-size: 0 !important;
      }
      nav[data-rb-hud="icons"] [data-rb-hud-icon] > :not(img):not(svg):not(.ico) { display: none !important; }
      nav[data-rb-hud="labels"] [data-rb-hud-icon] {
        width: auto !important; min-width: 0 !important; max-width: none !important;
      }
      nav[data-rb-hud="labels"] [data-rb-hud-icon] > [data-i18n] {
        font: 600 12px/1 system-ui !important;
        box-shadow: none !important; background-color: transparent !important;
      }
      nav[data-rb-hud="labels"] [data-rb-hud-more] > span { font: 600 12px/1 system-ui !important; }
      #rb-hud-more-menu {
        display: none !important; position: fixed !important; inset: auto !important; margin: 0 !important;
        box-sizing: border-box !important; width: min(190px, calc(100vw - 16px)) !important;
        max-height: min(240px, calc(100vh - 16px)) !important; overflow-y: auto !important;
        padding: 6px !important; gap: 4px !important; border: 1px solid var(--mad-linha, #302335) !important;
        border-radius: 7px !important; background: var(--mad, #543037) !important;
        box-shadow: 0 8px 24px #0008 !important;
      }
      #rb-hud-more-menu:popover-open { display: grid !important; }
      #rb-hud-more-menu [data-rb-hud-icon] { width: 100% !important; justify-content: flex-start !important; }
      nav[data-rb-hud] [data-rb-hud-icon]:focus-visible { outline: 2px solid #ffe3c0 !important; outline-offset: 1px !important; }
      /* The native vertical rail divides --menu-alt between two buttons. A
         compact single row makes them only 14px tall. Put both native controls
         beside each other so the rail fits above the stage without overlap. */
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) .app { --col-dir: 100px !important; }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) .col.dir {
        flex-direction: row !important; align-items: flex-start !important; gap: 12px !important;
      }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) nav[data-rb-hud] { min-height: 44px !important; }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) :is(#p-auto, #p-chat).recolhida {
        flex: 0 0 44px !important; width: 44px !important;
        height: 44px !important; min-height: 44px !important; padding: 4px !important;
      }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) :is(#btn-auto-toggle, #btn-chat-toggle) {
        padding: 2px 2px 12px !important; align-items: center !important; justify-content: center !important;
      }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) .col.dir .painel-ico svg { width: 18px !important; height: 18px !important; }
      html.dir-min:not(.mobile):has(nav[data-rb-hud]) .col.dir .painel-ico-selo {
        font-size: 10px !important; line-height: 12px !important; right: 1px !important; bottom: 1px !important;
      }
    `;

    function restore(element, attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
    }
    function remember(element, names) {
      if (!saved.has(element)) saved.set(element, Object.fromEntries(names.map(name => [name, element.getAttribute(name)])));
    }
    function closeMore() {
      if (moreMenu?.matches(':popover-open')) moreMenu.hidePopover();
      moreButton?.setAttribute('aria-expanded', 'false');
    }
    function onScroll(event) {
      if (!moreMenu?.contains(event.target)) closeMore();
    }
    function clearMore() {
      closeMore();
      window.removeEventListener('resize', closeMore);
      window.removeEventListener('scroll', onScroll, true);
      for (const [button, anchor] of moved) {
        if (anchor.parentNode && button.parentNode === moreMenu) anchor.replaceWith(button);
        else anchor.remove();
      }
      moved.clear();
      moreButton?.remove();
      moreMenu?.remove();
      moreButton = moreMenu = null;
    }
    function createMore() {
      moreButton = document.createElement('button');
      moreButton.type = 'button';
      moreButton.setAttribute('data-rb-hud-more', '');
      moreButton.setAttribute('data-rb-hud-icon', '⋯');
      moreButton.setAttribute('data-rb-hud-native', '1');
      moreButton.setAttribute('aria-expanded', 'false');
      moreButton.setAttribute('aria-controls', 'rb-hud-more-menu');
      moreButton.title = 'Mais opções do jogo';
      moreButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg><span>Mais ▾</span>';
      moreMenu = document.createElement('div');
      moreMenu.id = 'rb-hud-more-menu';
      moreMenu.setAttribute('popover', 'auto');
      moreMenu.setAttribute('role', 'group');
      moreMenu.setAttribute('aria-label', 'Mais opções do jogo');
      moreButton.addEventListener('click', event => {
        // The native dock delegates every button click to abrirModal(data-modal).
        // The disclosure is the only button that must not reach that handler.
        event.stopPropagation();
        if (moreMenu.matches(':popover-open')) { closeMore(); return; }
        moreMenu.showPopover();
        const anchor = moreButton.getBoundingClientRect(), popup = moreMenu.getBoundingClientRect();
        moreMenu.style.setProperty('left', Math.max(8, Math.min(anchor.right - popup.width, innerWidth - popup.width - 8)) + 'px', 'important');
        moreMenu.style.setProperty('top', Math.max(8, anchor.bottom + 6 + popup.height <= innerHeight - 8 ? anchor.bottom + 6 : anchor.top - popup.height - 6) + 'px', 'important');
        moreButton.setAttribute('aria-expanded', 'true');
        moreMenu.querySelector('button:not(:disabled), a.dock-btn')?.focus();
      });
      moreMenu.addEventListener('toggle', () => moreButton?.setAttribute('aria-expanded', String(moreMenu?.matches(':popover-open') || false)));
      moreMenu.addEventListener('click', event => {
        if (event.target.closest('button, a.dock-btn')) closeMore(); // Keep bubbling to the native action.
      });
      // The top layer prevents clipping by the game's column overflow. DOM
      // ancestry stays inside the dock, preserving its native delegated clicks.
      dock.append(moreButton, moreMenu);
      window.addEventListener('resize', closeMore);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    }
    function refresh() {
      observer.disconnect();
      const nextDock = document.querySelector('nav.menu-topo, nav.game-dock');
      if (current !== 'labels' || nextDock !== dock || (moreMenu && (!moreMenu.isConnected || !moreButton.isConnected))) clearMore();
      for (const [button, anchor] of moved) {
        if (button.parentNode !== moreMenu) { anchor.remove(); moved.delete(button); }
      }
      if (moreMenu && !moved.size) clearMore();
      // Release references to replaced buttons as soon as the SPA removes them.
      for (const [element, attrs] of saved) {
        if (!element.isConnected) { restore(element, attrs); saved.delete(element); }
      }
      dock = nextDock;
      if (!dock) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        return;
      }
      remember(dock, ['data-rb-hud']);
      dock.setAttribute('data-rb-hud', current);
      dock.querySelectorAll('button, a.dock-btn').forEach(button => {
        if (button === moreButton) return;
        const label = (button.querySelector('[data-i18n]')?.textContent || button.textContent || button.getAttribute('aria-label') || button.title || '').trim().replace(/\s+/g, ' ');
        if (!label) return;
        remember(button, ['data-rb-hud-icon', 'data-rb-hud-label', 'data-rb-hud-native', 'title', 'aria-label']);
        button.setAttribute('data-rb-hud-icon', icons.find(([pattern]) => pattern.test(label))?.[1] || label.charAt(0).toUpperCase());
        button.setAttribute('data-rb-hud-label', label);
        if (button.querySelector(':scope > img, :scope > svg, :scope > .ico')) button.setAttribute('data-rb-hud-native', '1');
        else button.removeAttribute('data-rb-hud-native');
        if (!button.title) button.title = label;
        if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
        if (current === 'labels' && secondaryActions.has(button.dataset.modal) && !moved.has(button)) {
          if (!moreMenu) createMore();
          const anchor = document.createComment('rb-hud-action');
          button.before(anchor);
          moved.set(button, anchor);
          moreMenu.appendChild(button);
        }
      });
      if (!dock.getClientRects().length || getComputedStyle(dock).display === 'none' || document.documentElement.classList.contains('modo-imersivo')) closeMore();
      // Watch the dock and ancestor replacements, without tracking every game mutation.
      observer.observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden'] });
      for (let parent = dock.parentElement; parent; parent = parent.parentElement) observer.observe(parent, { childList: true });
      observer.observe(document.documentElement, { childList: true, attributes: true, attributeFilter: ['class'] });
    }
    window[key] = {
      version: 4,
      setMode(next) {
        if (next === 'original') {
          observer.disconnect();
          clearMore();
          style.remove();
          for (const [element, attrs] of saved) restore(element, attrs);
          saved.clear();
          dock = null;
          delete window[key];
          return;
        }
        current = next;
        refresh();
      }
    };
    style.textContent = css;
    document.head.appendChild(style);
    refresh();
  }

  const api = { normalize, script: mode => '(' + install.toString() + ')(' + JSON.stringify(normalize(mode)) + ')' };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RebosteioGameHud = api;
})(typeof window === 'object' ? window : globalThis);
