// === Vex Phase 17: Customizable Keyboard Shortcuts ===
// Central registry. Renderer code calls ShortcutsRegistry.register(id, handler)
// and the global listener fires the right handler when the current binding
// for that id matches the pressed key combo.

const ShortcutsRegistry = (() => {
  const DEFAULT_SHORTCUTS = {
    // AI
    'command-bar':    { default: 'Ctrl+K',       label: 'Command Bar (URLs, commands, search)', category: 'Navigation' },
    'ask-ai-bar':     { default: 'Ctrl+J',       label: 'Ask Vex AI (quick prompt)',  category: 'AI' },
    'ai-panel':       { default: 'Ctrl+Shift+A', label: 'Toggle AI Panel',            category: 'AI' },
    'history-ai':     { default: 'Ctrl+Shift+H', label: 'Open History in AI Search',  category: 'AI' },

    // Tabs
    'new-tab':        { default: 'Ctrl+T',       label: 'New Tab',                    category: 'Tabs' },
    'close-tab':      { default: 'Ctrl+W',       label: 'Close Tab',                  category: 'Tabs' },
    'reopen-tab':     { default: 'Ctrl+Shift+T', label: 'Reopen Closed Tab',          category: 'Tabs' },
    'sleep-tab':      { default: 'Ctrl+Shift+Z', label: 'Sleep Tab',                  category: 'Tabs' },
    'mute-tab':       { default: 'Ctrl+M',       label: 'Mute Tab',                   category: 'Tabs' },
    'split-screen':   { default: 'Ctrl+Shift+S', label: 'Split Screen',               category: 'Tabs' },
    'tabs-sidebar':   { default: 'Ctrl+B',       label: 'Toggle Tabs Sidebar',        category: 'Tabs' },
    'pip':            { default: 'Ctrl+Shift+P', label: 'Picture-in-Picture',         category: 'Tabs' },

    // Navigation
    'focus-url':      { default: 'Ctrl+L',       label: 'Focus URL Bar',              category: 'Navigation' },
    'reload':         { default: 'Ctrl+R',       label: 'Reload Page',                category: 'Navigation' },
    'find-in-page':   { default: 'Ctrl+F',       label: 'Find in Page',               category: 'Navigation' },
    'zoom-reset':     { default: 'Ctrl+0',       label: 'Reset Zoom',                 category: 'Navigation' },

    // Panels
    'history-panel':  { default: 'Ctrl+H',       label: 'History Panel',              category: 'Panels' },
    'memory-panel':   { default: 'Ctrl+Shift+M', label: 'Memory Panel (tab usage)',   category: 'Panels' },
    'private-window': { default: 'Ctrl+Shift+N', label: 'Private Window',             category: 'Panels' },
    'sessions':       { default: 'Ctrl+Shift+O', label: 'Sessions Menu',              category: 'Panels' },
    'schedules':      { default: 'Ctrl+Shift+L', label: 'Schedules Panel',            category: 'Panels' },

    // Tools
    'reading-mode':   { default: 'Ctrl+Shift+R', label: 'Reading Mode',               category: 'Tools' },
    'screenshot':     { default: 'Ctrl+Alt+S',   label: 'Screenshot',                 category: 'Tools' },
    'group-tabs':     { default: 'Ctrl+Shift+G', label: 'Organize Tabs with AI',      category: 'Tools' },

    // Window
    'fullscreen':     { default: 'F11',          label: 'Fullscreen',                 category: 'Window' }
  };

  let userShortcuts = {};
  const handlers = new Map();
  let listenerAttached = false;

  function _load() {
    try { const raw = localStorage.getItem('vex.userShortcuts'); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  }
  function _save() {
    try { localStorage.setItem('vex.userShortcuts', JSON.stringify(userShortcuts)); } catch {}
  }

  function init() {
    userShortcuts = _load();
    if (!listenerAttached) {
      document.addEventListener('keydown', _onKeyDown, true); // capture so we fire before most listeners
      listenerAttached = true;
    }
  }

  function getShortcut(id) {
    return userShortcuts[id] || DEFAULT_SHORTCUTS[id]?.default || null;
  }

  function getAllShortcuts() {
    const out = {};
    for (const id in DEFAULT_SHORTCUTS) {
      out[id] = {
        ...DEFAULT_SHORTCUTS[id],
        current: userShortcuts[id] || DEFAULT_SHORTCUTS[id].default,
        isCustom: !!userShortcuts[id] && userShortcuts[id] !== DEFAULT_SHORTCUTS[id].default,
        hasHandler: handlers.has(id)
      };
    }
    return out;
  }

  function setShortcut(id, combo) {
    if (!DEFAULT_SHORTCUTS[id]) return false;
    const all = getAllShortcuts();
    for (const [otherId, data] of Object.entries(all)) {
      if (otherId !== id && data.current === combo) {
        return { conflict: otherId, conflictLabel: data.label };
      }
    }
    userShortcuts[id] = combo;
    _save();
    return true;
  }

  function resetShortcut(id) {
    delete userShortcuts[id];
    _save();
  }
  function resetAll() { userShortcuts = {}; _save(); }

  function register(id, handler) {
    if (!DEFAULT_SHORTCUTS[id]) {
      console.warn('[Shortcuts] Unknown id:', id);
      return;
    }
    handlers.set(id, handler);
  }

  function eventToShortcut(e) {
    if (!e || !e.key) return null;
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');

    let key = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;

    if (key === ' ') key = 'Space';
    else if (key === 'ArrowLeft') key = 'Left';
    else if (key === 'ArrowRight') key = 'Right';
    else if (key === 'ArrowUp') key = 'Up';
    else if (key === 'ArrowDown') key = 'Down';
    else if (key.length === 1) key = key.toUpperCase();
    // Function keys, Escape, Enter, etc. keep their name

    mods.push(key);
    return mods.join('+');
  }

  function _onKeyDown(e) {
    const target = e.target;
    const inInput = target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable);
    // If typing in an input and no modifier + not a function/F-key, do nothing
    if (inInput && !e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d+$/.test(e.key) && e.key !== 'Escape') return;

    const combo = eventToShortcut(e);
    if (!combo) return;

    const all = getAllShortcuts();
    for (const [id, data] of Object.entries(all)) {
      if (data.current !== combo) continue;
      const h = handlers.get(id);
      if (!h) return; // binding exists but no registered handler — don't swallow
      try {
        e.preventDefault();
        e.stopPropagation();
        h(e);
      } catch (err) { console.error('[Shortcuts] handler error for', id, err); }
      return;
    }
  }

  return {
    init, getShortcut, getAllShortcuts,
    setShortcut, resetShortcut, resetAll,
    register, eventToShortcut
  };
})();

window.ShortcutsRegistry = ShortcutsRegistry;
