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
  ],
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
