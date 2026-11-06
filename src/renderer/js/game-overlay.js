// === In-game overlay: Settings, the hotkey and the music buttons ==================
//
// A small Vex window you raise with a global hotkey while a game runs (src/main/game-overlay.js).
// This is the main window's half: it keeps the choices (vex.gameOverlay), hands them to main with the
// current theme colours, shows the Settings section, and answers the overlay's music buttons by pressing
// the Spotify panel's own controls.
//
// Anti-cheat: the overlay is an ordinary separate Vex window. It never injects into, hooks, reads the memory
// of or captures a game, and uses no global keyboard or mouse hook; the one thing it asks Windows for is a
// single global shortcut. That is said in Settings, in the FAQ and enforced by a test.
//
//   vex.gameOverlay = { on, hotkey (kept in Shortcuts), opacity, clickThrough, compact, hint, destroyMinutes,
//                       panels, guides: { game: address }, defaultGuide }
const VexGameOverlay = {
  KEY: 'vex.gameOverlay',
  FEATURE: 'game-overlay',
  SHORTCUT: 'game-overlay',
  PANELS: ['guide', 'discord', 'notes', 'timer', 'music', 'search'],
  PANEL_LABEL: { guide: 'Guide page', discord: 'Discord', notes: 'Notes', timer: 'Timer and stopwatch', music: 'Music buttons', search: 'Quick search' },
  DEFAULTS: { on: false, opacity: 0.92, clickThrough: false, compact: false, hint: false, destroyMinutes: 5, panels: ['guide', 'notes', 'timer', 'music', 'search'], guides: {}, defaultGuide: '' },
  // The theme values the overlay window repaints itself with (it is a separate window, so it cannot inherit them).
  TOKEN_NAMES: ['bg-base', 'bg-elevated', 'bg-deep', 'glass-input', 'border-subtle', 'border-medium', 'border-accent', 'accent', 'accent-glow',
    'text-primary', 'text-secondary', 'text-muted', 'text-accent', 'danger', 'success', 'hover-fill', 'shadow-color', 'radius-sm', 'radius-md', 'radius-lg',
    'font-base', 'font-mono', 'fs-xs', 'fs-sm', 'fs-base', 'fs-2xl', 'fw-semibold', 'space-2', 'space-3', 'radius-pill', 'lh-base'],
  SPOTIFY: {
    toggle: ['[data-testid="control-button-playpause"]', 'button[aria-label="Play" i]', 'button[aria-label="Pause" i]'],
    next: ['[data-testid="control-button-skip-forward"]', 'button[aria-label*="Next" i]'],
    prev: ['[data-testid="control-button-skip-back"]', 'button[aria-label*="Previous" i]'],
  },

  _lastHotkey: null,        // what main said about the hotkey the last time
  _watching: false,

  // ---- choices ----------------------------------------------------------------------
  prefs() {
    const raw = localStorage.getItem(this.KEY);
    const base = { ...this.DEFAULTS, panels: [...this.DEFAULTS.panels], guides: {} };
    if (raw === null) return base;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[GameOverlay] the saved choices are damaged and start again:', err); return base; }
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...base, ...v } : base;
  },
  enabled() { return this.prefs().on === true; },
  hotkey() {
    if (typeof ShortcutsRegistry === 'undefined') throw new Error('The shortcut list is not loaded');
    return ShortcutsRegistry.getShortcut(this.SHORTCUT);
  },
  language() {
    let v = 'en';
    try { v = JSON.parse(localStorage.getItem('vex.lang') || '"en"'); } catch { v = localStorage.getItem('vex.lang') || 'en'; }
    return String(v).slice(0, 2) === 'tr' ? 'tr' : 'en';
  },
  searchTemplate() {
    const T = window.VexTypedAddress;
    if (!T || typeof T.searchUrl !== 'function') return '';
    return T.searchUrl('__vexq__').split('__vexq__').join('%s');
  },
  // The theme as the overlay window needs it: the --vex-* values this window has right now (the look and the
  // theme both change them), plus the two attributes that name the look.
  readTokens() {
    const cs = getComputedStyle(document.body);
    const out = {};
    for (const n of this.TOKEN_NAMES) {
      const v = cs.getPropertyValue('--vex-' + n).trim();
      if (v) out['--vex-' + n] = v;
    }
    const theme = document.documentElement.getAttribute('data-theme');
    const look = document.body.getAttribute('data-gui-style');
    if (theme) out['data-theme'] = theme;
    if (look) out['data-gui-style'] = look;
    return out;
  },
  payload(config) {
    return { config: { ...config, hotkey: this.hotkey() }, tokens: this.readTokens(), searchTemplate: this.searchTemplate(), lang: this.language() };
  },

  // Tell main (it checks everything again and says what is wrong). The hotkey's answer is kept for Settings.
  async push(config = this.prefs()) {
    if (!window.vex || typeof window.vex.gameOverlayConfig !== 'function') throw new Error('This window cannot reach the overlay');
    const res = await window.vex.gameOverlayConfig(this.payload(config));
    this._lastHotkey = res.hotkey;
    this._follow(config.on);
    if (config.on && res.hotkey && !res.hotkey.registered) window.showToast?.('Game overlay: ' + res.hotkey.error, 'error');
    return res;
  },
  // Main refuses a wrong choice (an address that is not a web address, no panel at all); only what it accepts is saved.
  async save(patch) {
    const next = { ...this.prefs(), ...patch };
    delete next.hotkey;
    const res = await this.push(next);
    localStorage.setItem(this.KEY, JSON.stringify(next));
    return res;
  },
  setEnabled(on) {
    const next = { ...this.prefs(), on: !!on };
    localStorage.setItem(this.KEY, JSON.stringify(next));
    this.push(next).catch((err) => window.showToast?.('Game overlay: ' + ((err && err.message) || err), 'error'));
  },

  // While on: the music buttons are answered, and a theme change is passed on. Both stop when it is switched off.
  _follow(on) {
    if (!on) { if (this._observer) { this._observer.disconnect(); this._observer = null; } return; }
    if (!this._observer && typeof MutationObserver !== 'undefined') {
      let pending = null;
      this._observer = new MutationObserver(() => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => { pending = null; this.push().catch((err) => console.error('[GameOverlay] could not pass on the new theme:', err)); }, 800);
      });
      this._observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme', 'class'] });
      this._observer.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-gui-style', 'class'] });
    }
    if (!this._watching && window.vex && typeof window.vex.onGameOverlayMusic === 'function') {
      this._watching = true;
      window.vex.onGameOverlayMusic((req) => this.answerMusic(req));
    }
  },

  // ---- the music buttons ---------------------------------------------------------------
  spotifyWebview() {
    if (typeof VexMediaControl === 'undefined') throw new Error('Media control is not loaded');
    const wv = VexMediaControl._webviewOf({ kind: 'panel', id: 'spotify' });
    if (!wv) throw new Error('The Spotify panel is not open. Open it once in Vex, then use these buttons.');
    return wv;
  },
  async music(action) {
    const wv = this.spotifyWebview();
    const M = VexMediaControl;
    if (action !== 'status') {
      const sel = this.SPOTIFY[action];
      if (!sel) throw new Error('Unknown music action: ' + action);
      const hit = await window.vexGuestEval(wv, M.clickScript(sel), true, 3000);
      if (!hit) throw new Error('The Spotify panel has no ' + (action === 'toggle' ? 'play' : action) + ' button on screen. Open a playlist in the panel first.');
      await new Promise((r) => setTimeout(r, 400));   // let the page publish the new song before it is read
    }
    const meta = await window.vexGuestEval(wv, M.META_SCRIPT, false, 3000);
    return { ok: true, title: (meta && meta.title) || '', artist: (meta && meta.artist) || '', state: (meta && meta.state) || '' };
  },
  async answerMusic(req) {
    let answer;
    try { answer = await this.music(req.action); answer.id = req.id; }
    catch (err) { answer = { id: req.id, ok: false, error: (err && err.message) || String(err) }; }
    window.vex.gameOverlayMusicAnswer(answer);
  },

  async toggle() {
    if (!this.enabled()) { window.showToast?.('The game overlay is off. Turn it on in Settings, Game overlay.', 'info'); return; }
    try { await window.vex.gameOverlayToggle(); }
    catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
  },
};

const VexGameOverlaySettings = {
  ID: 'game-overlay',
  render(body) {
    const G = VexGameOverlay;
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const info = (t) => { const p = el('p', 'setting-info', t); body.appendChild(p); return p; };
    const rerender = () => this.render(body);
    const apply = async (patch, undo) => { try { await G.save(patch); } catch (err) { fail(err); if (undo) undo(); } };
    const prefs = G.prefs();

    info('A small Vex window you open with a hotkey while a game runs: a guide page, Discord, notes, a timer, music buttons and a quick search, without alt-tabbing.');
    const safe = info('Safe for games with anti-cheat: it is an ordinary separate window. It never injects into, hooks, reads the memory of or captures your game, and uses no keyboard or mouse hook of its own; the only thing it asks Windows for is one global shortcut. It knows which game is running only by the program name Game mode already reads.');
    safe.classList.add('muted');
    const fs = info('It shows over borderless and windowed games. A game in exclusive fullscreen can hide every other window, this one too: if it does not appear, switch the game to borderless (windowed fullscreen).');
    fs.classList.add('muted');

    const toggle = (label, hint, on, set) => {
      const row = el('div', 'setting-toggle-row');
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!on; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => set(input.checked, () => { input.checked = !input.checked; }));
      lab.append(input, el('span', 'toggle-slider'));
      row.append(el('span', 'setting-label-text', label), lab);
      body.appendChild(row);
      if (hint) info(hint);
    };

    toggle('Game overlay', '', prefs.on, async (on, undo) => { try { await G.save({ on }); rerender(); } catch (err) { fail(err); undo(); } });
    if (!prefs.on) return;

    // The hotkey: kept in the shortcut list, so a key another Vex shortcut uses is refused there.
    const status = el('p', 'setting-info', '');
    status.setAttribute('role', 'status');
    const paintStatus = () => {
      const h = G._lastHotkey;
      status.textContent = '';
      if (!h) return;
      if (h.registered) status.append(el('strong', null, h.accelerator), ' ', el('span', null, 'Ready. Pressing it shows or hides the overlay, even while a game has the screen.'));
      else status.append(el('span', null, 'The hotkey is not active.'), ' ', h.error);   // main's own words say why
    };
    const keyRow = el('div', 'setting-toggle-row');
    keyRow.appendChild(el('span', 'setting-label-text', 'Hotkey'));
    const keyBtn = el('button', 'btn-secondary', G.hotkey());
    keyBtn.type = 'button';
    keyBtn.setAttribute('aria-label', 'Change the overlay hotkey');
    keyBtn.addEventListener('click', () => {
      keyBtn.textContent = 'Press the new keys (Esc to cancel)';
      const onKey = async (e) => {
        e.preventDefault(); e.stopPropagation();
        const combo = ShortcutsRegistry.eventToShortcut(e);
        if (!combo) return;
        document.removeEventListener('keydown', onKey, true);
        if (e.key === 'Escape') { keyBtn.textContent = G.hotkey(); return; }
        const was = G.hotkey();
        const r = ShortcutsRegistry.setShortcut(G.SHORTCUT, combo);
        if (r !== true && !(r && r.saved === false)) {
          keyBtn.textContent = was;
          if (r && r.conflict) fail(new Error('That key is already used by another shortcut in Vex. Pick another key.'));
          else if (r && r.invalid) fail(new Error('That key needs Ctrl or Alt together with a key.'));
          else fail(new Error('That key cannot be used.'));
          return;
        }
        try { await G.push(); } catch (err) { fail(err); }
        keyBtn.textContent = G.hotkey();
        paintStatus();
      };
      document.addEventListener('keydown', onKey, true);
    });
    keyRow.appendChild(keyBtn);
    body.appendChild(keyRow);
    paintStatus();
    body.appendChild(status);
    // Settings was opened after the hotkey was set at start-up: ask main what really happened.
    if (!G._lastHotkey && window.vex && typeof window.vex.gameOverlayStatus === 'function') {
      window.vex.gameOverlayStatus().then((s) => { G._lastHotkey = s.hotkey; paintStatus(); }).catch(fail);
    }
    const show = el('button', 'btn-secondary', 'Show or hide the overlay now');
    show.type = 'button';
    show.addEventListener('click', () => G.toggle());
    body.appendChild(show);

    // See-through level
    const opRow = el('div', 'setting-toggle-row');
    opRow.appendChild(el('span', 'setting-label-text', 'See-through level'));
    const op = document.createElement('input');
    op.type = 'range'; op.min = '20'; op.max = '100'; op.step = '5'; op.value = String(Math.round(prefs.opacity * 100));
    op.setAttribute('aria-label', 'How solid the overlay is, 20 to 100 percent');
    op.addEventListener('change', () => apply({ opacity: Number(op.value) / 100 }));
    opRow.appendChild(op);
    body.appendChild(opRow);

    toggle('Start with mouse clicks passing through', 'Clicks go to the game and the overlay only shows. A badge and a dashed frame on the overlay say so, and its lock button turns it off.', prefs.clickThrough, (v, undo) => apply({ clickThrough: v }, undo));
    toggle('Start as a small bar', 'The small bar keeps a timer, the music buttons and a search box; the full card has every panel you choose below.', prefs.compact, (v, undo) => apply({ compact: v }, undo));
    toggle('Tell me when a game starts', 'A short note, without sound and without taking the game\'s focus, says which key opens the overlay. It needs Game mode\'s game list (Settings, Game mode).', prefs.hint, (v, undo) => apply({ hint: v }, undo));

    const mins = document.createElement('input');
    mins.type = 'number'; mins.min = '0'; mins.max = '240'; mins.className = 'set-input'; mins.value = String(prefs.destroyMinutes);
    mins.setAttribute('aria-label', 'Minutes a hidden overlay is kept before it is closed to free memory (0 = never)');
    mins.addEventListener('change', () => apply({ destroyMinutes: parseInt(mins.value, 10) }, () => { mins.value = String(G.prefs().destroyMinutes); }));
    info('Minutes a hidden overlay is kept before it is closed to free its memory (0 = never):');
    body.appendChild(mins);

    info('Which panels to show:');
    for (const p of G.PANELS) {
      toggle(G.PANEL_LABEL[p], p === 'discord' ? 'Loads Discord a second time in the overlay, using the Discord panel\'s sign-in (you do not log in again). It needs about as much memory as the panel while it is open and is closed when the overlay is hidden.' : '', prefs.panels.includes(p), (v, undo) => {
        const cur = G.prefs().panels;
        const next = v ? G.PANELS.filter(x => x === p || cur.includes(x)) : cur.filter(x => x !== p);
        apply({ panels: next }, undo);
      });
    }

    // Guide pages
    info('Guide page for every game (a web address):');
    const def = el('input', 'set-input');
    def.type = 'url'; def.placeholder = 'https://'; def.value = prefs.defaultGuide;
    def.setAttribute('aria-label', 'Guide page address used when the game has none of its own');
    def.addEventListener('change', () => apply({ defaultGuide: def.value.trim() }, () => { def.value = G.prefs().defaultGuide; }));
    body.appendChild(def);
    info('A guide page for one game, by its program name (for example RobloxPlayerBeta):');
    const list = el('div', 'setting-list');
    for (const [game, url] of Object.entries(prefs.guides)) {
      const row = el('div', 'setting-toggle-row');
      row.appendChild(el('span', 'setting-label-text', game + '  ' + url));
      const rm = el('button', 'btn-secondary', 'Remove');
      rm.type = 'button'; rm.setAttribute('aria-label', 'Remove this guide page');
      rm.addEventListener('click', async () => { const g = { ...G.prefs().guides }; delete g[game]; await apply({ guides: g }); rerender(); });
      row.appendChild(rm);
      list.appendChild(row);
    }
    body.appendChild(list);
    const gameIn = el('input', 'set-input'); gameIn.type = 'text'; gameIn.placeholder = 'Program name'; gameIn.setAttribute('aria-label', 'Program name of the game');
    const urlIn = el('input', 'set-input'); urlIn.type = 'url'; urlIn.placeholder = 'https://'; urlIn.setAttribute('aria-label', 'Guide page address for that game');
    const add = el('button', 'btn-secondary', 'Add guide page');
    add.type = 'button';
    add.addEventListener('click', async () => {
      const g = { ...G.prefs().guides, [gameIn.value.trim()]: urlIn.value.trim() };
      try { await G.save({ guides: g }); rerender(); } catch (err) { fail(err); }
    });
    body.append(gameIn, urlIn, add);
    info('Only addresses you add here are opened in the overlay (plus Discord, if you turn it on). Links inside a page open as a tab in Vex.');
  },
  init() {
    if (this._inited) return;
    if (typeof VexSettingsGroups === 'undefined') throw new Error('VexSettingsGroups is not loaded');
    this._inited = true;
    VexSettingsGroups.register({ id: this.ID, title: 'Game overlay', keywords: 'game overlay in-game discord guide notes timer music hotkey roblox borderless anti-cheat click-through', render: (body) => this.render(body) });
    if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
      VexExtras.registerCommand({ id: 'game-overlay', label: 'Show or hide the game overlay', hint: 'The small in-game window with a guide, Discord, notes, timer and music', icon: 'gamepad', action: () => VexGameOverlay.toggle() });
    }
    // A rebind in Settings > Shortcuts changes the global key too; and a profile with the overlay on pushes its choices now.
    if (typeof ShortcutsRegistry !== 'undefined' && typeof ShortcutsRegistry.onChange === 'function') {
      ShortcutsRegistry.onChange(() => { if (VexGameOverlay.enabled()) VexGameOverlay.push().catch((err) => window.showToast?.('Game overlay: ' + ((err && err.message) || err), 'error')); });
    }
    // The overlay speaks the language Vex speaks, so a change of language goes to it too.
    window.addEventListener('vex-lang-changed', () => { if (VexGameOverlay.enabled()) VexGameOverlay.push().catch((err) => window.showToast?.('Game overlay: ' + ((err && err.message) || err), 'error')); });
    if (VexGameOverlay.enabled()) VexGameOverlay.push().catch((err) => window.showToast?.('Game overlay: ' + ((err && err.message) || err), 'error'));
  },
};

if (typeof window !== 'undefined') { window.VexGameOverlay = VexGameOverlay; window.VexGameOverlaySettings = VexGameOverlaySettings; }
// A late module (js/lazy-boot.js): nothing else starts it, and init() runs once however many callers there are.
if (typeof window !== 'undefined' && typeof VexSettingsGroups !== 'undefined') VexGameOverlaySettings.init();
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGameOverlay, VexGameOverlaySettings };
