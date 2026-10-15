// === Interests profile ======================================================
//
// A small model of what you open, kept on this PC and used for one thing:
// putting the stories and brief sections you usually open first.
//
// What it stores is a handful of labels with a weight each ("topic:privacy",
// "source:Ars Technica", "section:github"), never an address, a title or a
// timestamp of a visit. A weight fades by half every 30 days, so an interest
// you drop stops mattering. It is not one of the synced stores (js/sync-engine.js
// lists what syncs; this key is not there), and Settings shows it all and can
// wipe it.
//
// Off until the person turns it on in Settings > Brief actions.
const VexInterests = {
  KEY: 'vex.interests',
  HALF_LIFE_DAYS: 30,
  MAX_WEIGHT: 50,
  MAX_KEYS: 200,
  DAY_MS: 24 * 3600 * 1000,

  _read() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object' || typeof raw.w !== 'object' || raw.w === null) return { v: 1, w: {}, since: 0, count: 0 };
    return { v: 1, w: raw.w, since: Number(raw.since) || 0, count: Number(raw.count) || 0 };
  },
  _write(model) {
    try { localStorage.setItem(this.KEY, JSON.stringify(model)); return true; }
    catch (err) { window.VexProblems?.note('Interests', 'Could not save the interests profile', err); return false; }
  },

  _decayed(entry, now) {
    if (!entry || !Number.isFinite(entry.w)) return 0;
    const days = Math.max(0, (now - (entry.at || now)) / this.DAY_MS);
    return entry.w * Math.pow(0.5, days / this.HALF_LIFE_DAYS);
  },

  // Labels for a story: its topics, its source and its site.
  featuresOf(item) {
    if (!item) return [];
    const out = new Set();
    let topics = item.topics || [];
    try { if (typeof AINews !== 'undefined' && typeof AINews.topicsOf === 'function') topics = AINews.topicsOf(item); } catch { /* fall back to raw topics */ }
    for (const t of topics) { const s = String(t).toLowerCase().trim(); if (s) out.add('topic:' + s); }
    if (item.source) out.add('source:' + String(item.source).trim().slice(0, 60));
    try { if (item.url) out.add('host:' + new URL(item.url).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* not a URL */ }
    return [...out];
  },

  // Add one open of something carrying these labels.
  record(features, now = Date.now()) {
    const list = (features || []).filter(f => typeof f === 'string' && f).slice(0, 12);
    if (!list.length) return false;
    const m = this._read();
    for (const f of list) {
      const cur = m.w[f];
      const w = Math.min(this.MAX_WEIGHT, this._decayed(cur, now) + 1);
      m.w[f] = { w: Math.round(w * 100) / 100, at: now };
    }
    if (!m.since) m.since = now;
    m.count += 1;
    const keys = Object.keys(m.w);
    if (keys.length > this.MAX_KEYS) {
      keys.map(k => [k, this._decayed(m.w[k], now)]).sort((a, b) => a[1] - b[1]).slice(0, keys.length - this.MAX_KEYS).forEach(([k]) => { delete m.w[k]; });
    }
    return this._write(m);
  },

  // How much these labels matter right now (0 = unknown to the profile).
  score(features, now = Date.now()) {
    const m = this._read();
    let s = 0;
    for (const f of features || []) s += this._decayed(m.w[f], now);
    return s;
  },

  // A small, bounded lift so interest orders stories of similar importance
  // and never buries a high-importance one: at most +3.
  bonus(features, now = Date.now()) { return Math.min(3, Math.log2(1 + this.score(features, now))); },

  // items sorted by base(item) + bonus; ties keep their incoming order.
  rank(items, featuresFn, baseFn, now = Date.now()) {
    const list = (items || []).map((it, i) => ({ it, i, v: (baseFn ? baseFn(it) : 0) + this.bonus(featuresFn(it), now) }));
    list.sort((a, b) => (b.v - a.v) || (a.i - b.i));
    return list.map(x => x.it);
  },

  // For Settings: strongest first, with readable names.
  top(n = 12, now = Date.now()) {
    const m = this._read();
    return Object.keys(m.w)
      .map(k => ({ key: k, kind: k.split(':')[0], name: k.slice(k.indexOf(':') + 1), weight: this._decayed(m.w[k], now) }))
      .filter(e => e.weight >= 0.05)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n);
  },
  summary() { const m = this._read(); return { opens: m.count, since: m.since, labels: Object.keys(m.w).length }; },
  reset() { try { localStorage.removeItem(this.KEY); } catch (err) { throw new Error('Could not clear the interests profile: ' + err.message); } },

  renderSettings(container) {
    if (!container) return;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const box = el('div', 'setting-info');
    const s = this.summary();
    box.appendChild(el('div', '', 'What Vex has learned about your interests (stays on this PC, never synced)'));
    const top = this.top();
    if (!top.length) box.appendChild(el('div', 'ain-muted', 'Nothing yet.' + (typeof BriefActions !== 'undefined' && !BriefActions.isOn('interests') ? ' Learning is off.' : '')));
    for (const e of top) box.appendChild(el('div', 'ain-muted', e.kind + ': ' + e.name + ' (' + e.weight.toFixed(1) + ')'));
    if (s.opens) box.appendChild(el('div', 'ain-muted', s.opens + ' opens counted' + (s.since ? ' since ' + new Date(s.since).toLocaleDateString() : '') + '.'));
    const btn = el('button', 'btn-secondary', 'Forget everything learned');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      const ok = await window.vexConfirm({ title: 'Forget your interests?', message: 'Vex deletes the interests profile. AI news and the brief go back to their normal order.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try { this.reset(); } catch (err) { window.showToast?.(err.message, 'error'); return; }
      this.renderSettings(container);
      window.showToast?.('Interests forgotten');
    });
    box.setAttribute('data-interests', '');
    box.appendChild(btn);
    container.querySelector('[data-interests]')?.remove();
    container.appendChild(box);
  },

  section: {
    id: 'interests',
    title: 'Because you read',
    icon: 'sparkles',
    order: 90,
    defaultOn: false,
    isEnabled() { return typeof BriefActions !== 'undefined' && BriefActions.isOn('interests'); },
    build() {
      const top = VexInterests.top(5).filter(e => e.kind === 'topic' || e.kind === 'source');
      if (!top.length) return null;
      return { summary: 'Leading with ' + top.slice(0, 3).map(e => e.name).join(', ') + ' in AI news.', note: 'Learned on this PC from what you open. Settings > Brief actions shows and resets it.' };
    },
  },
};

if (typeof window !== 'undefined') window.VexInterests = VexInterests;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexInterests };
