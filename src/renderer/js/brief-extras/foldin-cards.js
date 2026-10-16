// === Brief extras: four small cards for the New Tab ===========================
//
// Each is a section of the Morning Brief (js/brief-integration.js EXTRAS) and a candidate for
// the New Tab slot grid (js/newtab-slots.js): it competes for one of the three card slots by
// priority and cost, and is only available while it has something to say. None of them is an
// always-on card, and none draws anything until the page asks.
//
//   perm-audit        one line from Permission hygiene: "3 sites can use your mic", and the
//                     grants about to end. Local; read from the main process.
//   platform-status   shown ONLY when a service is red (a major or critical incident on its
//                     own public status page: Discord, GitHub, Cloudflare, Roblox). Off until
//                     you switch it on, because it is the one card that asks the internet: one
//                     small read-only request per service every 20 minutes, to the service's
//                     own status page, no cookies, nothing of yours in it, never during Game
//                     mode. Uses the Wave 3 status check (window.vex.statusCheck) when this
//                     build has it, else the bounded public request every other watcher uses.
//   old-highlight     one highlight (or note) from js/highlight-resurface.js that is due to come
//                     back, with "Remembered" and "Stop these".
//   watch-flag        pages you flagged ("Flag This Page in My Morning Brief": a weather
//                     warning page, a transit service-change page) that have changed since you
//                     last looked. They are ordinary page watches (js/page-watch.js, same
//                     rules: public pages, no login, none from private or Tor tabs).
//
// Switches: one for the group (vex.briefCards.enabled) and one per card (vex.briefCards.prefs).
const VexBriefCards = {
  ENABLED_KEY: 'vex.briefCards.enabled',   // '0' = off
  PREFS_KEY: 'vex.briefCards.prefs',       // { permAudit, platformStatus, oldHighlight, watchFlag }: booleans
  FEATURE: 'brief-cards',
  // The card ids, the pref that switches each, its default, and its place in the New Tab grid.
  CARDS: {
    'perm-audit': { pref: 'permAudit', def: true, title: 'Permission audit', label: 'Permission audit line', priority: 35, cost: 3, bytes: 500 },
    'platform-status': { pref: 'platformStatus', def: false, title: 'A service is down', label: 'Service status (only when red)', priority: 88, cost: 4, bytes: 700 },
    'old-highlight': { pref: 'oldHighlight', def: true, title: 'Do you remember?', label: 'An old highlight', priority: 26, cost: 3, bytes: 600 },
    'watch-flag': { pref: 'watchFlag', def: true, title: 'Weather and transit changes', label: 'Flagged pages that changed', priority: 58, cost: 3, bytes: 600 },
  },
  _shown: {},     // card id -> true when its last build had something to say (what the slot grid asks)

  // ---- switches ------------------------------------------------------------------------
  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== '0'; } catch (err) { console.error('[BriefCards] the switch could not be read:', err.message); return true; } },
  setEnabled(on) { localStorage.setItem(this.ENABLED_KEY, on ? '1' : '0'); this.syncJob(); this._changed(); },
  prefs() {
    const raw = localStorage.getItem(this.PREFS_KEY);
    let o = {};
    if (raw) {
      try { o = JSON.parse(raw); } catch (err) { throw new Error('The brief card settings are not readable', { cause: err }); }
    }
    const out = {};
    for (const c of Object.values(this.CARDS)) out[c.pref] = o && typeof o[c.pref] === 'boolean' ? o[c.pref] : c.def;
    return out;
  },
  setPref(pref, on) {
    if (!Object.values(this.CARDS).some(c => c.pref === pref)) throw new Error('Unknown brief card: ' + pref);
    localStorage.setItem(this.PREFS_KEY, JSON.stringify({ ...this.prefs(), [pref]: !!on }));
    this.syncJob();
    this._changed();
  },
  cardOn(id) { return this.enabled() && this.prefs()[this.CARDS[id].pref] === true && !this._priv(); },
  _priv() { return typeof window !== 'undefined' && !!(window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },
  _changed() { try { document.dispatchEvent(new CustomEvent('vex:brief-extras-changed')); } catch (err) { console.error('[BriefCards] could not tell the brief:', err.message); } },

  // What the New Tab slot grid asks: has this card something to say, as of its last build?
  visible(id) { return this.cardOn(id) && this._shown[id] === true; },
  _mark(id, out) { this._shown[id] = !!out; return out; },

  // ---- 1. permission audit -------------------------------------------------------------
  async buildPermAudit() {
    if (typeof VexPermHygiene === 'undefined' || !VexPermHygiene.enabled()) return null;
    if (!window.vex || typeof window.vex.hygienePermSummary !== 'function') return null;
    const s = await window.vex.hygienePermSummary();
    const lines = Array.isArray(s && s.lines) ? s.lines.filter(x => typeof x === 'string' && x) : [];
    const soon = Array.isArray(s && s.soonLines) ? s.soonLines.filter(x => typeof x === 'string' && x) : [];
    if (!lines.length && !soon.length) return null;
    const text = (lines.length ? lines.slice(0, 2).join('; ') : soon[0]) + '.';
    return {
      lines: [{
        text, detail: lines.length && soon.length ? soon[0] + '.' : '',
        actions: [{ label: 'Review', run: () => { if (typeof SettingsUI === 'undefined' || !SettingsUI.openSection) throw new Error('Settings are not available'); SettingsUI.openSection('setting-perm-hygiene'); } }],
      }],
    };
  },

  // ---- 3. an old highlight --------------------------------------------------------------
  buildOldHighlight(now = Date.now()) {
    if (typeof HighlightResurface === 'undefined' || !HighlightResurface.enabled()) return null;
    const due = HighlightResurface.due(HighlightResurface.items(), HighlightResurface.state().seen, now);
    const h = due.highlights[0] || null;
    const n = h ? null : (due.notes[0] || null);
    const it = h || n;
    if (!it) return null;
    const ago = Math.max(1, Math.round((now - it.at) / 86400000));
    return {
      lines: [{
        text: HighlightResurface.snippet(it.text, 140),
        detail: (it.title ? it.title + ' - ' : '') + (h ? 'highlighted ' : 'noted ') + ago + (ago === 1 ? ' day ago' : ' days ago'),
        url: it.url && /^https?:\/\//i.test(it.url) ? it.url : undefined,
        actions: [
          { label: 'Remembered', run: () => { const s = HighlightResurface.state(); HighlightResurface.mark(s.seen, { highlights: h ? [h] : [], notes: n ? [n] : [] }, Date.now()); HighlightResurface._save(s); this._shown['old-highlight'] = false; } },
          { label: 'Stop these', run: () => { HighlightResurface.stop(it.id); this._shown['old-highlight'] = false; } },
        ],
      }],
    };
  },

  // ---- 4. flagged pages that changed -------------------------------------------------------
  SOURCE: 'brief-flag',
  WATCH_EVERY_MS: 6 * 3600 * 1000,
  FLAG_WINDOW_MS: 24 * 3600 * 1000,
  flagged() { return typeof PageWatch === 'undefined' ? [] : PageWatch.list().filter(w => w.source === this.SOURCE); },
  buildWatchFlag(now = Date.now()) {
    if (typeof PageWatch === 'undefined') return null;
    const changed = this.flagged().filter(w => !w.paused && PageWatch.isUnseen(w) && now - w.lastChangedAt < this.FLAG_WINDOW_MS);
    if (!changed.length) return null;
    return {
      lines: changed.slice(0, 3).map(w => ({
        text: w.title,
        detail: 'changed ' + Math.max(1, Math.round((now - w.lastChangedAt) / 60000)) + ' min ago' + (w.lastSummary ? ': ' + w.lastSummary : ''),
        url: /^https?:\/\//i.test(w.url) ? w.url : undefined,
        actions: [{ label: 'Seen', run: () => { PageWatch.markSeen(w.id); this._shown['watch-flag'] = false; } }],
      })),
    };
  },
  // "Flag This Page in My Morning Brief": the page in front becomes a watch the brief reports on.
  async flagActivePage() {
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not available in this build');
    const tab = typeof TabManager !== 'undefined' && typeof TabManager.getActiveTab === 'function' ? TabManager.getActiveTab() : null;
    if (!tab || !/^https?:/i.test(tab.url || '')) throw new Error('Open a website first');
    const watch = PageWatch.add({ url: tab.url, title: tab.title || tab.url, kind: 'text', every: this.WATCH_EVERY_MS, byUser: true, partition: tab.partition || null, source: this.SOURCE });
    window.showToast?.('Flagged. The brief will say when this page changes (checked every 6 hours).');
    await PageWatch.firstLook(watch);
    return watch;
  },
  unflag(id) { return PageWatch.remove(id); },
};

// ---- 2. a service is down -------------------------------------------------------------------
const VexPlatformStatus = {
  KEY: 'vex.briefCards.status',    // { at, red: [{ id, name, text }], failed: n }
  JOB: 'Platform status',
  EVERY_MS: 20 * 60 * 1000,
  FRESH_MS: 2 * 3600 * 1000,       // a reading older than this is not shown
  SERVICES: [
    { id: 'discord', name: 'Discord', host: 'discordstatus.com' },
    { id: 'github', name: 'GitHub', host: 'www.githubstatus.com' },
    { id: 'cloudflare', name: 'Cloudflare', host: 'www.cloudflarestatus.com' },
    { id: 'roblox', name: 'Roblox', host: 'status.roblox.com' },
  ],
  RED: ['major', 'critical'],
  INDICATORS: ['none', 'minor', 'major', 'critical'],

  // Pure. One Statuspage "summary" document -> { indicator, text }. Throws for anything else.
  parse(json) {
    if (!json || typeof json !== 'object' || !json.status || typeof json.status !== 'object') throw new Error('That is not a status page document');
    const indicator = String(json.status.indicator || '');
    if (!this.INDICATORS.includes(indicator)) throw new Error('Unknown status ' + indicator.slice(0, 20));
    const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
    const first = Array.isArray(json.incidents) && json.incidents[0] ? clip(json.incidents[0].name, 100) : '';
    return { indicator, text: first || clip(json.status.description, 100) };
  },
  // Pure. results: [{ id, name, ok, indicator?, text?, error? }] -> { red, failed }.
  judge(results) {
    return {
      red: results.filter(r => r.ok && this.RED.includes(r.indicator)).map(r => ({ id: r.id, name: r.name, text: r.text || '' })),
      failed: results.filter(r => !r.ok).length,
    };
  },

  // One read of every service. The Wave 3 check when this build has it; else the bounded public request.
  async fetchAll() {
    const bridge = window.vex;
    if (!bridge) throw new Error('Vex is not available in this window');
    if (typeof bridge.statusCheck === 'function') {
      const rows = await bridge.statusCheck(this.SERVICES.map(s => s.host));
      return this.SERVICES.map((s, i) => {
        const r = rows && rows[i];
        return r && r.ok ? { id: s.id, name: s.name, ok: true, indicator: r.indicator, text: (r.incidents && r.incidents[0] && r.incidents[0].name) || r.description || '' } : { id: s.id, name: s.name, ok: false, error: (r && r.error) || 'no answer' };
      });
    }
    if (typeof bridge.apiRequest !== 'function') throw new Error('Requests are not available in this window');
    return Promise.all(this.SERVICES.map(async (s) => {
      const res = await bridge.apiRequest({ url: 'https://' + s.host + '/api/v2/summary.json', method: 'GET', publicOnly: true, headers: { Accept: 'application/json' }, egress: 'Platform status' });
      if (!res || !res.ok || res.status !== 200) return { id: s.id, name: s.name, ok: false, error: (res && res.error) || 'It answered ' + (res && res.status) };
      try { return { id: s.id, name: s.name, ok: true, ...this.parse(JSON.parse(res.body)) }; }
      catch (err) { return { id: s.id, name: s.name, ok: false, error: err.message }; }
    }));
  },

  saved() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return null;
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved service status is not readable', { cause: err }); }
    return v && Array.isArray(v.red) ? v : null;
  },
  async refresh(now = Date.now()) {
    if (!VexBriefCards.cardOn('platform-status')) return null;
    if (typeof AttentionState !== 'undefined' && AttentionState.has('game')) return null;
    const results = await this.fetchAll();
    const { red, failed } = this.judge(results);
    localStorage.setItem(this.KEY, JSON.stringify({ at: now, red, failed }));
    VexBriefCards._changed();
    return { red, failed };
  },
  current(now = Date.now()) {
    const s = this.saved();
    return s && now - s.at < this.FRESH_MS ? s.red : [];
  },
  build(now = Date.now()) {
    const red = this.current(now);
    if (!red.length) return null;
    return { lines: red.map(r => ({ text: r.name + ' is having a major problem', detail: r.text || 'See its status page', actions: [{ label: 'Status page', url: 'https://' + (this.SERVICES.find(s => s.id === r.id) || { host: '' }).host + '/' }] })) };
  },
};

// The four sections, in the shape js/brief-integration.js EXTRAS reads: { id, title, icon, isEnabled(), build() }.
const vexBriefCardSection = (id, icon, build) => ({
  id, title: VexBriefCards.CARDS[id].title, icon,
  isEnabled: () => VexBriefCards.cardOn(id),
  async build() { return VexBriefCards._mark(id, await build()); },
});
const VexBriefPermAudit = vexBriefCardSection('perm-audit', 'shield', () => VexBriefCards.buildPermAudit());
const VexBriefPlatformStatus = vexBriefCardSection('platform-status', 'warning', () => VexPlatformStatus.build());
const VexBriefOldHighlight = vexBriefCardSection('old-highlight', 'bulb', () => VexBriefCards.buildOldHighlight());
const VexBriefWatchFlag = vexBriefCardSection('watch-flag', 'cloud', () => VexBriefCards.buildWatchFlag());

Object.assign(VexBriefCards, {
  // Starts or stops the one job (the status read) to match the switches.
  syncJob() {
    const want = this.cardOn('platform-status');
    if (want && !this._job) {
      if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded');
      this._job = VexJobs.every(VexPlatformStatus.JOB, VexPlatformStatus.EVERY_MS, () => VexPlatformStatus.refresh(), { when: 'background', deferOnBattery: true, feature: this.FEATURE });
      VexPlatformStatus.refresh().catch(err => window.VexProblems?.note('Brief cards', 'Could not read the service status pages', err));
    } else if (!want && this._job) {
      this._job.stop();
      this._job = null;
    }
  },

  // The slot-grid candidates: each competes for a card slot only while it has something to say.
  registerSlots() {
    if (typeof NewTabSlots === 'undefined') return 0;
    let n = 0;
    for (const [id, c] of Object.entries(this.CARDS)) {
      if (NewTabSlots.list().some(d => d.id === 'brief-' + id)) continue;
      NewTabSlots.register({ id: 'brief-' + id, label: c.label, slot: 'card', priority: c.priority, cost: c.cost, bytes: c.bytes, briefSection: id, available: () => this.visible(id) });
      n++;
    }
    return n;
  },

  commands() {
    return [{ id: 'brief-flag-page', label: 'Flag This Page in My Morning Brief', hint: 'A weather warning or transit service page: the brief says when it changes', icon: 'cloud', action: () => this.flagActivePage().catch(err => window.showToast?.(err.message, 'error')) }];
  },

  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('Four small cards for the Morning Brief and the New Tab. Each shows only when it has something to say, and competes for one of the three card slots.'));
    const toggle = (label, checked, onChange) => {
      const row = document.createElement('label');
      row.className = 'setting-toggle-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.addEventListener('change', () => { try { onChange(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); } });
      row.append(cb, document.createTextNode(' ' + label));
      el.appendChild(row);
    };
    toggle('Show these cards', this.enabled(), (on) => this.setEnabled(on));
    const p = this.prefs();
    toggle('Permission audit: which sites can use your camera, microphone or location', p.permAudit, (on) => this.setPref('permAudit', on));
    toggle('Service status: only when Discord, GitHub, Cloudflare or Roblox has a major problem. This one asks each service\'s public status page every 20 minutes (a read-only request, no cookies, never during a game).', p.platformStatus, (on) => this.setPref('platformStatus', on));
    toggle('An old highlight or note that is due to come back', p.oldHighlight, (on) => this.setPref('oldHighlight', on));
    toggle('Flagged pages (weather, transit) that changed', p.watchFlag, (on) => this.setPref('watchFlag', on));
    const flagged = this.flagged();
    if (flagged.length) {
      el.appendChild(S.note('Flagged pages: ' + flagged.map(w => w.title).join(', ') + '. Stop one in the page watcher.'));
    }
    let last = null;
    try { last = VexPlatformStatus.saved(); } catch (err) { console.error('[BriefCards]', err.message); }
    if (last) el.appendChild(S.note('Last service check: ' + new Date(last.at).toLocaleString() + (last.red.length ? ', ' + last.red.map(r => r.name).join(', ') + ' red' : ', nothing red') + (last.failed ? ', ' + last.failed + ' could not be read' : '') + '.'));
  },
});

if (typeof window !== 'undefined') {
  window.VexBriefCards = VexBriefCards;
  window.VexPlatformStatus = VexPlatformStatus;
  window.VexBriefPermAudit = VexBriefPermAudit;
  window.VexBriefPlatformStatus = VexBriefPlatformStatus;
  window.VexBriefOldHighlight = VexBriefOldHighlight;
  window.VexBriefWatchFlag = VexBriefWatchFlag;
  VexBriefCards.registerSlots();
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'brief-cards', title: 'Brief cards', keywords: 'morning brief new tab permission audit status down highlight weather transit flag cards', before: 'about', build: (el) => VexBriefCards.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    for (const c of VexBriefCards.commands()) VexExtras.registerCommand(c);
  }
  document.addEventListener('DOMContentLoaded', () => {
    try { VexBriefCards.syncJob(); } catch (err) { window.VexProblems?.note('Brief cards', 'Could not start the service status check', err); }
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBriefCards, VexPlatformStatus, VexBriefPermAudit, VexBriefPlatformStatus, VexBriefOldHighlight, VexBriefWatchFlag };
