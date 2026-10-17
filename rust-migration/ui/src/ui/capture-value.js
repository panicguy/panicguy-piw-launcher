(function (root) {
  'use strict';
  function installCaptureValue(dependencies) {
    const P = window.__poke;
    if (!P || P.captureValue) return;
    let catalog = null, pricing = null, loading = null, retryAt = 0, settledHunts = null, noteMath = null;
    const load = () => {
      if (loading || Date.now() < retryAt) return;
      const get = async path => {
        const r = await fetch(path);
        if (!r.ok) throw new Error('Capture catalog: ' + path + ' (' + r.status + ')');
        return r.json();
      };
      loading = (async () => {
        const names = ['sell-value', 'valor-cadeia', 'outland', 'evolucoes-cruzadas',
          'evolucoes-ramificadas', 'teto-captura', 'ajustes-especie-espelho',
          'herdar-looktype-orre', 'herdar-looktype-outland', 'nota-pokemon', 'linhagem-nota', 'megas'];
        const modules = dependencies ? dependencies.modules : await Promise.all(names.map(n => import('/shared/' + n + '.mjs')));
        const [sale, chain, outland, evol, branches, ceiling, adjustments, orre, ol, notes, lineage, megas] = modules;
        const docs = dependencies ? dependencies.docs : await Promise.all(['creatures', 'creatures-novos', 'creatures-outland-novos',
          'creatures-sprites-lab'].map(n => get('/assets/' + n + '.json')));
        const list = docs.slice(0, 3).flatMap(d => d.creatures || []);
        outland.aplicarRemapOutlandLista(list);
        for (const patch of docs[3].patches || []) {
          const c = list.find(c => c.pokeId === patch.pokeId);
          if (c && patch.looktype) c.looktype = patch.looktype;
        }
        orre.herdarLooktypeOrre(list);
        ol.herdarLooktypeOutland(list);
        evol.aplicarCadeiasTruncadas(list);
        evol.normalizarEvolveLevel600(list);
        adjustments.aplicarAjustesHuntLevel(id => list.find(c => c.pokeId === id));
        const map = new Map();
        for (const c of list) {
          if (outland.isEspelhoFantasmaPokeId(c.pokeId)) continue;
          sale.normalizarSellValue(c);
          if (outland.isOutlandPokeId(c.pokeId)) { c.evolvesToId = 0; c.evolveLevel = 0; }
          map.set(c.pokeId, c);
        }
        evol.aplicarEvolucoesEntreGeracoes(list);
        branches.alinharNivelPadraoRamificado(list);
        evol.corrigirNiveisDeEvolucao(list);
        const { estagios } = ceiling.aplicarTetoDeCaptura(list, id => map.get(id));
        if (notes && lineage && megas) {
          for (const esp of megas.criarEspeciesMega(list)) { list.push(esp); map.set(esp.pokeId, esp); }
          lineage.anotarLinhagemDaNota(list, id => map.get(id), megas.elosMegaDaNota(list));
          noteMath = notes;
        }
        catalog = { map, estagios, chain };
        pricing = sale.precoVendaPokemon;
        refresh();
      })().catch(e => { retryAt = Date.now() + 30000; P.captureValueError = String(e.message); })
        .finally(() => { loading = null; });
    };
    function refresh() {
      if (!catalog) { load(); return; }
      if (settledHunts !== P.hunts) {
      const lowest = new Map();
      for (const h of P.hunts || []) for (const e of h.especies || []) {
        if (!lowest.has(e.pokeId) || h.nivel < lowest.get(e.pokeId)) lowest.set(e.pokeId, h.nivel);
      }
      catalog.chain.assentarValorDasEspecies(catalog.map.values(), catalog.estagios, id => lowest.get(id) ?? null);
      settledHunts = P.hunts;
      }
      for (const entry of P.catchLog || []) {
        const pk = (P.pokemonsMap || {})[entry.id];
        if (pk && pk.potencia != null) entry.potencia = Number(pk.potencia);
        const esp = catalog.map.get(entry.sid || (pk && pk.speciesId));
        if (noteMath && esp && (entry.iv > 0 || entry.ivs) && entry.q > 0 && entry.potencia >= 1 && entry.potencia <= 5) {
          const nota = noteMath.notaDePokemon({ iv: entry.iv || undefined, ivs: entry.ivs, quality: entry.q, shiny: entry.sh, potencia: entry.potencia, refino: pk && pk.refino }, esp);
          if (Number.isFinite(nota)) entry.nota = nota;
        }
      }
      const S = P.sess;
        for (const pk of Object.values(S.capturePending || {})) {
        const esp = catalog.map.get(pk.speciesId);
        if (!esp || pk.level == null || pk.quality == null) continue;
        const value = pricing(esp, pk);
        S.sellG = (S.sellG || 0) + value;
        delete S.capturePending[pk.id];
        const entry = (P.catchLog || []).find(c => c.id === pk.id);
        if (entry) entry.sellValue = value;
      }
    }
    P.captureValue = pk => {
      if (!pk || pk.id == null) return;
      const S = P.sess;
      const seen = S.capturePricedIds || (S.capturePricedIds = {});
      const pending = S.capturePending || (S.capturePending = {});
      if (!seen[pk.id]) { seen[pk.id] = true; pending[pk.id] = { ...pk }; }
      else if (pending[pk.id]) Object.assign(pending[pk.id], pk);
      refresh();
    };
    P.refreshCaptureValue = refresh;
    load();
  }
  if (typeof module === 'object' && module.exports) module.exports = { installCaptureValue };
  else root.PioCaptureValue = { installCaptureValue };
})(typeof window === 'object' ? window : globalThis);
