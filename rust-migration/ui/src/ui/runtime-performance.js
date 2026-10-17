// Launcher-only helpers. They do not change the game's timers, network or rendering.
(function (root) {
  function createReadCoordinator(read) {
    const pending = new Map();
    return {
      read(key, source) {
        const existing = pending.get(key);
        if (existing && existing.source === source) return existing.task;
        const entry = { source, task: null };
        entry.task = Promise.resolve().then(() => read(source)).finally(() => {
          if (pending.get(key) === entry) pending.delete(key);
        });
        pending.set(key, entry);
        return entry.task;
      },
      invalidate(key) { pending.delete(key); },
      get size() { return pending.size; }
    };
  }

  // Keep persisted history and the latest batch of each guest. A paused guest may
  // repeat its batch long after it has disappeared from the bounded history.
  function createRecentLogIndex() {
    let known = new Set();
    const sources = new Map();
    return {
      has: key => known.has(key),
      add: key => known.add(key),
      setSource(source, keys) { sources.set(source, new Set(keys)); },
      retain(keys) {
        known = new Set(keys);
        for (const batch of sources.values()) for (const key of batch) known.add(key);
      },
      get size() { return known.size; }
    };
  }

  function setText(element, value) {
    const text = String(value);
    if (element && element.textContent !== text) element.textContent = text;
  }
  function setAttribute(element, name, value) {
    const text = String(value);
    if (element && element.getAttribute(name) !== text) element.setAttribute(name, text);
  }

  const api = { createReadCoordinator, createRecentLogIndex, setText, setAttribute };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RebosteioPerformance = api;
})(typeof window === 'object' ? window : globalThis);
