// === Vex Phase 15: Personas Manager ===
// CRUD + active-persona state. Persistence via localStorage (mirrored to
// %APPDATA%/Vex/vex-persist.json by the Phase 11 shim, synced by Phase 13).

const PersonasManager = (() => {
  const STORAGE_KEY = 'vex.personas';
  const ACTIVE_GLOBAL_KEY = 'vex.activePersona';
  const ACTIVE_TAB_PREFIX = 'vex.activePersonaByTab.';

  let customPersonas = [];
  let activePersonaIdGlobal = 'builtin_default';

  function _load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function _save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  function _remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function init() {
    const loaded = _load(STORAGE_KEY, []);
    customPersonas = Array.isArray(loaded) ? loaded.filter(p => p && typeof p === 'object' && p.id) : [];
    activePersonaIdGlobal = _load(ACTIVE_GLOBAL_KEY, 'builtin_default') || 'builtin_default';
    // Sweep per-tab keys for tabs that no longer exist (see pruneTabs).
    try {
      // Only when tabs are actually loaded — pruning against an empty list
      // before TabManager.init() would wipe every per-tab choice.
      if (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs) && TabManager.tabs.length) {
        pruneTabs(TabManager.tabs.map(t => t.id));
      }
    } catch {}
  }

  function getAll() {
    return [...(window.BUILT_IN_PERSONAS || []), ...customPersonas];
  }

  function getById(id) {
    return getAll().find(p => p.id === id) || (window.BUILT_IN_PERSONAS || [])[0];
  }

  function getActiveForTab(tabId) {
    if (tabId != null) {
      const key = ACTIVE_TAB_PREFIX + tabId;
      const perTab = _load(key, null);
      if (perTab && getById(perTab) && getById(perTab).id === perTab) return getById(perTab);
    }
    return getById(activePersonaIdGlobal);
  }

  // This tab only. With no tab (nothing open) there is nothing per-tab to set,
  // so it falls through to the default — otherwise the choice would vanish.
  function setActiveForTab(tabId, personaId) {
    if (!getById(personaId)) return;
    if (tabId == null) return setDefault(personaId);
    _save(ACTIVE_TAB_PREFIX + tabId, personaId);
  }

  // The persona every tab uses unless it has picked its own. Clearing the
  // current tab's override is the caller's job (Settings does it, so "Use"
  // takes effect where you can see it).
  function setDefault(personaId) {
    if (!getById(personaId)) return;
    activePersonaIdGlobal = personaId;
    _save(ACTIVE_GLOBAL_KEY, personaId);
  }

  function clearTab(tabId) {
    if (tabId == null) return;
    _remove(ACTIVE_TAB_PREFIX + tabId);
  }

  // Per-tab persona choices are one localStorage key each and nothing ever
  // removed them, so a long-lived profile accumulated a key for every tab it
  // ever opened. Drop the ones whose tab is gone.
  function pruneTabs(liveTabIds) {
    if (!Array.isArray(liveTabIds)) return 0;
    const live = new Set(liveTabIds.map(String));
    let removed = 0;
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(ACTIVE_TAB_PREFIX)) continue;
        if (live.has(key.slice(ACTIVE_TAB_PREFIX.length))) continue;
        _remove(key);
        removed++;
      }
    } catch {}
    return removed;
  }

  // Personas are user data that go straight into an AI request \u2014 an imported
  // file used to be able to set temperature:"hot" (rejected by the model with an
  // opaque 400) or a megabyte-long system prompt. Everything is coerced here so
  // every consumer can trust the shape.
  const MAX_NAME = 60, MAX_DESC = 160, MAX_PROMPT = 8000, MAX_PROMPT_LINE = 120;

  function _text(v, max, fallback = '') {
    const s = (typeof v === 'string' ? v : (v == null ? '' : String(v))).trim();
    return (s ? s.slice(0, max) : fallback);
  }
  function _temperature(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!Number.isFinite(n)) return 0.7;
    return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  }
  function _quickPrompts(v) {
    if (!Array.isArray(v)) return [];
    return v.filter(p => typeof p === 'string' && p.trim())
      .map(p => p.trim().slice(0, MAX_PROMPT_LINE))
      .slice(0, 5);
  }
  function _enum(v, allowed, fallback) { return allowed.includes(v) ? v : fallback; }

  function _normalize(data) {
    return {
      name: _text(data.name, MAX_NAME, 'New Persona'),
      description: _text(data.description, MAX_DESC),
      icon: _text(data.icon, 40, 'robot'),
      systemPrompt: _text(data.systemPrompt, MAX_PROMPT),
      temperature: _temperature(data.temperature),
      preferredBackend: _enum(data.preferredBackend, ['auto', 'cloud', 'local'], 'auto'),
      preferredModel: typeof data.preferredModel === 'string' ? data.preferredModel.slice(0, 80) : null,
      tabContextDefault: _enum(data.tabContextDefault, ['current', 'all', 'group', 'custom'], 'current'),
      responseFormat: _enum(data.responseFormat, ['prose', 'bullets', 'json'], 'prose'),
      suggestedFollowUps: data.suggestedFollowUps !== false,
      quickPrompts: _quickPrompts(data.quickPrompts)
    };
  }

  function create(data) {
    const persona = {
      id: 'persona_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ..._normalize(data || {}),
      isBuiltIn: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    customPersonas.push(persona);
    _save(STORAGE_KEY, customPersonas);
    return persona;
  }

  function update(id, updates) {
    const builtIn = (window.BUILT_IN_PERSONAS || []).find(p => p.id === id);
    if (builtIn) {
      // Built-ins can't be edited in place — fork into a custom copy
      const copy = { ...builtIn, ...updates };
      delete copy.isBuiltIn;
      delete copy.id;
      copy.name = (updates.name && updates.name !== builtIn.name) ? updates.name : builtIn.name + ' (custom)';
      return create(copy);
    }
    const idx = customPersonas.findIndex(p => p.id === id);
    if (idx < 0) return null;
    const merged = { ...customPersonas[idx], ...updates };
    customPersonas[idx] = {
      ...customPersonas[idx],
      ..._normalize(merged),
      id: customPersonas[idx].id,
      isBuiltIn: false,
      createdAt: customPersonas[idx].createdAt,
      updatedAt: new Date().toISOString()
    };
    _save(STORAGE_KEY, customPersonas);
    return customPersonas[idx];
  }

  function remove(id) {
    const builtIn = (window.BUILT_IN_PERSONAS || []).find(p => p.id === id);
    if (builtIn) return false;
    customPersonas = customPersonas.filter(p => p.id !== id);
    if (activePersonaIdGlobal === id) {
      activePersonaIdGlobal = 'builtin_default';
      _save(ACTIVE_GLOBAL_KEY, activePersonaIdGlobal);
    }
    _save(STORAGE_KEY, customPersonas);
    return true;
  }

  function duplicate(id) {
    const original = getById(id);
    if (!original) return null;
    const copy = { ...original };
    delete copy.id;
    delete copy.isBuiltIn;
    copy.name = original.name + ' (copy)';
    return create(copy);
  }

  function exportPersonas() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      personas: customPersonas
    };
  }

  const MAX_PERSONAS = 200;

  function importPersonas(data) {
    if (!data || !Array.isArray(data.personas)) throw new Error('Invalid import format');
    let imported = 0, skipped = 0;
    for (const p of data.personas) {
      if (!p || typeof p !== 'object' || typeof p.name !== 'string' || typeof p.systemPrompt !== 'string'
        || !p.name.trim() || !p.systemPrompt.trim()) { skipped++; continue; }
      if (customPersonas.length >= MAX_PERSONAS) throw new Error(`Stopped at ${MAX_PERSONAS} personas — delete some first (imported ${imported}).`);
      create({
        name: p.name, description: p.description, icon: p.icon,
        systemPrompt: p.systemPrompt, temperature: p.temperature,
        preferredBackend: p.preferredBackend, tabContextDefault: p.tabContextDefault,
        responseFormat: p.responseFormat, suggestedFollowUps: p.suggestedFollowUps,
        quickPrompts: p.quickPrompts
      });
      imported++;
    }
    if (!imported) throw new Error(skipped ? 'No valid personas in that file (each needs a name and a system prompt).' : 'That file contained no personas.');
    return imported;
  }

  // Fuzzy match an @mention string like "@research" against persona names.
  function findByMention(text) {
    if (!text) return null;
    const m = String(text).match(/@([A-Za-z0-9_]+)/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    const all = getAll();
    // 1. exact prefix of full name (lowered, spaces stripped)
    let hit = all.find(p => p.name.toLowerCase().replace(/\s+/g, '').startsWith(q));
    if (hit) return hit;
    // 2. any word in name starts with q
    hit = all.find(p => p.name.toLowerCase().split(/\s+/).some(w => w.startsWith(q)));
    if (hit) return hit;
    // 3. contains anywhere
    hit = all.find(p => p.name.toLowerCase().includes(q));
    return hit || null;
  }

  return {
    init, getAll, getById,
    getActiveForTab, setActiveForTab, setDefault, clearTab,
    create, update, remove, duplicate,
    exportPersonas, importPersonas, findByMention,
    pruneTabs
  };
})();

if (typeof window !== 'undefined') window.PersonasManager = PersonasManager;
if (typeof module !== 'undefined' && module.exports) module.exports = { PersonasManager };
