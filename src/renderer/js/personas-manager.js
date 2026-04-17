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
    customPersonas = _load(STORAGE_KEY, []) || [];
    activePersonaIdGlobal = _load(ACTIVE_GLOBAL_KEY, 'builtin_default') || 'builtin_default';
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

  function setActiveForTab(tabId, personaId) {
    if (!getById(personaId)) return;
    if (tabId != null) {
      _save(ACTIVE_TAB_PREFIX + tabId, personaId);
    }
    activePersonaIdGlobal = personaId;
    _save(ACTIVE_GLOBAL_KEY, personaId);
  }

  function clearTab(tabId) {
    if (tabId == null) return;
    _remove(ACTIVE_TAB_PREFIX + tabId);
  }

  function create(data) {
    const persona = {
      id: 'persona_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: data.name || 'New Persona',
      description: data.description || '',
      icon: data.icon || '\ud83e\udd16',
      systemPrompt: data.systemPrompt || '',
      temperature: data.temperature ?? 0.7,
      preferredBackend: data.preferredBackend || 'auto',
      preferredModel: data.preferredModel || null,
      tabContextDefault: data.tabContextDefault || 'current',
      responseFormat: data.responseFormat || 'prose',
      suggestedFollowUps: data.suggestedFollowUps ?? true,
      quickPrompts: Array.isArray(data.quickPrompts) ? data.quickPrompts.slice(0, 5) : [],
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
    customPersonas[idx] = {
      ...customPersonas[idx],
      ...updates,
      id: customPersonas[idx].id,
      isBuiltIn: false,
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

  function importPersonas(data) {
    if (!data || !Array.isArray(data.personas)) throw new Error('Invalid import format');
    let imported = 0;
    for (const p of data.personas) {
      if (!p.name || !p.systemPrompt) continue;
      create({
        name: p.name, description: p.description, icon: p.icon,
        systemPrompt: p.systemPrompt, temperature: p.temperature,
        preferredBackend: p.preferredBackend, tabContextDefault: p.tabContextDefault,
        responseFormat: p.responseFormat, suggestedFollowUps: p.suggestedFollowUps,
        quickPrompts: p.quickPrompts
      });
      imported++;
    }
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
    getActiveForTab, setActiveForTab, clearTab,
    create, update, remove, duplicate,
    exportPersonas, importPersonas, findByMention
  };
})();

window.PersonasManager = PersonasManager;
