// === Vex while you are gaming or streaming =================================
//
// Two problems that only exist because Discord lives in a browser panel and
// the browser is on the same screen as the game:
//
//   Reaching Discord. Muting yourself meant alt-tabbing out of a fullscreen
//   game, finding Vex, finding the panel, clicking — by which time the moment
//   has gone. Discord's own app has system-wide hotkeys; the panel had none.
//   Main registers them (src/main/game-hotkeys.js) and sends the action here,
//   and here we press the button inside Discord.
//
//   Being on camera. Vex holds passwords, one-time codes, an email address in
//   every tab title and a notification for each one. Sharing a screen or
//   recording puts all of it in front of an audience. Streamer mode blanks the
//   things that matter while the screen is being captured.
const GameMode = {
  // ---- Discord, from inside a game ----------------------------------------
  // Discord's own controls, found by what they are labelled — the class names
  // change every few weeks, the labels do not.
  CLICKS: {
    'discord-mute': ['button[aria-label^="Mute"]', 'button[aria-label^="Unmute"]'],
    'discord-deafen': ['button[aria-label^="Deafen"]', 'button[aria-label^="Undeafen"]'],
    'discord-hangup': ['button[aria-label="Disconnect"]', 'button[aria-label^="Disconnect"]'],
  },

  init() {
    if (!window.vex || typeof window.vex.onHotkey !== 'function') return false;
    window.vex.onHotkey((action) => this.run(action));
    this.watchCapture();
    return true;
  },

  async run(action) {
    const selectors = this.CLICKS[action];
    if (!selectors) return false;
    const wv = (typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) ? SidebarManager.panelWebviews.discord : null;
    if (!wv) { window.showToast?.('Open the Discord panel once, and the hotkey will work from anywhere', 'error'); return false; }
    const code = `(() => {
      const found = ${JSON.stringify(selectors)}.map(s => document.querySelector(s)).find(Boolean);
      if (!found) return null;
      found.click();
      return (found.getAttribute('aria-label') || '').trim();
    })()`;
    try {
      const was = await window.vexGuestEval(wv, code, true, 4000);
      if (!was) { window.showToast?.('Discord is not in a call', 'info'); return false; }
      // The label is what it was BEFORE the click, so the new state is the
      // opposite: pressing "Mute" means you are now muted.
      window.showToast?.(this._said(was));
      return true;
    } catch (err) {
      VexProblems?.note('Discord hotkey', 'Could not reach the Discord panel', err);
      window.showToast?.('Could not reach Discord: ' + ((err && err.message) || ''), 'error');
      return false;
    }
  },

  _said(label) {
    const l = String(label).toLowerCase();
    if (l.startsWith('unmute')) return 'Microphone on';
    if (l.startsWith('mute')) return 'Microphone muted';
    if (l.startsWith('undeafen')) return 'Sound on';
    if (l.startsWith('deafen')) return 'Deafened';
    if (l.startsWith('disconnect')) return 'Left the call';
    return label;
  },

  // ---- Streamer mode -------------------------------------------------------
  KEY: 'vex.streamerMode',       // 'off' | 'on' | 'auto'  (auto = while captured)
  mode() { try { return localStorage.getItem(this.KEY) || 'auto'; } catch { return 'auto'; } },
  setMode(mode) {
    if (!['off', 'on', 'auto'].includes(mode)) throw new Error('Unknown streamer mode: ' + mode);
    try { localStorage.setItem(this.KEY, mode); } catch (err) { VexProblems?.note('Streamer mode', 'Could not save the setting', err); }
    this.apply();
    return mode;
  },

  // Is anything being captured right now? Vex already tracks this for the
  // recording badges: a tab or a panel sharing a screen, camera or microphone.
  captured() {
    try {
      if (typeof TabManager !== 'undefined' && TabManager.tabs.some(t => TabManager.isCapturing && TabManager.isCapturing(t))) return true;
      if (typeof SidebarManager !== 'undefined' && SidebarManager.panelCapture) {
        for (const c of Object.values(SidebarManager.panelCapture)) if (c && (c.mic || c.camera || c.screen)) return true;
      }
    } catch { /* treat unknown as not captured; the manual switch still works */ }
    return false;
  },

  on() { const m = this.mode(); return m === 'on' || (m === 'auto' && this.captured()); },

  // What it hides: the things that identify you or unlock something.
  //   • one-time codes and password values (the authenticator and the vault)
  //   • the email address in the profile row
  //   • the text of notifications, which quote messages
  // Everything stays usable — the values come back on hover, and a click still
  // copies the real one.
  apply() {
    const on = this.on();
    document.body.classList.toggle('streamer-mode', on);
    document.body.dataset.streamerMode = this.mode();
    // Turning on by itself, mid-stream, must be visible — otherwise the first
    // sign of it is a blurred code and a moment of thinking Vex has broken.
    const was = this._was;
    this._was = on;
    if (on !== was) {
      if (on) window.showToast?.('Streamer mode on — codes, passwords and notifications are blurred while you are being captured. Hover to read one.');
      else if (was === true) window.showToast?.('Streamer mode off');
    }
    return on;
  },

  watchCapture() {
    this.apply();
    if (this._watching) return;
    this._watching = true;
    // Capture starts and stops through these, and both already fire.
    document.addEventListener('vex:media-capture', () => this.apply());
    document.addEventListener('vex:memory-event', () => this.apply());
    setInterval(() => { if (this.mode() === 'auto') this.apply(); }, 5000);
  },
};


// ---- the Settings controls -------------------------------------------------
// A hotkey is captured by pressing it, not by typing its name: nobody knows
// Electron's spelling ('CommandOrControl+Shift+M'), and a typo is a hotkey that
// silently does nothing.
GameMode.renderSettings = async function () {
  const rows = document.getElementById('hotkey-rows');
  const mode = document.getElementById('setting-streamer-mode');
  if (mode) {
    mode.value = this.mode();
    if (!mode.dataset.wired) { mode.dataset.wired = '1'; mode.addEventListener('change', () => this.setMode(mode.value)); }
  }
  if (!rows || !window.vex || typeof window.vex.hotkeysGet !== 'function') return;
  let state;
  try { state = await window.vex.hotkeysGet(); }
  catch (err) { rows.textContent = 'Hotkeys are not available in this build.'; VexProblems?.note('Hotkeys', 'Could not read them', err); return; }
  rows.innerHTML = '';
  for (const [action, label] of Object.entries(state.actions)) {
    const row = document.createElement('div');
    row.className = 'hk-row';
    row.innerHTML = '<span class="hk-label"></span><button class="hk-key" type="button"></button><button class="hk-clear" type="button">Clear</button>';
    row.querySelector('.hk-label').textContent = label;
    const key = row.querySelector('.hk-key');
    key.textContent = state.current[action] || 'Not set';
    key.addEventListener('click', () => this._capture(action, key));
    row.querySelector('.hk-clear').addEventListener('click', () => this._save(action, '', key));
    rows.appendChild(row);
  }
};

GameMode._capture = function (action, button) {
  button.textContent = 'Press the keys…';
  button.classList.add('listening');
  const onKey = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { finish(null); return; }
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;    // still waiting for the real key
    finish(mods.length ? mods.join('+') + '+' + key : key);
  };
  const finish = (accel) => {
    document.removeEventListener('keydown', onKey, true);
    button.classList.remove('listening');
    if (accel === null) { this.renderSettings(); return; }
    this._save(action, accel, button);
  };
  document.addEventListener('keydown', onKey, true);
};

GameMode._save = async function (action, accel, button) {
  let state;
  try { state = await window.vex.hotkeysGet(); } catch { state = { current: {} }; }
  const config = { ...state.current };
  if (accel) config[action] = accel; else delete config[action];
  const r = await window.vex.hotkeysSet(config);
  const failed = (r.errors || []).find(e => e.action === action);
  if (failed) window.showToast?.(failed.error, 'error');
  else if (accel) window.showToast?.(accel + ' set');
  this.renderSettings();
};

if (typeof window !== 'undefined') window.GameMode = GameMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameMode };
