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
          <h3><svg class="pd-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Privacy</h3>
          <button id="pd-reset" class="pd-reset" title="Reset the counters for this session">Reset</button>
        </div>
        <div id="pd-body" class="pd-body"><div class="pd-empty">Loading…</div></div>
        <div id="pd-egress" class="pd-egress"></div>
      </div>`;
    this._injectStyles();
    el.querySelector('#pd-reset').addEventListener('click', async () => {
      try { await window.vex.privacyTrackerReset(); }
      catch (err) { console.error('[Privacy] counter reset failed:', err.message); window.showToast?.('Could not reset the counters', 'error'); return; }
      this._refresh();
    });
    this._egressBuild(el);
    await this._refresh();
    this._startTicking();
  },

  _startTicking() {
    this.stop();
    // Light poll: only actually fetches while the panel is visible. Once the
    // panel is gone for good the interval stops itself instead of ticking (and
    // holding a detached element) for the rest of the session.
    this._timer = VexJobs.every('Privacy panel refresh', 2500, () => {
      if (!this._el || !document.body.contains(this._el)) { this.stop(); return; }
      const panel = document.getElementById('panel-privacy');
      if (!panel || panel.style.display === 'none' || panel.offsetParent === null) return;
      this._refresh();
    });
  },

  stop() {
    if (this._timer) { this._timer.stop(); this._timer = null; }
  },

  // ---- What left this computer (main/egress-ledger.js) -----------------------
  // Every request Vex itself made, by feature and host, with sizes and never any
  // content; filters; and the proof line. Pages you browse are not in it.
  KIND_LABEL: { ai: 'Cloud AI', sync: 'Vex Sync', update: 'Updates', news: 'News', breach: 'Breach check', extension: 'Extensions', fetch: 'Other fetches', other: 'Other' },
  _egFilter: { kind: '', feature: '', host: '' },

  _fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; },

  _egressBuild(el) {
    const host = el.querySelector('#pd-egress');
    if (!host) return;
    host.textContent = '';
    const sectionHead = document.createElement('div');
    sectionHead.className = 'pd-section-title';
    sectionHead.textContent = 'What left this computer';
    const proof = document.createElement('div');
    proof.className = 'pd-egress-proof';
    proof.id = 'pd-egress-proof';
    proof.setAttribute('role', 'status');
    const filters = document.createElement('div');
    filters.className = 'pd-egress-filters';
    const kindSel = document.createElement('select');
    kindSel.id = 'pd-egress-kind';
    kindSel.setAttribute('aria-label', 'Filter by kind');
    for (const [v, t] of [['', 'All kinds'], ...Object.entries(this.KIND_LABEL)]) { const o = document.createElement('option'); o.value = v; o.textContent = t; kindSel.appendChild(o); }
    const featSel = document.createElement('select');
    featSel.id = 'pd-egress-feature';
    featSel.setAttribute('aria-label', 'Filter by feature');
    const hostIn = document.createElement('input');
    hostIn.type = 'text'; hostIn.id = 'pd-egress-host'; hostIn.placeholder = 'Host'; hostIn.setAttribute('aria-label', 'Filter by host');
    const forget = document.createElement('button');
    forget.type = 'button'; forget.className = 'pd-reset'; forget.textContent = 'Forget this list';
    filters.append(kindSel, featSel, hostIn, forget);
    const list = document.createElement('div');
    list.id = 'pd-egress-list';
    list.className = 'pd-egress-list';
    const note = document.createElement('div');
    note.className = 'pd-own-note';
    note.textContent = 'Only requests Vex itself makes: the host, the feature and how many bytes, never what was in them. Pages you browse are not listed. Kept for 30 days at most.';
    host.append(sectionHead, proof, filters, list, note);
    const changed = () => { this._egFilter = { kind: kindSel.value, feature: featSel.value, host: hostIn.value.trim().toLowerCase() }; this._egressRefresh(); };
    kindSel.addEventListener('change', changed);
    featSel.addEventListener('change', changed);
    hostIn.addEventListener('input', changed);
    forget.addEventListener('click', async () => {
      const ok = await vexConfirm({ title: 'Forget this list?', message: 'The record of what Vex sent out is deleted. This does not stop Vex making requests.', okLabel: 'Forget', danger: true });
      if (!ok) return;
      try { await window.vex.egressClear(); }
      catch (err) { console.error('[Privacy] could not forget the list:', err.message); window.showToast?.('Could not forget the list: ' + err.message, 'error'); return; }
      this._egressRefresh();
    });
  },

  async _egressRefresh() {
    const el = this._el; if (!el) return;
    const proof = el.querySelector('#pd-egress-proof'); if (!proof) return;
    const list = el.querySelector('#pd-egress-list');
    let sum, rows;
    try {
      sum = await window.vex.egressSummary(24 * 3600 * 1000);
      rows = await window.vex.egressList({ ...this._egFilter, sinceMs: 7 * 24 * 3600 * 1000, limit: 100 });
    } catch (err) {
      console.error('[Privacy] the egress list could not be read:', err.message);
      proof.textContent = 'The list of what left this computer is not available here (' + err.message + ').';
      list.textContent = '';
      return;
    }
    this._egressPaint(el, sum, rows);
  },

  // Paints the proof line, the feature filter and the rows. Pure over its arguments.
  _egressPaint(el, sum, rows) {
    const proof = el.querySelector('#pd-egress-proof');
    const list = el.querySelector('#pd-egress-list');
    const keptHours = Math.max(0, Math.floor((Date.now() - sum.keptSince) / 3600000));
    if (sum.nothingLeft) {
      proof.textContent = keptHours >= 24
        ? 'Nothing left this computer in the last 24 hours.'
        : 'Nothing has left this computer in the ' + (keptHours < 1 ? 'last hour' : keptHours + ' hours') + ' this list has been kept (it counts back 24 hours once it is a day old).';
      proof.dataset.state = 'none';
    } else {
      proof.textContent = sum.count + ' request' + (sum.count === 1 ? '' : 's') + ' in the last 24 hours: ' + this._fmtBytes(sum.bytesOut) + ' sent, ' + this._fmtBytes(sum.bytesIn) + ' received.';
      proof.dataset.state = 'some';
    }
    const featSel = el.querySelector('#pd-egress-feature');
    const chosen = this._egFilter.feature;
    const names = sum.byFeature.map(f => f.name);
    if (chosen && !names.includes(chosen)) names.push(chosen);
    featSel.textContent = '';
    for (const n of ['', ...names]) { const o = document.createElement('option'); o.value = n; o.textContent = n || 'All features'; featSel.appendChild(o); }
    featSel.value = chosen;
    list.textContent = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'pd-empty';
      empty.textContent = 'Nothing to show for this filter.';
      list.appendChild(empty);
      return;
    }
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 'pd-cross-item';
      const left = document.createElement('span');
      left.className = 'pd-host';
      left.title = r.host;
      left.textContent = r.feature + ' → ' + r.host;
      const right = document.createElement('span');
      right.className = 'pd-cross-count';
      right.textContent = new Date(r.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' · ' + this._fmtBytes(r.out) + ' out, ' + this._fmtBytes(r.in) + ' in' + (r.ok ? '' : ' · failed');
      row.append(left, right);
      list.appendChild(row);
    }
  },

  async _refresh() {
    const el = this._el; if (!el) return;
    this._egressRefresh();
    const body = el.querySelector('#pd-body'); if (!body) return;
    let stats = null;
    try { stats = await window.vex.privacyTrackerStats(); }
    catch (err) { console.error('[Privacy] tracker stats failed:', err.message); }
    if (!stats) { body.innerHTML = `<div class="pd-empty">Couldn't read blocking stats.</div>`; return; }
    // These counters only move while the blocker is actually running, so the
    // panel must report its real state instead of claiming blocking is always on.
    let blocking = true;
    try { blocking = (await window.vex.getAdBlockerState?.()) !== false; } catch { blocking = true; }
    const total = stats.total || 0;
    const cross = stats.crossSite || [];
    // A host blocked only on its own site (web.whatsapp.com inside WhatsApp,
    // netflix.com inside Netflix) is that site's own analytics, not a tracker
    // following you around: it was listed among the "tracker/ad hosts" and top
    // offenders (walkthrough L4, 2026-10-07). It gets its own short list.
    const all = stats.byHost || [];
    const top = all.filter(t => !this.ownSiteOnly(t));
    const own = all.filter(t => this.ownSiteOnly(t));

    const offNotice = blocking ? '' : `<div class="pd-off">Ad and tracker blocking is currently switched OFF, so nothing new is being counted. Turn it back on in Settings.</div>`;

    if (!total) {
      body.innerHTML = offNotice + `<div class="pd-empty">Nothing blocked yet this session.<br>As you browse, trackers and ads Vex blocks will show up here.</div>`;
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

    const ownHtml = own.length ? `
      <div class="pd-section-title">A site's own analytics</div>
      <div class="pd-own-note">Blocked on the site itself and not seen on any other site.</div>
      <div class="pd-cross">${own.slice(0, 8).map(t =>
        `<div class="pd-cross-item"><span class="pd-host" title="${this._esc(t.host)}">${this._esc(t.host)}</span><span class="pd-count">${t.count.toLocaleString()}</span></div>`
      ).join('')}</div>` : '';

    body.innerHTML = offNotice + `
      <div class="pd-hero">
        <div class="pd-hero-num">${total.toLocaleString()}</div>
        <div class="pd-hero-label">requests blocked this session</div>
        <div class="pd-hero-sub">${top.length.toLocaleString()} tracker/ad host${top.length === 1 ? '' : 's'} from other sites</div>
      </div>
      ${crossHtml}
      ${top.length ? `<div class="pd-section-title">Top offenders</div>
      <div class="pd-list">${bars}</div>` : ''}
      ${ownHtml}
      <div class="pd-foot">Counts reset when Vex restarts. Blocking is ${blocking ? 'on' : 'off'}.</div>`;
  },

  // The site a host belongs to, near enough: its last two labels, or three
  // under a two-letter country suffix such as co.uk.
  siteOf(host) {
    const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const n = (parts[parts.length - 1].length === 2 && /^(co|com|org|net|ac|gov|edu|ne|or)$/.test(parts[parts.length - 2])) ? 3 : 2;
    return parts.slice(-n).join('.');
  },

  // Blocked only on pages of its own site: never seen on another one.
  ownSiteOnly(t) {
    const sites = (t && t.sites) || [];
    if (!sites.length) return true;
    const mine = this.siteOf(t.host);
    return sites.every(s => this.siteOf(s) === mine);
  },

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  _injectStyles() {
    if (document.getElementById('pd-styles')) return;
    const s = document.createElement('style');
    s.id = 'pd-styles';
    s.textContent = `
      .pd-panel{display:flex;flex-direction:column;height:100%;font-family:'Outfit',sans-serif;color:var(--text)}
      .pd-head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 8px;flex-shrink:0}
      .pd-head h3{margin:0;font-size:15px;font-weight:600;display:flex;align-items:center;gap:7px}
      .pd-title-icon{width:16px;height:16px;display:block;color:var(--primary)}
      .pd-off{background:color-mix(in srgb, var(--warning,#f59e0b) 14%, transparent);border:1px solid color-mix(in srgb, var(--warning,#f59e0b) 38%, transparent);border-radius:10px;padding:9px 11px;font-size:11.5px;line-height:1.5;margin-bottom:12px}
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
      .pd-own-note{font-size:11px;color:var(--text-muted);margin:-4px 2px 8px;line-height:1.45}
      .pd-cross-count{font-size:11px;color:var(--warning,#f59e0b);font-weight:600;flex-shrink:0;margin-left:8px}
      .pd-list{display:flex;flex-direction:column;gap:9px}
      .pd-row-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
      .pd-host{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:'JetBrains Mono',monospace}
      .pd-count{font-size:11.5px;color:var(--text-muted);flex-shrink:0;margin-left:8px;font-variant-numeric:tabular-nums}
      .pd-bar{height:5px;background:rgba(127,127,127,.14);border-radius:3px;overflow:hidden}
      .pd-bar-fill{height:100%;background:linear-gradient(90deg,var(--primary),color-mix(in srgb,var(--primary) 55%,#a855f7));border-radius:3px;transition:width .3s ease}
      .pd-egress{flex-shrink:0;max-height:42%;overflow-y:auto;padding:0 14px 14px;border-top:1px solid var(--border)}
      .pd-egress-proof{font-size:12px;line-height:1.5;padding:8px 10px;border-radius:10px;background:color-mix(in srgb, var(--primary) 9%, transparent);margin-bottom:8px}
      .pd-egress-proof[data-state=none]{background:color-mix(in srgb, var(--success,#2e9d5b) 14%, transparent)}
      .pd-egress-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
      .pd-egress-filters select,.pd-egress-filters input{font:inherit;font-size:11.5px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:4px 8px;min-width:0;flex:1 1 90px}
      .pd-egress-list{display:flex;flex-direction:column;gap:5px}
      .pd-foot{margin-top:16px;font-size:10.5px;color:var(--text-muted);text-align:center;line-height:1.5}`;
    document.head.appendChild(s);
  },
};

if (typeof window !== 'undefined') window.PrivacyDashboard = PrivacyDashboard;
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivacyDashboard };
