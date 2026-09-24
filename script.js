/* METAZOOA — game engine, storage and UI. */
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    APP_VERSION: 1,
    DATASET_VERSION: 1,
    STORAGE_KEY: 'metazooa.state.v1',
    STORAGE_VERSION: 1,
    DAILY_SEED: 'METAZOOA-2026-A',
    RECENT_DAILY_WINDOW: 14,
    MIN_DIFFICULTY: 'easy',
    MAX_DIFFICULTY: 'expert',
    ALLOW_EXTINCT: false,
    ALLOW_SUBSPECIES: false,
    DIFFICULTY_BY_WEEKDAY: Object.freeze({
      0: 'easy',
      1: 'easy',
      2: 'medium',
      3: 'hard',
      4: 'medium',
      5: 'hard',
      6: 'expert'
    }),
    RANKS: Object.freeze([
      { key: 'kingdom', label: 'Reino', weight: 1.0 },
      { key: 'phylum', label: 'Filo', weight: 1.2 },
      { key: 'subphylum', label: 'Subfilo', weight: 0.55 },
      { key: 'class', label: 'Clase', weight: 1.5 },
      { key: 'subclass', label: 'Subclase', weight: 0.65 },
      { key: 'order', label: 'Orden', weight: 1.7 },
      { key: 'suborder', label: 'Suborden', weight: 0.65 },
      { key: 'family', label: 'Familia', weight: 1.9 },
      { key: 'subfamily', label: 'Subfamilia', weight: 0.7 },
      { key: 'subgenus', label: 'Subgénero', weight: 0.8 },
      { key: 'genus', label: 'Género', weight: 2.2 },
      { key: 'species', label: 'Especie', weight: 2.5 }
    ]),
    PRIMARY_DISPLAY_RANKS: Object.freeze(['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species']),
    HINTS: Object.freeze([
      { id: 'class', label: 'Revelar clase', description: 'Muestra la clase zoológica del objetivo.' },
      { id: 'order', label: 'Revelar orden', description: 'Muestra el orden zoológico del objetivo.' },
      { id: 'habitat', label: 'Revelar hábitat', description: 'Muestra un hábitat principal del objetivo.' },
      { id: 'firstLetter', label: 'Primera letra', description: 'Revela la primera letra del nombre común.' },
      { id: 'letterCount', label: 'Número de letras', description: 'Indica cuántas letras tiene el nombre común.' }
    ])
  });

  const animals = Array.isArray(window.METAZOOA_ANIMALS) ? window.METAZOOA_ANIMALS : [];
  const byId = new Map(animals.map(a => [a.id, a]));
  const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s.-]/g, ' ').replace(/\s+/g, ' ').trim();

  class SearchIndex {
    constructor(records) {
      this.records = records;
      this.exact = new Map();
      this.byCommonName = new Map();
      this.byScientificName = new Map();
      this.byAlias = new Map();
      this.bigrams = new Map();
      this.prefix = new Map();
      this.aliases = new Map();
      const addIndexedValue = (map, term, animalId) => {
        const n = normalizeName(term);
        if (!n) return;
        if (!map.has(n)) map.set(n, new Set());
        map.get(n).add(animalId);
      };
      for (const animal of records) {
        addIndexedValue(this.byCommonName, animal.commonName, animal.id);
        addIndexedValue(this.byScientificName, animal.scientificName, animal.id);
        for (const alias of (animal.aliases || [])) addIndexedValue(this.byAlias, alias, animal.id);
        const terms = new Set([animal.commonName, animal.scientificName, ...(animal.aliases || [])]);
        for (const term of terms) {
          const n = normalizeName(term);
          if (!n) continue;
          if (!this.exact.has(n)) this.exact.set(n, new Set());
          this.exact.get(n).add(animal.id);
          const prefixKey = n.slice(0, 3);
          if (!this.prefix.has(prefixKey)) this.prefix.set(prefixKey, new Set());
          this.prefix.get(prefixKey).add(animal.id);
          if (n.length >= 3) {
            const grams = new Set();
            for (let i = 0; i < n.length - 1; i++) grams.add(n.slice(i, i + 2));
            for (const gram of grams) {
              if (!this.bigrams.has(gram)) this.bigrams.set(gram, new Set());
              this.bigrams.get(gram).add(animal.id);
            }
          }
          this.aliases.set(`${animal.id}:${n}`, true);
        }
      }
    }

    search(query, limit = 8) {
      const q = normalizeName(query);
      if (!q) return [];
      const candidates = new Set();
      const addSet = set => set?.forEach(id => candidates.add(id));
      addSet(this.exact.get(q));
      addSet(this.prefix.get(q.slice(0, 3)));
      if (q.length >= 3) {
        const grams = [];
        for (let i = 0; i < q.length - 1; i++) grams.push(q.slice(i, i + 2));
        grams.sort((a,b) => (this.bigrams.get(a)?.size ?? 999999) - (this.bigrams.get(b)?.size ?? 999999));
        for (const gram of grams.slice(0, 4)) addSet(this.bigrams.get(gram));
      }
      const scored = [];
      for (const id of candidates) {
        const animal = byId.get(id);
        if (!animal) continue;
        const terms = [animal.commonName, animal.scientificName, ...(animal.aliases || [])].map(normalizeName);
        let best = Infinity;
        let bestTerm = '';
        for (const term of terms) {
          const d = levenshteinBounded(q, term, Math.max(3, Math.ceil(Math.max(q.length, term.length) * .42)));
          const contains = q.length >= 3 && term.split(' ').some(token => token === q || token.startsWith(q));
          const exact = term === q;
          const adjusted = exact ? 0 : contains ? Math.min(d, 2) + .15 : d;
          if (adjusted < best) { best = adjusted; bestTerm = term; }
        }
        const tolerance = q.length <= 2 ? 0 : Math.min(3, Math.max(1, Math.floor(q.length * .25)));
        if (best <= tolerance || (q.length >= 3 && bestTerm.split(' ').some(token => token === q || token.startsWith(q))) || q.length <= 2) {
          scored.push({ animal, score: best, exact: this.exact.get(q)?.has(animal.id) === true });
        }
      }
      scored.sort((a,b) => Number(b.exact) - Number(a.exact) || a.score - b.score || a.animal.commonName.localeCompare(b.animal.commonName, 'es'));
      return scored.slice(0, limit).map(x => x.animal);
    }
  }

  const levenshteinBounded = (a, b, limit) => {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > limit) return limit + 1;
      prev = cur;
    }
    return prev[b.length];
  };

  const searchIndex = new SearchIndex(animals);

  class StorageManager {
    constructor(key, version) {
      this.key = key;
      this.version = version;
      this.volatile = false;
    }
    save(data) {
      try {
        localStorage.setItem(this.key, JSON.stringify(data));
        this.volatile = false;
        return true;
      } catch (error) {
        this.volatile = true;
        return false;
      }
    }
    load() {
      try {
        const raw = localStorage.getItem(this.key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.version === this.version ? parsed : null;
      } catch (error) {
        this.volatile = true;
        return null;
      }
    }
    remove() {
      try { localStorage.removeItem(this.key); return true; } catch { this.volatile = true; return false; }
    }
    reset() { return this.remove(); }
  }

  const storage = new StorageManager(CONFIG.STORAGE_KEY, CONFIG.STORAGE_VERSION);

  const defaultState = () => ({
    version: CONFIG.STORAGE_VERSION,
    settings: {
      sound: true,
      vibration: true,
      animations: true,
      theme: 'dark'
    },
    game: {
      currentDate: null,
      dailyTargetId: null,
      completed: false,
      started: false,
      attempts: [],
      usedHints: [],
      hintReveals: [],
      startedAt: null,
      completedAt: null
    },
    dailyHistory: {},
    stats: {
      gamesStarted: 0,
      gamesCompleted: 0,
      abandonedGames: 0,
      totalAttempts: 0,
      totalHints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastCompletedDate: null,
      completedDates: [],
      startedDates: []
    },
    pokedex: {}
  });

  let state = storage.load() || defaultState();
  const stateNow = () => state;

  const formatDate = date => date.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric' });
  const isoDateKey = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const todayKey = () => isoDateKey(new Date());
  const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);
  const difficultyOrder = ['easy','medium','hard','expert'];
  const rarityLabels = { common:'COMÚN', uncommon:'POCO COMÚN', rare:'RARO', epic:'ÉPICO', legendary:'LEGENDARIO' };
  const difficultyLabels = { easy:'FÁCIL', medium:'MEDIO', hard:'DIFÍCIL', expert:'EXPERTO' };
  const rankLabel = key => CONFIG.RANKS.find(r => r.key === key)?.label ?? key;
  const capitalize = value => String(value).charAt(0).toUpperCase() + String(value).slice(1);

  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function getScheduledDifficulty(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`);
    return CONFIG.DIFFICULTY_BY_WEEKDAY[date.getDay()] || 'medium';
  }

  function eligibleDailyPool(difficulty) {
    const min = difficultyOrder.indexOf(CONFIG.MIN_DIFFICULTY);
    const max = difficultyOrder.indexOf(CONFIG.MAX_DIFFICULTY);
    const target = difficultyOrder.indexOf(difficulty);
    return animals.filter(animal => {
      const level = difficultyOrder.indexOf(animal.difficulty);
      return level >= min && level <= max && level === target && !animal.extinct && !(animal.isSubspecies && !CONFIG.ALLOW_SUBSPECIES);
    });
  }

  function chooseDailyCandidate(dateKey, recentIds) {
    const difficulty = getScheduledDifficulty(dateKey);
    let pool = eligibleDailyPool(difficulty);
    if (!pool.length) pool = animals.filter(a => !a.extinct && !(a.isSubspecies && !CONFIG.ALLOW_SUBSPECIES));
    if (!pool.length) return null;
    for (let i = 0; i < pool.length * 2 + 20; i++) {
      const hash = fnv1a(`${CONFIG.DAILY_SEED}|${CONFIG.DATASET_VERSION}|${dateKey}|${i}`);
      const candidate = pool[hash % pool.length];
      if (!recentIds.has(candidate.id) || pool.length <= recentIds.size + 1) return candidate;
    }
    return pool[fnv1a(`${CONFIG.DAILY_SEED}|fallback|${dateKey}`) % pool.length];
  }

  function selectDailyTarget(dateKey) {
    // Rebuild only a short deterministic window. This guarantees the target for a
    // given date does not depend on local history while still avoiding recent repeats.
    const end = new Date(`${dateKey}T12:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - CONFIG.RECENT_DAILY_WINDOW);
    const recentQueue = [];
    const recentSet = new Set();
    let selected = null;
    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      const key = isoDateKey(d);
      selected = chooseDailyCandidate(key, recentSet);
      if (!selected) continue;
      recentQueue.push(selected.id);
      recentSet.add(selected.id);
      while (recentQueue.length > CONFIG.RECENT_DAILY_WINDOW) {
        recentSet.delete(recentQueue.shift());
      }
    }
    return selected;
  }

  function taxValue(animal, rank) {
    return animal?.taxonomy?.[rank] ?? animal?.[rank] ?? null;
  }

  class TaxonomyTree {
    constructor(records) {
      this.nodes = new Map();
      this.pathsByAnimalId = new Map();
      for (const animal of records) this.addAnimal(animal);
    }
    nodeId(rankKey, value) { return `${rankKey}:${normalizeName(value)}`; }
    addAnimal(animal) {
      const path = [];
      let parentId = null;
      for (const rank of CONFIG.RANKS) {
        const value = taxValue(animal, rank.key);
        if (!value) continue;
        const id = this.nodeId(rank.key, value);
        if (!this.nodes.has(id)) {
          this.nodes.set(id, { id, rank:rank.key, label:rank.label, value, parentId, children:new Set(), animalIds:new Set() });
        }
        const node = this.nodes.get(id);
        if (parentId && this.nodes.has(parentId)) this.nodes.get(parentId).children.add(id);
        node.animalIds.add(animal.id);
        path.push(id);
        parentId = id;
      }
      this.pathsByAnimalId.set(animal.id, path);
    }
    findLCA(a, b) {
      const pa = this.pathsByAnimalId.get(a.id) || [];
      const pb = this.pathsByAnimalId.get(b.id) || [];
      const length = Math.min(pa.length, pb.length);
      let commonNode = null;
      for (let i = 0; i < length; i++) {
        if (pa[i] !== pb[i]) break;
        commonNode = this.nodes.get(pa[i]) || null;
      }
      return commonNode ? { key:commonNode.rank, label:commonNode.label, value:commonNode.value } : null;
    }
  }

  const taxonomyTree = new TaxonomyTree(animals);

  function sharedRanks(a, b) {
    return CONFIG.RANKS.filter(r => taxValue(a, r.key) && taxValue(a, r.key) === taxValue(b, r.key));
  }

  function findLCA(a, b) {
    return taxonomyTree.findLCA(a, b);
  }

  function branchDepthFrom(rankKey) {
    const index = CONFIG.RANKS.findIndex(r => r.key === rankKey);
    return index < 0 ? CONFIG.RANKS.length - 1 : index;
  }

  function edgeCostAfter(rankKey) {
    const startIndex = branchDepthFrom(rankKey) + 1;
    return CONFIG.RANKS.slice(startIndex).reduce((sum, r) => sum + r.weight, 0);
  }

  function calculateProximity(guess, target) {
    if (guess.id === target.id) {
      return { level:'exact', label:'DESCUBIERTO', score:100, lca:{ key:'species', label:'Especie', value:guess.species }, distance:0, shared:CONFIG.RANKS.map(r => r.key), direction:'exact' };
    }
    const lca = findLCA(guess, target);
    const shared = sharedRanks(guess, target).map(r => r.key);
    const depth = lca ? branchDepthFrom(lca.key) : -1;
    const below = lca ? edgeCostAfter(lca.key) : CONFIG.RANKS.reduce((s,r) => s+r.weight, 0);
    const maxDepthCost = CONFIG.RANKS.reduce((s,r) => s+r.weight, 0);
    const normalizedDistance = Math.min(1, below / maxDepthCost);
    const rankBase = depth >= 0 ? (depth / (CONFIG.RANKS.length - 1)) * 100 : 0;
    const depthScore = Math.max(0, 100 - normalizedDistance * 100);
    const score = Math.round(Math.min(99, (rankBase * .35) + (depthScore * .65)));

    let level;
    if (lca?.key === 'genus' || lca?.key === 'subgenus' || lca?.key === 'subfamily') level = 'very-close';
    else if (lca?.key === 'family' || lca?.key === 'suborder') level = 'close';
    else if (lca?.key === 'order' || lca?.key === 'subclass') level = 'related';
    else if (lca?.key === 'class' || lca?.key === 'subphylum') level = 'far';
    else level = 'very-far';

    return {
      level,
      label: ({'very-close':'MUY CERCA','close':'CERCA','related':'RELACIONADO','far':'LEJANO','very-far':'MUY LEJANO'})[level],
      score,
      lca,
      shared,
      distance: Number(below.toFixed(2)),
      direction: buildDirection(guess, target, lca)
    };
  }

  function buildDirection(guess, target, lca) {
    if (!lca) return 'No comparten un ancestro registrado en la ficha más allá del reino.';
    if (lca.key === 'species') return 'Es el mismo taxón.';
    const nextGuess = nextDistinctRankValue(guess, lca.key);
    const nextTarget = nextDistinctRankValue(target, lca.key);
    if (lca.key === 'genus') return `Mismo género, <strong>${escapeHtml(guess.genus)}</strong>; especies distintas.`;
    const relationship = rankLabel(lca.key).toLowerCase();
    return `Ambos convergen en <strong>${escapeHtml(lca.value)}</strong> (${relationship}); después se separan en ramas distintas${nextGuess && nextTarget ? `: <strong>${escapeHtml(nextGuess)}</strong> ↔ <strong>${escapeHtml(nextTarget)}</strong>` : ''}.`;
  }

  function nextDistinctRankValue(animal, fromKey) {
    const start = branchDepthFrom(fromKey) + 1;
    for (const rank of CONFIG.RANKS.slice(start)) {
      const value = taxValue(animal, rank.key);
      if (value) return value;
    }
    return null;
  }

  function renderTaxonomyComparison(guess, target) {
    const grid = document.createElement('div');
    grid.className = 'taxonomy-grid';
    for (const rankKey of CONFIG.PRIMARY_DISPLAY_RANKS) {
      const guessValue = taxValue(guess, rankKey);
      const targetValue = taxValue(target, rankKey);
      const chip = document.createElement('div');
      const same = Boolean(guessValue && targetValue && guessValue === targetValue);
      chip.className = `tax-chip ${!guessValue || !targetValue ? 'missing' : same ? 'same' : 'diff'}`;
      chip.innerHTML = `<span>${rankLabel(rankKey)}</span><strong>${escapeHtml(guessValue || targetValue || '—')}</strong>`;
      grid.appendChild(chip);
    }
    return grid;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  }

  function getDailyGame(dateKey = todayKey()) {
    if (state.game.currentDate !== dateKey) {
      rolloverDay(dateKey);
    }
    return state.game;
  }

  function rolloverDay(dateKey) {
    const previousDate = state.game.currentDate;
    if (previousDate && previousDate !== dateKey && state.game.started && !state.game.completed) {
      state.dailyHistory[previousDate] = normalizeDailyHistory({ ...state.game, abandoned: true });
      state.stats.abandonedGames += 1;
    }
    const previousLast = state.stats.lastCompletedDate;
    if (previousLast && daysBetween(previousLast, dateKey) > 1) {
      state.stats.currentStreak = 0;
    }
    const target = selectDailyTarget(dateKey);
    const saved = state.dailyHistory[dateKey];
    if (!saved) ensureAnimalStats(target.id).dailyTimesUsed += 1;
    state.game = saved ? {
      currentDate: dateKey,
      dailyTargetId: target.id,
      completed: Boolean(saved.completed),
      started: Boolean(saved.started),
      attempts: Array.isArray(saved.attempts) ? saved.attempts : [],
      usedHints: Array.isArray(saved.usedHints) ? saved.usedHints : [],
      hintReveals: Array.isArray(saved.hintReveals) ? saved.hintReveals : [],
      startedAt: saved.startedAt || null,
      completedAt: saved.completedAt || null
    } : {
      currentDate: dateKey,
      dailyTargetId: target.id,
      completed: false,
      started: false,
      attempts: [],
      usedHints: [],
      hintReveals: [],
      startedAt: null,
      completedAt: null
    };
    persist();
  }

  function normalizeDailyHistory(entry) {
    return {
      currentDate: entry.currentDate || null,
      dailyTargetId: entry.dailyTargetId || null,
      completed: Boolean(entry.completed),
      started: Boolean(entry.started),
      abandoned: Boolean(entry.abandoned),
      attempts: Array.isArray(entry.attempts) ? entry.attempts : [],
      usedHints: Array.isArray(entry.usedHints) ? entry.usedHints : [],
      hintReveals: Array.isArray(entry.hintReveals) ? entry.hintReveals : [],
      startedAt: entry.startedAt || null,
      completedAt: entry.completedAt || null
    };
  }

  function persist() {
    state.version = CONFIG.STORAGE_VERSION;
    const ok = storage.save(state);
    updateStorageStatus(ok);
    return ok;
  }

  function updateStorageStatus(ok = !storage.volatile) {
    const el = document.getElementById('storageStatus');
    if (!el) return;
    el.textContent = ok ? 'Guardado local' : 'Modo temporal · almacenamiento no disponible';
  }

  function ensureAnimalStats(animalId) {
    if (!state.pokedex[animalId]) {
      state.pokedex[animalId] = {
        unlocked: false,
        usageCount: 0,
        dailyTimesUsed: 0,
        firstDiscovered: null,
        lastUsed: null
      };
    }
    return state.pokedex[animalId];
  }

  function unlockAnimal(animal) {
    const record = ensureAnimalStats(animal.id);
    const now = new Date().toISOString();
    if (!record.unlocked) record.firstDiscovered = now;
    record.unlocked = true;
    record.usageCount += 1;
    record.lastUsed = now;
    persist();
    return record;
  }

  function registerStartIfNeeded() {
    const game = getDailyGame();
    if (game.started) return;
    game.started = true;
    game.startedAt = new Date().toISOString();
    state.stats.gamesStarted += 1;
    if (!state.stats.startedDates.includes(game.currentDate)) state.stats.startedDates.push(game.currentDate);
    persist();
  }

  function makeAttemptRecord(animal, proximity) {
    return {
      animalId: animal.id,
      at: new Date().toISOString(),
      level: proximity.level,
      score: proximity.score,
      lcaRank: proximity.lca?.key || null,
      lcaValue: proximity.lca?.value || null
    };
  }

  function submitGuess(animalId) {
    const game = getDailyGame();
    if (game.completed) return { ok:false, message:'Ya has completado el animal de hoy.' };
    const animal = byId.get(animalId);
    if (!animal) return { ok:false, message:'Ese animal no existe en esta edición.' };
    if (game.attempts.some(a => a.animalId === animalId)) return { ok:false, message:'Ya has utilizado este animal.' };
    const target = byId.get(game.dailyTargetId);
    if (!target) return { ok:false, message:'El objetivo diario no está disponible.' };
    registerStartIfNeeded();
    const proximity = calculateProximity(animal, target);
    game.attempts.push(makeAttemptRecord(animal, proximity));
    state.stats.totalAttempts += 1;
    unlockAnimal(animal);
    if (animal.id === target.id) {
      completeDailyGame();
    }
    persist();
    return { ok:true, animal, target, proximity, completed: animal.id === target.id };
  }

  function completeDailyGame() {
    const game = state.game;
    if (game.completed) return;
    game.completed = true;
    game.completedAt = new Date().toISOString();
    state.stats.gamesCompleted += 1;
    state.stats.completedDates = Array.from(new Set([...state.stats.completedDates, game.currentDate])).sort();
    state.stats.lastCompletedDate = game.currentDate;
    const previous = state.stats.completedDates.filter(d => d !== game.currentDate).sort().at(-1);
    if (previous && daysBetween(previous, game.currentDate) === 1) state.stats.currentStreak += 1;
    else state.stats.currentStreak = 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.currentStreak);
    ensureAnimalStats(game.dailyTargetId);
    state.dailyHistory[game.currentDate] = normalizeDailyHistory(game);
    persist();
  }

  function useHint(hintId) {
    const game = getDailyGame();
    if (game.completed) return { ok:false, message:'Las pistas están cerradas para el día.' };
    if (!CONFIG.HINTS.some(h => h.id === hintId)) return { ok:false, message:'Pista no válida.' };
    if (game.usedHints.includes(hintId)) return { ok:false, message:'Ya utilizaste esta pista.' };
    const target = byId.get(game.dailyTargetId);
    if (!target) return { ok:false, message:'Objetivo diario no disponible.' };
    registerStartIfNeeded();
    let reveal = '';
    if (hintId === 'class') reveal = `Clase: ${target.class}`;
    if (hintId === 'order') reveal = `Orden: ${target.order}`;
    if (hintId === 'habitat') reveal = `Hábitat: ${target.habitat[0]}`;
    if (hintId === 'firstLetter') reveal = `Primera letra: ${target.commonName.trim().charAt(0).toUpperCase()}`;
    if (hintId === 'letterCount') reveal = `Número de letras: ${normalizeName(target.commonName).replace(/\s/g,'').length}`;
    game.usedHints.push(hintId);
    game.hintReveals.push({ id:hintId, reveal, at:new Date().toISOString() });
    state.stats.totalHints += 1;
    persist();
    return { ok:true, reveal };
  }

  function getShareText() {
    const game = getDailyGame();
    const symbols = game.attempts.map(a => ({'very-close':'🟩','close':'🟢','related':'🟨','far':'🟧','very-far':'🟥','exact':'🟩'})[a.level] || '⬜').join(' ');
    const done = game.completed ? 'Descubierto' : `${game.attempts.length} intentos`;
    return `METAZOOA 🐾\n${formatDate(new Date(`${game.currentDate}T12:00:00`))}\n\n${game.attempts.length ? `Intentos: ${game.attempts.length}` : done}\n${symbols || '⬜'}`;
  }

  async function shareResult() {
    const text = getShareText();
    if (navigator.share && (window.isSecureContext !== false)) {
      try { await navigator.share({ title:'METAZOOA', text }); return true; } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Resultado copiado al portapapeles.');
      return true;
    } catch {
      openModal(`<div class="eyebrow">COMPARTIR RESULTADO</div><h2>Copia tu resultado</h2><div class="share-preview">${escapeHtml(text)}</div>`);
      return false;
    }
  }

  function feedback(kind = 'tap') {
    if (state.settings.vibration && navigator.vibrate) {
      try { navigator.vibrate(kind === 'win' ? [20,35,70] : kind === 'error' ? [28] : [12]); } catch {}
    }
    if (state.settings.sound) playTone(kind);
  }

  function playTone(kind) {
    if (!state.settings.sound) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const now = ctx.currentTime;
      const notes = kind === 'win' ? [659.25, 783.99, 987.77] : kind === 'error' ? [180] : [420];
      notes.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        osc.type = 'sine';
        const start = now + index * .08;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(kind === 'win' ? .07 : .025, start + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, start + (kind === 'win' ? .16 : .08));
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + (kind === 'win' ? .17 : .09));
      });
      setTimeout(() => ctx.close().catch(() => {}), 500);
    } catch {}
  }

  function toast(message) {
    const region = document.getElementById('toastRegion');
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  let currentView = 'game';
  let selectedAnimalId = null;
  let highlightedSuggestion = -1;
  let pokedexView = 'grid';

  function init() {
    sanitizeImportedState();
    getDailyGame();
    detectClockIssue();
    applyTheme();
    bindNavigation();
    bindGame();
    bindPokedex();
    bindSettings();
    registerPWA();
    renderAll();
    setInterval(tick, 1000);
    document.addEventListener('keydown', onGlobalKeydown);
  }

  function sanitizeImportedState() {
    const base = defaultState();
    if (!state || state.version !== CONFIG.STORAGE_VERSION) state = base;
    state.settings = { ...base.settings, ...(state.settings || {}) };
    state.game = { ...base.game, ...(state.game || {}) };
    state.stats = { ...base.stats, ...(state.stats || {}) };
    state.dailyHistory = state.dailyHistory && typeof state.dailyHistory === 'object' ? state.dailyHistory : {};
    state.pokedex = state.pokedex && typeof state.pokedex === 'object' ? state.pokedex : {};
    state.stats.completedDates = Array.isArray(state.stats.completedDates) ? [...new Set(state.stats.completedDates.filter(Boolean))].sort() : [];
    state.stats.startedDates = Array.isArray(state.stats.startedDates) ? [...new Set(state.stats.startedDates.filter(Boolean))].sort() : [];
    for (const key of Object.keys(state.pokedex)) {
      if (!byId.has(key)) { delete state.pokedex[key]; continue; }
      const rec = state.pokedex[key];
      rec.unlocked = Boolean(rec.unlocked);
      rec.usageCount = Math.max(0, Number(rec.usageCount) || 0);
      rec.dailyTimesUsed = Math.max(0, Number(rec.dailyTimesUsed) || 0);
      rec.firstDiscovered = rec.firstDiscovered || null;
      rec.lastUsed = rec.lastUsed || null;
    }
    persist();
  }

  function detectClockIssue() {
    const key = todayKey();
    const metaKey = `${CONFIG.STORAGE_KEY}.clock`;
    try {
      const raw = localStorage.getItem(metaKey);
      const prev = raw ? JSON.parse(raw) : null;
      const maxSeen = prev?.maxDate || null;
      const warning = Boolean(maxSeen && key < maxSeen);
      const banner = $('#clockWarning');
      if (banner) {
        if (warning) {
          banner.textContent = `La fecha del dispositivo parece haber retrocedido (${maxSeen} → ${key}). METAZOOA usa la fecha local del dispositivo; esta comprobación no puede garantizar protección contra manipulación.`;
          banner.classList.remove('is-hidden');
        } else banner.classList.add('is-hidden');
      }
      const nextMax = !maxSeen || key > maxSeen ? key : maxSeen;
      localStorage.setItem(metaKey, JSON.stringify({ maxDate:nextMax }));
    } catch {}
  }

  function bindNavigation() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-view-target]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
    $('#quickSettings')?.addEventListener('click', () => switchView('settings'));
  }

  function switchView(view) {
    const valid = ['game','pokedex','stats','settings'];
    if (!valid.includes(view)) return;
    currentView = view;
    $$('[data-view-panel]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
    $$('[data-view]').forEach(nav => nav.classList.toggle('is-active', nav.dataset.view === view));
    if (view === 'pokedex') renderPokedex();
    if (view === 'stats') renderStats();
    if (view === 'settings') renderSettings();
    window.scrollTo({ top:0, behavior: state.settings.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
  }

  function bindGame() {
    const input = $('#animalSearch');
    input.addEventListener('input', () => {
      selectedAnimalId = null;
      highlightedSuggestion = -1;
      updateGuessButton();
      renderSuggestions(input.value);
      $('#clearSearch').classList.toggle('is-hidden', !input.value);
    });
    input.addEventListener('focus', () => { if (input.value.trim()) renderSuggestions(input.value); });
    input.addEventListener('keydown', onSearchKeydown);
    $('#clearSearch').addEventListener('click', () => { input.value=''; selectedAnimalId=null; $('#clearSearch').classList.add('is-hidden'); closeSuggestions(); updateGuessButton(); input.focus(); });
    $('#guessButton').addEventListener('click', handleGuessButton);
    $('#hintButton').addEventListener('click', openHintsModal);
    $('#completedShareButton').addEventListener('click', shareResult);
    document.addEventListener('click', event => {
      if (!event.target.closest('.search-shell')) closeSuggestions();
    });
  }

  function onSearchKeydown(event) {
    const items = $$('#searchSuggestions .suggestion');
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!items.length) return; highlightedSuggestion = Math.min(highlightedSuggestion + 1, items.length - 1); refreshSuggestionHighlight(items); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (!items.length) return; highlightedSuggestion = Math.max(highlightedSuggestion - 1, 0); refreshSuggestionHighlight(items); }
    else if (event.key === 'Enter') { event.preventDefault(); if (highlightedSuggestion >= 0 && items[highlightedSuggestion]) items[highlightedSuggestion].click(); else if (selectedAnimalId) handleGuessButton(); else chooseFirstSuggestion(); }
    else if (event.key === 'Escape') { closeSuggestions(); }
  }

  function refreshSuggestionHighlight(items) {
    items.forEach((item, index) => item.classList.toggle('is-highlighted', index === highlightedSuggestion));
    items[highlightedSuggestion]?.scrollIntoView({ block:'nearest' });
  }

  function chooseFirstSuggestion() {
    const first = $('#searchSuggestions .suggestion');
    if (first) first.click();
  }

  function renderSuggestions(query) {
    const container = $('#searchSuggestions');
    container.innerHTML = '';
    if (!query.trim()) { closeSuggestions(); return; }
    const suggestions = searchIndex.search(query, 8);
    if (!suggestions.length) {
      container.innerHTML = `<div class="suggestion"><div class="suggestion-main"><strong>No encontramos ese animal</strong><span>Prueba un nombre común, científico o un término más corto.</span></div></div>`;
    } else {
      const already = new Set(getDailyGame().attempts.map(a => a.animalId));
      suggestions.forEach((animal, index) => {
        const button = document.createElement('button');
        button.type='button'; button.className='suggestion'; button.setAttribute('role','option');
        const used = already.has(animal.id);
        button.innerHTML = `<span class="suggestion-icon" aria-hidden="true">${escapeHtml(animal.icon || '🐾')}</span><span class="suggestion-main"><strong>${escapeHtml(animal.commonName)}</strong><span>${escapeHtml(animal.scientificName)}</span></span><span class="suggestion-extra">${used ? 'USADO' : capitalize(animal.class)}</span>`;
        button.addEventListener('click', () => selectSuggestion(animal));
        container.appendChild(button);
      });
      highlightedSuggestion = -1;
    }
    container.classList.remove('is-hidden');
    $('#animalSearch').setAttribute('aria-expanded','true');
  }

  function selectSuggestion(animal) {
    const input = $('#animalSearch');
    input.value = animal.commonName;
    selectedAnimalId = animal.id;
    closeSuggestions();
    updateGuessButton();
    input.focus();
  }

  function closeSuggestions() {
    $('#searchSuggestions').classList.add('is-hidden');
    $('#animalSearch').setAttribute('aria-expanded','false');
    highlightedSuggestion = -1;
  }

  function updateGuessButton() {
    $('#guessButton').disabled = !selectedAnimalId || getDailyGame().completed;
  }

  function handleGuessButton() {
    if (!selectedAnimalId) return;
    const result = submitGuess(selectedAnimalId);
    if (!result.ok) { feedback('error'); toast(result.message); return; }
    feedback(result.completed ? 'win' : 'tap');
    $('#animalSearch').value=''; selectedAnimalId=null; $('#clearSearch').classList.add('is-hidden'); updateGuessButton(); closeSuggestions();
    renderAll();
    if (result.completed) openVictoryModal(result.animal, result.proximity);
  }

  function openHintsModal() {
    const game = getDailyGame();
    const locked = game.completed;
    openModal(`<div class="eyebrow">PISTAS OPCIONALES</div><h2>Revela una pieza del árbol</h2><p>Las pistas no son necesarias para jugar. Cada una cuenta como uso de pista en tus estadísticas.</p><div class="hint-modal-list">${CONFIG.HINTS.map(h => `<button class="hint-option" data-hint-id="${h.id}" ${locked || game.usedHints.includes(h.id) ? 'disabled' : ''}><strong>${h.label}</strong><span class="muted">${h.description}</span></button>`).join('')}</div>`);
    $$('.hint-option').forEach(btn => btn.addEventListener('click', () => {
      const result = useHint(btn.dataset.hintId);
      if (result.ok) { feedback('tap'); closeModal(); renderAll(); toast(`💡 ${result.reveal}`); }
      else toast(result.message);
    }));
  }

  function renderHints() {
    const game = getDailyGame();
    const grid = $('#hintGrid');
    const revealById = new Map((game.hintReveals || []).map(x => [x.id, x.reveal]));
    grid.innerHTML = CONFIG.HINTS.map(h => {
      const used = game.usedHints.includes(h.id);
      return `<div class="hint-pill ${used ? 'is-used' : ''}">${used ? '✓ ' : ''}${h.label}${used && revealById.get(h.id) ? `<br><span>${escapeHtml(revealById.get(h.id))}</span>` : ''}</div>`;
    }).join('');
  }

  function renderHistory() {
    const game = getDailyGame();
    const target = byId.get(game.dailyTargetId);
    const list = $('#historyList');
    $('#historyCount').textContent = `${game.attempts.length} ${game.attempts.length === 1 ? 'intento' : 'intentos'}`;
    if (!game.attempts.length) {
      list.innerHTML = `<div class="card empty-state"><div class="empty-icon">🌿</div><h2>Tu árbol empieza aquí</h2><p class="muted">Introduce un animal. Cada intento te enseñará hasta qué rama comparte ancestro contigo.</p></div>`;
      return;
    }
    list.innerHTML = '';
    [...game.attempts].reverse().forEach(attempt => {
      const animal = byId.get(attempt.animalId);
      if (!animal || !target) return;
      const result = calculateProximity(animal, target);
      const wrapper = document.createElement('article');
      wrapper.className='attempt-card';
      wrapper.innerHTML = `<div class="attempt-head"><div class="animal-mini"><span class="animal-icon" aria-hidden="true">${escapeHtml(animal.icon || '🐾')}</span><div><strong class="guess-name">${escapeHtml(animal.commonName)}</strong><span class="guess-scientific">${escapeHtml(animal.scientificName)}</span></div></div><span class="proximity-badge" data-level="${result.level}">${result.label}</span></div>`;
      wrapper.appendChild(renderTaxonomyComparison(animal, target));
      const direction = document.createElement('div'); direction.className='attempt-direction'; direction.innerHTML = result.lca ? `${result.direction}<br><span class="muted">Ancestro común: <strong>${escapeHtml(result.lca.value)}</strong> · ${escapeHtml(result.lca.label)}</span>` : result.direction;
      wrapper.appendChild(direction);
      list.appendChild(wrapper);
    });
  }

  function renderDailyState() {
    const game = getDailyGame();
    const target = byId.get(game.dailyTargetId);
    $('#dailyDifficulty').textContent = difficultyLabels[getScheduledDifficulty(game.currentDate)] || 'MEDIO';
    const completed = game.completed && target;
    $('#completedDailyPanel').classList.toggle('is-hidden', !completed);
    $('#playCard').classList.toggle('is-hidden', Boolean(completed));
    if (completed) $('#gameTitle').textContent = 'Animal descubierto';
    else $('#gameTitle').textContent = '¿Qué animal se esconde hoy?';
    updateGuessButton();
  }

  function renderCollectionOverview() {
    const unlocked = animals.filter(a => state.pokedex[a.id]?.unlocked).length;
    const percent = animals.length ? Math.round(unlocked / animals.length * 100) : 0;
    $('#collectionCount').textContent = unlocked;
    $('#collectionTotal').textContent = animals.length;
    $('#collectionPercent').textContent = `${percent}%`;
    $('#collectionProgress').style.width = `${percent}%`;
    const classes = [...new Set(animals.map(a => a.class))].sort((a,b)=>a.localeCompare(b));
    const top = classes.sort((a,b) => {
      const ua = animals.filter(x=>x.class===a && state.pokedex[x.id]?.unlocked).length;
      const ub = animals.filter(x=>x.class===b && state.pokedex[x.id]?.unlocked).length;
      return ub-ua;
    }).slice(0,4);
    $('#collectionMini').innerHTML = top.map(cls => {
      const total=animals.filter(a=>a.class===cls).length; const have=animals.filter(a=>a.class===cls && state.pokedex[a.id]?.unlocked).length; const p=total?Math.round(have/total*100):0;
      return `<div class="mini-class"><div class="mini-class-head"><span>${escapeHtml(displayClass(cls))}</span><strong>${have}/${total}</strong></div><div class="mini-class-bar"><span style="width:${p}%"></span></div></div>`;
    }).join('');
  }

  function displayClass(cls) {
    const map = { Mammalia:'Mamíferos', Aves:'Aves', Reptilia:'Reptiles', Amphibia:'Anfibios', Actinopterygii:'Peces óseos', Arachnida:'Arácnidos', Insecta:'Insectos', Malacostraca:'Crustáceos', Cephalopoda:'Cefalópodos', Bivalvia:'Bivalvos', Gastropoda:'Gasterópodos', Anthozoa:'Anémonas y corales', Hydrozoa:'Hidrozoos', Scyphozoa:'Escifozoos', Cubozoa:'Cubomedusas', Asteroidea:'Estrellas de mar', Echinoidea:'Erizos de mar', Holothuroidea:'Pepinos de mar', Crinoidea:'Crinoideos', Ophiuroidea:'Ofiuras', Trematoda:'Tremátodos', Cestoda:'Cestodos', Rhabditophora:'Platelmintos', Demospongiae:'Esponjas', Calcarea:'Esponjas calcáreas', Priapulida:'Priapúlidos', Eutardigrada:'Tardígrados', Monogononta:'Rotíferos', Hyperoartia:'Lampreas' };
    return map[cls] || cls;
  }

  function bindPokedex() {
    $('#pokedexSearch').addEventListener('input', renderPokedex);
    $('#pokedexClassFilter').addEventListener('change', renderPokedex);
    $('#pokedexRarityFilter').addEventListener('change', renderPokedex);
    $('#pokedexSort').addEventListener('change', renderPokedex);
    $$('[data-pokedex-view]').forEach(btn => btn.addEventListener('click', () => { pokedexView = btn.dataset.pokedexView; $$('[data-pokedex-view]').forEach(x=>x.classList.toggle('is-active', x===btn)); renderPokedex(); }));
  }

  function renderPokedexFilters() {
    const classSelect = $('#pokedexClassFilter');
    const currentClass = classSelect.value || 'all';
    const classes = [...new Set(animals.map(a=>a.class))].sort((a,b)=>displayClass(a).localeCompare(displayClass(b), 'es'));
    classSelect.innerHTML = `<option value="all">Todas las clases</option>` + classes.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(displayClass(c))}</option>`).join('');
    classSelect.value = classes.includes(currentClass) ? currentClass : 'all';
    const raritySelect = $('#pokedexRarityFilter'); const currentRarity=raritySelect.value || 'all';
    raritySelect.innerHTML = `<option value="all">Todas las rarezas</option>` + Object.entries(rarityLabels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('');
    raritySelect.value = Object.keys(rarityLabels).includes(currentRarity) ? currentRarity : 'all';
  }

  function getFilteredPokedex() {
    const query = normalizeName($('#pokedexSearch').value);
    const cls = $('#pokedexClassFilter').value; const rarity=$('#pokedexRarityFilter').value; const sort=$('#pokedexSort').value;
    let list = animals.filter(a => (cls==='all'||a.class===cls) && (rarity==='all'||a.rarity===rarity));
    if (query) list = list.filter(a => [a.commonName,a.scientificName,...(a.aliases||[])].some(t=>normalizeName(t).includes(query)));
    list.sort((a,b)=>{
      const ua=state.pokedex[a.id]?.unlocked?1:0, ub=state.pokedex[b.id]?.unlocked?1:0;
      if (sort==='status') return ub-ua || a.commonName.localeCompare(b.commonName,'es');
      if (sort==='name') return a.commonName.localeCompare(b.commonName,'es');
      if (sort==='family') return a.family.localeCompare(b.family,'en') || a.commonName.localeCompare(b.commonName,'es');
      if (sort==='rarity') return ['legendary','epic','rare','uncommon','common'].indexOf(a.rarity)-['legendary','epic','rare','uncommon','common'].indexOf(b.rarity) || a.commonName.localeCompare(b.commonName,'es');
      if (sort==='usage') return (state.pokedex[b.id]?.usageCount||0)-(state.pokedex[a.id]?.usageCount||0) || a.commonName.localeCompare(b.commonName,'es');
      if (sort==='recent') return String(state.pokedex[b.id]?.lastUsed||'').localeCompare(String(state.pokedex[a.id]?.lastUsed||'')) || a.commonName.localeCompare(b.commonName,'es');
      return a.commonName.localeCompare(b.commonName,'es');
    });
    return list;
  }

  function renderPokedex() {
    const unlocked = animals.filter(a => state.pokedex[a.id]?.unlocked).length;
    $('#pokedexUnlocked').textContent = unlocked; $('#pokedexTotal').textContent = animals.length;
    renderPokedexFilters(); renderTaxProgress(); renderRecentDiscoveries();
    const grid = $('#pokedexGrid'); const list = getFilteredPokedex();
    grid.classList.toggle('list-view', pokedexView === 'list');
    grid.innerHTML = list.map(renderPokedexCard).join('');
    $$('#pokedexGrid .pokedex-card[data-animal-id]').forEach(card => {
      const open = () => openAnimalDetail(card.dataset.animalId);
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    });
    $('#pokedexEmpty').classList.toggle('is-hidden', list.length > 0);
  }


  function openAnimalDetail(animalId) {
    const animal = byId.get(animalId);
    const record = state.pokedex[animalId];
    if (!animal || !record?.unlocked) return;
    const rows = ['kingdom','phylum','class','order','family','genus','species'].map(key => `<div class="victory-tax-row"><span>${rankLabel(key)}</span><strong>${escapeHtml(taxValue(animal,key) || '—')}</strong></div>`).join('');
    const optional = ['subphylum','subclass','suborder','subfamily','subgenus'].filter(k => taxValue(animal,k)).map(key => `<div class="victory-tax-row"><span>${rankLabel(key)}</span><strong>${escapeHtml(taxValue(animal,key))}</strong></div>`).join('');
    openModal(`<div class="victory-hero"><div class="victory-emoji">${escapeHtml(animal.icon || '🐾')}</div><div class="eyebrow">ANIMAL DESBLOQUEADO</div><div class="victory-name">${escapeHtml(animal.commonName)}</div><div class="victory-science"><em>${escapeHtml(animal.scientificName)}</em></div></div><div class="eyebrow">TAXONOMÍA</div><div class="victory-tax">${rows}${optional}</div><div class="eyebrow" style="margin-top:18px">COLECCIÓN</div><div class="victory-tax"><div class="victory-tax-row"><span>Rareza</span><strong>${rarityLabels[animal.rarity]}</strong></div><div class="victory-tax-row"><span>Dificultad diaria</span><strong>${difficultyLabels[animal.difficulty]}</strong></div><div class="victory-tax-row"><span>Veces utilizado</span><strong>${record.usageCount}</strong></div><div class="victory-tax-row"><span>Veces animal diario</span><strong>${record.dailyTimesUsed}</strong></div><div class="victory-tax-row"><span>Hábitat</span><strong>${escapeHtml(animal.habitat.join(' · '))}</strong></div></div>`);
  }

  function renderPokedexCard(animal) {
    const record = state.pokedex[animal.id]; const unlocked = Boolean(record?.unlocked);
    if (!unlocked) return `<article class="pokedex-card locked" aria-label="Animal bloqueado"><div class="pokedex-visual"><div class="pokedex-icon" aria-label="Silueta de animal desconocido">${escapeHtml(animal.icon || '🐾')}</div><span class="locked-question">BLOQUEADO</span></div><div class="pokedex-body"><strong>???</strong><span class="science">Animal sin descubrir</span></div></article>`;
    return `<article class="pokedex-card" data-animal-id="${escapeHtml(animal.id)}" tabindex="0" role="button" aria-label="Ver detalles de ${escapeHtml(animal.commonName)}"><div class="pokedex-visual"><div class="pokedex-icon">${escapeHtml(animal.icon || '🐾')}</div></div><div class="pokedex-body"><strong>${escapeHtml(animal.commonName)}</strong><span class="science"><em>${escapeHtml(animal.scientificName)}</em></span><div class="pokedex-meta"><span class="meta-chip rarity-${animal.rarity}">${rarityLabels[animal.rarity]}</span><span class="meta-chip">${escapeHtml(animal.family)}</span><span class="meta-chip">Usos: ${record.usageCount}</span></div><div class="pokedex-meta"><span class="meta-chip">Primer: ${record.firstDiscovered ? escapeHtml(formatDate(new Date(record.firstDiscovered))) : '—'}</span><span class="meta-chip">Último: ${record.lastUsed ? escapeHtml(formatDate(new Date(record.lastUsed))) : '—'}</span></div></div></article>`;
  }

  function renderTaxProgress() {
    const tracked = ['Mammalia','Aves','Reptilia','Amphibia','Actinopterygii','Insecta','Arachnida','Malacostraca'];
    const available = tracked.filter(cls=>animals.some(a=>a.class===cls));
    $('#taxProgress').innerHTML = available.map(cls=>{const total=animals.filter(a=>a.class===cls).length;const have=animals.filter(a=>a.class===cls&&state.pokedex[a.id]?.unlocked).length;const p=total?Math.round(have/total*100):0;return `<div class="tax-progress-item"><div class="tax-progress-head"><span>${escapeHtml(displayClass(cls))}</span><strong>${have} / ${total}</strong></div><div class="tax-progress-bar"><span style="width:${p}%"></span></div></div>`}).join('');
  }

  function renderRecentDiscoveries() {
    const items = animals.filter(a=>state.pokedex[a.id]?.unlocked && state.pokedex[a.id]?.firstDiscovered).sort((a,b)=>String(state.pokedex[b.id].firstDiscovered).localeCompare(String(state.pokedex[a.id].firstDiscovered))).slice(0,8);
    $('#pokedexRecent').innerHTML = items.length ? items.map(a=>`<div class="recent-card"><span class="recent-name">${escapeHtml(a.icon||'🐾')} ${escapeHtml(a.commonName)}</span><span class="recent-date">Descubierto · ${escapeHtml(formatDate(new Date(state.pokedex[a.id].firstDiscovered)))}</span></div>`).join('') : `<div class="muted microcopy">Aún no hay descubrimientos. Tu primer intento aparecerá aquí.</div>`;
  }

  function bindSettings() {
    $$('.switch').forEach(button => button.addEventListener('click', () => { const key=button.dataset.setting; state.settings[key]=!state.settings[key]; persist(); applyTheme(); renderSettings(); }));
    $('#themeSelect').addEventListener('change', event => { state.settings.theme=event.target.value; persist(); applyTheme(); });
    $('#exportButton').addEventListener('click', exportData);
    $('#importButton').addEventListener('click', () => $('#importInput').click());
    $('#importInput').addEventListener('change', importDataFile);
    $('#resetButton').addEventListener('click', openResetConfirm);
  }

  function renderSettings() {
    $$('.switch').forEach(btn => btn.classList.toggle('is-on', Boolean(state.settings[btn.dataset.setting])));
    $('#themeSelect').value = state.settings.theme || 'dark';
  }

  function applyTheme() {
    const theme = state.settings.theme || 'dark';
    const actual = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.dataset.theme = actual;
    document.documentElement.dataset.animations = state.settings.animations ? 'on' : 'off';
    try { document.querySelector('meta[name="theme-color"]').setAttribute('content', actual === 'light' ? '#f3f6f4' : '#071411'); } catch {}
  }

  function exportData() {
    const payload = { app:'METAZOOA', version:CONFIG.STORAGE_VERSION, exportedAt:new Date().toISOString(), datasetVersion:CONFIG.DATASET_VERSION, state };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`metazooa-backup-${todayKey()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),500);
    toast('Copia de datos exportada.');
  }

  function importDataFile(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const result = validateImport(data);
        if (!result.ok) { toast(result.message); return; }
        state = result.state;
        persist();
        getDailyGame(); detectClockIssue(); applyTheme(); renderAll(); toast('Datos importados correctamente.');
      } catch { toast('El archivo no es un JSON válido.'); }
      event.target.value='';
    };
    reader.readAsText(file);
  }

  function validateImport(data) {
    if (!data || data.app !== 'METAZOOA' || data.version !== CONFIG.STORAGE_VERSION || !data.state) return {ok:false,message:'El archivo no pertenece a una copia válida de METAZOOA.'};
    const candidate = data.state;
    const fresh = defaultState();
    const safe = {
      ...fresh,
      settings: {...fresh.settings, ...(candidate.settings||{})},
      game: {...fresh.game, ...(candidate.game||{})},
      stats: {...fresh.stats, ...(candidate.stats||{})},
      dailyHistory: candidate.dailyHistory && typeof candidate.dailyHistory==='object' ? candidate.dailyHistory : {},
      pokedex: candidate.pokedex && typeof candidate.pokedex==='object' ? candidate.pokedex : {}
    };
    safe.settings.sound = Boolean(safe.settings.sound); safe.settings.vibration=Boolean(safe.settings.vibration); safe.settings.animations=Boolean(safe.settings.animations); safe.settings.theme=['dark','light','system'].includes(safe.settings.theme)?safe.settings.theme:'dark';
    safe.game.attempts = Array.isArray(safe.game.attempts) ? safe.game.attempts.filter(a=>a && byId.has(a.animalId)) : [];
    safe.game.usedHints = Array.isArray(safe.game.usedHints) ? safe.game.usedHints.filter(x=>CONFIG.HINTS.some(h=>h.id===x)) : [];
    safe.game.hintReveals = Array.isArray(safe.game.hintReveals) ? safe.game.hintReveals.slice(0,CONFIG.HINTS.length) : [];
    safe.stats.gamesStarted=Math.max(0,Number(safe.stats.gamesStarted)||0); safe.stats.gamesCompleted=Math.max(0,Number(safe.stats.gamesCompleted)||0); safe.stats.abandonedGames=Math.max(0,Number(safe.stats.abandonedGames)||0); safe.stats.totalAttempts=Math.max(0,Number(safe.stats.totalAttempts)||0); safe.stats.totalHints=Math.max(0,Number(safe.stats.totalHints)||0); safe.stats.currentStreak=Math.max(0,Number(safe.stats.currentStreak)||0); safe.stats.bestStreak=Math.max(0,Number(safe.stats.bestStreak)||0);
    safe.stats.completedDates=Array.isArray(safe.stats.completedDates)?safe.stats.completedDates.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-500):[]; safe.stats.startedDates=Array.isArray(safe.stats.startedDates)?safe.stats.startedDates.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).slice(-500):[];
    for (const [id, rec] of Object.entries(safe.pokedex)) if (!byId.has(id)) delete safe.pokedex[id]; else { rec.unlocked=Boolean(rec.unlocked); rec.usageCount=Math.max(0,Number(rec.usageCount)||0); rec.dailyTimesUsed=Math.max(0,Number(rec.dailyTimesUsed)||0); rec.firstDiscovered=rec.firstDiscovered||null; rec.lastUsed=rec.lastUsed||null; }
    safe.version=CONFIG.STORAGE_VERSION;
    return {ok:true,state:safe};
  }

  function openResetConfirm() {
    openModal(`<div class="eyebrow">REINICIAR PROGRESO</div><h2>¿Seguro que quieres borrar toda tu Pokédex?</h2><p>Esta acción no se puede deshacer. Elimina únicamente los datos guardados por METAZOOA en este navegador.</p><div class="confirm-actions"><button class="secondary-button" id="cancelReset" type="button">CANCELAR</button><button class="danger-button" id="confirmReset" type="button">BORRAR TODO</button></div>`);
    $('#cancelReset').addEventListener('click', closeModal);
    $('#confirmReset').addEventListener('click', () => {
      state = defaultState(); storage.reset(); persist(); getDailyGame(); applyTheme(); renderAll(); closeModal(); toast('Progreso reiniciado.');
    });
  }

  function openVictoryModal(animal, result) {
    const game = getDailyGame();
    const taxRows = ['class','order','family','genus'].map(k=>`<div class="victory-tax-row"><span>${rankLabel(k)}</span><strong>${escapeHtml(animal[k])}</strong></div>`).join('');
    openModal(`<div class="victory-hero"><div class="victory-emoji">🎉</div><div class="eyebrow">ANIMAL DESCUBIERTO</div><div class="victory-name">${escapeHtml(animal.commonName)}</div><div class="victory-science"><em>${escapeHtml(animal.scientificName)}</em></div><div class="victory-attempts">Intentos · <strong>${game.attempts.length}</strong></div></div><div class="eyebrow">TAXONOMÍA</div><div class="victory-tax">${taxRows}</div><div class="victory-actions"><button class="primary-button" id="victoryShare" type="button">↗ Compartir</button><button class="secondary-button" id="victoryPokedex" type="button">📖 Ver en Pokédex</button><button class="secondary-button" id="victoryClose" type="button">Cerrar</button></div>`);
    $('#victoryShare').addEventListener('click', shareResult);
    $('#victoryPokedex').addEventListener('click', () => { closeModal(); switchView('pokedex'); });
    $('#victoryClose').addEventListener('click', closeModal);
    if (state.settings.animations) document.querySelector('.victory-hero')?.animate([{transform:'scale(.98)',opacity:.5},{transform:'scale(1)',opacity:1}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
  }

  function openModal(html) {
    $('#modalContent').innerHTML = html;
    const backdrop=$('#modalBackdrop'); backdrop.classList.remove('is-hidden'); backdrop.setAttribute('aria-hidden','false');
    const modal=backdrop.querySelector('.modal'); modal.focus();
    $('#modalClose').onclick=closeModal;
    backdrop.onclick=event=>{ if(event.target===backdrop) closeModal(); };
  }
  function closeModal() { const b=$('#modalBackdrop'); b.classList.add('is-hidden'); b.setAttribute('aria-hidden','true'); }

  function renderStats() {
    const completed = state.stats.gamesCompleted; const attempts=state.stats.totalAttempts; const avg=completed?Math.round(attempts/completed*10)/10:0; const best = completed ? Math.min(...state.stats.completedDates.map(d=>state.dailyHistory[d]?.attempts?.length || 999)) : 0; const unlocked=animals.filter(a=>state.pokedex[a.id]?.unlocked).length; const percent=animals.length?Math.round(unlocked/animals.length*100):0;
    const cards = [
      ['Partidas completadas', completed, 'días resueltos'],
      ['Partidas iniciadas', state.stats.gamesStarted, 'días con al menos un intento/pista'],
      ['Partidas abandonadas', state.stats.abandonedGames, 'iniciadas y no resueltas antes del cambio de día'],
      ['Animales descubiertos', unlocked, `${percent}% de la Pokédex`],
      ['Intentos totales', attempts, 'todos los animales válidos'],
      ['Media de intentos', avg.toFixed(1), 'por día completado'],
      ['Mejor partida', best || '—', best ? 'menos intentos en un día' : 'aún sin victorias'],
      ['Racha actual', `🔥 ${state.stats.currentStreak}`, `mejor: ${state.stats.bestStreak}`],
      ['Pistas utilizadas', state.stats.totalHints, 'uso acumulado']
    ];
    $('#statsGrid').innerHTML = cards.map(c=>`<div class="stat-card"><div class="eyebrow">${escapeHtml(c[0])}</div><div class="stat-value">${escapeHtml(c[1])}</div><div class="stat-note">${escapeHtml(c[2])}</div></div>`).join('');
    const classes=[...new Set(animals.map(a=>a.class))].sort((a,b)=>displayClass(a).localeCompare(displayClass(b),'es'));
    $('#statsClasses').innerHTML=classes.map(cls=>{const total=animals.filter(a=>a.class===cls).length;const have=animals.filter(a=>a.class===cls&&state.pokedex[a.id]?.unlocked).length;const p=total?Math.round(have/total*100):0;return `<div class="stats-class-row"><span>${escapeHtml(displayClass(cls))}</span><div class="stats-bar"><span style="width:${p}%"></span></div><strong>${have}/${total}</strong></div>`}).join('');
    const most=animals.filter(a=>state.pokedex[a.id]?.usageCount>0).sort((a,b)=>(state.pokedex[b.id].usageCount-state.pokedex[a.id].usageCount)||a.commonName.localeCompare(b.commonName,'es')).slice(0,8);
    $('#mostUsedList').innerHTML=most.length?most.map(a=>`<div class="used-row"><div class="used-icon">${escapeHtml(a.icon||'🐾')}</div><div class="used-main"><strong>${escapeHtml(a.commonName)}</strong><span>${escapeHtml(a.scientificName)}</span></div><div class="used-count">${state.pokedex[a.id].usageCount} usos</div></div>`).join(''):`<div class="muted microcopy">Todavía no hay intentos registrados.</div>`;
  }

  function tick() {
    const now = new Date(); const current = todayKey();
    if (state.game.currentDate !== current) { detectClockIssue(); getDailyGame(current); renderAll(); }
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0,0,0,0);
    const diff=Math.max(0,next-now); const h=Math.floor(diff/3600000); const m=Math.floor((diff%3600000)/60000); const s=Math.floor((diff%60000)/1000); $('#countdown').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function onGlobalKeydown(event) {
    if (event.key==='Escape' && !$('#modalBackdrop').classList.contains('is-hidden')) closeModal();
  }

  async function registerPWA() {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      try { await navigator.serviceWorker.register('service-worker.js'); } catch { /* App still works without PWA worker. */ }
    }
  }

  function renderAll() {
    renderDailyState(); renderHistory(); renderHints(); renderCollectionOverview(); renderPokedex(); renderStats(); renderSettings(); tick(); updateStorageStatus(!storage.volatile);
    $('#streakValue').textContent = state.stats.currentStreak;
  }

  init();
})();
