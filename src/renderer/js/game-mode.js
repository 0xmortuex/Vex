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
    this.initGaming();
    if (!window.vex || typeof window.vex.onHotkey !== 'function') return false;
    window.vex.onHotkey((action) => this.run(action));
    this.watchCapture();
    return true;
  },

  async run(action) {
    if (action === 'streamer-toggle') return this.toggleStreamer();
    const selectors = this.CLICKS[action];
    if (!selectors) return false;
    // The panel, or the tab when Discord opens as a tab.
    const wv = window.DiscordMemory ? DiscordMemory.webview() : ((typeof SidebarManager !== 'undefined' && SidebarManager.panelWebviews) ? SidebarManager.panelWebviews.discord : null);
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

  // Is the screen being shared right now? A tab or a panel sharing it
  // (getDisplayMedia — Discord's Go Live, a meeting's screen share) or Vex's
  // own screen recorder. NOT a call's microphone or camera: those put nothing
  // of Vex in front of anyone, and blurring Vex through every call was wrong
  // (reported 2026-09-19).
  captured() {
    try {
      if (window.ScreenRecorder && ScreenRecorder.recording()) return true;
      if (typeof TabManager !== 'undefined' && TabManager.tabs.some(t => t.capturing && t.capturing.screen)) return true;
      if (typeof SidebarManager !== 'undefined' && SidebarManager.panelCapture) {
        for (const c of Object.values(SidebarManager.panelCapture)) if (c && c.screen) return true;
      }
    } catch (err) { window.VexProblems?.note('Streamer mode', 'Could not tell whether the screen is shared', err); }
    return false;
  },

  // A clean window exists to be shared, so it is always in streamer mode.
  on() { if (window.VexTabPolicy?.isCleanWindow) return true; const m = this.mode(); return m === 'on' || (m === 'auto' && this.captured()); },

  // The hotkey (Settings › Hotkeys): on if it is off, off if it is on — from
  // inside a game or a stream, where Settings is out of reach.
  toggleStreamer() {
    const next = this.on() ? 'off' : 'on';
    this.setMode(next);
    if (next === 'off') window.showToast?.('Streamer mode off — Settings turns "while you are being captured" back on');
    return next;
  },

  // An email address in a tab's title ("Inbox – you@gmail.com") is blurred
  // too, and re-checked as titles change while streamer mode is on.
  EMAIL: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  markTitles(on) {
    document.querySelectorAll('.tab-title').forEach(el => {
      if (on && this.EMAIL.test(el.textContent || '')) el.setAttribute('data-sensitive', '');
      else el.removeAttribute('data-sensitive');
    });
    if (on && !this._titleWatch && typeof MutationObserver !== 'undefined') {
      this._titleWatch = new MutationObserver(() => this.markTitles(true));
      this._titleWatch.observe(document.body, { subtree: true, childList: true, characterData: true });
    } else if (!on && this._titleWatch) {
      this._titleWatch.disconnect();
      this._titleWatch = null;
    }
  },

  // What it hides: the things that identify you or unlock something.
  //   • one-time codes and password values (the authenticator and the vault)
  //   • the email address in the profile row
  //   • the text of notifications, which quote messages
  // Everything stays usable — the values come back on hover, and a click still
  // copies the real one.
  apply() {
    const on = this.on();
    document.body.classList.toggle('streamer-mode', on);
    this.markTitles(on);
    document.body.dataset.streamerMode = this.mode();
    // Turning on by itself, mid-stream, must be visible — otherwise the first
    // sign of it is a blurred code and a moment of thinking Vex has broken.
    const was = this._was;
    this._was = on;
    if (on !== was) {
      if (on) window.showToast?.('Streamer mode on — codes, passwords and notifications are blurred while you share your screen. Hover to read one.');
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
  this.renderGamingSettings();
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

// ---- Getting out of a game's way --------------------------------------------
//
// 16 GB of RAM and an 8 GB card, shared with a game. Measured here: Ollama
// running but idle costs 29 MB and no GPU — nothing. A model used recently
// holds ~5.5 GB of VRAM, and background tabs hold RAM. When main reports a
// full-screen game (src/main/game-watch.js), Vex hands both back:
//
//   free the GPU     every loaded model is unloaded (ModelManager.freeGpu)
//   sleep tabs       every tab but the one you were on sleeps — except one
//                    playing sound, on a call, or kept awake by you; they wake
//                    where you left them
//   hold the AI      no background AI starts while you play: scheduled tasks
//                    wait (and catch up after), history indexing skips. A
//                    question YOU ask is still answered.
//
// Each is its own switch in Settings › Gaming, all on by default. Nothing is
// announced mid-game — a notification over a game is the opposite of the
// point — you are told what was done when you come back.
GameMode.GAMING_KEYS = { freeGpu: 'vex.game.freeGpu', sleepTabs: 'vex.game.sleepTabs', wakeAfter: 'vex.game.wakeAfter', holdAi: 'vex.game.holdAi', stillVex: 'vex.game.stillVex' };
GameMode.WAKE_GAP_MS = 1500;
GameMode.gaming = false;
GameMode.gamingApp = '';
GameMode._gamingReport = null;

GameMode.gamingSetting = function (name) {
  try { return localStorage.getItem(this.GAMING_KEYS[name]) !== 'off'; } catch { return true; }
};
GameMode.setGamingSetting = function (name, on) {
  if (!this.GAMING_KEYS[name]) throw new Error('Unknown gaming setting ' + name);
  try { localStorage.setItem(this.GAMING_KEYS[name], on ? 'on' : 'off'); } catch {}
  return this.syncWatcher();
};
// The watcher runs when something would happen during a game. "Wake the tabs
// after the game" only follows "Sleep background tabs"; on its own it has
// nothing to do.
GameMode.anyGamingOn = function () {
  return Object.keys(this.GAMING_KEYS).some(k => k !== 'wakeAfter' && this.gamingSetting(k));
};

// The watcher runs only while at least one of the three is wanted.
GameMode.syncWatcher = async function () {
  if (!window.vex || typeof window.vex.gameWatch !== 'function') return null;
  try { return await window.vex.gameWatch(this.anyGamingOn()); } catch (err) { window.VexProblems?.note('Gaming', 'Could not watch for games', err); return null; }
};

GameMode.initGaming = function () {
  if (this._gamingWired || !window.vex || typeof window.vex.onGameState !== 'function') return false;
  this._gamingWired = true;
  window.vex.onGameState((s) => { (s && s.game) ? this.onGameStart(s.app) : this.onGameEnd(); });
  this.syncWatcher();
  return true;
};

// Is Vex holding background AI right now? (read by AIRouter and Scheduler)
GameMode.holdingAi = function () { return this.gaming && this.gamingSetting('holdAi'); };

GameMode.onGameStart = async function (app) {
  if (this.gaming) { this.gamingApp = app || this.gamingApp; return this._gamingReport; }
  this.gaming = true;
  this.gamingApp = app || '';
  const report = { app: this.gamingApp, at: Date.now(), freedMB: 0, models: [], slept: 0, sleptIds: [], panels: [] };
  // Vex's own animations stop while the game has the screen.
  if (this.gamingSetting('stillVex')) document.body.classList.add('vex-gaming-still');
  this._gamingReport = report;

  if (this.gamingSetting('freeGpu') && typeof ModelManager !== 'undefined' && ModelManager.freeGpu) {
    try { const r = await ModelManager.freeGpu(); report.freedMB = r.freed || 0; report.models = r.models || []; }
    catch (err) { window.VexProblems?.note('Gaming', 'Could not free the graphics card', err); }
  }

  // A game is the one moment a question cannot be answered — the screen is
  // not Vex's. So unless the user has said "do it automatically", gaming mode
  // leaves the tabs and panels alone and offers once, afterwards, when there
  // is somebody there to answer (js/sleep-consent.js). Alt-tabbing into a
  // game and coming back to everything reloaded was the complaint.
  // If that answer cannot be read, nothing sleeps. A guard that falls back to
  // sleeping is no guard at all: the one case it exists for — something has
  // gone wrong — is exactly when it would close the user's pages anyway.
  const maySleep = (typeof SleepConsent !== 'undefined') && SleepConsent.auto();
  if (!maySleep) report.leftAlone = true;
  if (maySleep && this.gamingSetting('sleepTabs') && typeof TabManager !== 'undefined') {
    for (const tab of (TabManager.tabs || []).slice()) {
      if (tab.id === TabManager.activeTabId || tab.sleeping) continue;
      // Music, a call, a stream you are listening to: not ours to stop.
      if ((tab.audible && !tab.muted) || (TabManager.isCapturing && TabManager.isCapturing(tab))) continue;
      try { await TabManager.sleepTab(tab.id); if (tab.sleeping) { report.slept++; report.sleptIds.push(tab.id); } }   // sleepTab itself spares kept-awake tabs
      catch (err) { window.VexProblems?.note('Gaming', 'Could not sleep a tab', err); }
    }
    // Hidden panels too — the same ones "Free memory now" sleeps: never one
    // kept awake in Settings, playing sound, or on a call.
    if (typeof SidebarManager !== 'undefined' && SidebarManager.sleepHiddenPanels) {
      try { report.panels = SidebarManager.sleepHiddenPanels(); }
      catch (err) { window.VexProblems?.note('Gaming', 'Could not sleep the panels', err); }
    }
  }
  console.log('[Gaming] ' + (report.app || 'a game') + ' started — freed ' + report.freedMB + ' MB of VRAM, slept ' + report.slept + ' tabs');
  return report;
};

GameMode.onGameEnd = function () {
  // Now there is somebody to ask.
  try {
    if (this._gamingReport && this._gamingReport.leftAlone && typeof SleepConsent !== 'undefined') {
      SleepConsent.offerAfterGame(this._gamingReport.app);
    }
  } catch (err) { window.VexProblems?.note('Gaming', 'Could not offer to free memory next time', err); }
  if (!this.gaming) return null;
  this.gaming = false;
  const r = this._gamingReport;
  this._gamingReport = null;
  document.body.classList.remove('vex-gaming-still');
  // The tabs the game put to sleep come back, one at a time so waking them
  // is not a memory spike of its own. A tab closed meanwhile is skipped.
  if (r && r.sleptIds && r.sleptIds.length && this.gamingSetting('wakeAfter') && typeof TabManager !== 'undefined') {
    r.sleptIds.forEach((id, i) => setTimeout(() => {
      const tab = (TabManager.tabs || []).find(t => t.id === id);
      if (!tab || !tab.sleeping) return;
      try { TabManager.wakeTab(id); } catch (err) { window.VexProblems?.note('Gaming', 'Could not wake a tab', err); }
    }, i * this.WAKE_GAP_MS));
  }
  // Background jobs held back during the game run their owed turn now.
  if (typeof VexJobs !== 'undefined') VexJobs.resume();
  // Scheduled tasks held back during the game catch up on their next check.
  const done = [];
  if (r && r.freedMB) done.push('freed ' + (r.freedMB >= 1024 ? (r.freedMB / 1024).toFixed(1) + ' GB' : r.freedMB + ' MB') + ' of graphics memory');
  if (r && r.slept) done.push('slept ' + r.slept + ' tab' + (r.slept === 1 ? '' : 's'));
  if (r && r.panels && r.panels.length) done.push('slept ' + r.panels.length + ' panel' + (r.panels.length === 1 ? '' : 's'));
  if (done.length) window.showToast?.('While you played' + (r.app ? ' ' + r.app : '') + ', Vex ' + done.join(' and ') + '. ' + (r.sleptIds && r.sleptIds.length && this.gamingSetting('wakeAfter') ? 'The tabs are waking now; panels come back when you open them.' : 'They come back when you use them.'));
  return r;
};

GameMode.renderGamingSettings = function (host) {
  host = host || document.getElementById('gaming-settings');
  if (!host) return;
  const rows = [
    ['freeGpu', 'Free the graphics card', 'Unload the AI model so the game gets all of its video memory (about 5.5 GB on an 8 GB card).'],
    ['sleepTabs', 'Sleep background tabs and panels', 'Every tab but the one you were on sleeps, and hidden panels too — except anything playing sound, on a call, or kept awake in Settings.'],
    ['wakeAfter', 'Wake the tabs after the game', 'The tabs the game put to sleep come back one at a time when it ends, instead of when you next click them.'],
    ['stillVex', 'Keep Vex still', 'Vex stops its own animations while the game has the screen. (Windows already slows a window a fullscreen game covers.)'],
    ['holdAi', 'Hold background AI', 'Scheduled AI tasks wait until the game ends, then catch up. A question you ask is still answered.'],
  ];
  host.innerHTML = '';
  for (const [key, label, hint] of rows) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    row.innerHTML = '<span></span><label class="toggle"><input type="checkbox"><span class="toggle-slider"></span></label>';
    row.querySelector('span').textContent = label;
    row.querySelector('span').title = hint;
    const box = row.querySelector('input');
    box.checked = this.gamingSetting(key);
    box.setAttribute('aria-label', label);
    box.addEventListener('change', () => this.setGamingSetting(key, box.checked));
    host.appendChild(row);
  }
  // How long a model stays loaded after the AI answers — games or not.
  if (typeof Ollama !== 'undefined' && Ollama.setKeepAlive) {
    const row = document.createElement('div');
    row.className = 'setting-toggle-row';
    row.innerHTML = '<span>Keep the AI model loaded after a reply</span><select aria-label="Keep the AI model loaded after a reply"></select>';
    const sel = row.querySelector('select');
    const now = String(Ollama.keepAlive());
    for (const [v, text] of [['0', 'Unload at once'], ['1m', '1 minute'], ['5m', '5 minutes'], ['15m', '15 minutes']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = text; if (v === now) o.selected = true; sel.appendChild(o);
    }
    sel.addEventListener('change', () => { Ollama.setKeepAlive(sel.value); window.showToast?.('The model now unloads ' + (sel.value === '0' ? 'straight after each reply' : sel.options[sel.selectedIndex].textContent + ' after a reply')); });
    host.appendChild(row);
  }
};

if (typeof window !== 'undefined') window.GameMode = GameMode;
if (typeof module !== 'undefined' && module.exports) module.exports = { GameMode };
