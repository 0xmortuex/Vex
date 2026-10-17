// === Discord's memory limit =================================================
//
// Discord in a panel is kept awake so its notifications arrive, which means it
// is never slept and never reloaded — and a Discord that has run all day grows.
// Measured on the user's machine: one renderer at 2.15 GB, the rest of Vex
// together about 1 GB. A fresh Discord is a fraction of that.
//
// So: past a limit (Settings › Performance, 1 GB by default), Vex replaces
// the Discord panel with a fresh one — only when that costs nothing:
//   hidden      not the panel you are looking at, nor the one beside it
//   no call     no microphone or camera, nothing audible, no Disconnect button
//   not lately  at most once every 30 minutes
// It stays logged in and keeps notifying; it simply starts clean.
//
// A limit below what a FRESH Discord needs would refresh it for ever. Three
// minutes after each refresh the fresh size is measured; if that is already
// near the limit, the limit is raised above it, once, and the user is told.
//
// This is the ONE Discord memory watch. There used to be three: a strip in
// the Discord panel at vex.discordMemoryWarnMB / the shared notice ceiling
// (1 GB), this one (1 GB), and the kept-awake toast (1.5 GB) — three numbers,
// three notices, three settings. Now one limit (vex.discordMemoryLimitMB),
// one notice (Refresh / During calls / Later), one setting. Saying so is not
// sleeping anything, so the notice comes whatever "Before Vex puts anything
// to sleep on its own" says; only refreshing by itself waits for "auto".

const DiscordMemory = {
  KEY: 'vex.discordMemoryLimitMB',
  CHOICES: [0, 700, 1000, 1500, 2000],       // 0 = off
  DEFAULT_MB: 1000,
  // Lowered from 1.5 GB to 1 GB (2026-09-19, asked for). A limit left at the
  // old default is moved down once; any choice made after that is kept.
  LOWERED_KEY: 'vex.discordLimitLowered',
  // The three watches merged into this one (2026-10-11), once per profile.
  MERGED_KEY: 'vex.discordMemoryMerged',
  // Told once per growth: again only when it has grown this much more.
  GROWTH_MB: 512,
  _toldMB: 0,

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
    const sb = this._sidebar();
    // Leaving the panel behind frees it at once — but not in the middle of a
    // call: sleepPanel refuses with the reason, and the choice is not saved.
    if (mode === 'tab' && sb && sb.panelWebviews && sb.panelWebviews.discord) {
      const busy = typeof sb.panelBusy === 'function' ? sb.panelBusy('discord') : '';
      if (busy) throw new Error('Discord is in use — ' + busy + '. Switch to a tab after the call.');
      if (sb.activePanel === 'discord') sb.hideActivePanel();
      if (sb.sidePanel === 'discord') sb.closeBeside();
      sb.sleepPanel('discord');
    }
    localStorage.setItem(this.MODE_KEY, mode);
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

  // ---- "Why is Discord big?" -----------------------------------------------------------
  // A report, built only when asked for (Memory panel > Discord row, or Ctrl+K).
  // It reads what Vex already knows - the process list, the page's own JS heap,
  // the extensions, the keep-awake / throttling / visibility choices - and
  // writes nothing, sends nothing. A part that cannot be read says so in the
  // report instead of being left out.
  async collect() {
    const d = { problems: [], mode: this.mode(), pid: null, wsMB: null, privMB: null, sharedWith: 0, cpu: null,
      heap: null, domNodes: null, plugins: null, spoofed: null, keepAwake: null, throttled: null,
      lite: this.lite(), extensions: null, limit: null };
    const sb = this._sidebar();
    const wv = this.webview();
    if (!wv) { d.problems.push('Discord is not loaded (asleep, or not opened yet), so there is nothing to measure'); return d; }
    let id = null;
    try { id = wv.getWebContentsId(); } catch (err) { d.problems.push('Discord has no process yet: ' + err.message); }
    if (id != null) {
      if (!window.vex || typeof window.vex.processes !== 'function') d.problems.push('The process list is not available in this build');
      else {
        try {
          const got = await window.vex.processes();
          const procs = Array.isArray(got) ? got : (got && got.processes) || [];
          const mine = procs.find(p => Array.isArray(p.contents) && p.contents.some(c => c.id === id));
          if (!mine) d.problems.push('Discord’s process was not in the process list');
          else {
            d.pid = mine.pid;
            d.wsMB = Math.round(mine.memKB / 1024);
            d.privMB = mine.privKB ? Math.round(mine.privKB / 1024) : null;
            d.cpu = mine.cpu;
            d.sharedWith = mine.contents.filter(c => c.id !== id && c.kind === 'webview').length;
          }
        } catch (err) { d.problems.push('The process list could not be read: ' + err.message); }
      }
      const scriptsOff = typeof WebviewManager !== 'undefined' && typeof WebviewManager.scriptsOffIn === 'function' && WebviewManager.scriptsOffIn(wv);
      if (scriptsOff) d.problems.push('JavaScript is off for this page, so its heap, plugins and visibility could not be read');
      else {
        try {
          const page = await window.vexGuestEval(wv, `(() => {
            const m = performance.memory;
            const p = window.Vencord && Vencord.Settings && Vencord.Settings.plugins;
            const own = Object.getOwnPropertyDescriptor(document, 'hidden');
            return {
              heap: m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } : null,
              nodes: document.getElementsByTagName('*').length,
              vencord: !!p,
              heavy: p ? ${JSON.stringify(this.HEAVY_PLUGINS)}.filter(n => p[n] && p[n].enabled) : [],
              enabledPlugins: p ? Object.keys(p).filter(n => p[n] && p[n].enabled).length : 0,
              spoofed: !!(own && own.get),
            };
          })()`, false, 5000);
          if (page) {
            const mb = (n) => Math.round(n / 1048576);
            if (page.heap) d.heap = { usedMB: mb(page.heap.used), totalMB: mb(page.heap.total), limitMB: mb(page.heap.limit) };
            d.domNodes = page.nodes;
            d.plugins = page.vencord ? { heavy: page.heavy, enabled: page.enabledPlugins } : null;
            d.spoofed = page.spoofed;
          }
        } catch (err) { d.problems.push('The page could not be asked: ' + err.message); }
      }
    }
    try {
      const keep = sb && typeof sb.keepAwakeFor === 'function' ? sb.keepAwakeFor('discord') : null;
      d.keepAwake = keep ? { mode: keep.mode, now: !!(typeof sb.keptAwakeNow === 'function' && sb.keptAwakeNow('discord')) } : null;
      d.throttled = sb && typeof sb._discordThrottled === 'boolean' ? sb._discordThrottled : null;
    } catch (err) { d.problems.push('The keep-awake choice could not be read: ' + err.message); }
    if (!window.vex || typeof window.vex.extensionsList !== 'function') d.problems.push('The extension list is not available in this build');
    else {
      try {
        const list = await window.vex.extensionsList();
        d.extensions = (Array.isArray(list) ? list : []).filter(e => e.enabled && Array.isArray(e.where) && e.where.includes(this.PARTITION)).map(e => e.name || e.folder);
      } catch (err) { d.problems.push('The extension list could not be read: ' + err.message); }
    }
    let why = null;
    try { why = await this.reasonToWait(Date.now(), { ignoreGap: false }); } catch (err) { d.problems.push('Why no notice came could not be worked out: ' + err.message); }
    d.limit = { savedMB: this.limitMB(), effectiveMB: this.effectiveLimitMB(), consent: this.consent(), blockedBy: why,
      quiet: Date.now() < this._quietUntil, toldMB: this._toldMB };
    return d;
  },

  // Plain text, the biggest measured part first, then the choices that let it
  // grow. Pure: the same data gives the same words (tested).
  buildReport(d) {
    const out = ['Why is Discord big?', ''];
    const size = (mb) => mb == null ? 'unknown' : (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB');
    out.push('Discord opens as a ' + d.mode + '.');
    if (d.wsMB == null) {
      for (const p of d.problems) out.push('Could not measure: ' + p);
      return out.join('\n');
    }
    out.push('Process ' + d.pid + ': ' + size(d.wsMB) + ' in memory' + (d.privMB != null ? ', ' + size(d.privMB) + ' private to it' : '') + (d.cpu != null ? ', ' + d.cpu.toFixed(0) + '% of a core now' : '') + '.');
    if (d.sharedWith) out.push('Another ' + d.sharedWith + ' page' + (d.sharedWith === 1 ? '' : 's') + ' shares this process, so part of the number is not Discord’s.');
    out.push('', 'Where the memory is, biggest first:');
    const base = d.privMB != null ? d.privMB : d.wsMB;
    const parts = [];
    if (d.heap) {
      parts.push([d.heap.usedMB, 'JavaScript objects in use (Discord itself, Vencord and its plugins)']);
      if (d.heap.totalMB > d.heap.usedMB) parts.push([d.heap.totalMB - d.heap.usedMB, 'JavaScript memory held but not in use']);
      parts.push([Math.max(0, base - d.heap.totalMB), 'Everything else in the process: the page tree, decoded images, video and the compositor']);
    } else parts.push([base, 'The whole process (the JavaScript heap could not be split out)']);
    parts.sort((a, b) => b[0] - a[0]);
    for (const [mb, what] of parts) out.push('  ' + size(mb) + ' - ' + what);
    if (d.domNodes != null) out.push('  The page has ' + d.domNodes.toLocaleString() + ' elements' + (d.domNodes > 30000 ? ' (a lot: a long channel, or a big member list, is open)' : '') + '.');
    out.push('', 'What lets it grow, and what each costs to change:');
    if (d.plugins && d.plugins.heavy.length) out.push('  Heavy Vencord plugins are on: ' + d.plugins.heavy.join(', ') + '. Settings > Performance > "Turn off the heaviest Vencord plugins" (you lose message logging and the like).');
    else if (d.plugins) out.push('  None of the heaviest Vencord plugins are on (' + d.plugins.enabled + ' plugins are on in all).');
    else out.push('  Vencord is not running in this Discord.');
    if (d.keepAwake) out.push('  Kept awake: ' + (d.keepAwake.now ? 'yes (' + d.keepAwake.mode + ')' : 'no (' + d.keepAwake.mode + ')') + '. While it is, it is never slept or reloaded, so it only grows. Changing it costs Discord notifications while it sleeps.');
    if (d.throttled === false) out.push('  Background throttling is off (the panel was made unthrottled and is shown or in a call). Vex turns it back on after two minutes hidden with no call.');
    else if (d.throttled === true) out.push('  Background throttling is on while it is hidden (normal).');
    if (d.spoofed === true) out.push('  Discord is told it is always visible (built in, so it does not drop its connection when hidden). It therefore never goes into its own idle mode. Removing it would cost reconnects and loading screens.');
    else if (d.spoofed === false) out.push('  Discord is not being told it is always visible.');
    out.push('  Lighter Discord is ' + (d.lite ? 'on' : 'off') + (d.lite ? '.' : ': turning it on keeps avatars, emoji and stickers still.'));
    if (d.extensions) out.push('  Extensions loaded into Discord’s session: ' + (d.extensions.length ? d.extensions.length + ' (' + d.extensions.join(', ') + '). Each one adds its own scripts to Discord’s page; Extensions can limit where one runs.' : 'none.'));
    if (d.limit) {
      out.push('', 'Why no notice came:');
      out.push('  Limit ' + (d.limit.effectiveMB ? size(d.limit.effectiveMB) + (d.limit.effectiveMB > d.limit.savedMB ? ' (raised from ' + size(d.limit.savedMB) + ' this session)' : '') : 'Never') + '; sleep choice "' + d.limit.consent + '" (only "auto" refreshes by itself).');
      if (d.limit.blockedBy) out.push('  Right now it would wait because: ' + d.limit.blockedBy + '.');
      if (d.limit.quiet) out.push('  You pressed Later / Not now less than four hours ago.');
      if (d.limit.toldMB) out.push('  It already asked at ' + size(d.limit.toldMB) + ' and asks again only after another ' + this.GROWTH_MB + ' MB of growth.');
    }
    for (const p of d.problems) out.push('', 'Could not read: ' + p);
    return out.join('\n');
  },

  async showWhyBig() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The report window is not loaded');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-discord-why-big', title: 'Why is Discord big?', sub: 'Measured now, on this computer only. Nothing is changed or sent.' });
    body.appendChild(VexSettingsGroups.note('Measuring...'));
    let text;
    try { text = this.buildReport(await this.collect()); }
    catch (err) { body.textContent = ''; body.appendChild(VexSettingsGroups.note('Could not measure: ' + err.message)); throw err; }
    body.textContent = '';
    const pre = document.createElement('pre');
    pre.className = 'vex-platform-note';
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = text;
    body.appendChild(pre);
    body.appendChild(VexSettingsGroups.button('Copy', async () => {
      try { await navigator.clipboard.writeText(text); window.showToast?.('Report copied'); }
      catch (err) { window.showToast?.('Could not copy: ' + err.message, 'error'); }
    }));
    return text;
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
  // So it follows the ONE choice in Settings › Performance, "Before Vex puts
  // anything to sleep on its own" (js/sleep-consent.js) — Discord has no
  // consent of its own any more. It had one (vex.discordMemoryConsent), and a
  // saved "ask" or "auto" in it beat a "never" in the main choice; that key is
  // removed once on start (SleepConsent.migrateOnce).
  //
  //   never   (the default) — never touched for memory at all
  //   ask     — a notice with Free the memory / Not now / Always; nothing
  //             happening is a no. "Always" answers for Discord only.
  //   auto    — what it used to do, for anyone who wants it back
  //
  // "Not now" is quiet for four hours rather than a minute: being asked the
  // same question every sixty seconds is not being asked, it is being nagged.
  ASK_QUIET_MS: 4 * 3600000,

  // Unknown means no: a guard that falls back to acting is no guard.
  consent() {
    try { if (typeof SleepConsent !== 'undefined') return SleepConsent.modeFor('discord'); }
    catch (err) { window.VexProblems?.note('Discord memory', 'The sleep choice could not be read', err); }
    return 'never';
  },

  // Kept awake in Settings (the default for Discord): never put to sleep.
  _keptAwake() {
    const sb = this._sidebar();
    try { return !!(sb && typeof sb.keptAwakeNow === 'function' && sb.keptAwakeNow('discord')); }
    catch (err) { window.VexProblems?.note('Discord memory', 'Keep awake could not be read', err); return true; }
  },

  _quietUntil: 0,

  // One check: idle long enough and safe → sleep; else over the limit and
  // safe → refresh. Neither happens without a yes unless the user has asked
  // for it to be automatic. Returns what it did.
  async check(now = Date.now()) {
    const consent = this.consent();
    const idle = this.idleMinutes();
    const sb = this._sidebar();
    if (consent !== 'never' && idle && !this._keptAwake() && sb && sb.panelWebviews && sb.panelWebviews.discord && this.hiddenFor(now) > idle * 60000) {
      const wait = await this.reasonToWait(now, { ignoreGap: true });
      if (!wait) {
        if (consent !== 'auto') return this._ask('sleep', { idle }, now);
        this.sleepNow(idle);
        return { action: 'slept' };
      }
    }
    const limit = this.effectiveLimitMB();
    if (!limit) { this._closeNotice('refresh'); return { action: 'off' }; }
    const mb = await this.sizeMB();
    if (mb == null) return { action: 'unknown' };
    if (mb <= limit) { this._toldMB = 0; this._closeNotice('refresh'); return { action: 'fine', mb, limit }; }
    const wait = await this.reasonToWait(now);
    if (wait) return { action: 'waiting', mb, limit, why: wait };
    if (consent !== 'auto') {
      // Once per growth past the limit: an unanswered notice is a no, and
      // the same size is not brought up again.
      if (this._toldMB && mb < this._toldMB + this.GROWTH_MB && !document.getElementById('vex-discord-ask')) return { action: 'told', mb, limit };
      return this._ask('refresh', { mb, limit }, now);
    }
    this.refresh(mb);
    return { action: 'refreshed', mb, limit };
  },

  _closeNotice(what) {
    const bar = document.getElementById('vex-discord-ask');
    if (bar && (!what || bar.dataset.what === what)) bar.remove();
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
    bar.dataset.what = what;
    const line = what === 'sleep'
      ? 'Discord has been hidden for ' + info.idle + ' minutes. Let it sleep and hand its memory back?'
      : 'Discord is using ' + esc(size) + '. Refresh it to free that?';
    const cost = what === 'sleep'
      ? 'Asleep it uses nothing and wakes when you open it — but it cannot notify you until then.'
      : 'It stays signed in; whatever is on screen in it is reloaded, and a voice call would drop.';
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
    act(what === 'sleep' ? 'Let it sleep' : 'Refresh', 'Free the memory now', () => {
      done();
      try {
        if (what === 'sleep') this.sleepNow(info.idle); else this.refresh(info.mb);
      } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    if (what === 'refresh') {
      this._toldMB = info.mb;
      // Kept awake all the time: sleeping when idle and waking for calls is
      // the setting that gives this back for good.
      const sb = this._sidebar();
      const mode = sb && typeof sb.keepAwakeFor === 'function' ? sb.keepAwakeFor('discord').mode : '';
      if (mode === 'always' || mode === 'until') {
        act('During calls', 'Keep Discord awake only during calls — it sleeps when you have not used it for a while, and a call in progress is never slept', () => {
          done();
          if (!sb.setKeepAwakeMode('discord', 'call')) { window.showToast?.('The setting could not be saved', 'error'); return; }
          window.showToast?.('Discord stays awake for calls only — Settings › Performance changes it back');
        });
      }
      act('Later', 'Leave Discord alone — Vex will not bring this up again for four hours', () => {
        done();
        this._quietUntil = Date.now() + this.ASK_QUIET_MS;
        this._toldMB = 0;
        window.showToast?.('Discord left alone — Vex will not bring this up for four hours');
      });
      document.body.appendChild(bar);
      this._askTimer = setTimeout(() => { if (bar.isConnected) bar.remove(); }, 30000);
      return { action: 'asked', what, ...info };
    }
    act('Not now', 'Leave Discord alone — Vex will not ask again for four hours', () => {
      done();
      this._quietUntil = Date.now() + this.ASK_QUIET_MS;
      window.showToast?.('Discord left alone — Vex will not ask again for four hours');
    });
    act('Always', 'Do this for Discord from now on without asking — everything else still asks', () => {
      done();
      try { SleepConsent.allowKind('discord'); }
      catch (err) { window.showToast?.(err.message, 'error'); return; }
      try {
        if (what === 'sleep') this.sleepNow(info.idle); else this.refresh(info.mb);
      } catch (err) { window.showToast?.(err.message, 'error'); }
      window.showToast?.('Vex will free Discord\u2019s memory without asking from now on — everything else still asks. Settings › Performance changes it back');
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
    this._closeNotice('refresh');                                // its number is out of date now
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

  // The three Discord memory watches became one (see the top). A profile that
  // saved nothing here keeps the number it was actually being told at:
  //   vex.discordMemoryWarnMB (the panel strip's own number), else
  //   vex.memoryNoticeMB 0 (strip off) -> 1.5 GB, the kept-awake toast that
  //   still spoke — the owner's case, else
  //   vex.memoryNoticeMB N -> N, the strip's number,
  // each to the nearest choice. A saved limit is kept as it is.
  mergeOnce() {
    if (localStorage.getItem(this.MERGED_KEY) === '1') return null;
    let to = null;
    const saved = localStorage.getItem(this.KEY);
    if (saved == null || saved === '') {
      const warn = Number(localStorage.getItem('vex.discordMemoryWarnMB'));
      const notice = localStorage.getItem('vex.memoryNoticeMB');
      let want = null;
      if (warn > 0) want = warn;
      else if (notice === '0') want = 1536;
      else if (notice != null && notice !== '' && Number(notice) > 0) want = Number(notice);
      if (want != null) {
        to = this.CHOICES.filter(c => c > 0).reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a);
        localStorage.setItem(this.KEY, String(to));
      }
    }
    localStorage.removeItem('vex.discordMemoryWarnMB');
    localStorage.setItem(this.MERGED_KEY, '1');
    return to;
  },

  start() {
    // The limit, lowered once from the old 1.5 GB default.
    if (localStorage.getItem(this.LOWERED_KEY) !== '1') {
      if (localStorage.getItem(this.KEY) === '1500') localStorage.setItem(this.KEY, '1000');
      localStorage.setItem(this.LOWERED_KEY, '1');
    }
    this.mergeOnce();
    // Lighter Discord is one switch in main, set by the main window; a private
    // window is refused discord: channels and only logged the refusal.
    if (window.vex && typeof window.vex.setDiscordLite === 'function' && !window.VexTabPolicy?.isPrivateWindow) {
      window.vex.setDiscordLite(this.lite()).catch(err => window.VexProblems?.note('Discord memory', 'Could not set Lighter Discord', err));
    }
    this._watchHide();
    if (this._timer) this._timer.stop();
    this._timer = VexJobs.every('Discord memory check', this.CHECK_MS, () => this.check().catch(err => window.VexProblems?.note('Discord memory', 'Check failed', err)), { when: 'background' });
    return true;
  },

  renderSetting(host) {
    host = host || document.getElementById('discord-memory-setting');
    if (!host) return;
    host.innerHTML = `
      <div class="setting-toggle-row"><span>Open Discord as</span><select data-mode aria-label="Open Discord as"><option value="panel">a panel (always running)</option><option value="tab">a tab (only while open)</option></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">A tab uses no memory once closed — but then there are no Discord notifications, and closing it ends a call. Same login, Vencord and connection either way.</p>
      <div data-sleep-dependent>
      <div class="setting-toggle-row"><span>Put Discord to sleep when it has been hidden, and not in a call, for</span><select data-idle aria-label="Put Discord to sleep after"></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">Asleep it uses no memory and wakes when you open it — no Discord notifications while it sleeps. Never while Discord is kept awake (above), and only as the choice “Before Vex puts anything to sleep on its own” allows.</p>
      </div>
      <div class="setting-toggle-row"><span>Tell me when Discord grows past</span><select data-limit aria-label="Tell me when Discord grows past"></select></div>
      <p class="setting-info muted" style="margin:2px 0 10px">A notice with Refresh — it stays signed in and notifying. Never while you are in a call. Vex refreshes it by itself only when “Before Vex puts anything to sleep on its own” is set to just do it.</p>
      <div class="setting-toggle-row"><span>Lighter Discord — avatars, emoji, stickers and server icons stay still (anything people post still loads)</span><label class="toggle"><input type="checkbox" data-lite aria-label="Lighter Discord"><span class="toggle-slider"></span></label></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px"><button type="button" class="btn-secondary" data-plugins>Turn off the heaviest Vencord plugins</button></div>
      <p class="setting-info muted" style="margin:2px 0 0">MessageLoggerEnhanced, MessageLogger, ShowHiddenChannels, PlatformIndicators and WhoReacted — the biggest memory users in the plugin review. Discord reloads after.</p>
      <p class="setting-info muted" style="margin:10px 0 0">In Discord itself (its settings, not Vex's): Accessibility › Reduced motion on, and play GIFs, animated emoji and stickers off; Chat › link previews and image previews off. Leaving large servers you do not read helps most of all — Discord keeps every server's channels and members in memory.</p>`;
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
      this._toldMB = 0;
      window.showToast?.(v ? 'Vex will tell you when Discord grows past ' + sel.options[sel.selectedIndex].textContent + ' — never during a call' : 'No more Discord memory notices');
    });
    if (typeof SleepConsent !== 'undefined') SleepConsent.renderSettingsState(host);
  },
};

if (typeof window !== 'undefined') window.DiscordMemory = DiscordMemory;
if (typeof module !== 'undefined' && module.exports) module.exports = { DiscordMemory };
