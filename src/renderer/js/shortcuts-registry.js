// === Vex Phase 17: Customizable Keyboard Shortcuts ===
// Central registry. Renderer code calls ShortcutsRegistry.register(id, handler)
// and the global listener fires the right handler when the current binding
// for that id matches the pressed key combo.

const ShortcutsRegistry = (() => {
  const DEFAULT_SHORTCUTS = {
    // AI
    'command-bar':    { default: 'Ctrl+K',       label: 'Command Bar (URLs, commands, search)', category: 'Navigation' },
    // Sixty shortcuts listed on a settings page nobody decides to read is
    // sixty shortcuts nobody uses. One key puts them over whatever you are
    // doing, the relevant ones first (js/keys-sheet.js).
    'keys-sheet':     { default: 'Ctrl+Shift+K', label: 'What you can press (shortcut sheet)', category: 'Navigation' },
    'ask-ai-bar':     { default: 'Ctrl+J',       label: 'Ask Vex AI (quick prompt)',  category: 'AI' },
    'ai-panel':       { default: 'Ctrl+Shift+A', label: 'Toggle AI Panel',            category: 'AI' },
    'ai-focus-mode':  { default: 'Ctrl+Shift+F', label: 'Vex AI full screen',         category: 'AI' },
    'history-ai':     { default: 'Ctrl+Shift+H', label: 'Open History in AI Search',  category: 'AI' },

    // Tabs
    'new-tab':        { default: 'Ctrl+T',       label: 'New Tab',                    category: 'Tabs' },
    'close-tab':      { default: 'Ctrl+W',       label: 'Close Tab',                  category: 'Tabs' },
    'reopen-tab':     { default: 'Ctrl+Shift+T', label: 'Reopen Closed Tab',          category: 'Tabs' },
    'next-tab':       { default: 'Ctrl+Tab',     label: 'Next Tab',                   category: 'Tabs' },
    'prev-tab':       { default: 'Ctrl+Shift+Tab', label: 'Previous Tab',             category: 'Tabs' },
    'bookmark':       { default: 'Ctrl+D',       label: 'Bookmark Page',              category: 'Tabs' },
    'sleep-tab':      { default: 'Ctrl+Shift+Z', label: 'Sleep Tab',                  category: 'Tabs' },
    'mute-tab':       { default: 'Ctrl+M',       label: 'Mute Tab',                   category: 'Tabs' },
    'split-screen':   { default: 'Ctrl+Shift+S', label: 'Split Screen',               category: 'Tabs' },
    'tabs-sidebar':   { default: 'Ctrl+B',       label: 'Toggle Tabs Sidebar',        category: 'Tabs' },
    'pip':            { default: 'Ctrl+Shift+P', label: 'Picture-in-Picture',         category: 'Tabs' },
    'lock-vex':       { default: 'Ctrl+Alt+L',   label: 'Lock Vex',                   category: 'Tabs' },

    // Navigation
    'focus-url':      { default: 'Ctrl+L',       label: 'Focus URL Bar',              category: 'Navigation' },
    'reload':         { default: 'Ctrl+R',       label: 'Reload Page',                category: 'Navigation' },
    'hard-reload':    { default: 'Ctrl+Shift+R', label: 'Hard Reload (clear cache)',  category: 'Navigation' },
    'find-in-page':   { default: 'Ctrl+F',       label: 'Find in Page',               category: 'Navigation' },
    'zoom-reset':     { default: 'Ctrl+0',       label: 'Reset Zoom',                 category: 'Navigation' },

    // Panels
    'history-panel':  { default: 'Ctrl+H',       label: 'History Panel',              category: 'Panels' },
    'memory-panel':   { default: 'Ctrl+Shift+M', label: 'Memory Panel (tab usage)',   category: 'Panels' },
    // Ctrl+Shift+N is claimed by Notes at the main-process level, so this used a
    // dead key. Ctrl+Alt+N is free (and not intercepted by main.js), so the
    // renderer registry actually fires it — and it stays user-rebindable.
    'private-window': { default: 'Ctrl+Alt+N',   label: 'Private Window',             category: 'Panels' },
    'sessions':       { default: 'Ctrl+Shift+O', label: 'Sessions Menu',              category: 'Panels' },
    'schedules':      { default: 'Ctrl+Shift+L', label: 'Schedules Panel',            category: 'Panels' },

    // Tools
    'reading-mode':   { default: 'Ctrl+Alt+R',   label: 'Reading Mode',               category: 'Tools' },
    'screenshot':     { default: 'Ctrl+Alt+S',   label: 'Screenshot',                 category: 'Tools' },
    'group-tabs':     { default: 'Ctrl+Shift+G', label: 'Organize Tabs with AI',      category: 'Tools' },
    'free-memory':    { default: 'Ctrl+Alt+M',   label: 'Free memory now',            category: 'Tools' },
    'toggle-theme':   { default: 'Ctrl+Shift+Y', label: 'Open Theme Picker',           category: 'Tools' },
    'dictate':        { default: 'Ctrl+Alt+D',   label: 'Dictate (speak, and it is typed)', category: 'Tools' },
    'do-again':       { default: 'Ctrl+Alt+A',   label: 'Do the last Ctrl+K command again', category: 'Tools' },

    // Window
    'fullscreen':     { default: 'F11',          label: 'Fullscreen',                 category: 'Window' },

    // Features that had no key of their own. Each one names the Ctrl+K command
    // it runs (`cmd`), so there is nothing to wire up: the registry runs the
    // command itself when the key is pressed. All rebindable, none claimed by
    // the main process, and Ctrl+Alt is where there is room left — Ctrl and
    // Ctrl+Shift are largely spoken for by Chromium and by Vex already.
    'library':        { default: 'Ctrl+Alt+B',   label: 'Library (what you saved)',   category: 'Panels',     cmd: 'library' },
    'everything':     { default: 'Ctrl+Alt+E',   label: 'Everything Vex can do',      category: 'Panels',     cmd: 'everything' },
    'tasks':          { default: 'Ctrl+Alt+T',   label: 'Running tasks',              category: 'Tools',      cmd: 'tasks' },
    'downloads':      { default: 'Ctrl+Alt+J',   label: 'Downloads',                  category: 'Panels',     cmd: 'downloads' },
    'logins':         { default: 'Ctrl+Alt+P',   label: 'Logins & 2FA codes',         category: 'Panels',     cmd: 'loginshub' },
    'focus-mode':     { default: 'Ctrl+Alt+F',   label: 'Focus mode',                 category: 'Tools',      cmd: 'focus' },
    'clip-to-notes':  { default: 'Ctrl+Alt+C',   label: 'Clip the selection to Notes', category: 'Tools',     cmd: 'clip' },
    'watch-page':     { default: 'Ctrl+Alt+W',   label: 'Watch this page for changes', category: 'Tools',     cmd: 'watch' },
    'toolbox':        { default: 'Ctrl+Alt+X',   label: 'Toolbox',                    category: 'Tools',      cmd: 'toolbox' },
    'read-later':     { default: 'Ctrl+Alt+K',   label: 'Save this page to Read Later', category: 'Tools',    cmd: 'readlater' },
    'translate-page': { default: 'Ctrl+Alt+G',   label: 'Translate this page',        category: 'Tools',      cmd: 'translate' },
    // Alt+Tab's useful half, for tabs: one press and you are back on the tab
    // you were on before this one. Alt+Q because Alt+Tab itself belongs to
    // Windows and can never be taken from it.
    'last-tab':       { default: 'Alt+Q',         label: 'Back to the last tab you used', category: 'Tabs' }
  };

  // A binding the user made for a Ctrl+K command that has no built-in key.
  // Stored under 'cmd:<command id>' beside the built-in ones, and the label
  // is read from the live command bar rather than copied, so a renamed
  // command does not leave a stale name in the list.
  const CUSTOM_PREFIX = 'cmd:';
  const isCustomId = (id) => String(id || '').startsWith(CUSTOM_PREFIX);
  const commandIdOf = (id) => String(id).slice(CUSTOM_PREFIX.length);

  function _command(cmdId) {
    const list = (typeof CommandBar !== 'undefined' && CommandBar.commands) || [];
    return list.find(c => c.id === cmdId) || null;
  }

  // Every command that could be given a key, and has not got one.
  function assignable() {
    const list = (typeof CommandBar !== 'undefined' && CommandBar.commands) || [];
    const taken = new Set();
    for (const id in DEFAULT_SHORTCUTS) if (DEFAULT_SHORTCUTS[id].cmd) taken.add(DEFAULT_SHORTCUTS[id].cmd);
    for (const id in userShortcuts) if (isCustomId(id)) taken.add(commandIdOf(id));
    return list
      .filter(c => c && c.id && !taken.has(c.id) && typeof c.action === 'function')
      .map(c => ({ id: c.id, label: c.label || c.id, hint: c.hint || '' }));
  }

  // These combos are ALSO claimed by the main-process keyboard layer
  // (main.js before-input-event), which fires them and preventDefault()s the
  // event before this renderer registry ever sees the key. Rebinding them here
  // can't move the key off its default — the OS-level default always wins — so
  // they're flagged `system` and the editor shows them as fixed rather than
  // promising a rebind it can't deliver. (The shortcut still WORKS; it just
  // can't be reassigned from here.) Keep this list in sync with main.js.
  const SYSTEM_SHORTCUTS = new Set([
    'command-bar', 'find-in-page', 'new-tab', 'close-tab', 'reload', 'zoom-reset',
    'split-screen', 'pip', 'sessions', 'reopen-tab', 'history-ai', 'history-panel',
    'memory-panel', 'sleep-tab', 'screenshot', 'fullscreen', 'mute-tab', 'ai-panel',
    'schedules', 'tabs-sidebar',
    // Passed up from inside pages by main.js (handleDictateShortcut).
    'dictate',
  ]);
  for (const id of SYSTEM_SHORTCUTS) { if (DEFAULT_SHORTCUTS[id]) DEFAULT_SHORTCUTS[id].system = true; }

  let userShortcuts = {};
  const handlers = new Map();
  let listenerAttached = false;

  function _load() {
    try { const raw = localStorage.getItem('vex.userShortcuts'); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  }
  // Returns false when the bindings could not be written. Callers must pass that
  // on rather than reporting a rebind that will not survive a restart.
  function _save() {
    try { localStorage.setItem('vex.userShortcuts', JSON.stringify(userShortcuts)); } catch { return false; }
    return true;
  }

  // Tell main which combinations we answer to, so the same keys work while a
  // PAGE has the focus (main/guest-shortcuts.js passes those back up). Sent on
  // start and after every rebind; without it a rebound key only worked while
  // Vex's own interface was focused.
  function _tellMain() {
    if (!window.vex || typeof window.vex.setGuestShortcutKeys !== 'function') return false;
    const all = getAllShortcuts();
    const combos = Object.values(all).filter(d => d.current && d.hasHandler).map(d => d.current);
    try { window.vex.setGuestShortcutKeys([...new Set(combos)]); return true; }
    catch (err) { console.warn('[Shortcuts] could not hand the keys to the window:', err && err.message); return false; }
  }

  function init() {
    userShortcuts = _load();
    if (!listenerAttached) {
      document.addEventListener('keydown', _onKeyDown, true); // capture so we fire before most listeners
      listenerAttached = true;
    }
    // After the command bar has built its list, so a shortcut that names a
    // command counts as handled.
    setTimeout(_tellMain, 1200);
  }

  function getShortcut(id) {
    return userShortcuts[id] || DEFAULT_SHORTCUTS[id]?.default || null;
  }

  function getAllShortcuts() {
    const out = {};
    for (const id in DEFAULT_SHORTCUTS) {
      const def = DEFAULT_SHORTCUTS[id];
      out[id] = {
        ...def,
        current: userShortcuts[id] || def.default,
        isCustom: !!userShortcuts[id] && userShortcuts[id] !== def.default,
        // A key with nothing behind it does nothing, and the editor greys it
        // out rather than pretending. An entry that names a Ctrl+K command
        // counts as handled while that command exists.
        hasHandler: handlers.has(id) || !!(def.cmd && _command(def.cmd))
      };
    }
    // The ones the user added for a command of their choosing.
    for (const id in userShortcuts) {
      if (!isCustomId(id)) continue;
      const cmd = _command(commandIdOf(id));
      out[id] = {
        label: cmd ? (cmd.label || cmd.id) : commandIdOf(id) + ' (no longer in Vex)',
        category: 'Your own',
        current: userShortcuts[id],
        isCustom: true,
        removable: true,
        hasHandler: !!cmd,
        cmd: commandIdOf(id)
      };
    }
    return out;
  }

  function setShortcut(id, combo) {
    // A key for any Ctrl+K command: 'cmd:<id>', made by the editor's "give
    // something else a key" box rather than shipped as a default.
    if (isCustomId(id)) {
      if (!_command(commandIdOf(id))) return { unknown: true };
    } else if (!DEFAULT_SHORTCUTS[id]) return false;
    else if (DEFAULT_SHORTCUTS[id].system) return { system: true }; // fixed at the main-process level
    const all = getAllShortcuts();
    for (const [otherId, data] of Object.entries(all)) {
      if (otherId !== id && data.current === combo) {
        return { conflict: otherId, conflictLabel: data.label };
      }
    }
    userShortcuts[id] = combo;
    const ok = _save();
    _tellMain();
    // `true` still means "bound and saved"; { saved: false } means the binding
    // is live for this session only, which the editor tells the user about.
    return ok ? true : { saved: false };
  }

  function resetShortcut(id) {
    delete userShortcuts[id];
    const ok = _save();
    _tellMain();
    return ok;
  }

  // A shortcut the user added has no default to fall back to, so removing it
  // takes the key away entirely.
  function removeShortcut(id) {
    if (!isCustomId(id)) return resetShortcut(id);
    delete userShortcuts[id];
    const ok = _save();
    _tellMain();
    return ok;
  }
  function resetAll() { userShortcuts = {}; const ok = _save(); _tellMain(); return ok; }

  function register(id, handler) {
    if (!DEFAULT_SHORTCUTS[id]) {
      console.warn('[Shortcuts] Unknown id:', id);
      return;
    }
    handlers.set(id, handler);
  }

  function _commandHandler(cmdId) {
    const cmd = _command(cmdId);
    if (!cmd || typeof cmd.action !== 'function') return null;
    return () => {
      try { cmd.action(); }
      catch (err) { window.showToast?.((err && err.message) || 'That did not work', 'error'); }
    };
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
      // Either something registered a handler for this id, or the entry names
      // a Ctrl+K command and the registry runs that. A binding with neither
      // is not swallowed: the key goes on to whatever else wants it.
      const h = handlers.get(id) || (data.cmd ? _commandHandler(data.cmd) : null);
      if (!h) return;
      try {
        e.preventDefault();
        e.stopPropagation();
        h(e);
      } catch (err) { console.error('[Shortcuts] handler error for', id, err); }
      return;
    }
  }

  return {
    init, getShortcut, getAllShortcuts, assignable,
    setShortcut, resetShortcut, removeShortcut, resetAll,
    register, eventToShortcut, _tellMain
  };
})();

if (typeof window !== 'undefined') window.ShortcutsRegistry = ShortcutsRegistry;
if (typeof module !== 'undefined' && module.exports) module.exports = ShortcutsRegistry;
