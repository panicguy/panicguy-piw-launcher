(function (root) {
  'use strict';
  function installAutoDepot() {
    if (typeof location !== 'undefined' && location.hostname !== 'poke.idleworld.online') return;
    if (window.__pioAutoDepot) return;
    const status = window.__pioAutoDepot = { account: null, phase: 'aguardando', lastSale: 0 };
    let socket, account, activeId, automation = {}, pokemons = new Map(), lastCommand = 0, initialized = false;
    const hooked = new WeakSet();
    const key = () => 'pio:auto-depot:v1:' + account;
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    let nativePreferences, preferencesReady = !invoke, preferencesPending = false;
    let writes = Promise.resolve(), preferenceRevision = 0;
    const localRead = () => { try { return JSON.parse(localStorage.getItem(key())) || {}; } catch { return {}; } };
    const read = () => nativePreferences || localRead();
    const save = value => {
      if (invoke) {
        preferencesPending = true;
        const target = account;
        const revision = ++preferenceRevision;
        writes = writes.then(() => invoke('auto_depot_set', { account: String(target), preferences: { enabled: value.enabled !== false, configured: !!value.configured } })).then(() => {
          if (account === target && revision === preferenceRevision) { nativePreferences = value; localStorage.setItem(key(), JSON.stringify(value)); }
        }).catch(() => { if (account === target && revision === preferenceRevision) status.phase = 'falha ao salvar preferências'; }).finally(() => { if (account === target && revision === preferenceRevision) preferencesPending = false; });
        return false; // the next tick uses the confirmed native preference
      }
      try { localStorage.setItem(key(), JSON.stringify(value)); return true; } catch { return false; }
    };
    const protectedReady = () => automation.autoLockShiny === true && automation.autoLockNota9 === true &&
      automation.autoLockP5 === true && Number(automation.autoLockNotaMin) === 3.5;
    function observe(raw) {
      const m = raw.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
      if (!['welcome', 'estado'].includes(m.t) || !m.estado) return;
      const state = m.estado;
      if (m.t === 'welcome') {
        account = state.id;
        status.account = account;
        activeId = null; automation = {}; pokemons = new Map(); initialized = false; lastCommand = 0; status.lastSale = 0;
        nativePreferences = undefined; preferencesReady = !invoke; preferencesPending = false;
        ++preferenceRevision;
        if (invoke && account) {
          const target = account;
          const legacy = localRead();
          invoke('auto_depot_get', { account: String(target), legacy: { enabled: legacy.enabled !== false, configured: !!legacy.configured } }).then(value => {
            if (account === target) { nativePreferences = value; preferencesReady = true; }
          }).catch(() => { status.phase = 'falha ao carregar preferências'; });
        }
      }
      if (!account || (state.id != null && String(state.id) !== String(account))) return;
      if (Object.hasOwn(state, 'activeId')) activeId = state.activeId;
      if (state.automation) { automation = { ...automation, ...state.automation }; initialized = true; }
      if (Array.isArray(state.pokemons)) pokemons = new Map(state.pokemons.map(p => [String(p.id), p]));
      for (const p of state.pkMud || []) pokemons.set(String(p.id), { ...pokemons.get(String(p.id)), ...p });
      for (const id of state.pkFora || []) pokemons.delete(String(id));
    }
    function hook(s) {
      if (!s || hooked.has(s)) return;
      hooked.add(s);
      s.addEventListener('message', e => {
        try { const m = JSON.parse(e.data); if (m.t === 'welcome') socket = s; if (s === socket) observe(m); } catch {}
      });
      s.addEventListener('close', () => { if (socket === s) { socket = null; initialized = false; status.phase = 'desconectado'; } });
    }
    const Native = window.WebSocket;
    window.WebSocket = new Proxy(Native, { construct(target, args) { const s = Reflect.construct(target, args); hook(s); return s; } });
    // Electron installs after dom-ready; Rust installs before the game's socket opens.
    const P = window.__poke;
    if (P?.sock) {
      socket = P.sock; hook(socket);
      if (P.ws?.welcome) observe(P.ws.welcome);
    }
    function tick() {
      if (!socket || socket.readyState !== 1 || !account || !initialized || !preferencesReady || preferencesPending) return;
      const cfg = read();
      const enabled = cfg.enabled !== false;
      // This control is placed beside the game's Depot actions, including economy mode.
      const anchor = document.querySelector('#mk-auto-lock-p5');
      const actions = anchor?.closest('.mk-vt-acoes');
      if (actions && !actions.querySelector('[data-pio-auto-depot]')) {
        const label = document.createElement('label');
        label.className = 'auto-linha mk-auto-venda-linha';
        label.textContent = 'Auto vender Depot (1 min) ';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = enabled;
        cb.dataset.pioAutoDepot = ''; cb.onchange = () => save({ ...read(), enabled: cb.checked });
        label.appendChild(cb); actions.appendChild(label);
      }
      if (!enabled) { status.phase = 'desativado'; return; }
      const now = Date.now();
      if (!cfg.configured) {
        status.phase = 'configurando proteções';
        if (!protectedReady()) {
          if (now - lastCommand < 5000) return;
          let command;
          if (automation.autoLockShiny !== true) command = { t: 'shop.autoLockShiny', ativo: true };
          else if (automation.autoLockNota9 !== true || Number(automation.autoLockNotaMin) !== 3.5)
            command = { t: 'shop.autoLockNota9', ativo: true, nota: 3.5 };
          else command = { t: 'shop.autoLockP5', ativo: true };
          socket.send(JSON.stringify(command)); lastCommand = now; return;
        }
        // Persist only after all three options are confirmed by server snapshots.
        if (!save({ ...cfg, configured: true, enabled: true })) return;
        lastCommand = now;
        return;
      }
      // Later user edits are preserved. Selling pauses if any protection is disabled.
      if (!automation.autoLockShiny || !automation.autoLockNota9 || !automation.autoLockP5) {
        status.phase = 'pausado: proteção desativada'; return;
      }
      status.phase = 'ativo';
      if (now - lastCommand < 5000 || now - status.lastSale < 60000) return;
      const locked = new Set((automation.pokemonTravado || []).map(String));
      const candidates = [...pokemons.values()].filter(p => p.slot == null && String(p.id) !== String(activeId) && !locked.has(String(p.id)) && !p.shiny && Number(p.potencia) !== 5);
      const ateId = candidates.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0);
      if (!Number.isSafeInteger(ateId) || ateId <= 0) return;
      socket.send(JSON.stringify({ t: 'shop.sellAllPokemons', ateId }));
      status.lastSale = now;
    }
    setInterval(() => { try { tick(); } catch { status.phase = 'falha; aguardando próxima tentativa'; } }, 2000);
  }
  if (typeof module === 'object' && module.exports) module.exports = { installAutoDepot };
  else root.PioAutoDepot = { installAutoDepot };
})(typeof window === 'object' ? window : globalThis);
