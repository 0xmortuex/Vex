// === Reaching Discord without leaving the game =============================
//
// The Discord panel is the point of having Discord inside the browser — but
// muting yourself means alt-tabbing out of a fullscreen game, finding Vex,
// finding the panel, and clicking. By then the moment has passed. Discord's own
// app has global hotkeys for exactly this; a Discord living in a browser panel
// had none.
//
// These are system-wide: they work while the game has the screen. Each one is
// off until the user sets it, because a global hotkey takes that combination
// away from every other program on the machine — including the game.
//
// Everything is injected so the registration logic can be tested without
// Electron.
// No push-to-talk: it needs the key RELEASE as well, and Electron's global
// shortcuts only report the press. A half-working one is worse than none.
const ACTIONS = {
  'quick-capture': 'Note something, set a reminder or a timer, from anywhere',
  'discord-mute': 'Mute or unmute yourself in Discord',
  'discord-deafen': 'Deafen or undeafen yourself in Discord',
  'discord-hangup': 'Leave the Discord call',
  'streamer-toggle': 'Turn streamer mode on or off (blur codes, passwords, emails)',
};

// A combination Vex refuses to take from the rest of the machine. Plain keys
// and bare modifiers would swallow typing everywhere.
function isSafeAccelerator(accel) {
  const s = String(accel || '').trim();
  if (!s) return false;
  const parts = s.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const mods = parts.slice(0, -1).map(p => p.toLowerCase());
  const key = parts[parts.length - 1];
  const known = ['ctrl', 'control', 'cmd', 'command', 'commandorcontrol', 'alt', 'option', 'shift', 'super', 'meta', 'altgr'];
  if (!mods.length || !mods.every(m => known.includes(m))) return false;
  if (mods.every(m => m === 'shift')) return false;                 // Shift+A is just typing
  return /^([A-Za-z0-9]|F\d{1,2}|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Numpad\d|NumpadDecimal|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|`|-|=|\[|\]|\\|;|'|,|\.|\/)$/.test(key);
}

function createGameHotkeys({ globalShortcut, onAction, log, load, save }) {
  const note = typeof log === 'function' ? log : () => {};
  let registered = new Map();          // action → accelerator

  function readConfig() {
    try { const raw = load ? load() : null; return (raw && typeof raw === 'object') ? raw : {}; }
    catch (err) { note('[Hotkeys] could not read the hotkeys: ' + err.message); return {}; }
  }

  // → { applied: {action: accel}, errors: [{action, accel, error}] }
  function apply(config) {
    const wanted = config || readConfig();
    const applied = {};
    const errors = [];
    for (const accel of registered.values()) { try { globalShortcut.unregister(accel); } catch { /* it was never taken */ } }
    registered = new Map();
    for (const [action, accel] of Object.entries(wanted)) {
      if (!ACTIONS[action] || !accel) continue;
      if (!isSafeAccelerator(accel)) { errors.push({ action, accel, error: 'That needs a modifier — "Ctrl+Shift+M", not a plain key' }); continue; }
      let ok;
      try { ok = globalShortcut.register(accel, () => onAction(action)); }
      catch (err) { errors.push({ action, accel, error: err.message }); continue; }
      // Windows hands a combination to whoever asked first: another program
      // already holding it is the usual reason, and silence would be baffling.
      if (!ok) { errors.push({ action, accel, error: 'Another program already has ' + accel }); continue; }
      registered.set(action, accel);
      applied[action] = accel;
      note(`[Hotkeys] ${accel} → ${action}`);
    }
    return { applied, errors };
  }

  function set(config) {
    const clean = {};
    for (const [action, accel] of Object.entries(config || {})) if (ACTIONS[action] && accel) clean[action] = String(accel);
    const result = apply(clean);
    // Only what actually registered is kept, so a stolen combination does not
    // come back silently dead after a restart.
    try { if (save) save(result.applied); } catch (err) { note('[Hotkeys] could not save: ' + err.message); }
    return result;
  }

  function current() { return Object.fromEntries(registered); }
  function stop() { for (const [, accel] of registered) { try { globalShortcut.unregister(accel); } catch {} } registered = new Map(); }

  return { apply, set, current, stop, ACTIONS, isSafeAccelerator };
}

module.exports = { createGameHotkeys, isSafeAccelerator, ACTIONS };
