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
  DEFAULT_MB: 1000,
  // Lowered from 1.5 GB to 1 GB (2026-09-19, asked for). A limit left at the
  // old default is moved down once; any choice made after that is kept.
  LOWERED_KEY: 'vex.discordLimitLowered',

  // ---- asleep when idle ------------------------------------------------------------
  // A hidden Discord, not in a call, for this long, is put to sleep: it frees
  // all its memory, and wakes when you open it. The cost is said in Settings:
  // no Discord notifications while it sleeps.
  IDLE_KEY: 'vex.discordIdleSleepMin',
  IDLE_CHOICES: [0, 15, 30, 60],             // 0 = never
  IDLE_DEFAULT: 15,
  idleMinutes() {
    const raw = localStorage.getItem(this.IDLE_KEY);
    const v = Number(raw);
    return raw != null && this.IDLE_CHOICES.includes(v) ? v : this.IDLE_DEFAULT;
  },
  hiddenFor(now = Date.now()) {
    let usage = {};
    try { usage = JSON.parse(localStorage.getItem('vex.panelUsage') || '{}') || {}; }
    catch (err) { window.VexProblems?.note('Discord memory', 'Panel usage could not be read', err); }
    return now - (Number(usage.discord) || 0);
  },

  // ---- lighter Discord (src/main/discord-lite.js) --------------------------------
  LITE_KEY: 'vex.discordLite',
  lite() { return localStorage.getItem(this.LITE_KEY) !== 'off'; },
  async setLite(on) {
    localStorage.setItem(this.LITE_KEY, on ? 'on' : 'off');
    if (window.vex && typeof window.vex.setDiscordLite === 'function') await window.vex.setDiscordLite(!!on);
    return !!on;
  },

  // ---- panel or tab ------------------------------------------------------------------
  // In a tab, Discord only runs while the tab is open: close it and it uses
  // nothing (and sends nothing — no notifications, and a call ends). Same
  // session as the panel (persist:discord), so the login, Vencord and the
  // network bypass come with it.
  MODE_KEY: 'vex.discordMode',
  URL: 'https://discord.com/app',
  PARTITION: 'persist:discord',
  mode() { return localStorage.getItem(this.MODE_KEY) === 'tab' ? 'tab' : 'panel'; },
  setMode(mode) {
    if (mode !== 'panel' && mode !== 'tab') throw new Error('Discord opens as a panel or a tab');
    localStorage.setItem(this.MODE_KEY, mode);
    const sb = this._sidebar();
    // Leaving the panel behind frees it at once.
    if (mode === 'tab' && sb && sb.panelWebviews && sb.panelWebviews.discord) {
      if (sb.activePanel === 'discord') sb.hideActivePanel();
      if (sb.sidePanel === 'discord') sb.closeBeside();
      sb.sleepPanel('discord');
    }
    return mode;
  },
  discordTab() {
    const tabs = (typeof TabManager !== 'undefined' ? TabManager.tabs : []) || [];
    return tabs.find(t => t.partition === this.PARTITION && /^https:\/\/([a-z0-9-]+\.)?discord\.com\//i.test(t.url || '')) || null;
  },
  openTab() {
    const t = this.discordTab();
    if (t) TabManager.switchTab(t.id);
    else TabManager.createTab(this.URL, true, null, { partition: this.PARTITION });
  },
  // Discord's page, wherever it is: the panel, or the tab.
  webview() {
    const sb = this._sidebar();
    if (sb && sb.panelWebviews && sb.panelWebviews.discord) return sb.panelWebviews.discord;
    const t = this.discordTab();
    return t && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(t.id) || null : null;
  },

  // ---- the heaviest Vencord plugins -------------------------------------------------
  // Measured in the plugin review (v2.32.18): MessageLoggerEnhanced keeps up to
  // 2,000 messages per server in memory, MessageLogger does the same work
  // again, and these three add their own. Turned off through Vencord's own
  // settings, on request, then Discord reloads so it takes effect.
  HEAVY_PLUGINS: ['MessageLoggerEnhanced', 'MessageLogger', 'ShowHiddenChannels', 'PlatformIndicators', 'WhoReacted'],
  async turnOffHeavyPlugins() {
    const wv = this.webview();
    if (!wv) throw new Error('Open Discord once first, then try again');
    const off = await window.vexGuestEval(wv, `(() => {
      const p = window.Vencord && Vencord.Settings && Vencord.Settings.plugins;
      if (!p) return null;
      const out = [];
      for (const name of ${JSON.stringify(this.HEAVY_PLUGINS)}) if (p[name] && p[name].enabled) { p[name].enabled = false; out.push(name); }
      return out;
    })()`);
    if (off == null) throw new Error('Vencord is not running in Discord — nothing to turn off');
    if (off.length) wv.reload();
    return off;
  },

  // ---- clear its caches when it is hidden ---------------------------------------
  CLEAR_AFTER_MS: 20000,
  _watchHide() {
    document.addEventListener('vex:panel-changed', () => {
      const sb = this._sidebar();
      if (!sb || sb.activePanel === 'discord' || sb.sidePanel === 'discord' || !sb.panelWebviews || !sb.panelWebviews.discord) return;
      clearTimeout(this._clearTimer);
      this._clearTimer = setTimeout(() => {
        const s = this._sidebar();
        const wv = s && s.panelWebviews && s.panelWebviews.discord;
        if (!wv || s.activePanel === 'discord' || s.sidePanel === 'discord') return;
        try { wv.send('vex-clear-cache'); }
        catch (err) { window.VexProblems?.note('Discord memory', 'Could not clear its caches', err); }
      }, this.CLEAR_AFTER_MS);
    });
  },
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
  async reasonToWait(now = Date.now(), { ignoreGap = false } = {}) {
    const sb = this._sidebar();
    if (!sb) return 'no sidebar';
    const wv = sb.panelWebviews && sb.panelWebviews.discord;
    if (!wv) return 'Discord is not loaded';
    if (sb.activePanel === 'discord' || sb.sidePanel === 'discord') return 'Discord is open';
    if (typeof sb.isPanelCapturing === 'function' && sb.isPanelCapturing('discord')) return 'Discord is using the microphone or camera';
    try { if (typeof wv.isCurrentlyAudible === 'function' && wv.isCurrentlyAudible()) return 'Discord is playing sound'; } catch {}
    if (typeof sb._discordInCall === 'function' && await sb._discordInCall(wv)) return 'You are in a call';
    if (!ignoreGap && now - this._lastRefresh < this.MIN_GAP_MS) return 'Refreshed recently';
    return null;
  },

  // === Asking first ========================================================
  //
  // Sleeping Discord frees a gigabyte and costs you every notification until
  // you open it again; refreshing it drops whatever was on screen. Vex used to
  // do both on a timer, silently. That is a decision about someone's messages,
  // made without them — and a browser that closes your chat to save memory it
  // was never asked to save has got the priority backwards.
  //
  // So it asks, and **nothing happening is a no**. The notice waits, and if it
  // is ignored it expires and Discord is left exactly as it was.
  //
  //   ask     (the default) — a notice with Free the memory / Not now / Always
  //   auto    — what it used to do, for anyone who wants it back
  //   never   — never touched for memory at all
  //
  // "Not now" is quiet for four hours rather than a minute: being asked the
  // same question every sixty seconds is not being asked, it is being nagged.
  CONSENT_KEY: 'vex.discordMemoryConsent',
  ASK_QUIET_MS: 4 * 3600000,

  consent() {
    const v = localStorage.getItem(this.CONSENT_KEY);
    if (v === 'auto' || v === 'never' || v === 'ask') return v;
    // No answer about Discord in particular: follow the one setting that
    // governs every unattended sleeper (js/sleep-consent.js), so turning it
    // off in one place turns it off everywhere.
    try { if (typeof SleepConsent !== 'undefined') return SleepConsent.mode(); } catch { /* ask, then */ }
    return 'ask';
  },

  setConsent(mode) {
    if (!['ask', 'auto', 'never'].includes(mode)) throw new Error('Vex can ask, do it automatically, or never do it');
    try { localStorage.setItem(this.CONSENT_KEY, mode); }
    catch (err) { window.VexProblems?.note('Discord memory', 'The choice could not be saved', err); }
    return mode;
  },

  _quietUntil: 0,

  // One check: idle long enough and safe → sleep; else over the limit and
  // safe → refresh. Neither happens without a yes unless the user has asked
  // for it to be automatic. Returns what it did.
  async check(now = Date.now()) {
    const consent = this.consent();
    if (consent === 'never') return { action: 'off' };
    const idle = this.idleMinutes();
    const sb = this._sidebar();
    if (idle && sb && sb.panelWebviews && sb.panelWebviews.discord && this.hiddenFor(now) > idle * 60000) {
      const wait = await this.reasonToWait(now, { ignoreGap: true });
      if (!wait) {
        if (consent !== 'auto') return this._ask('sleep', { idle }, now);
        this.sleepNow(idle);
        return { action: 'slept' };
      }
    }
    const limit = this.effectiveLimitMB();
    if (!limit) return { action: 'off' };
    const mb = await this.sizeMB();
    if (mb == null) return { action: 'unknown' };
    if (mb <= limit) return { action: 'fine', mb, limit };
    const wait = await this.reasonToWait(now);
    if (wait) return { action: 'waiting', mb, limit, why: wait };
    if (consent !== 'auto') return this._ask('refresh', { mb, limit }, now);
    this.refresh(mb);
    return { action: 'refreshed', mb, limit };
  },

  // Put it to sleep, and say what that cost. Separated from check() so the
  // answer to the question and the automatic path do exactly the same thing.
  sleepNow(idle) {
    const sb = this._sidebar();
    if (!sb || typeof sb.sleepPanel !== 'function') throw new Error('Discord cannot be slept right now');
    sb.sleepPanel('discord');
    const why = idle ? 'Discord was idle for ' + idle + ' minutes and not in a call — ' : 'Discord is ';
    try { document.dispatchEvent(new CustomEvent('vex:memory-event', { detail: { note: why + 'asleep until you open it' } })); } catch {}
    return true;
  },

  // The question. Returns at once: the answer arrives later, or never, and
  // never is a no.
  _ask(what, info, now = Date.now()) {
    if (now < this._quietUntil) return { action: 'quiet', what };
    if (document.getElementById('vex-discord-ask')) return { action: 'asking', what };
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const size = info.mb ? (info.mb >= 1024 ? (info.mb / 1024).toFixed(1) + ' GB' : info.mb + ' MB') : '';
    const bar = document.createElement('div');
    bar.id = 'vex-discord-ask';
    bar.className = 'vexslow-notice';
    const line = what === 'sleep'
      ? 'Discord has been hidden for ' + info.idle + ' minutes. Let it sleep and hand its memory back?'
      : 'Discord has grown to ' + esc(size) + '. Refresh it to free that?';
    const cost = what === 'sleep'
      ? 'Asleep it uses nothing and wakes when you open it — but it cannot notify you until then.'
      : 'It stays signed in; whatever is on screen in it is reloaded.';
    bar.innerHTML = '<span>' + esc(line) + '<br><small style="opacity:.75">' + esc(cost) + '</small></span>';

    const done = () => bar.remove();
    const act = (label, title, run) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', run);
      bar.appendChild(b);
      return b;
    };
    act(what === 'sleep' ? 'Let it sleep' : 'Refresh it', 'Free the memory now', () => {
      done();
      try {
        if (what === 'sleep') this.sleepNow(info.idle); else this.refresh(info.mb);
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    act('Not now', 'Leave Discord alone — Vex will not ask again for four hours', () => {
      done();
      this._quietUntil = Date.now() + this.ASK_QUIET_MS;
      window.showToast?.('Discord left alone — Vex will not ask again for four hours');
    });
    act('Always', 'Do this from now on without asking', () => {
      done();
      this.setConsent('auto');
      try {
        if (what === 'sleep') this.sleepNow(info.idle); else this.refresh(info.mb);
      } catch (err) { window.showToast?.(err.message, 'error'); }
      window.showToast?.('Vex will free Discord\u2019s memory by itself from now on — Settings › Performance changes it back');
      this.renderSetting();
    });
    document.body.appendChild(bar);
    // An unanswered question is a no. It goes by itself, and Discord is left
    // exactly as it was.
    this._askTimer = setTimeout(() => { if (bar.isConnected) bar.remove(); }, 30000);
    return { action: 'asked', what, ...info };
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
    // The limit, lowered once from the old 1.5 GB default.
    if (localStorage.getItem(this.LOWERED_KEY) !== '1') {
      if (localStorage.getItem(this.KEY) === '1500') localStorage.setItem(this.KEY, '1000');
      localStorage.setItem(this.LOWERED_KEY, '1');
    }
    if (window.vex && typeof window.vex.setDiscordLite === 'function') {
      window.vex.setDiscordLite(this.lite()).catch(err => window.VexProblems?.note('Discord memory', 'Could not set Lighter Discord', err));
    }
    this._watchHide();
    clearInterval(this._timer);
    this._timer = setInterval(() => { this.check().catch(err => window.VexProblems?.note('Discord memory', 'Check failed', err)); }, this.CHECK_MS);
    return true;
  },

  renderSetting(host) {
    host = host || document.getElementById('discord-memory-setting');
    if (!host) return;
    host.innerHTML = `
      <div class="setting-toggle-row"><span>Before freeing Discord’s memory, Vex should</span><select data-consent aria-label="Before freeing Discord's memory"><option value="ask">ask me first</option><option value="auto">just do it</option><option value="never">never do it</option></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">Sleeping Discord costs you every notification until you open it again, and refreshing it reloads what is on screen — so by default Vex asks, and a question you ignore is a no.</p>
      <div class="setting-toggle-row"><span>Open Discord as</span><select data-mode aria-label="Open Discord as"><option value="panel">a panel (always running)</option><option value="tab">a tab (only while open)</option></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">A tab uses no memory once closed — but then there are no Discord notifications, and closing it ends a call. Same login, Vencord and connection either way.</p>
      <div class="setting-toggle-row"><span>Put Discord to sleep when it has been hidden, and not in a call, for</span><select data-idle aria-label="Put Discord to sleep after"></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">Asleep it uses no memory and wakes when you open it — no Discord notifications while it sleeps.</p>
      <div class="setting-toggle-row"><span>Refresh Discord when it grows past</span><select data-limit aria-label="Refresh Discord when it grows past"></select></div>
      <div class="setting-toggle-row"><span>Lighter Discord — avatars, emoji, stickers and server icons stay still (anything people post still loads)</span><label class="toggle"><input type="checkbox" data-lite><span class="toggle-slider"></span></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px"><button type="button" class="btn-secondary" data-plugins>Turn off the heaviest Vencord plugins</button></div>
      <p class="setting-info muted" style="margin:2px 0 0">MessageLoggerEnhanced, MessageLogger, ShowHiddenChannels, PlatformIndicators and WhoReacted — the biggest memory users in the plugin review. Discord reloads after.</p>
      <p class="setting-info muted" style="margin:10px 0 0">In Discord itself (its settings, not Vex's): Accessibility › Reduced motion on, and play GIFs, animated emoji and stickers off; Chat › link previews and image previews off. Leaving large servers you do not read helps most of all — Discord keeps every server's channels and members in memory.</p>`;
    const consent = host.querySelector('[data-consent]');
    consent.value = this.consent();
    consent.addEventListener('change', () => {
      try {
        this.setConsent(consent.value);
        window.showToast?.(consent.value === 'ask'
          ? 'Vex will ask before freeing Discord\u2019s memory'
          : consent.value === 'auto' ? 'Vex will free Discord\u2019s memory by itself'
            : 'Vex will never touch Discord for memory');
      } catch (err) { window.showToast?.(err.message, 'error'); consent.value = this.consent(); }
    });
    const mode = host.querySelector('[data-mode]');
    mode.value = this.mode();
    mode.addEventListener('change', () => {
      try { this.setMode(mode.value); window.showToast?.(mode.value === 'tab' ? 'Discord opens as a tab now — the panel is closed and its memory freed' : 'Discord opens as a panel again'); }
      catch (err) { window.showToast?.(err.message, 'error'); mode.value = this.mode(); }
    });
    const idleSel = host.querySelector('[data-idle]');
    for (const v of this.IDLE_CHOICES) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = v ? v + ' minutes' : 'Never';
      if (v === this.idleMinutes()) o.selected = true;
      idleSel.appendChild(o);
    }
    idleSel.addEventListener('change', () => localStorage.setItem(this.IDLE_KEY, idleSel.value));
    const lite = host.querySelector('[data-lite]');
    lite.checked = this.lite();
    lite.addEventListener('change', () => {
      this.setLite(lite.checked).then(
        (on) => window.showToast?.(on ? 'Lighter Discord on — reopen a channel to see it' : 'Lighter Discord off'),
        (err) => window.showToast?.('Could not change it: ' + err.message, 'error'));
    });
    host.querySelector('[data-plugins]').addEventListener('click', async () => {
      try {
        const off = await this.turnOffHeavyPlugins();
        window.showToast?.(off.length ? 'Turned off ' + off.join(', ') + ' — Discord is reloading' : 'None of them were on');
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    const sel = host.querySelector('[data-limit]');
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
