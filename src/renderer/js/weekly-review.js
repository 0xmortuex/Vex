// === Weekly review =========================================================
//
// One honest card, once a week: what fired, what got snoozed, what you saved
// and never read, which watched pages changed, which tools you used. All of
// it is already stored; nothing showed it together.
//
// The review is itself a reminder — kind 'review', every Friday at 17:00 —
// so it arrives with Vex closed like any other, and firing it opens this card
// rather than a toast. It is created once; deleting it in the Schedules
// panel is respected (a flag records that it was offered).
const VexReview = {
  SEEDED_KEY: 'vex.review.seeded',
  DAY: 5, HOUR: 17,

  init() {
    const b = window.vex && window.vex.reminders;
    if (!b || typeof b.onFired !== 'function') return false;
    b.onFired((r) => { if (r && r.kind === 'review') this.open(); });
    this.ensureScheduled().catch(err => console.error('[Review] could not schedule:', err && err.message));
    return true;
  },

  async ensureScheduled() {
    const b = window.vex && window.vex.reminders;
    if (!b) return false;
    try { if (localStorage.getItem(this.SEEDED_KEY) === '1') return false; } catch { /* storage unavailable: offer anyway */ }
    const existing = (await b.list()).some(r => r.kind === 'review' && !r.firedAt);
    if (!existing) {
      const d = new Date(); d.setHours(this.HOUR, 0, 0, 0);
      while (d.getDay() !== this.DAY || d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      await b.create('Weekly review', d.getTime(), { kind: 'review', repeat: 'weekly' });
    }
    try { localStorage.setItem(this.SEEDED_KEY, '1'); } catch { /* it will be offered again next start */ }
    return true;
  },

  // The numbers for the last seven days.
  async build(now = Date.now()) {
    const weekAgo = now - 7 * 24 * 3600000;
    const r = { from: weekAgo, to: now, reminders: { fired: 0, snoozed: 0, pending: 0, missed: 0, list: [] }, saved: { unread: [], readCount: 0 }, changed: [], tools: [], errors: [] };
    try {
      const b = window.vex && window.vex.reminders;
      if (b) for (const x of await b.list()) {
        if (x.kind === 'review') continue;
        const firedAt = x.firedAt || x.lastFiredAt;
        if (firedAt && firedAt >= weekAgo) {
          r.reminders.fired++;
          if (x.delivered === 'failed') r.reminders.missed++;
          r.reminders.list.push({ text: x.message, at: firedAt, kind: x.kind || 'reminder' });
        }
        if (!x.firedAt && x.at != null && x.at > now) r.reminders.pending++;
      }
      // Snoozes: reminders created within two minutes after one fired, with the same text.
      const all = window.vex && window.vex.reminders ? await window.vex.reminders.list() : [];
      for (const x of all) {
        const twin = all.find(y => y !== x && y.message === x.message && y.firedAt && x.createdAt > y.firedAt && x.createdAt - y.firedAt < 120000);
        if (twin && x.createdAt >= weekAgo) r.reminders.snoozed++;
      }
      r.reminders.list.sort((a, c) => c.at - a.at);
    } catch (err) { r.errors.push('reminders: ' + ((err && err.message) || 'unavailable')); }
    try {
      if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) {
        r.saved.unread = ReadLater.items.filter(i => !i.read && i.at >= weekAgo).map(i => ({ text: i.title || i.url, url: i.url, at: i.at }));
        r.saved.readCount = ReadLater.items.filter(i => i.read && i.at >= weekAgo).length;
      }
    } catch (err) { r.errors.push('read later: ' + ((err && err.message) || 'unavailable')); }
    try {
      // Page watches (page-watch.js). This read a WebMonitor that never
      // existed, so "which watched pages changed" was always empty.
      if (window.PageWatch) {
        r.changed = window.PageWatch.list().filter(w => w.lastChangedAt && w.lastChangedAt >= weekAgo).map(w => ({ text: w.title || w.url, url: w.url, at: w.lastChangedAt }));
      }
    } catch (err) { r.errors.push('watched pages: ' + ((err && err.message) || 'unavailable')); }
    try {
      const counts = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('vex.tool.history.')) continue;
        const items = JSON.parse(localStorage.getItem(k) || '[]');
        const n = Array.isArray(items) ? items.filter(h => h.at >= weekAgo).length : 0;
        if (n) counts[k.slice('vex.tool.history.'.length)] = n;
      }
      r.tools = Object.entries(counts).sort((a, c) => c[1] - a[1]).slice(0, 6).map(([id, n]) => ({ id, name: (typeof Toolbox !== 'undefined' && Toolbox.all) ? ((Toolbox.all().find(t => t.id === id) || {}).name || id) : id, n }));
    } catch (err) { r.errors.push('tools: ' + ((err && err.message) || 'unavailable')); }
    return r;
  },

  async open(now) {
    let data;
    try { data = await this.build(now == null ? Date.now() : now); }
    catch (err) { window.showToast?.('Could not build the review: ' + ((err && err.message) || ''), 'error'); return null; }
    document.getElementById('vex-review')?.remove();
    const icon = (n, sz) => (window.VexIcons && VexIcons.has(n)) ? VexIcons.svg(n, { size: sz || 15 }) : '';
    const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    const wrap = document.createElement('div');
    wrap.id = 'vex-review';
    wrap.className = 'qr-overlay';
    wrap.innerHTML = `
      <div class="qr-dialog rv" role="dialog" aria-modal="true" aria-labelledby="rv-title">
        <div class="qr-head">
          <span class="qr-head-icon">${icon('clipboard', 16)}</span>
          <span class="qr-title" id="rv-title">Your week</span>
          <span class="rv-range">${fmt(data.from)} – ${fmt(data.to)}</span>
          <button class="qr-close" id="rv-close" title="Close" aria-label="Close">${icon('x', 14)}</button>
        </div>
        <div class="rv-stats">
          <div class="rv-stat"><b>${data.reminders.fired}</b><span>reminders fired</span></div>
          <div class="rv-stat"><b>${data.reminders.snoozed}</b><span>snoozed</span></div>
          <div class="rv-stat"><b>${data.reminders.pending}</b><span>still ahead</span></div>
          <div class="rv-stat${data.reminders.missed ? ' bad' : ''}"><b>${data.reminders.missed}</b><span>did not show</span></div>
        </div>
        <div class="rv-body" id="rv-body"></div>
        <div class="qr-actions"><button class="qr-btn qr-primary" id="rv-done">Done</button></div>
      </div>`;
    document.body.appendChild(wrap);
    const body = wrap.querySelector('#rv-body');
    const section = (title, items, render) => {
      const s = document.createElement('section'); s.className = 'rv-sec';
      const h = document.createElement('h4'); h.textContent = title; s.appendChild(h);
      if (!items.length) { const e = document.createElement('div'); e.className = 'rv-empty'; e.textContent = 'Nothing this week.'; s.appendChild(e); }
      for (const it of items) s.appendChild(render(it));
      body.appendChild(s);
    };
    const link = (text, url, sub) => {
      const a = document.createElement(url ? 'a' : 'div'); a.className = 'rv-row'; if (url) { a.href = '#'; a.addEventListener('click', (e) => { e.preventDefault(); try { TabManager.createTab(url, true); } catch { /* no tabs */ } wrap.remove(); }); }
      const t = document.createElement('span'); t.className = 'rv-row-text'; t.textContent = text; a.appendChild(t);
      const s = document.createElement('span'); s.className = 'rv-row-sub'; s.textContent = sub || ''; a.appendChild(s);
      return a;
    };
    section('Reminders that fired', data.reminders.list.slice(0, 8), (x) => link(x.text, null, fmt(x.at)));
    section('Saved and not yet read', data.saved.unread.slice(0, 8), (x) => link(x.text, x.url, fmt(x.at)));
    section('Watched pages that changed', data.changed.slice(0, 8), (x) => link(x.text, x.url, fmt(x.at)));
    section('Tools you used', data.tools, (x) => link(x.name, null, x.n + ' result' + (x.n === 1 ? '' : 's')));
    for (const e of data.errors) { const d = document.createElement('div'); d.className = 'rv-error'; d.textContent = 'Could not read ' + e; body.appendChild(d); }
    const close = () => wrap.remove();
    wrap.querySelector('#rv-close').addEventListener('click', close);
    wrap.querySelector('#rv-done').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    setTimeout(() => wrap.querySelector('#rv-done').focus(), 40);
    return wrap;
  },
};

if (typeof window !== 'undefined') window.VexReview = VexReview;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReview };
