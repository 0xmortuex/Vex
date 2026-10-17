// === Privacy report card ====================================================
//
// Extends Tracker Receipts (js/tracker-receipts.js, which owns the 7-day log of
// what was blocked) with the cookie half of a weekly page, and a one-click
// cleanup of the worst offenders:
//
//   blocked this week     from TrackerReceipts' own log (not re-measured here)
//   cookies stored        what sites kept, and how many belong to a company the
//                         blocker saw tracking you           (privacy:report)
//   cookies set this week counted from the cookie jar's change events while Vex
//                         was running, per site, no names or values
//   fingerprinting        NOT shown as a number: Vex alters what such scripts
//                         read but nothing reports that one asked, so the page
//                         says that instead of inventing a count
//
// Cleanup removes every cookie of the chosen sites (privacy:report-clean) and
// asks first, because clearing a site you use signs you out of it.
const PrivacyReportCard = {
  WEEKLY_KEY: 'vex.privacyReportWeekly',
  SEEN_KEY: 'vex.privacyReportSeen',
  WEEK_MS: 7 * 24 * 3600 * 1000,
  _timer: null,

  _get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? d : v; } catch { return d; } },
  _set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { console.warn('[PrivacyReportCard] could not save', k, err.message); } },
  weeklyOn() { return this._get(this.WEEKLY_KEY, false) === true; },
  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  // The blocked-this-week figure from Tracker Receipts' stored log.
  _blockedThisWeek() {
    try {
      if (typeof TrackerReceipts === 'undefined') return null;
      const log = TrackerReceipts._load(TrackerReceipts.LOG, {});
      return TrackerReceipts._lastDays(7).reduce((n, d) => n + ((log[d] && log[d].blocked) || 0), 0);
    } catch (err) { console.warn('[PrivacyReportCard] could not read the receipts log:', err.message); return null; }
  },

  async open() {
    if (!window.vex || typeof window.vex.privacyReport !== 'function') throw new Error('The privacy report is not available in this window');
    document.getElementById('vex-privacy-report')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-privacy-report';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Privacy report card');
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5))">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 8px"><span style="color:var(--text)">${VexIcons.svg('shield', { size: 16 })}</span><span style="font-size:15px;font-weight:700;color:var(--text);flex:1">Privacy report card</span><button type="button" id="prc-close" class="btn-secondary" style="padding:6px 10px;line-height:0" title="Close" aria-label="Close">${VexIcons.svg('x', { size: 13 })}</button></div>
      <div id="prc-body" style="overflow-y:auto;padding:4px 20px 20px;color:var(--text)"><div style="color:var(--text-muted);padding:20px 0">Reading what sites have kept…</div></div></div>`;
    document.body.appendChild(m);
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#prc-close').addEventListener('click', close);
    m.querySelector('#prc-close').focus();
    this._set(this.SEEN_KEY, Date.now());
    await this._render(m);
    return m;
  },

  async _render(m) {
    const body = m.querySelector('#prc-body');
    const esc = (s) => this._esc(s);
    let r;
    try { r = await window.vex.privacyReport(); }
    catch (err) { body.innerHTML = `<div role="alert" style="color:var(--danger);padding:16px 0">The report could not be read: ${esc(this._msg(err))}</div>`; return; }
    const blocked = this._blockedThisWeek();
    const num = (n) => Number(n).toLocaleString();
    const stat = (value, label) => `<div style="flex:1;min-width:120px;text-align:center;padding:10px 6px;border:1px solid var(--border);border-radius:10px"><div style="font-size:22px;font-weight:800">${value}</div><div style="font-size:11px;color:var(--text-muted)">${label}</div></div>`;
    // Cookie banners Vex pressed "reject" on for you (page-extras.js, ConsentBlock; T3-077).
    let bannerStat = '';
    if (typeof ConsentBlock !== 'undefined' && typeof ConsentBlock.weekCount === 'function') {
      try { bannerStat = stat(num(ConsentBlock.weekCount()), 'cookie banners rejected for you in 7 days'); }
      catch (err) { bannerStat = stat('—', 'cookie banner count could not be read'); window.VexProblems?.note('Privacy report', 'Could not read the cookie banner count', err); }
    }
    const trackerSites = r.stored.sites.filter(s => s.tracker);
    const offenders = r.stored.sites.filter(s => s.tracker || s.count >= 15).slice(0, 12);
    const row = (s) => `<label style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px">
        <input type="checkbox" class="prc-pick" value="${esc(s.domain)}" ${s.tracker ? 'checked' : ''} aria-label="Select ${esc(s.domain)}">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.domain)}</span>
        <span style="color:var(--text-muted)">${s.tracker ? 'tracker · ' : ''}${num(s.count)} cookie${VexPlural.s(s.count)}${s.longLived ? ' · ' + s.longLived + ' last over a year' : ''}</span></label>`;
    const topSet = r.setThisWeek.top.length
      ? r.setThisWeek.top.map(s => `<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-size:12.5px"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.domain)}</span><span style="color:var(--text-muted)">${s.tracker ? 'tracker · ' : ''}${num(s.count)} set</span></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:12px">Nothing counted yet. Counting starts when Vex is running; cookies set while it was closed are not included.</div>';
    body.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 14px">
        ${stat(blocked == null ? '—' : num(blocked), 'trackers and ads blocked in 7 days')}
        ${stat(num(r.stored.total), 'cookies stored now')}
        ${stat(num(r.stored.trackerCookies), 'of them from trackers')}
        ${stat(num(r.setThisWeek.total), 'cookies set in 7 days')}
        ${bannerStat}
      </div>
      <div style="font-weight:700;margin:6px 0">Worst offenders</div>
      ${offenders.length ? `<div id="prc-list">${offenders.map(row).join('')}</div>
        <div style="display:flex;gap:8px;align-items:center;margin:10px 0 4px;flex-wrap:wrap">
          <button type="button" id="prc-clean" class="btn-primary" style="padding:7px 14px;font-size:12.5px">${VexIcons.svg('broom', { size: 13 })} Clear selected</button>
          ${trackerSites.length ? `<button type="button" id="prc-clean-trackers" class="btn-secondary" style="padding:7px 14px;font-size:12.5px">Clear all ${trackerSites.length} tracker site${VexPlural.s(trackerSites.length)}</button>` : ''}
          <span id="prc-status" role="status" style="font-size:11.5px;color:var(--text-muted)"></span>
        </div>
        <div style="font-size:11.5px;color:var(--text-muted)">Trackers are pre-selected. A site that is not a tracker is listed only because it keeps many cookies; clearing it signs you out of it.</div>`
        : '<div style="color:var(--text-muted);font-size:12.5px">No tracker cookies and no site keeping an unusual number. Nothing to clean up.</div>'}
      <div style="font-weight:700;margin:16px 0 6px">Cookies set this week, by site</div>
      ${topSet}
      <div style="font-weight:700;margin:16px 0 6px">Fingerprinting</div>
      <div style="font-size:12.5px;color:var(--text-muted)">${esc(r.fingerprinting.why)} That is why there is no count here.</div>`;

    const status = body.querySelector('#prc-status');
    const run = async (domains) => {
      if (!domains.length) { if (status) status.textContent = 'Pick at least one site.'; return; }
      const ok = await vexConfirm({
        title: 'Clear cookies?',
        message: 'Remove every cookie from ' + domains.length + ' site' + VexPlural.s(domains.length) + '? Sites that keep you signed in with a cookie will sign you out.',
        okLabel: 'Clear cookies', danger: true,
      });
      if (!ok) return;
      try {
        const res = await window.vex.privacyReportClean(domains);
        window.showToast?.('Removed ' + res.removed + ' cookie' + VexPlural.s(res.removed) + (res.failed.length ? ' (could not clear ' + res.failed.join(', ') + ')' : ''), res.failed.length ? 'error' : 'success');
        await this._render(m);
      } catch (err) {
        window.showToast?.('Cleanup failed: ' + this._msg(err), 'error');
      }
    };
    body.querySelector('#prc-clean')?.addEventListener('click', () => run([...body.querySelectorAll('.prc-pick:checked')].map(c => c.value)));
    body.querySelector('#prc-clean-trackers')?.addEventListener('click', () => run(trackerSites.map(s => s.domain)));
  },

  // --- the weekly nudge --------------------------------------------------
  // Off by default. When on, the first launch after a week since the page was
  // last opened says it is ready; it never opens by itself.
  async maybeNudge() {
    if (!this.weeklyOn()) return false;
    const last = Number(this._get(this.SEEN_KEY, 0)) || 0;
    if (Date.now() - last < this.WEEK_MS) return false;
    if (typeof window.showToast !== 'function') return false;
    if (!(typeof VexAttention === 'undefined' || VexAttention.gate('privacy-report', 'weekly'))) return false;
    window.showToast('Your weekly privacy report is ready', 'info', 12000, { action: { label: 'Open', run: () => { this.open().catch(err => window.showToast('The report could not open: ' + this._msg(err), 'error')); } } });
    // Counts as seen so it is not repeated every launch until it is opened.
    this._set(this.SEEN_KEY, Date.now());
    return true;
  },

  mountSettings() {
    if (typeof ProtectSettings === 'undefined' && !window.ProtectSettings) return null;
    const PS = window.ProtectSettings;
    const body = PS.group({ id: 'settings-privacy-report', title: 'Privacy report card', intro: 'A weekly page: trackers blocked, cookies sites kept and set, and one-click cleanup of the worst offenders. Everything is worked out on this computer.' });
    if (!body || body.dataset.ready) return body;
    body.dataset.ready = '1';
    body.append(
      PS.button('Open the report card', () => this.open().catch(err => window.showToast?.('The report could not open: ' + this._msg(err), 'error')), { icon: 'shield' }),
      PS.toggle({ text: 'Tell me when the weekly report is ready', hint: 'off by default; a toast, never opens by itself', checked: this.weeklyOn(), onChange: (on) => this._set(this.WEEKLY_KEY, on) }),
    );
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.PrivacyReportCard = PrivacyReportCard;
  const boot = () => {
    try { PrivacyReportCard.mountSettings(); } catch (err) { console.error('[PrivacyReportCard] settings group failed:', err); }
    setTimeout(() => { PrivacyReportCard.maybeNudge().catch(err => console.warn('[PrivacyReportCard] nudge:', err.message)); }, 9000);
  };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivacyReportCard };
