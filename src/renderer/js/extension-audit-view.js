// === Extension audit ========================================================
//
// One page that answers "should I keep this extension?" for all of them:
// what it can read and do (the manifest, main/extension-audit.js), when it last
// changed, when you last used it, and a one-click switch-off.
//
// "Last used" is only what Vex can see: opening the extension's popup or
// pressing its toolbar button (main/extension-usage.js). An extension that
// works silently on every page is shown as "works in the background" and is
// never called unused. Disabling is the existing extensions:set-enabled, so it
// is reversible here and in Settings > Extensions.
const ExtensionAuditView = {
  UNUSED_DAYS: 30,

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _msg(err) { return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); },

  ago(ms, now = Date.now()) {
    if (!Number.isFinite(ms)) return null;
    const d = Math.floor((now - ms) / 86400000);
    if (d < 1) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 60) return d + ' days ago';
    if (d < 730) return Math.round(d / 30) + ' months ago';
    return Math.round(d / 365) + ' years ago';
  },

  // The list joined with its usage, worst-first (the existing audit weight).
  async load() {
    if (!window.vex || typeof window.vex.extensionsList !== 'function' || typeof window.vex.extensionsUsageAudit !== 'function') {
      throw new Error('The extension audit is not available in this window');
    }
    const [list, usage] = await Promise.all([window.vex.extensionsList(), window.vex.extensionsUsageAudit()]);
    const byFolder = new Map(usage.map(u => [u.folder, u]));
    return list.map(e => ({ ...e, usage: byFolder.get(e.folder) || null }))
      .sort((a, b) => ((b.audit && b.audit.weight) || 0) - ((a.audit && a.audit.weight) || 0));
  },

  // What the page says about when it was used, as one honest phrase.
  usedText(e, now = Date.now()) {
    const u = e.usage;
    if (!u) return 'Last use: not known';
    if (u.lastUsed) return 'Last used ' + this.ago(u.lastUsed, now);
    if (u.passive) return 'Works in the background, so Vex cannot tell when it is used';
    if (!u.usageKnown) return 'Last use: not known';
    return 'Not used since it was installed';
  },

  async open() {
    document.getElementById('vex-ext-audit')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-ext-audit';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Extension audit');
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:640px;max-width:94vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5))">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 8px"><span style="color:var(--text)">${VexIcons.svg('puzzle', { size: 16 })}</span><span style="font-size:15px;font-weight:700;color:var(--text);flex:1">Extension audit</span><button type="button" id="eaud-close" class="btn-secondary" style="padding:6px 10px;line-height:0" title="Close" aria-label="Close">${VexIcons.svg('x', { size: 13 })}</button></div>
      <div id="eaud-body" style="overflow-y:auto;padding:4px 20px 20px;color:var(--text)"><div style="color:var(--text-muted);padding:20px 0">Reading your extensions…</div></div></div>`;
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'extension-audit-view' });
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#eaud-close').addEventListener('click', close);
    m.querySelector('#eaud-close').focus();
    await this._render(m);
    return m;
  },

  async _render(m) {
    const body = m.querySelector('#eaud-body');
    const esc = (s) => this._esc(s);
    let items;
    try { items = await this.load(); }
    catch (err) { body.innerHTML = `<div role="alert" style="color:var(--danger);padding:16px 0">The audit could not be read: ${esc(this._msg(err))}</div>`; return; }
    if (!items.length) { body.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">No extensions are installed.</div>'; return; }
    const unusedCount = items.filter(e => e.enabled && e.usage && e.usage.unused === true).length;
    const now = Date.now();
    body.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin:6px 0 10px">${items.length} extension${VexPlural.s(items.length)}${unusedCount ? ' · ' + unusedCount + ' not used in ' + this.UNUSED_DAYS + ' days' : ''}. Switching one off keeps it installed; you can switch it back on here.</div>` +
      items.map((e, i) => {
        const a = e.audit || { reach: { says: '', level: 'none' }, powers: [] };
        const heavy = a.powers.filter(p => p.heavy);
        const upd = e.usage && e.usage.lastUpdated ? 'Updated ' + this.ago(e.usage.lastUpdated, now) : 'Update date not known';
        const unused = e.enabled && e.usage && e.usage.unused === true;
        return `<div class="eaud-row" data-folder="${esc(e.folder)}" style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-weight:700;flex:1;min-width:140px">${esc(e.name)} <span style="font-weight:400;color:var(--text-muted);font-size:11.5px">v${esc(e.version)}</span></span>
            ${unused ? '<span style="font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--border);color:var(--text-muted)">Unused ' + this.UNUSED_DAYS + '+ days</span>' : ''}
            ${e.enabled ? `<button type="button" class="btn-secondary eaud-off" data-i="${i}" style="padding:5px 12px;font-size:12px">Disable</button>`
              : `<span style="font-size:11px;color:var(--text-muted)">Disabled</span><button type="button" class="btn-secondary eaud-on" data-i="${i}" style="padding:5px 12px;font-size:12px">Enable</button>`}
          </div>
          <div style="font-size:12.5px;margin-top:4px">${esc(a.reach.says)}</div>
          ${a.powers.length ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${heavy.length ? esc(heavy.map(p => p.says).join(' · ')) : a.powers.length + ' permission' + VexPlural.s(a.powers.length) + ', none of them sensitive'}</div>` : ''}
          ${(a.sessions || []).map(s => `<div class="eaud-session" style="font-size:11.5px;color:var(--danger);margin-top:3px">${esc(s.says)}</div>`).join('')}
          <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${esc(upd)} · ${esc(this.usedText(e, now))}</div>
        </div>`;
      }).join('');
    const setEnabled = async (e, on) => {
      if (!on) {
        const ok = await vexConfirm({ title: 'Disable ' + e.name + '?', message: 'It stops running now and stays installed. You can enable it again from this page.', okLabel: 'Disable', danger: true });
        if (!ok) return;
      }
      try {
        const r = await window.vex.extensionsSetEnabled(e.folder, on);
        if (!r || r.ok === false) throw new Error((r && r.error) || 'the extension did not change');
        window.showToast?.(e.name + (on ? ' enabled' : ' disabled'), 'success');
        await this._render(m);
      } catch (err) { window.showToast?.('Could not change ' + e.name + ': ' + this._msg(err), 'error'); }
    };
    body.querySelectorAll('.eaud-off').forEach(b => b.addEventListener('click', () => setEnabled(items[Number(b.dataset.i)], false)));
    body.querySelectorAll('.eaud-on').forEach(b => b.addEventListener('click', () => setEnabled(items[Number(b.dataset.i)], true)));
  },

  mountSettings() {
    const PS = window.ProtectSettings;
    if (!PS) return null;
    const body = PS.group({ id: 'settings-extension-audit', title: 'Extension audit', intro: 'For every extension: what it can read and do, when it last updated, when you last used it, and a one-click switch-off.' });
    if (!body || body.dataset.ready) return body;
    body.dataset.ready = '1';
    body.append(PS.button('Open the extension audit', () => this.open().catch(err => window.showToast?.('The audit could not open: ' + this._msg(err), 'error')), { icon: 'puzzle' }));
    return body;
  },
};

if (typeof window !== 'undefined') {
  window.ExtensionAuditView = ExtensionAuditView;
  const boot = () => { try { ExtensionAuditView.mountSettings(); } catch (err) { console.error('[ExtensionAuditView] settings group failed:', err); } };
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ExtensionAuditView };
