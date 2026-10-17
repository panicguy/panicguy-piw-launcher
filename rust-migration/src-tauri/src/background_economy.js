// Use the game's own Economy controls only while its view is hidden.
// No hunting, purchasing, reconnecting or socket suspension occurs here.
(() => {
  if (window.top !== window || location.origin !== 'https://poke.idleworld.online' || window.__idleioBackgroundEconomy) return;
  const preference = 'cfg-economia', marker = '__idleio_auto_economy_v1';
  let requestedHidden = false, owned = false, previous = null, retry;
  let capturing = false, capturePrevious = null;
  const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const set = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {} };
  // Restore a transient setting left by a crash before the game reads preferences.
  try {
    const saved = JSON.parse(get(marker) ?? 'null');
    if (saved?.version === 1 && [null, '0'].includes(saved.previous) && get(preference) === '1') set(preference, saved.previous);
  } catch {}
  set(marker, null);
  function cancelRetry() { if (retry !== undefined) clearTimeout(retry); retry = undefined; }
  function apply() {
    cancelRetry();
    if (capturing) {
      if (get(preference) === '1') document.getElementById('eco-sair')?.click();
      return;
    }
    const hidden = requestedHidden || document.hidden;
    if (!hidden && !owned) return;
    const app = document.getElementById('app');
    if (!app || app.classList.contains('hidden')) return;
    if (hidden) {
      if (owned || get(preference) === '1') return; // preserve manual Economy
      const button = document.getElementById('hunt-eco');
      if (!button) return;
      previous = get(preference);
      if (previous !== null && previous !== '0') return; // unknown future preference format
      set(marker, JSON.stringify({ version: 1, previous }));
      button.click();
      if (get(preference) === '1') owned = true;
      else set(marker, null); // unsupported game version: do not fake Economy
    } else {
      const button = document.getElementById('eco-sair');
      if (!button) return;
      if (get(preference) === '1') button.click();
      if (get(preference) !== '1') {
        set(preference, previous); set(marker, null); owned = false;
      }
    }
  }
  function schedule() { cancelRetry(); retry = setTimeout(() => { retry = undefined; apply(); }, 50); }
  window.__idleioBackgroundEconomy = {
    setCapture(value) {
      value = !!value;
      if (value === capturing) return;
      if (value) { capturePrevious = owned ? previous : get(preference); owned = false; set(marker, null); }
      capturing = value;
      if (!value) {
        if (capturePrevious === '1' && get(preference) !== '1') document.getElementById('hunt-eco')?.click();
        if (capturePrevious !== '1') set(preference, capturePrevious);
      }
      schedule();
    },
    setHidden(value) { requestedHidden = !!value; schedule(); },
    ready() { schedule(); },
    status() { return { requestedHidden, owned, economy: get(preference) === '1', documentHidden: document.hidden }; },
  };
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target?.closest?.('#hunt-eco,#eco-sair,#cfg-economia')) {
      // An explicit user choice takes ownership back from the launcher.
      set(marker, null); owned = false;
    }
  }, true);
  function observeApp() {
    const app = document.getElementById('app');
    if (app) new MutationObserver(schedule).observe(app, { attributes: true, attributeFilter: ['class'] });
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observeApp, { once: true });
  else observeApp();
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('pagehide', () => {
    cancelRetry();
    if (capturing) set(preference, capturePrevious);
    else if (owned && get(preference) === '1') set(preference, previous);
    set(marker, null);
  }, { once: true });
})();
