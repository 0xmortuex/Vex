// === Discord status follows Game and Focus mode (T3-062) ==========================
//
// Playing or focusing and still showing "Online" in Discord means pings you cannot
// answer. The idea was to set the status for you. THE OWNER DECIDED OTHERWISE, and
// this keeps to it: Vex NEVER changes your Discord status, by any route (not through
// the page, not through a plugin, not through a token). What it does:
//
//   1. When Game mode or a Focus block starts, it puts ONE suggestion in the Attention
//      Inbox (never a toast over your game): "Set Discord to Do Not Disturb?" with the
//      status text to use. "Copy status text" copies the words and opens the Discord
//      panel; you click your avatar and set it yourself. When the mode ends it suggests
//      the way back ("Set Discord back to Online").
//   2. A status line of your own, in plain words ("In a match, back around 22:00"), is
//      shown on your New Tab page (Morning Brief section "Status line", off until you turn
//      it on there). It is Vex's, on your page; it does not leave this computer and is not
//      shown in Discord. While a mode is on it follows the mode; or you set one by hand
//      for a number of minutes.
//
// It reads only Vex's own attention state (the same one that quiets toasts). It reads
// nothing from Discord and writes nothing to it.
const DiscordStatus = {
  KEY: 'vex.discordStatus',
  MODES: ['game', 'focus'],
  STATUSES: ['Online', 'Idle', 'Do Not Disturb', 'Invisible'],
  DEFAULTS: {
    game: { status: 'Do Not Disturb', text: 'In a game, back later' },
    focus: { status: 'Do Not Disturb', text: 'Focusing until {end}' },
    back: { status: 'Online', text: '' },
  },
  MAX_TEXT: 100,

  _now() { return Date.now(); },
  _mode: '',          // the mode that was on at the last look
  _suggested: false,  // a start suggestion was made for it

  // ---- state -----------------------------------------------------------------------------
  state() {
    const s = CommsStore.record(this.KEY, { on: true, suggest: true, line: true, texts: {}, manual: null }, 'Discord status settings');
    const texts = {};
    for (const k of ['game', 'focus', 'back']) {
      const t = s.texts && s.texts[k];
      texts[k] = { status: t && this.STATUSES.includes(t.status) ? t.status : this.DEFAULTS[k].status, text: t && typeof t.text === 'string' ? CommsStore.line(t.text, this.MAX_TEXT) : this.DEFAULTS[k].text };
    }
    const manual = s.manual && typeof s.manual.text === 'string' && Number.isFinite(s.manual.until) ? { text: CommsStore.line(s.manual.text, this.MAX_TEXT), until: s.manual.until } : null;
    return { on: s.on !== false, suggest: s.suggest !== false, line: s.line !== false, texts, manual };
  },
  _save(s) { CommsStore.write(this.KEY, s); CommsStore.emit('vex:discord-status'); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); if (!on) { this._mode = ''; this._suggested = false; } },
  setSuggest(on) { const s = this.state(); s.suggest = !!on; this._save(s); },
  setLine(on) { const s = this.state(); s.line = !!on; this._save(s); },
  setText(mode, { status, text }) {
    if (!(mode in this.DEFAULTS)) throw new Error('The status is for game, focus or back');
    if (status !== undefined && !this.STATUSES.includes(status)) throw new Error('A Discord status is ' + this.STATUSES.join(', '));
    const s = this.state();
    s.texts[mode] = { status: status === undefined ? s.texts[mode].status : status, text: text === undefined ? s.texts[mode].text : CommsStore.line(text, this.MAX_TEXT) };
    this._save(s);
  },
  setManual(text, minutes) {
    const m = Number(minutes);
    if (!(m >= 1 && m <= 24 * 60)) throw new Error('A status line lasts from 1 minute to 24 hours');
    const t = CommsStore.line(text, this.MAX_TEXT);
    if (!t) throw new Error('Write the status line first');
    const s = this.state(); s.manual = { text: t, until: this._now() + m * 60000 }; this._save(s);
  },
  clearManual() { const s = this.state(); s.manual = null; this._save(s); },

  // ---- pure --------------------------------------------------------------------------------------
  // The mode that matters in an attention state ({ sources: [{ id, until }] }): game before focus.
  modeOf(att) {
    const src = (att && Array.isArray(att.sources)) ? att.sources : [];
    for (const m of this.MODES) { const hit = src.find(x => x.id === m); if (hit) return { mode: m, until: hit.until || 0 }; }
    return null;
  },
  hm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },
  // "Focusing until {end}" -> with the end filled in, or with the " until {end}" dropped when it is not known.
  fill(text, until) {
    if (until > 0) return text.replace(/\{end\}/g, this.hm(until));
    return text.replace(/\s*(until|till|by|back at|back around)\s*\{end\}/gi, '').replace(/\{end\}/g, '').replace(/\s+/g, ' ').trim();
  },
  // What to set for a mode: -> { status, text, label }
  advice(mode, until = 0) {
    const t = this.state().texts[mode];
    if (!t) throw new Error('No status for ' + mode);
    const text = this.fill(t.text, until);
    return { mode, status: t.status, text, label: 'Set Discord to ' + t.status + (text ? ': "' + text + '"' : '') };
  },

  // ---- the status line for the New Tab page -----------------------------------------------------------
  currentLine(att = (typeof AttentionState !== 'undefined' ? AttentionState.get() : null)) {
    const s = this.state();
    if (!s.on || !s.line) return '';
    if (s.manual && s.manual.until > this._now()) return s.manual.text;
    const m = this.modeOf(att);
    if (!m) return '';
    return this.fill(s.texts[m.mode].text, m.until);
  },
  briefPayload() {
    const line = this.currentLine();
    if (!line) return null;
    return { summary: 'Your status line', items: [{ text: line }] };
  },

  // ---- following the modes (a look at Vex's own state; nothing from Discord) -----------------------------------
  // Called with each new attention state. -> 'start' | 'end' | '' for what it did.
  follow(att) {
    const s = this.state();
    if (!s.on) return '';
    const now = this.modeOf(att);
    const was = this._mode;
    const mode = now ? now.mode : '';
    this._mode = mode;
    if (mode === was) return '';
    if (mode) {
      this._suggested = false;
      if (!s.suggest) return '';
      this._offer(mode, now.until);
      this._suggested = true;
      return 'start';
    }
    // The mode ended: the way back, but only if the start was suggested (otherwise there is nothing to undo).
    if (s.suggest && this._suggested) { this._suggested = false; this._offer('back', 0); return 'end'; }
    return '';
  },
  _offer(mode, until) {
    if (typeof VexAttention === 'undefined') throw new Error('The attention budget is not loaded');
    const a = this.advice(mode, until);
    VexAttention.suggest({
      feature: 'discord-status', id: mode, title: a.label + '?',
      body: 'Vex never changes your Discord status. Copy the words and set it yourself in Discord.',
      action: { label: 'Copy status text', key: mode },
    });
  },
  // The inbox row's button: copy the words, open the Discord panel. The status is yours to set.
  async act(mode) {
    if (!(mode in this.DEFAULTS)) throw new Error('No status for ' + mode);
    const m = this.modeOf(typeof AttentionState !== 'undefined' ? AttentionState.get() : null);
    const a = this.advice(mode, mode === 'back' ? 0 : (m ? m.until : 0));
    await CommsStore.copy(a.text || a.status);
    if (typeof SidebarManager !== 'undefined' && typeof SidebarManager.openPanel === 'function') SidebarManager.openPanel('discord');
    window.showToast?.('Copied. In Discord, click your picture and choose ' + a.status + (a.text ? ', then paste the text as your custom status' : '') + '.');
    return a;
  },
};

if (typeof window !== 'undefined') {
  window.DiscordStatus = DiscordStatus;
  if (typeof document !== 'undefined') {
    document.addEventListener('vex:attention-state', (e) => {
      try { DiscordStatus.follow(e && e.detail); }
      catch (err) { console.error('[DiscordStatus]', err); window.VexProblems?.note('Discord status', 'Could not follow Game or Focus mode', err); }
    });
  }
  if (typeof AttentionInbox !== 'undefined' && typeof AttentionInbox.handle === 'function') {
    AttentionInbox.handle('discord-status', (key) => DiscordStatus.act(key).catch((err) => { window.showToast?.(err.message, 'error'); window.VexProblems?.note('Discord status', 'Could not copy the status text', err); }));
  }
  if (typeof VexBrief !== 'undefined') {
    VexBrief.register({ id: 'discord-status-line', title: 'Status line', icon: 'message', order: 56, optIn: true, defaultOn: false, maxItems: 1, build: () => DiscordStatus.briefPayload() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordStatus };
