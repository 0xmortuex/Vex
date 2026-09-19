// === Discord's memory limit =================================================
//
// Discord in a panel is kept awake so its notifications arrive, which means it
// is never slept and never reloaded — and a Discord that has run all day grows.
// Measured on the user's machine: one renderer at 2.15 GB, the rest of Vex
// together about 1 GB. A fresh Discord is a fraction of that.
//
// So: past a limit (Settings › Performance, 1.5 GB by default), Vex replaces
// the Discord panel with a fresh one — only when that costs nothing:
//   hidden      not the panel you are looking at, nor the one beside it
//   no call     no microphone or camera, nothing audible, no Disconnect button
//   not lately  at most once every 30 minutes
// It stays logged in and keeps notifying; it simply starts clean.
//
// A limit below what a FRESH Discord needs would refresh it for ever. Three
// minutes after each refresh the fresh size is measured; if that is already
// near the limit, the limit is raised above it, once, and the user is told.

const DiscordMemory = {
  KEY: 'vex.discordMemoryLimitMB',
  CHOICES: [0, 700, 1000, 1500, 2000],       // 0 = off
  DEFAULT_MB: 1500,
  CHECK_MS: 2 * 60000,
  MIN_GAP_MS: 30 * 60000,
  SETTLE_MS: 3 * 60000,
  _timer: null,
  _lastRefresh: 0,
  _raisedTo: 0,                              // effective limit after a fresh Discord proved bigger
  _history: [],                              // [{ at, beforeMB, afterMB }]

  limitMB() {
    // Nothing saved must mean the default, not "off": Number(null) is 0, and 0
    // IS a choice here (Never) — so an unset limit silently disabled the whole
    // feature until a test caught it.
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch {}
    if (raw == null || raw === '') return this.DEFAULT_MB;
    const v = Number(raw);
    return (Number.isFinite(v) && this.CHOICES.includes(v)) ? v : this.DEFAULT_MB;
  },
  effectiveLimitMB() { const l = this.limitMB(); return l ? Math.max(l, this._raisedTo) : 0; },
  setLimitMB(mb) {
    const v = Number(mb);
    if (!this.CHOICES.includes(v)) throw new Error('The Discord limit is one of ' + this.CHOICES.join(', ') + ' MB');
    try { localStorage.setItem(this.KEY, String(v)); } catch {}
    this._raisedTo = 0;
    return v;
  },

  _sidebar() { return (typeof SidebarManager !== 'undefined') ? SidebarManager : window.SidebarManager; },

  // How much the Discord panel's process holds, in MB, or null if unknown.
  async sizeMB() {
    const sb = this._sidebar();
    const wv = sb && sb.panelWebviews && sb.panelWebviews.discord;
    if (!wv || typeof wv.getWebContentsId !== 'function' || !window.vex || typeof window.vex.tabMemory !== 'function') return null;
    let id;
    try { id = wv.getWebContentsId(); } catch { return null; }
    if (typeof id !== 'number' || id < 0) return null;
    const r = await window.vex.tabMemory([id]);
    const e = r && r.byId && r.byId[id];
    return e && Number.isFinite(e.memKB) ? Math.round(e.memKB / 1024) : null;
  },

  // Why it would be wrong to refresh right now, or null if it is fine.
  async reasonToWait(now = Date.now()) {
    const sb = this._sidebar();
    if (!sb) return 'no sidebar';
    const wv = sb.panelWebviews && sb.panelWebviews.discord;
    if (!wv) return 'Discord is not loaded';
    if (sb.activePanel === 'discord' || sb.sidePanel === 'discord') return 'Discord is open';
    if (typeof sb.isPanelCapturing === 'function' && sb.isPanelCapturing('discord')) return 'Discord is using the microphone or camera';
    try { if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) return 'Discord is playing sound'; } catch {}
    if (typeof sb._discordInCall === 'function' && await sb._discordInCall(wv)) return 'You are in a call';
    if (now - this._lastRefresh < this.MIN_GAP_MS) return 'Refreshed recently';
    return null;
  },

  // One check: over the limit and safe → refresh. Returns what it did.
  async check(now = Date.now()) {
    const limit = this.effectiveLimitMB();
    if (!limit) return { action: 'off' };
    const mb = await this.sizeMB();
    if (mb == null) return { action: 'unknown' };
    if (mb <= limit) return { action: 'fine', mb, limit };
    const wait = await this.reasonToWait(now);
    if (wait) return { action: 'waiting', mb, limit, why: wait };
    this.refresh(mb);
    return { action: 'refreshed', mb, limit };
  },

  // Replace the Discord panel with a fresh one, without showing it.
  refresh(beforeMB) {
    const sb = this._sidebar();
    const old = sb && sb.panelWebviews && sb.panelWebviews.discord;
    const panelEl = document.getElementById('panel-discord');
    if (!sb || !old || !panelEl || typeof sb._createPanelWebview !== 'function') throw new Error('Discord cannot be refreshed right now');
    try { old.remove(); } catch {}
    delete sb.panelWebviews.discord;
    document.querySelectorAll('.panel-navbar[data-panel="discord"]').forEach(n => n.remove());
    panelEl.querySelector('.discord-mem-banner')?.remove();     // its number is out of date now
    sb._createPanelWebview('discord', panelEl);
    this._lastRefresh = Date.now();
    const entry = { at: this._lastRefresh, beforeMB: beforeMB || null, afterMB: null };
    this._history.unshift(entry);
    this._history.length = Math.min(this._history.length, 20);
    const note = 'Refreshed Discord' + (beforeMB ? ' — it had grown to ' + (beforeMB >= 1024 ? (beforeMB / 1024).toFixed(1) + ' GB' : beforeMB + ' MB') : '');
    try { document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note } })); } catch {}
    // Measure the fresh one once it has settled.
    setTimeout(() => this._afterRefresh(entry), this.SETTLE_MS);
    return entry;
  },

  async _afterRefresh(entry) {
    const mb = await this.sizeMB().catch(() => null);
    if (mb == null) return;
    entry.afterMB = mb;
    const limit = this.limitMB();
    // A fresh Discord already near the limit would be refreshed again and again.
    if (limit && mb > limit * 0.85) {
      this._raisedTo = Math.ceil((mb + 400) / 100) * 100;
      window.showToast?.('A fresh Discord already uses ' + mb + ' MB, close to your ' + limit + ' MB limit — Vex will refresh it at ' + this._raisedTo + ' MB instead, so it is not refreshed over and over.');
    }
  },

  start() {
    clearInterval(this._timer);
    this._timer = setInterval(() => { this.check().catch(err => window.VexProblems?.note('Discord memory', 'Check failed', err)); }, this.CHECK_MS);
    return true;
  },

  renderSetting(host) {
    host = host || document.getElementById('discord-memory-setting');
    if (!host) return;
    host.innerHTML = '<div class="setting-toggle-row"><span>Refresh Discord when it grows past</span><select aria-label="Refresh Discord when it grows past"></select></div>';
    const sel = host.querySelector('select');
    const now = this.limitMB();
    for (const v of this.CHOICES) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v === 0 ? 'Never' : (v >= 1000 ? (v / 1000) + ' GB' : v + ' MB');
      if (v === now) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const v = this.setLimitMB(sel.value);
      window.showToast?.(v ? 'Discord will be refreshed past ' + sel.options[sel.selectedIndex].textContent + ' — only while hidden and not in a call' : 'Discord will not be refreshed automatically');
    });
  },
};

if (typeof window !== 'undefined') window.DiscordMemory = DiscordMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordMemory };
