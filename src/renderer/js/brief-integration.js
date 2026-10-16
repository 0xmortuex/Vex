// === Brief integration: extras and memory tools join the Morning Brief ======
//
// Three groups of modules were built beside the Morning Brief registry
// (js/brief.js) and each answers its own shape:
//
//   brief extras  (js/brief-extras/*)   { id, title, icon, build(), isEnabled() }
//                  build() -> { lines: [{ text, detail?, url?, actions?: [{ label, run }] }] }
//   memory tools  (js/memory-tools.js)  pushed onto window.VexBriefModules
//                  build() -> { items: [{ text, detail?, url?, state? }], empty }
//   brief actions (js/brief-actions.js) already register in the registry's own shape
//
// The page that draws the brief (start.html) has no bridge and cannot run a
// function, so this adapter turns every one of them into a registry section:
//
//   * `lines` / `items` become display items { text, sub, url, badge, actions }
//   * an action's `run()` stays HERE, in the browser, under a short key. The
//     page is given only { type: 'brief-action', key } and sends it back; the
//     browser runs it only if that key came out of the last build
//     (VexBrief.onStartCommand -> BriefIntegration.runAction).
//   * an action with a web address becomes { type: 'brief-open-url', url }.
//
// A section never takes another down: each module is its own registry
// section, so VexBrief isolates a throw or a timeout to that one card.
const BriefIntegration = {
  _actions: new Map(),   // key -> { run, label }
  _synced: new Set(),    // section ids registered from here
  _wired: false,

  // Where each module sits in the page, and its fallback icon.
  EXTRAS: [
    { id: 'evening-wind-down', order: 5, icon: 'moon', maxItems: 10, get: () => (typeof VexBriefEvening !== 'undefined' ? VexBriefEvening : null) },
    { id: 'audio-digest', order: 7, icon: 'play', maxItems: 2, get: () => (typeof VexBriefAudio !== 'undefined' ? VexBriefAudio : null) },
    { id: 'news-actions', order: 12, icon: 'newspaper', maxItems: 4, get: () => (typeof VexBriefNewsActions !== 'undefined' ? VexBriefNewsActions : null) },
    { id: 'streaks-goals', order: 102, icon: 'target', maxItems: 3, get: () => (typeof VexBriefStreaks !== 'undefined' ? VexBriefStreaks : null) },
    { id: 'one-new-thing', order: 105, icon: 'sparkles', maxItems: 2, get: () => (typeof VexBriefOneNew !== 'undefined' ? VexBriefOneNew : null) },
    // Wave 4 cards (js/brief-extras/foldin-cards.js): each is also a candidate for a New Tab slot.
    { id: 'platform-status', order: 3, icon: 'warning', maxItems: 4, get: () => (typeof VexBriefPlatformStatus !== 'undefined' ? VexBriefPlatformStatus : null) },
    { id: 'watch-flag', order: 9, icon: 'cloud', maxItems: 3, get: () => (typeof VexBriefWatchFlag !== 'undefined' ? VexBriefWatchFlag : null) },
    { id: 'perm-audit', order: 103, icon: 'shield', maxItems: 1, get: () => (typeof VexBriefPermAudit !== 'undefined' ? VexBriefPermAudit : null) },
    { id: 'old-highlight', order: 106, icon: 'bulb', maxItems: 1, get: () => (typeof VexBriefOldHighlight !== 'undefined' ? VexBriefOldHighlight : null) },
    // 2026-10 modules that already answer in the extras shape.
    { id: 'flashmind-due', order: 60, icon: 'graduation', maxItems: 3, get: () => (typeof VexBriefFlashMind !== 'undefined' ? VexBriefFlashMind : null) },
    { id: 'weekly-world', order: 70, icon: 'globe', maxItems: 6, get: () => (typeof VexWeeklyWorld !== 'undefined' ? VexWeeklyWorld : null) },
    { id: 'offline-pages', order: 72, icon: 'download', maxItems: 4, get: () => (typeof VexOfflinePages !== 'undefined' ? VexOfflinePages : null) },
    { id: 'year-in-vex', order: 74, icon: 'calendar', maxItems: 4, get: () => (typeof VexYearInVex !== 'undefined' ? VexYearInVex : null) },
    { id: 'fortune', order: 108, icon: 'sparkles', maxItems: 1, get: () => (typeof VexFortune !== 'undefined' ? VexFortune.brief : null) },
    { id: 'speed-run-best', order: 109, icon: 'timer', maxItems: 4, get: () => (typeof VexSpeedRun !== 'undefined' ? VexSpeedRun.brief : null) },
    // Modules that answer with a data hook or a string list are wrapped below.
    { id: 'time-travel', order: 80, icon: 'history', maxItems: 5, get: () => BriefIntegration.adapters().timeTravel },
    { id: 'tuning', order: 82, icon: 'activity', maxItems: 5, get: () => BriefIntegration.adapters().tuning },
    { id: 'renewals', order: 84, icon: 'calendar', maxItems: 5, get: () => BriefIntegration.adapters().renewals },
    { id: 'meeting-copilot', order: 20, icon: 'users', maxItems: 2, get: () => BriefIntegration.adapters().meeting },
  ],

  // Adapters for the modules whose answer is not { lines } with objects.
  // Each is { id, title, icon, isEnabled(), build() -> { lines } | null }.
  // A module that is not loaded gives null, and is simply not registered.
  adapters() {
    const lines = (arr) => arr.filter(t => typeof t === 'string' && t).map(text => ({ text }));
    const priv = () => typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow;
    return {
      timeTravel: typeof VexTimeTravel === 'undefined' || typeof VexTimeTravel.briefSection !== 'function' ? null : {
        id: 'time-travel', title: 'This time yesterday', icon: 'history',
        isEnabled: () => !priv(),
        async build() {
          const s = await VexTimeTravel.briefSection();
          return s && Array.isArray(s.lines) ? { lines: lines(s.lines) } : null;
        },
      },
      tuning: typeof VexTuning === 'undefined' || typeof VexTuning.briefSection !== 'function' ? null : {
        id: 'tuning', title: 'What slowed Vex down since yesterday', icon: 'activity',
        isEnabled: () => !priv(),
        async build() {
          const s = await VexTuning.briefSection();
          return s && Array.isArray(s.lines) ? { lines: lines(s.lines) } : null;
        },
      },
      renewals: typeof RenewalRadar === 'undefined' || typeof RenewalRadar.snapshot !== 'function' ? null : {
        id: 'renewals', title: 'Renewals coming up', icon: 'calendar',
        isEnabled: () => true,
        build() {
          const s = RenewalRadar.snapshot();
          if (!s) return null;
          const out = (s.upcoming || []).slice(0, 5).map(u => ({ text: u.name + ' renews ' + u.next, detail: u.cost != null ? u.cost + ' ' + (u.currency || '') : '' }));
          if (s.toConfirm) out.push({ text: s.toConfirm + ' possible subscription' + (s.toConfirm === 1 ? '' : 's') + ' to confirm' });
          return out.length ? { lines: out } : null;
        },
      },
      meeting: typeof MeetingCopilot === 'undefined' || typeof MeetingCopilot.snapshot !== 'function' ? null : {
        id: 'meeting-copilot', title: 'Meeting in progress', icon: 'users',
        isEnabled: () => true,
        build() {
          const s = MeetingCopilot.snapshot();
          if (!s || s.ended) return null;
          return { lines: [{ text: s.title || 'Meeting', detail: s.decisions + ' decision' + (s.decisions === 1 ? '' : 's') + ', ' + s.actions + ' action' + (s.actions === 1 ? '' : 's') }] };
        },
      },
    };
  },
  // Memory tools: the ids its _makeBrief() hands out.
  MEMORY: {
    'dashboards': { order: 45, icon: 'activity', maxItems: 6 },
    'journal': { order: 110, icon: 'book', maxItems: 2 },
    'link-memory': { order: 115, icon: 'link', maxItems: 5 },
    'game-log': { order: 120, icon: 'gamepad', maxItems: 5 },
    'backup': { order: 125, icon: 'save', maxItems: 2 },
  },

  _icon(want, fallback) {
    const has = (n) => typeof VexIcons === 'undefined' || typeof VexIcons.has !== 'function' || VexIcons.has(n);
    return want && has(want) ? want : (fallback && has(fallback) ? fallback : 'sparkles');
  },

  // ---- turning a module's answer into a registry payload ------------------
  _dropActions(id) {
    const p = id + ':';
    for (const k of [...this._actions.keys()]) if (k.startsWith(p)) this._actions.delete(k);
  },

  // Action list -> [{ label, cmd }]. Functions are kept; addresses are named.
  _actionsOf(id, tag, list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((a, i) => {
      if (!a || typeof a.label !== 'string') return;
      if (typeof a.run === 'function') {
        const key = id + ':' + tag + ':' + i;
        this._actions.set(key, { run: a.run, label: a.label });
        out.push({ label: a.label, cmd: { type: 'brief-action', key } });
      } else if (typeof a.url === 'string' && /^https?:\/\//i.test(a.url)) {
        out.push({ label: a.label, cmd: { type: 'brief-open-url', url: a.url } });
      }
    });
    return out;
  },

  _stateBadge(state) {
    return { ok: 'ok', warn: 'check', down: 'down' }[state] || '';
  },

  // `out` is whatever the module's build() answered. Returns a registry
  // payload ({ summary?, stats?, items?, note? }) or null for "nothing today".
  toPayload(id, out) {
    if (!out || typeof out !== 'object') return null;
    let items = [];
    if (Array.isArray(out.lines)) {
      items = out.lines.filter(l => l && l.text).map((l, i) => ({
        text: l.text,
        sub: l.detail || '',
        url: l.url || '',
        badge: l.met === true ? 'done' : '',
        actions: this._actionsOf(id, String(i), l.actions),
      }));
    } else if (Array.isArray(out.items)) {
      items = out.items.filter(i => i && i.text).map((i) => ({
        text: i.text,
        sub: i.detail || i.sub || '',
        url: i.url || '',
        badge: i.state ? this._stateBadge(i.state) : (i.badge || ''),
      }));
    }
    const payload = {};
    if (typeof out.summary === 'string' && out.summary) payload.summary = out.summary;
    if (Array.isArray(out.stats) && out.stats.length) payload.stats = out.stats;
    if (items.length) payload.items = items;
    if (typeof out.note === 'string' && out.note) payload.note = out.note;
    if (Array.isArray(out.errors) && out.errors.length) {
      const why = 'Some of this could not be read: ' + out.errors.slice(0, 3).join('; ');
      payload.note = payload.note ? payload.note + ' ' + why : why;
    }
    // Nothing to show, and only an "empty" message from the module: the
    // brief hides an empty section rather than printing it every day.
    if (!payload.summary && !payload.stats && !payload.items && !payload.note) return null;
    return payload;
  },

  // A module -> a registry section definition.
  sectionFor(mod, opts = {}) {
    const self = this;
    return {
      id: mod.id,
      title: mod.title || mod.id,
      icon: this._icon(mod.icon, opts.icon),
      order: opts.order == null ? 100 : opts.order,
      defaultOn: true,
      maxItems: opts.maxItems || 6,
      async build() {
        self._dropActions(mod.id);
        if (typeof mod.isEnabled === 'function' && !mod.isEnabled()) return null;
        return self.toPayload(mod.id, await mod.build());
      },
    };
  },

  // ---- Vex Pack sections ---------------------------------------------------
  // A pack's brief section is data: text, https links and https URL templates.
  // It becomes a registry section here; a template that needs a query is not
  // offered (the brief has none) and one that needs the open page is filled
  // only from a normal tab, never a private, Tor or routed one.
  _packIds: new Set(),

  _activePage() {
    try {
      const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
      if (!tab || !/^https:/i.test(tab.url || '')) return null;
      const wv = typeof WebviewManager !== 'undefined' && WebviewManager.webviews ? WebviewManager.webviews.get(tab.id) : null;
      const pol = typeof window !== 'undefined' ? window.VexTabPolicy : null;
      if (!pol || !wv || typeof pol.canReadWebview !== 'function' || !pol.canReadWebview(wv)) return null;
      if (typeof pol.canShareTab === 'function' && !pol.canShareTab(tab)) return null;
      const u = new URL(tab.url);
      return { url: tab.url, host: u.hostname };
    } catch { return null; }
  },

  packLines(item) {
    const out = [];
    for (const b of item.blocks || []) {
      if (b.kind === 'text') out.push({ text: b.text });
      else if (b.kind === 'link' && /^https:\/\//i.test(b.url)) out.push({ text: b.label, actions: [{ label: 'Open', url: b.url }] });
      else if (b.kind === 'url-template') {
        if (b.template.includes('{query}')) continue;
        let url = b.template;
        if (/\{tab-(url|host)\}/.test(url)) {
          const page = this._activePage();
          if (!page) continue;
          url = url.replace(/\{tab-url\}/g, encodeURIComponent(page.url)).replace(/\{tab-host\}/g, encodeURIComponent(page.host));
        }
        if (/^https:\/\//i.test(url)) out.push({ text: b.label, actions: [{ label: 'Open', url }] });
      }
    }
    return out;
  },

  // entries: VexPacks.items('brief-section') -> [{ packId, packName, item }]
  setPackSections(entries, brief) {
    const reg = brief || (typeof VexBrief !== 'undefined' ? VexBrief : null);
    if (!reg || typeof reg.register !== 'function') return 0;
    for (const id of this._packIds) { if (typeof reg.unregister === 'function') reg.unregister(id); this._synced.delete(id); }
    this._packIds.clear();
    let n = 0;
    for (const { packId, packName, item } of Array.isArray(entries) ? entries : []) {
      if (!item || !Array.isArray(item.blocks)) continue;
      const id = 'pack-' + packId + '-' + item.id;
      const mod = {
        id, title: item.title + (packName ? ' (' + packName + ')' : ''), icon: 'box',
        isEnabled: () => true,
        build: () => { const lines = this.packLines(item); return lines.length ? { lines } : null; },
      };
      reg.register({ ...this.sectionFor(mod, { order: 140, maxItems: 8, icon: 'box' }), defaultOn: true });
      this._packIds.add(id);
      this._synced.add(id);
      n++;
    }
    return n;
  },

  // ---- registering ---------------------------------------------------------
  // Idempotent. Called before every build, so a module that arrives late (the
  // memory tools start with the app, not with the page) is picked up.
  sync(brief) {
    const reg = brief || (typeof VexBrief !== 'undefined' ? VexBrief : null);
    if (!reg || typeof reg.register !== 'function') return 0;
    let added = 0;
    const put = (def) => {
      if (this._synced.has(def.id) || (typeof reg.get === 'function' && reg.get(def.id))) return;
      reg.register(def);
      this._synced.add(def.id);
      added++;
    };
    for (const e of this.EXTRAS) {
      const mod = e.get();
      if (mod) put(this.sectionFor(mod, e));
    }
    // Autopilot builds its own card; it joins through here so it is registered
    // once, with the others, whichever loaded first.
    if (typeof VexAutopilot !== 'undefined' && typeof VexAutopilot.registerWithBrief === 'function') {
      try { VexAutopilot.registerWithBrief(); } catch (err) { window.VexProblems?.note('Autopilot', 'Could not join the Morning Brief', err); }
    }
    const mods = Array.isArray(window.VexBriefModules) ? window.VexBriefModules : [];
    for (const mod of mods) {
      if (!mod || typeof mod.id !== 'string' || typeof mod.build !== 'function') continue;
      put(this.sectionFor(mod, this.MEMORY[mod.id] || { order: 130 }));
    }
    return added;
  },

  // ---- actions coming back from the page ----------------------------------
  runAction(key) {
    const hit = this._actions.get(key);
    if (!hit) throw new Error('That action is no longer on offer. Refresh the brief.');
    const done = () => { if (typeof VexBrief !== 'undefined') VexBrief.refresh(true).catch(err => window.VexProblems?.note('Morning Brief', 'Could not refresh after an action', err)); };
    // Not awaited: a spoken digest "play" runs for minutes, and the card
    // should redraw when it has started, not when it ends.
    Promise.resolve().then(() => hit.run()).then(done, (err) => {
      window.showToast?.((err && err.message) || String(err), 'error');
    });
    return true;
  },

  // ---- Settings › Morning Brief -------------------------------------------
  renderSettings(container) {
    if (!container) return;
    container.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    container.appendChild(el('p', 'setting-info', 'Extra sections: one new thing, news about what you use, the evening wind-down, the spoken digest and streaks. They show in the list above once they have something to say.'));
    const box = el('div');
    container.appendChild(box);
    if (typeof VexBriefExtrasSettings !== 'undefined') VexBriefExtrasSettings.render(box);
    else box.appendChild(el('p', 'setting-info muted', 'The extra sections are not loaded.'));
    container.appendChild(el('p', 'setting-info', 'The journal, saved links, dashboards, games and backup sections are switched in Memory tools.'));
    const open = el('button', 'btn-secondary', 'Open Memory tools settings');
    open.type = 'button';
    open.addEventListener('click', () => { if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) SettingsUI.openSection('settings-memtools'); });
    container.appendChild(open);
  },

  // ---- start-up -------------------------------------------------------------
  init() {
    if (this._wired) return false;
    this._wired = true;
    this.sync();
    if (typeof VexBriefStreaks !== 'undefined' && typeof VexBriefStreaks.start === 'function') VexBriefStreaks.start();
    // The spoken digest changes state outside a build: redraw its card.
    document.addEventListener('vex:brief-audio-changed', () => {
      if (typeof VexBrief !== 'undefined') VexBrief.refresh(false).catch(err => window.VexProblems?.note('Morning Brief', 'Could not redraw the spoken digest', err));
    });
    // The extras' own settings changed: build again.
    document.addEventListener('vex:brief-extras-changed', () => {
      if (typeof VexBrief !== 'undefined') VexBrief.refresh(true).catch(err => window.VexProblems?.note('Morning Brief', 'Could not refresh after a settings change', err));
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.BriefIntegration = BriefIntegration;
if (typeof module !== 'undefined' && module.exports) module.exports = { BriefIntegration };
