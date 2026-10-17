(function (root) {
  'use strict';
  const rewards = Object.freeze([
    Object.freeze({ key: 'exp', label: 'EXP', cost: 300 }),
    Object.freeze({ key: 'catch', label: 'Capture', cost: 500 }),
    Object.freeze({ key: 'lure', label: 'Lure', cost: 1000 })
  ]);
  function selected(priority) {
    return priority === 'all' ? rewards : rewards.filter(r => r.key === priority).length
      ? rewards.filter(r => r.key === priority) : [rewards[0]];
  }
  function forBalance(balance, priority, now = Date.now()) {
    const choices = selected(priority);
    if (!balance || balance.status !== 'verified' || !Number.isSafeInteger(balance.points) || balance.points < 0 ||
        !Number.isFinite(balance.checkedAt) || now - balance.checkedAt < 0 || now - balance.checkedAt >= 120000) {
      return { known: false, affordable: [], missing: null, label: 'Atualize o saldo', className: 'progress' };
    }
    if (balance.catalogStatus !== 'verified' || !Array.isArray(balance.rewards)) {
      return { known: false, affordable: [], missing: null, label: 'Disponibilidade não confirmada', className: 'progress' };
    }
    const available = choices.filter(r => balance.rewards.some(actual => actual.key === r.key && actual.cost === r.cost && actual.available === true));
    if (!available.length) return { known: true, affordable: [], missing: null, label: 'Buff indisponível na Kick', className: 'progress' };
    const affordable = available.filter(r => balance.points >= r.cost);
    const missing = Math.max(0, Math.min(...available.map(r => r.cost)) - balance.points);
    return {
      known: true, affordable, missing,
      label: affordable.length
        ? affordable.map(r => `${Math.floor(balance.points / r.cost)}× ${r.label}`).join(' ou ')
        : `Faltam ${missing.toLocaleString('pt-BR')} pts`,
      className: affordable.length ? 'ready-' + affordable[0].key : 'progress'
    };
  }
  const api = { rewards, selected, forBalance };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KickRewardStatus = api;
})(typeof globalThis === 'object' ? globalThis : this);
