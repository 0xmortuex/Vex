// === Vex Tracker Receipts ===
// The Privacy Dashboard shows LIVE, this-session counters. Tracker Receipts is
// the accumulated story over days: it samples privacy:tracker-stats and builds a
// rolling daily log (handling the session counter resetting on restart), then
// shows a weekly narrative — total blocked, a 7-day trend, your worst trackers,
// and which followed you across the most sites. History/narrative layer only;
// it does not do any blocking itself.
const TrackerReceipts = {
  LOG: 'vex.trackerReceipts',
  STATE: 'vex.trackerReceiptsState',
  _timer: null,

  _load(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v || d; } catch { return d; } },
  _save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  _today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  async sample() {
    let stats = null;
    try { stats = window.vex && window.vex.privacyTrackerStats ? await window.vex.privacyTrackerStats() : null; } catch {}
    if (!stats) return;
    const cur = stats.total || 0;
    const byHost = stats.byHost || [];
    const cross = stats.crossSite || [];
    const log = this._load(this.LOG, {});
    const state = this._load(this.STATE, { lastTotal: 0, lastByHost: {} });
    const today = this._today();
    const day = log[today] = log[today] || { blocked: 0, topTrackers: {}, cross: {} };

    // Session total resets on restart — if it dropped, treat the whole current
    // value as a fresh delta; otherwise add the growth since we last sampled.
    const grew = cur >= state.lastTotal;
    day.blocked += grew ? (cur - state.lastTotal) : cur;
    byHost.forEach((h) => {
      const prev = state.lastByHost[h.host] || 0;
      const d = (grew && h.count >= prev) ? (h.count - prev) : h.count;
      if (d > 0) day.topTrackers[h.host] = (day.topTrackers[h.host] || 0) + d;
    });
    cross.forEach((c) => { day.cross[c.host] = Math.max(day.cross[c.host] || 0, c.siteCount || 0); });

    // Keep last ~30 days.
    const keep = {};
    Object.keys(log).sort().slice(-30).forEach((k) => { keep[k] = log[k]; });
    this._save(this.LOG, keep);
    const nextByHost = {}; byHost.forEach((h) => { nextByHost[h.host] = h.count; });
    this._save(this.STATE, { lastTotal: cur, lastByHost: nextByHost });
  },

  start() { if (this._timer) return; this.sample(); this._timer = setInterval(() => this.sample(), 10 * 60 * 1000); },

  _lastDays(n) {
    const out = []; const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
    }
    return out;
  },

  async open() {
    await this.sample();                 // freshen before showing
    document.getElementById('vex-receipts')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const log = this._load(this.LOG, {});
    const days = this._lastDays(7);
    const daily = days.map((d) => (log[d] && log[d].blocked) || 0);
    const weekTotal = daily.reduce((a, b) => a + b, 0);
    const maxDay = Math.max(1, ...daily);

    // Merge the week's trackers + cross-site counts.
    const trackers = {}, cross = {};
    days.forEach((d) => {
      const e = log[d]; if (!e) return;
      Object.entries(e.topTrackers || {}).forEach(([h, c]) => { trackers[h] = (trackers[h] || 0) + c; });
      Object.entries(e.cross || {}).forEach(([h, c]) => { cross[h] = Math.max(cross[h] || 0, c); });
    });
    const topTrackers = Object.entries(trackers).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topCross = Object.entries(cross).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const m = document.createElement('div');
    m.id = 'vex-receipts';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    let body;
    if (!weekTotal) {
      body = `<div style="padding:30px 20px;text-align:center;color:var(--text-muted)">🌱 Your first receipt is still building.<br>Keep browsing — over the next few days this fills with your tracker‑blocking trend.</div>`;
    } else {
      const chart = days.map((d, i) => {
        const h = Math.round((daily[i] / maxDay) * 60);
        const lbl = d.slice(5).replace('-', '/');
        return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
          <div title="${daily[i].toLocaleString()} blocked" style="width:60%;height:${Math.max(2, h)}px;background:var(--primary,var(--accent,#6366f1));border-radius:3px 3px 0 0"></div>
          <span style="font-size:9px;color:var(--text-muted)">${lbl}</span></div>`;
      }).join('');
      const trkRows = topTrackers.map(([h, c]) => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h)}</span><span style="color:var(--text-muted)">${c.toLocaleString()}</span></div>`).join('');
      const crossRows = topCross.length ? topCross.map(([h, c]) => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h)}</span><span style="color:var(--text-muted)">followed you across ${c} site${c === 1 ? '' : 's'}</span></div>`).join('') : '<div style="color:var(--text-muted);font-size:12px">No cross-site trackers spotted — nice.</div>';
      body = `
        <div style="text-align:center;margin:6px 0 14px">
          <div style="font-size:30px;font-weight:800;color:var(--text)">${weekTotal.toLocaleString()}</div>
          <div style="font-size:12px;color:var(--text-muted)">trackers &amp; ads blocked in the last 7 days</div>
        </div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:76px;margin-bottom:16px">${chart}</div>
        <div style="font-weight:700;margin:6px 0 6px">Worst trackers this week</div>
        <div style="font-size:12.5px;margin-bottom:14px">${trkRows}</div>
        <div style="font-weight:700;margin:6px 0 6px">Followed you across sites</div>
        <div style="font-size:12.5px;margin-bottom:8px">${crossRows}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px">${esc(this._summary(weekTotal, topTrackers, topCross))}</div>`;
    }
    m.innerHTML = `<div style="width:520px;max-width:94vw;max-height:85vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 8px"><span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🧾 Tracker Receipts</span><button id="tr-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button></div>
      <div style="overflow-y:auto;padding:4px 20px 20px;color:var(--text)">${body}</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#tr-close').addEventListener('click', () => m.remove());
  },

  _summary(total, trackers, cross) {
    const worst = trackers[0] ? trackers[0][0] : null;
    const stalker = cross[0] ? cross[0][0] : null;
    let s = `That's roughly ${Math.round(total / 7).toLocaleString()} blocked a day.`;
    if (worst) s += ` ${worst} was your noisiest tracker.`;
    if (stalker) s += ` ${stalker} tried hardest to follow you around.`;
    return s;
  },
};

if (typeof window !== 'undefined') {
  window.TrackerReceipts = TrackerReceipts;
  const boot = () => { try { TrackerReceipts.start(); } catch {} };
  if (document.readyState !== 'loading') setTimeout(boot, 4000);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 4000));
}
