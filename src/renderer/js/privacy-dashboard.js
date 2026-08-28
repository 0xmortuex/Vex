// === Vex Privacy Dashboard ===
// Surfaces the tracker/ad blocking that Vex already does (main-process
// webRequest.onBeforeRequest + _recordTracker) as a live, readable panel:
// a big "requests blocked" total, the cross-site trackers that actually follow
// you around the web, and the top offenders. Pure read-only view over the
// existing `privacy:tracker-stats` IPC — no new blocking logic here.
const PrivacyDashboard = {
  _el: null,
  _timer: null,

  async renderPanel(el) {
    this._el = el;
    el.innerHTML = `
      <div class="pd-panel">
        <div class="pd-head">
          <h3>🛡️ Privacy</h3>
          <button id="pd-reset" class="pd-reset" title="Reset the counters for this session">Reset</button>
        </div>
        <div id="pd-body" class="pd-body"><div class="pd-empty">Loading…</div></div>
      </div>`;
    this._injectStyles();
    el.querySelector('#pd-reset').addEventListener('click', async () => {
      await window.vex.privacyTrackerReset().catch(() => {});
      this._refresh();
    });
    await this._refresh();
    this._startTicking();
  },

  _startTicking() {
    if (this._timer) clearInterval(this._timer);
    // Light poll: only actually fetches while the panel is visible.
    this._timer = setInterval(() => {
      const panel = document.getElementById('panel-privacy');
      if (!panel || panel.style.display === 'none' || !document.body.contains(this._el)) return;
      this._refresh();
    }, 2500);
  },

  async _refresh() {
    const el = this._el; if (!el) return;
    const body = el.querySelector('#pd-body'); if (!body) return;
    const stats = await window.vex.privacyTrackerStats().catch(() => null);
    if (!stats) { body.innerHTML = `<div class="pd-empty">Couldn't read blocking stats.</div>`; return; }
    const total = stats.total || 0;
    const cross = stats.crossSite || [];
    const top = stats.byHost || [];

    if (!total) {
      body.innerHTML = `<div class="pd-empty">🌱 Nothing blocked yet this session.<br>As you browse, trackers and ads Vex blocks will show up here.</div>`;
      return;
    }

    const maxCount = top.length ? top[0].count : 1;
    const bars = top.slice(0, 15).map(t => {
      const w = Math.max(3, Math.round((t.count / maxCount) * 100));
      return `<div class="pd-row">
        <div class="pd-row-top"><span class="pd-host" title="${this._esc(t.host)}">${this._esc(t.host)}</span><span class="pd-count">${t.count.toLocaleString()}</span></div>
        <div class="pd-bar"><div class="pd-bar-fill" style="width:${w}%"></div></div>
      </div>`;
    }).join('');

    const crossHtml = cross.length ? `
      <div class="pd-section-title">Followed you across sites <span class="pd-badge">${cross.length}</span></div>
      <div class="pd-cross">${cross.slice(0, 12).map(c =>
        `<div class="pd-cross-item"><span class="pd-host" title="${this._esc(c.host)}">${this._esc(c.host)}</span><span class="pd-cross-count">${c.siteCount} sites</span></div>`
      ).join('')}</div>` : '';

    body.innerHTML = `
      <div class="pd-hero">
        <div class="pd-hero-num">${total.toLocaleString()}</div>
        <div class="pd-hero-label">requests blocked this session</div>
        <div class="pd-hero-sub">${top.length.toLocaleString()} distinct tracker/ad host${top.length === 1 ? '' : 's'}</div>
      </div>
      ${crossHtml}
      <div class="pd-section-title">Top offenders</div>
      <div class="pd-list">${bars}</div>
      <div class="pd-foot">Counts reset when Vex restarts. Blocking is always on.</div>`;
  },

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  _injectStyles() {
    if (document.getElementById('pd-styles')) return;
    const s = document.createElement('style');
    s.id = 'pd-styles';
    s.textContent = `
      .pd-panel{display:flex;flex-direction:column;height:100%;font-family:'Outfit',sans-serif;color:var(--text)}
      .pd-head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 8px;flex-shrink:0}
      .pd-head h3{margin:0;font-size:15px;font-weight:600}
      .pd-reset{background:none;border:1px solid var(--border);color:var(--text-muted);border-radius:8px;padding:5px 11px;cursor:pointer;font:inherit;font-size:11.5px;transition:background .12s,color .12s,border-color .12s}
      .pd-reset:hover{background:rgba(127,127,127,.1);color:var(--text);border-color:var(--vex-border-medium,var(--border))}
      .pd-body{flex:1;overflow-y:auto;padding:6px 14px 16px}
      .pd-empty{color:var(--text-muted);font-size:13px;line-height:1.6;padding:26px 6px;text-align:center}
      .pd-hero{text-align:center;padding:14px 10px 16px;background:color-mix(in srgb, var(--primary) 9%, transparent);border:1px solid color-mix(in srgb, var(--primary) 22%, transparent);border-radius:14px;margin-bottom:14px}
      .pd-hero-num{font-size:40px;font-weight:700;line-height:1;color:var(--primary);letter-spacing:-1px}
      .pd-hero-label{font-size:12.5px;color:var(--text);margin-top:6px}
      .pd-hero-sub{font-size:11px;color:var(--text-muted);margin-top:3px}
      .pd-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-muted);font-weight:600;margin:14px 2px 8px;display:flex;align-items:center;gap:7px}
      .pd-badge{background:color-mix(in srgb, var(--warning,#f59e0b) 85%, transparent);color:#1a1206;border-radius:10px;padding:1px 8px;font-size:10px;font-weight:700;letter-spacing:0}
      .pd-cross{display:flex;flex-direction:column;gap:5px;margin-bottom:4px}
      .pd-cross-item{display:flex;align-items:center;justify-content:space-between;background:rgba(127,127,127,.06);border:1px solid var(--border);border-radius:9px;padding:7px 10px}
      .pd-cross-count{font-size:11px;color:var(--warning,#f59e0b);font-weight:600;flex-shrink:0;margin-left:8px}
      .pd-list{display:flex;flex-direction:column;gap:9px}
      .pd-row-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
      .pd-host{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'JetBrains Mono',monospace}
      .pd-count{font-size:11.5px;color:var(--text-muted);flex-shrink:0;margin-left:8px;font-variant-numeric:tabular-nums}
      .pd-bar{height:5px;background:rgba(127,127,127,.14);border-radius:3px;overflow:hidden}
      .pd-bar-fill{height:100%;background:linear-gradient(90deg,var(--primary),color-mix(in srgb,var(--primary) 55%,#a855f7));border-radius:3px;transition:width .3s ease}
      .pd-foot{margin-top:16px;font-size:10.5px;color:var(--text-muted);text-align:center;line-height:1.5}`;
    document.head.appendChild(s);
  },
};

if (typeof window !== 'undefined') window.PrivacyDashboard = PrivacyDashboard;
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivacyDashboard };
