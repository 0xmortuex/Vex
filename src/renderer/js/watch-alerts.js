// === One alert per thing that changed, and digest first (T2-079) ================
//
// The page watch, the patch radar, the GitHub watch (and, through the same call, any
// other watcher) each said "something changed" in their own words, so one release
// could arrive three times: a page watch on the releases page, a GitHub watch on the
// repository, a patch radar on the game's notes. With this on they all ask here first:
//
//   WatchAlerts.route({ source, entity, title, body, url, show }) -> true when it took the alert
//
//   - COALESCE: the same entity within 15 minutes is ONE alert, whichever watcher saw it.
//     An entity is the thing, not the watcher: a GitHub repository (github.com/owner/repo),
//     a page without its query and fragment, a game's patch notes. Later sightings only
//     raise the count on the first.
//   - DIGEST FIRST: by default an alert is not a toast. It waits as one line in the Attention
//     Inbox (the "next brief", and what Delivery windows release as one digest), refreshed
//     rather than repeated. "Instant" is opt-in, per watcher, in Settings; an instant alert is
//     the watcher's own toast, still through the Attention Budget.
//   - NEVER LOST: when the Inbox cannot hold it (it is switched off), the alert is shown the
//     instant way instead of being dropped.
//   - OFF = THE OLD BEHAVIOUR: with this off, route() returns false and every watcher speaks
//     exactly as before.
const WatchAlerts = {
  KEYS: { on: 'vex.watchAlerts.enabled', instant: 'vex.watchAlerts.instant' },
  WINDOW_MS: 15 * 60 * 1000,
  MAX_RECENT: 200,
  SOURCES: { 'page-watch': 'Page watch', 'patch-radar': 'Patch radar', 'github-watch': 'GitHub watch' },

  _recent: new Map(),            // entity -> { at, sources: Set, n }
  _now() { return Date.now(); },
  _note(what, err) { window.VexProblems?.note('Watch alerts', what, err); },

  // Staged: arrives OFF on an existing profile (its manifest is "new"); on for a new one.
  enabled() { return localStorage.getItem(this.KEYS.on) !== 'off'; },
  setEnabled(on) { localStorage.setItem(this.KEYS.on, on ? 'on' : 'off'); },

  instantSources() {
    const raw = localStorage.getItem(this.KEYS.instant);
    if (raw === null) return {};
    let o;
    try { o = JSON.parse(raw); } catch (err) { throw new Error('The watchers set to instant could not be read', { cause: err }); }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  },
  isInstant(source) { return this.instantSources()[source] === true; },
  setInstant(source, on) {
    if (!(source in this.SOURCES)) throw new Error('Unknown watcher: ' + source);
    const o = this.instantSources();
    if (on) o[source] = true; else delete o[source];
    localStorage.setItem(this.KEYS.instant, JSON.stringify(o));
  },

  // The thing that changed, whichever watcher noticed.
  entityOf(raw) {
    const s = String(raw || '').trim();
    if (!/^https?:\/\//i.test(s)) return s.toLowerCase().slice(0, 120);
    let u;
    try { u = new URL(s); } catch { return s.toLowerCase().slice(0, 120); }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    if (host === 'github.com' && parts.length >= 2) return 'github.com/' + parts[0].toLowerCase() + '/' + parts[1].toLowerCase();
    return (host + '/' + parts.join('/')).toLowerCase().replace(/\/+$/, '').slice(0, 120);
  },

  // -> true when this took the alert (the caller must not also show its own);
  //    false when the caller should speak as it always did.
  route({ source, entity, title, body = '', url = '', show } = {}) {
    if (!this.enabled()) return false;
    if (!(source in this.SOURCES)) throw new Error('Unknown watcher: ' + source);
    if (!title) throw new Error('An alert needs a title');
    if (typeof show !== 'function') throw new Error('An alert needs the watcher\'s own way of showing it');
    const key = this.entityOf(entity || url || title);
    const now = this._now();
    const seen = this._recent.get(key);
    if (seen && now - seen.at < this.WINDOW_MS) {
      seen.n++; seen.sources.add(source);
      this._count++;
      // The waiting line says how many times, without making a second one.
      if (!this.isInstant(source) && seen.waiting) this._hold(source, key, title, body, url, seen);
      return true;
    }
    const rec = { at: now, sources: new Set([source]), n: 1, waiting: false };
    this._recent.set(key, rec);
    if (this._recent.size > this.MAX_RECENT) for (const [k, v] of this._recent) if (now - v.at >= this.WINDOW_MS) this._recent.delete(k);
    if (this.isInstant(source)) { this._instant(source, key, title, body, show); return true; }
    if (this._hold(source, key, title, body, url, rec)) { rec.waiting = true; return true; }
    // The Inbox cannot hold it: shown now rather than lost.
    this._instant(source, key, title, body, show);
    return true;
  },
  _count: 0,
  collapsed() { return this._count; },

  _hold(source, key, title, body, url, rec) {
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    const also = [...rec.sources].filter(s => s !== source).map(s => this.SOURCES[s]);
    const extra = (rec.n > 1 ? 'Seen ' + rec.n + ' times' + (also.length ? ', also by ' + also.join(' and ') : '') + '. ' : '');
    return VexAttention.suggest({
      feature: 'watch-alerts', id: key, label: this.SOURCES[source],
      title, body: (extra + body + (url ? ' ' + url : '')).trim().slice(0, 300),
      action: url ? { label: 'Open', key: 'open' } : null,
    });
  },
  _instant(source, key, title, body, show) {
    if (typeof VexAttention === 'undefined') throw new Error('VexAttention is not loaded');
    VexAttention.notify({ feature: 'watch-alerts', urgency: 'useful', id: key, title, body, label: this.SOURCES[source] }, show);
  },

  // ---- Settings ---------------------------------------------------------------------------------
  group(section) {
    const el = document.createElement('div');
    section.appendChild(el);
    const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
    const toggle = (label, checked, onChange) => {
      const row = mk('div', 'setting-toggle-row');
      row.appendChild(mk('span', null, label));
      const sw = document.createElement('label');
      sw.className = 'toggle';
      sw.innerHTML = '<input type="checkbox"><span class="toggle-slider"></span>';
      const box = sw.querySelector('input');
      box.setAttribute('aria-label', label);
      box.checked = checked;
      box.addEventListener('change', () => { try { onChange(box.checked); } catch (err) { box.checked = !box.checked; window.showToast?.(err.message, 'error'); } });
      row.appendChild(sw);
      return row;
    };
    el.appendChild(mk('p', 'setting-info muted', 'The same change seen by more than one watcher is one alert for 15 minutes. Alerts wait in the Attention Inbox (and Delivery windows\' digest) instead of interrupting; choose the watchers that may ping you at once.'));
    el.appendChild(toggle('One alert per change, digest first', this.enabled(), (on) => this.setEnabled(on)));
    let instant = {};
    try { instant = this.instantSources(); } catch (err) { el.appendChild(mk('p', 'setting-info muted', err.message)); }
    for (const [id, label] of Object.entries(this.SOURCES)) {
      el.appendChild(toggle(label + ': ping me at once', instant[id] === true, (on) => this.setInstant(id, on)));
    }
    if (this._count) el.appendChild(mk('p', 'setting-info muted', this._count + ' repeated alert' + (this._count === 1 ? '' : 's') + ' folded into earlier ones this session.'));
  },

  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof AttentionInbox !== 'undefined') {
      AttentionInbox.handle('watch-alerts', (key, row) => {
        const m = /https?:\/\/\S+/.exec(String(row.body || ''));
        if (!m) throw new Error('That alert has no address to open');
        if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
        TabManager.createTab(m[0], true);
      });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.WatchAlerts = WatchAlerts;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'watch-alerts', title: 'Watcher alerts',
      keywords: 'watch alerts duplicate digest instant ping notifications page watch patch radar github',
      before: 'about',
      build: (el) => WatchAlerts.group(el),
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => WatchAlerts.init());
    else WatchAlerts.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { WatchAlerts };
