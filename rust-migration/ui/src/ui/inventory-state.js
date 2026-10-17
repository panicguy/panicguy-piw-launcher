// One stock projection for gameplay reads, native telemetry and Blaster.
(() => {
  'use strict';
  const own = (o, key) => Object.prototype.hasOwnProperty.call(o, key);
  const quantity = value => value === '∞' ? '∞' : (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
  const cleanMap = input => Object.fromEntries(Object.entries(input || {}).filter(([id]) => /^\d+$/.test(id)).map(([id, value]) => [id, quantity(value)]));
  const names = {1:'Poké Ball',2:'Great Ball',3:'Super Ball',4:'Ultra Ball',5:'Beast Ball'};
  function project(state) {
    if (!state) return state;
    // Legacy fixture/readers may have only precomputed KPIs; native snapshots always declare known flags.
    if (!own(state, 'ballsKnown') && !own(state, 'inventoryKnown') && !own(state, 'ballMap') && !own(state, 'invMap')) return state;
    const ballsKnown = state.ballsKnown ?? (state.ballMap != null);
    const inventoryKnown = state.inventoryKnown ?? (state.invMap != null);
    const ballMap = ballsKnown ? cleanMap(state.ballMap) : {};
    const invMap = inventoryKnown ? cleanMap(state.invMap) : {};
    const catalog = Object.fromEntries((state.ballCatalog || []).filter(b => b && b.id != null).map(b => [String(b.id), b]));
    const infinite = id => ballMap[id] === '∞' || !!(catalog[id]?.infinite || catalog[id]?.infinito) || (Number(ballMap[id]) >= 999999 && !catalog[id]?.priceGold);
    for (const id of Object.keys(ballMap)) if (infinite(id)) ballMap[id] = '∞';
    const available = id => ballMap[id] === '∞' || Number(ballMap[id]) > 0;
    const selected = Array.isArray(state.automation?.ballIds) ? state.automation.ballIds.map(String) : [];
    let id = selected.find(available) ?? selected[0];
    if (id == null && state.lastBallId != null && own(ballMap, String(state.lastBallId))) id = String(state.lastBallId);
    if (id == null) id = Object.keys(ballMap).filter(available).sort((a,b) => Number(catalog[b]?.catchRate ?? b) - Number(catalog[a]?.catchRate ?? a))[0] ?? Object.keys(ballMap)[0];
    const equippedBall = ballsKnown && id != null ? {id, name:catalog[id]?.nome || catalog[id]?.name || names[id] || `Bola ${id}`, infinite:infinite(id), qty:infinite(id) ? 999999 : (ballMap[id] ?? 0)} : null;
    const total = ids => ids.reduce((sum, key) => sum + (Number(invMap[key]) || 0), 0);
    return {...state, ballsKnown, inventoryKnown, ballMap, invMap, equippedBall,
      balls: ballsKnown ? (equippedBall?.qty ?? 0) : null,
      potions: inventoryKnown ? total(['200','201','202','203','204']) : null,
      revives: inventoryKnown ? total(['205','206']) : null};
  }
  window.PioInventory = {project};
})();
