// Forward only the launcher's existing console protocol; never arbitrary console output.
(() => {
  if (window.top !== window || window.__pioConsoleBridge) return;
  window.__pioConsoleBridge = true;
  const log = console.log.bind(console);
  console.log = (...args) => {
    const message = args[0];
    if (typeof message === 'string' && /^__(PGST|PGIV|PGDLG|RBZOOM|GMSET|GMXHR)__/.test(message) && message.length < 2000000) {
      window.__TAURI_INTERNALS__.invoke('game_console_message', {message}).catch(() => {});
    }
    return log(...args);
  };
})();
