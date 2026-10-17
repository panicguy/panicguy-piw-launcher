// Eligibility and confirmation come exclusively from the game server.
(() => {
  if (window.top !== window || location.hostname !== 'poke.idleworld.online' || window.__idleioDailyPass) return;
  const status = window.__idleioDailyPass = { state: 'waiting', attempts: 0 };
  const Native = window.WebSocket;
  let socket, player, offset = 0, key = '', last = 0, confirmed = '';
  function tick() {
    if (!player || socket?.readyState !== 1 || !(player.admin || Number(player.level) >= 10)) return;
    const now = Date.now() - offset, day = Math.floor((now - 10800000) / 86400000);
    const pass = player.passe || {};
    const taken = Number(pass.degrau) >= 1 && pass.ultimo != null && Number(pass.ultimo) === day;
    const vip = Number(pass.vipAte) > now && (pass.ultimoVip == null || Number(pass.ultimoVip) !== day);
    if (taken && !vip) { status.state = 'collected'; return; }
    const nextKey = `${day}:${taken ? 'vip' : 'free'}`;
    if (key !== nextKey) { key = nextKey; status.attempts = 0; last = 0; }
    if (confirmed === key) return;
    if (status.attempts >= 3) { status.state = 'unconfirmed'; return; }
    if (last && Date.now() - last < 60000) return;
    try {
      socket.send(JSON.stringify({ t: 'passe.resgatar' }));
      last = Date.now(); status.attempts++; status.state = 'awaiting-server';
    } catch { status.state = 'waiting'; }
  }
  function hook(s) {
    s.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try {
        const raw = JSON.parse(event.data), m = { ...raw, ...(raw.data || {}) };
        if (m.t === 'welcome') { socket = s; player = null; key = ''; confirmed = ''; }
        if (socket !== s) return;
        if (m.t === 'welcome' || m.t === 'estado') {
          const p = m.estado || m;
          if (m.t === 'welcome' || p.cheio) player = { passe: {}, ...p };
          else if (player) Object.assign(player, p);
          if (Number.isFinite(p.servidorAgora)) offset = Date.now() - p.servidorAgora;
        }
        if (m.t === 'passe' && m.resgate) { confirmed = key; status.state = 'confirmed'; }
      } catch {}
    });
    s.addEventListener('close', () => { if (socket === s) { socket = null; player = null; status.state = 'waiting'; } });
  }
  window.WebSocket = function (...args) { const s = Reflect.construct(Native, args); hook(s); return s; };
  window.WebSocket.prototype = Native.prototype;
  Object.setPrototypeOf(window.WebSocket, Native);
  setInterval(tick, 5000);
})();
