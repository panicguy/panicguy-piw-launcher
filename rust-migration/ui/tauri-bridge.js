/**
 * @file tauri-bridge.js
 * Camada de compatibilidade transparente entre a API histórica do launcher (window.pokeAPI)
 * e os comandos / eventos nativos do Tauri v2 (window.__TAURI__.core / event), incluindo
 * polyfill completo do elemento <webview> do Electron para WebView2 nativo do Windows,
 * com gerenciamento de airspace para modais e auto-preenchimento nativo de credenciais.
 */

(() => {
  'use strict';

  const tauri = window.__TAURI__;
  const invoke = (tauri && tauri.core && tauri.core.invoke) || (async () => { throw new Error('Tauri indisponível'); });
  const listen = (tauri && tauri.event && tauri.event.listen) || (async () => { throw new Error('Eventos Tauri indisponíveis'); });

  // Cache em memória de credenciais para auto-preenchimento
  let cachedAccounts = [];

  window.pokeAPI = {
    // 1. Credenciais & Contas
    loadCreds: async () => {
      try {
        const accs = await invoke('creds_load');
        if (Array.isArray(accs) && accs.length) {
          cachedAccounts = accs;
          return accs;
        }
      } catch (e) { console.error('Falha ao carregar contas:', e); throw e; }
      return Array.from({ length: 4 }, (_, i) => ({ name: `Conta ${i + 1}`, email: '', senha: '' }));
    },
    saveCreds: async (accounts) => {
      cachedAccounts = accounts;
      return invoke('creds_save', { accounts }).catch(() => false);
    },
    applyAccountProxies: async () => {
      const result=await invoke('proxy_apply');
      for(const index of result.changed || []) {
        delete lastBounds[index];
        for(const view of registeredWebviews) if(view.__resolveIndex()===index) view.__syncBounds();
      }
      return result;
    },
    clearAccount: (i) => invoke('account_clear', { index: i }).catch(() => true),

    // 2. Sistema & Janela
    setAwake: (on) => invoke('set_awake', { on }).catch(() => true),
    setMinToTray: (on) => invoke('set_min_to_tray', { on }),
    webhook: (url, text) => invoke('webhook_send', { url, text }).catch(() => true),
    getAutoStart: () => invoke('autostart_get').catch(() => ({ on: false, suportado: true })),
    setAutoStart: (on) => invoke('autostart_set', { on }),
    onAutoStart: (cb) => listen('autostart:change', (e) => cb(e.payload)),
    onHotkey: (cb) => listen('hotkey:press', (e) => cb(e.payload)),
    onJanela: (cb) => listen('window:visibility', (e) => cb(e.payload)),
    windowControl: (action) => invoke('window_control', { action }).catch(() => ({ maximized: false })),
    onWindowMaximized: (cb) => listen('window:maximized', (e) => cb(e.payload)),
    notify: (title, body) => invoke('system_notify', { title, body }),

    // 3. Presets & Logs
    readPreset: (name) => invoke('preset_read', { name }).catch(() => null),
    logError: (origin, msg) => invoke('errlog_write', { origin, msg }).catch(() => true),
    openErrorLog: () => invoke('errlog_open').catch(() => true),
    saveBackup: (name, content, header) => invoke('backup_save', { name, content, header }).catch(() => false),

    // 4. Userscripts & Extensões
    // The Tauri command returns raw source text, while the script manager expects
    // {ok, url, code}. GitHub /blob/ links render an HTML page, so normalize them
    // to raw.githubusercontent.com before fetching. Keep the normalized URL for updates.
    fetchUserScript: async (url) => {
      let target;
      try {
        const parsed = new URL(String(url || '').trim());
        if (parsed.protocol !== 'https:') {
          return { ok: false, error: 'Use um link HTTPS do GitHub.' };
        }
        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'github.com' || hostname === 'www.github.com') {
          const parts = parsed.pathname.split('/').filter(Boolean);
          if (parts.length < 5 || !['blob', 'raw'].includes(parts[2])) {
            return { ok: false, error: 'Use o link de um arquivo .js no GitHub (com /blob/ ou /raw/).' };
          }
          const [owner, repository, , branch, ...file] = parts;
          if (!file.length || !file[file.length - 1].toLowerCase().endsWith('.js')) {
            return { ok: false, error: 'Selecione um arquivo JavaScript (.js ou .user.js).' };
          }
          target = 'https://raw.githubusercontent.com/' +
            [owner, repository, branch, ...file].join('/');
        } else if (hostname === 'raw.githubusercontent.com') {
          if (!parsed.pathname.toLowerCase().endsWith('.js')) {
            return { ok: false, error: 'O link precisa apontar para um arquivo .js.' };
          }
          target = parsed.origin + parsed.pathname;
        } else {
          return { ok: false, error: 'Use um link do GitHub ou raw.githubusercontent.com.' };
        }
      } catch (_) {
        return { ok: false, error: 'Link do GitHub inválido.' };
      }

      try {
        const code = await invoke('userscript_fetch', { url: target });
        if (typeof code !== 'string' || !code.trim()) {
          return { ok: false, error: 'Não foi possível baixar o arquivo. Confira se o repositório é público e o caminho está correto.' };
        }
        if (code.length > 4 * 1024 * 1024) {
          return { ok: false, error: 'O script excede o limite de 4 MB.' };
        }
        if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(code)) {
          return { ok: false, error: 'O GitHub retornou uma página HTML em vez do código JavaScript.' };
        }
        return { ok: true, url: target, code };
      } catch (error) {
        return { ok: false, error: 'Falha ao baixar o script: ' + String(error).slice(0, 180) };
      }
    },
    fetchExtension: (url) => invoke('userscript_request', { url }).catch(() => ({ status: 500, body: '' })),

    // 5. Autenticação & Janelas Auxiliares
    camoufoxLogin: (data) => invoke('camoufox_login', { data }).catch(() => ({ success: false })),
    cancelLogin: (index) => invoke('auth_cancel_login', { index }).catch(() => true),
    camoufoxCheck: () => invoke('camoufox_check').catch(() => ({ available: false })),
    openAuthWindow: (index, url) => invoke('auth_window_open', { index, url }).catch(() => true),

    // 6. Bônus Twitch IRC
    twitchLoadCreds: () => invoke('twitch_creds_load'),
    twitchSaveCreds: async (data) => {
      if (typeof twitchConfigReady === 'boolean' && !twitchConfigReady) {
        await loadTwitchBonusConfig();
        if (!twitchConfigReady) throw new Error('Configuração não carregada; arquivo salvo preservado.');
      }
      return invoke('twitch_creds_save', { data });
    },
    twitchTestConnection: (username, token) => invoke('twitch_test', { username, token }).catch(() => ({ ok: false, error: 'Teste falhou' })),
    twitchSyncLives: (lives) => invoke('twitch_sync_lives', { lives }).catch(() => true),
    twitchGetStatus: () => invoke('twitch_status_get').catch(() => ({ accounts: [] })),
    onTwitchStatus: (cb) => listen('twitch:status', (e) => cb(e.payload)),

    // 7. Bônus Kick (Pusher & WebSocket)
    kickLoadCreds: () => invoke('kick_creds_load'),
    kickSaveCreds: async (data) => {
      if (typeof kickConfigReady === 'boolean' && !kickConfigReady) {
        await loadKickBonusConfig();
        if (!kickConfigReady) throw new Error('Configuração não carregada; arquivo salvo preservado.');
      }
      return invoke('kick_creds_save', { data });
    },
    kickTestConnection: (username, token) => invoke('kick_test', { username, token }).catch(() => ({ ok: false, error: 'Teste falhou' })),
    kickSyncLives: (lives) => invoke('kick_sync_lives', { lives }).catch(() => false),
    kickGetStatus: () => invoke('kick_status_get').catch(() => ({ accounts: [] })),
    kickGetPoints: () => invoke('kick_points_get').catch(() => ({ accounts: [] })),
    kickRefreshPoints: (index) => invoke('kick_points_refresh', { index }),
    kickOpenSession: (index, slug = '') => invoke('kick_session_open', { index, slug: slug ?? '' }),
    kickSetPointChannels: (channels) => invoke('kick_point_channels', { channels }),
    onKickPoints: (cb) => listen('kick:points', (e) => cb(e.payload)),
    onKickCreds: (cb) => listen('kick:creds', (e) => cb(e.payload)),
    onKickStatus: (cb) => listen('kick:status', (e) => cb(e.payload)),
    onKickGameLinked: (cb) => listen('kick:linked', (e) => cb(e.payload)),

    // 8. Modo Master Blaster (Headless Puro WebSocket)
    blasterStart: (index, config) => invoke('blaster_start', { index, config }).catch(() => ({ ok: false })),
    blasterStop: async (index) => {
      await invoke('blaster_stop', { index });
      delete lastBounds[index];
      // Headless closes the native WebView. Recreate it, including when Card view keeps it hidden.
      for (const el of registeredWebviews) if (el.__resolveIndex() === index) el.__syncBounds();
      // The scripts manager uses this event to retry injection only after the game's own
      // authenticated WebView session has loaded; it never runs userscripts on the login form.
      window.dispatchEvent(new CustomEvent('piw:headless-restored', { detail: { index } }));
      return { ok: true };
    },
    blasterStatus: (index) => invoke('blaster_status', { index }).catch(() => ({ active: false })),
    supplyBuy: async (index, orders) => {
      if (!window.PioBattleHud?.isBlasterActive(index)) {
        return window.pokeAPI.webviewEval(index, window.SUPPLY_BUY_JS(JSON.stringify(orders)));
      }
      const results = [];
      for (const order of orders) {
        const map = order.kind === 'ball' ? 'ballMap' : 'invMap';
        const state = window.stCache?.[index]?.d;
        if (!state?.live || !state[map] || (order.kind === 'ball' ? state.ballsKnown === false : state.inventoryKnown === false)) {
          results.push({...order, success:false, reason:'aguardando estoque do servidor'});
          break;
        }
        const before = +state[map][order.id] || 0;
        const result = await new Promise(async resolve => {
          let done = false, timer, unlisten;
          const finish = data => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unlisten?.();
            resolve({...order, before, ...data});
          };
          try {
            unlisten = await listen('blaster:update', event => {
              const payload = event.payload || {};
              if (payload.index !== index) return;
              if (payload.state?.live === false) return finish({success:false, reason:'conexão encerrada'});
              const after = +payload.state?.[map]?.[order.id];
              if (after > before) finish({success:true, after});
            });
            timer = setTimeout(() => finish({success:false, reason:'estoque não confirmado pelo servidor'}), 8000);
            if (!await invoke('blaster_send', {index, data:{t:'shop.buy', kind:order.kind, id:order.id, qty:order.qty}})) {
              finish({success:false, reason:'falha ao enviar compra'});
            }
          } catch (error) { finish({success:false, reason:String(error)}); }
        });
        results.push(result);
        if (!result.success) break;
      }
      return results;
    },
    blasterSend: (index, data) => invoke('blaster_send', { index, data }).catch(() => false),
    sessionTokenSave: (index, token, nick) => invoke('session_token_save', { index, token, nick }).catch(() => false),
    sessionTokenGet: (index) => invoke('session_token_get', { index }).catch(() => null),
    onSessionToken: (cb) => listen('session:token', (e) => cb(e.payload)),
    onBlasterUpdate: (cb) => listen('blaster:update', (e) => cb(e.payload)),
    onBlasterStatus: (cb) => listen('blaster:status', (e) => cb(e.payload)),

    blasterStartWithLogin: async (index, config = {}) => {
      lastVisibility[index] = false;
      delete lastBounds[index];
      try {
        await invoke('blaster_start', { index, config });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },

    // 9. Gerenciamento Nativo de Sub-WebViews (Perfis Isolados)
    webviewSync: (index, bounds, url, visible) => invoke('webview_sync', { index, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, url, visible: typeof visible === 'boolean' ? visible : null }).catch(() => false),
    webviewSetVisible: (index, visible) => {
      lastVisibility[index] = visible;
      return invoke('webview_set_visible', { index, visible }).catch(() => false);
    },
    webviewDestroy: (index) => invoke('webview_destroy', { index }).catch(() => false),
    webviewEval: (index, script) => invoke('webview_eval', { index, script }),
    webviewFillCreds: (index, email, pass) => invoke('webview_fill_creds', { index, email, pass }).catch(() => false),

    // 10. Metadados
    appVersion: '2.0.26'
  };

  // O launcher carrega as credenciais uma única vez durante sua inicialização.

  function dispatchToApp(index, state) {
    if (typeof index !== 'number' || !state) return;
    state = {...state};
    for (const [map, known] of [['ballMap','ballsKnown'],['invMap','inventoryKnown']]) {
      if (Object.hasOwn(state, map) && state[known] === undefined) state[known] = state[map] != null;
    }
    const previous = window.stCache?.[index]?.d;
    if (previous) state = {...previous, ...state, a: {...previous.a, ...state.a}};
    state = window.PioInventory.project(state);
    if (typeof window.stCache !== 'undefined') {
      window.stCache[index] = { t: Date.now(), d: state };
    }
    const grid = document.getElementById('grid');
    const panel = grid && grid.children[index];
    if (panel && window.PioBattleHud && typeof window.PioBattleHud.update === 'function') {
      window.PioBattleHud.update(panel, index, state);
    }
    // Dispara console-message para o index.html (alimenta estatísticas globais, Simples e cards)
    const targetWv = (panel && panel.querySelector('webview')) ||
                     (typeof webviews !== 'undefined' && webviews[index]) ||
                     Array.from(registeredWebviews).find(w => w.__resolveIndex && w.__resolveIndex() === index);
    if (targetWv) {
      const msgStr = '__PGST__' + JSON.stringify(state);
      const evt = new CustomEvent('console-message', {
        detail: { message: msgStr }
      });
      evt.message = msgStr;
      targetWv.dispatchEvent(evt);
    }
  }

  listen('game:console', (e) => {
    const {index, message} = e.payload;
    const el = Array.from(registeredWebviews).find(w => w.__resolveIndex() === index);
    if (el) { const event = new Event('console-message'); event.message = message; el.dispatchEvent(event); }
  });
  listen('game:load', (e) => {
    const el = Array.from(registeredWebviews).find(w => w.__resolveIndex() === e.payload.index);
    el?.__onNativeLoad(e.payload);
  });
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !event.target.closest('.leaf-topbar') || event.target.closest('button, input, select, a, [role="button"]')) return;
    event.preventDefault();
    invoke('window_control', {action: event.detail === 2 ? 'maximize' : 'drag'}).catch(console.error);
  });


  // Sincronização de telemetria nativa (push de estado completo e eventos de combate)
  listen('st:push', (e) => {
    const payload = e.payload || {};
    if (window.PioBattleHud?.isBlasterActive(payload.index)) return;
    dispatchToApp(payload.index, payload.state);
  });

  listen('blaster:update', (e) => {
    const payload = e.payload || {};
    dispatchToApp(payload.index, payload.state);
  });

  // =========================================================================
  // Gerenciamento de Airspace: Modais Reais que cobrem o grid
  // (Nota: #stats NÃO é modal; é a barra lateral que fica ao lado do grid)
  // =========================================================================
  const REAL_MODAL_SELECTORS = [
    '#overlay.show',
    '#scOverlay.show',
    '#tlOverlay.show',
    '#tlOv.show',
    '#dtOverlay.show',
    '#dtOv.show',
    '#dispatchOverlay.show',
    '#autoSupplyOverlay.show',
    '#twitchBonusOverlay.show',
    '#kickBonusOverlay.show',
    '#menu.show',
    'body.leaf-tools-open #leafToolsMenu',
    'body.leaf-settings-open #leafSettingsDrawer',
    '#stats.show',
    '#ivCard.show'
  ].join(', ');

  function isAnyModalOpen() {
    return Array.from(document.querySelectorAll(REAL_MODAL_SELECTORS)).some(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  const registeredWebviews = new Set();
  const lastBounds = {};
  const lastVisibility = {};

  function updateAllWebviewsVisibility() {
    const modalActive = isAnyModalOpen();
    if (modalActive) {
      for (let i = 0; i < 4; i++) {
        if (lastVisibility[i] !== false) {
          lastVisibility[i] = false;
          window.pokeAPI.webviewSetVisible(i, false);
        }
      }
      return;
    }

    for (const el of registeredWebviews) {
      if (typeof el.__syncBounds === 'function') {
        el.__syncBounds();
      }
    }
  }

  let updateVisibilityTimer = null;
  function debouncedUpdateVisibility() {
    if (updateVisibilityTimer) clearTimeout(updateVisibilityTimer);
    updateVisibilityTimer = setTimeout(updateAllWebviewsVisibility, 60);
  }

  // Observa apenas aberturas de modais com debouncing
  document.addEventListener('click', debouncedUpdateVisibility);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') debouncedUpdateVisibility();
  });
  window.addEventListener('resize', debouncedUpdateVisibility);

  // Observa mudanças de classe no body e painéis para stats-open, cards-on, modais e is-hud-active
  const bodyObserver = new MutationObserver(() => {
    debouncedUpdateVisibility();
  });
  const observeBody = () => bodyObserver.observe(document.body, {attributes: true, attributeFilter: ['class'], subtree: true});
  if (document.body) observeBody();
  else document.addEventListener('DOMContentLoaded', observeBody, {once: true});

  // =========================================================================
  // Polyfill de <webview> para o Microsoft Edge WebView2 no Tauri v2
  // =========================================================================
  const origCreateElement = document.createElement.bind(document);
  document.createElement = function (tagName, options) {
    if (typeof tagName === 'string' && tagName.toLowerCase() === 'webview') {
      const el = origCreateElement('webview', options);
      el.classList.add('tauri-webview-host');
      el.style.flex = '1';
      el.style.minHeight = '0';
      el.style.minWidth = '0';
      el.style.background = '#0d1117';
      el.style.display = 'block';

      let _src = '';
      let _partition = '';
      let _index = -1;
      let _syncTimer = null;
      let _loadedOnce = false;
      let _filledCreds = false;

      function resolveIndex() {
        if (_index >= 0) return _index;
        if (_partition) {
          const m = _partition.match(/conta(\d+)/i);
          if (m) { _index = parseInt(m[1], 10) - 1; return _index; }
        }
        return -1;
      }

      function syncBounds() {
        const idx = resolveIndex();
        if (idx < 0) return;
        if (!el.isConnected) {
          if (lastVisibility[idx] !== false) {
            lastVisibility[idx] = false;
            window.pokeAPI.webviewSetVisible(idx, false);
          }
          return;
        }

        const panel = el.closest('.panel');
        const isPanelOff = panel && panel.classList.contains('off');
        const isFamHidden = panel && panel.classList.contains('leaf-fam-hidden');
        const isHudActive = panel && (panel.classList.contains('is-hud-active') || panel.classList.contains('is-blaster-active'));
        const isCardsOn = document.body.classList.contains('cards-on');
        const expandedPanel = document.querySelector('#grid > .panel.expanded');
        const coveredByExpandedPanel = expandedPanel && panel !== expandedPanel;
        const modalOpen = isAnyModalOpen();

        const rect = el.getBoundingClientRect();

        if (panel && panel.classList.contains('is-blaster-active')) return;

        if (isPanelOff || !_src || _src === 'about:blank') {
          window.pokeAPI.webviewSetVisible(idx, false);
          return;
        }
        const visible = !(modalOpen || coveredByExpandedPanel || isFamHidden || isHudActive || isCardsOn || rect.width <= 15 || rect.height <= 15 || getComputedStyle(el).display === 'none');
        if (!visible) {
          if (lastVisibility[idx] !== false) window.pokeAPI.webviewSetVisible(idx, false);
          if (!lastBounds[idx]) {
            const host = panel.getBoundingClientRect();
            const bounds = {x:Math.max(0, host.left), y:Math.max(0, host.top), width:Math.max(320, host.width), height:Math.max(240, host.height)};
            lastBounds[idx] = bounds;
            window.pokeAPI.webviewSync(idx, bounds, _src, false);
          }
          return;
        }

        const b = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };

        const prev = lastBounds[idx];
        const boundsChanged = !prev ||
          Math.abs(prev.x - b.x) > 1 ||
          Math.abs(prev.y - b.y) > 1 ||
          Math.abs(prev.width - b.width) > 1 ||
          Math.abs(prev.height - b.height) > 1;

        const targetUrl = (_src && _src !== 'about:blank') ? _src : 'https://poke.idleworld.online/play';

        if (boundsChanged) {
          lastBounds[idx] = b;
          window.pokeAPI.webviewSync(idx, b, targetUrl, true);
        }

        if (lastVisibility[idx] !== true) {
          lastVisibility[idx] = true;
          window.pokeAPI.webviewSetVisible(idx, true);
        }

        // Preenche credenciais automaticamente uma vez após carregar
        if (!_filledCreds && cachedAccounts[idx] && cachedAccounts[idx].email && cachedAccounts[idx].senha) {
          _filledCreds = true;
          window.pokeAPI.webviewFillCreds(idx, cachedAccounts[idx].email, cachedAccounts[idx].senha);
        }

      }

      el.__onNativeLoad = (payload) => {
        if (payload.event === 'did-start-loading') {
          el.dispatchEvent(new Event('did-start-loading'));
          return;
        }
        _src = payload.url;
        _loadedOnce = true;
        for (const type of ['did-navigate', 'did-navigate-in-page', 'dom-ready', 'did-stop-loading']) {
          const event = new Event(type);
          event.url = payload.url;
          event.isMainFrame = true;
          el.dispatchEvent(event);
        }
      };

      el.__syncBounds = syncBounds;
      el.__resolveIndex = resolveIndex;
      registeredWebviews.add(el);

      function debouncedSync() {
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(syncBounds, 80);
      }

      Object.defineProperty(el, 'src', {
        get: () => _src,
        set: (val) => {
          _src = val;
          _loadedOnce = false;
          _filledCreds = false;
          if (val && val !== 'about:blank') {
            debouncedSync();
          } else if (val === 'about:blank') {
            const idx = resolveIndex();
            if (idx >= 0) {
              lastVisibility[idx] = false;
              window.pokeAPI.webviewSetVisible(idx, false);
            }
          }
        }
      });

      Object.defineProperty(el, 'partition', {
        get: () => _partition,
        set: (val) => {
          _partition = val;
          resolveIndex();
        }
      });

      el.loadURL = (url) => {
        _src = url;
        _loadedOnce = false;
        const idx = resolveIndex();
        if (idx >= 0) {
          invoke('webview_navigate', {index: idx, url}).catch(console.error);
        }
        debouncedSync();
      };

      el.executeJavaScript = async (code) => {
        const idx = resolveIndex();
        if (idx >= 0) {
          if (window.PioBattleHud?.isBlasterActive(idx)) {
            if (code === window.READ_STATE) return window.stCache?.[idx]?.d || null;
            throw new Error('Esta ação requer abrir o jogo; conta em modo headless');
          }
          return window.pokeAPI.webviewEval(idx, code);
        }
        return null;
      };

      el.getURL = () => _src || 'https://poke.idleworld.online/play';
      el.reload = () => {
        const idx = resolveIndex();
        if (idx >= 0) return invoke('webview_navigate', {index: idx, url: null}).catch(console.error);
      };
      el.reloadIgnoringCache = () => el.reload();
      el.setAudioMuted = (muted) => {
        const index=resolveIndex();
        if(index>=0) invoke('webview_settings', {index, muted:!!muted}).catch(console.error);
      };
      el.setZoomFactor = (zoom) => {
        const index=resolveIndex();
        if(index>=0) invoke('webview_settings', {index, zoom:Number(zoom)}).catch(console.error);
      };

      const ro = new ResizeObserver(() => debouncedSync());
      ro.observe(el);

      setTimeout(syncBounds, 200);
      setTimeout(syncBounds, 700);

      return el;
    }
    return origCreateElement(tagName, options);
  };
})();
