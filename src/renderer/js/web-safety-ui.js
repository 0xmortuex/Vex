// === Web safety: the settings and the per-site switch ========================
//
// The part of "safe by default" the person touches (the checks themselves
// live in main: src/main/web-safety.js):
//
//   How often Vex warns   off | standard | strict
//   Sites to trust        the ones they said "do not warn again" for
//   Paranoid sites        a per-origin switch: no cookies to third parties, no
//                         WebRTC address leak, no permission prompts, no pop-ups
//   Check an address      what the interstitial would say, and why
//
// Nothing here looks anything up: the check runs in Vex on the address as
// typed.
const WebSafetyUI = {
  LEVELS: [
    { id: 'off', label: 'Off', text: 'Vex never warns about addresses, downloads or permission requests.' },
    { id: 'standard', label: 'Standard', text: 'Only when it is sure: a name that fakes another site, a program from a bare number address, a disguised file name, a site asking for several sensitive things at once.' },
    { id: 'strict', label: 'Strict', text: 'Adds the likely ones too: any one-letter difference from a known site, brand-plus-"login" names, and any program from a site you have not used.' },
  ],

  _api() {
    if (!window.vex || !window.vex.webSafety) throw new Error('Web safety is not available in this window');
    return window.vex.webSafety;
  },

  // The origin of the page in front, or '' when it is not a website.
  currentOrigin() {
    const tab = (typeof TabManager !== 'undefined' && typeof TabManager.getActiveTab === 'function') ? TabManager.getActiveTab() : null;
    try { const u = new URL(tab && tab.url); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
  },

  async toggleCurrent() {
    const origin = this.currentOrigin();
    if (!origin) throw new Error('Paranoid mode is for a website. Open one first.');
    const state = await this._api().get();
    const on = !state.paranoid.includes(origin);
    await this._api().setParanoid(origin, on);
    window.showToast?.(on
      ? 'Paranoid mode is on for ' + origin + '. Reload the page for it to apply fully.'
      : 'Paranoid mode is off for ' + origin + '.');
    return on;
  },

  async open() {
    document.querySelector('.vex-websafety-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const icon = (n) => (typeof VexIcons !== 'undefined' && VexIcons.svg ? VexIcons.svg(n, { size: 14 }) : '');
    const overlay = document.createElement('div');
    overlay.className = 'vex-websafety-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.4);display:grid;place-items:start center;padding-top:7vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Web safety" style="width:min(640px,94vw);max-height:82vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,.45));overflow:hidden;color:var(--text)">
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <div style="flex:1"><div style="font-size:13.5px;font-weight:650">Web safety</div>
            <div style="font-size:11px;color:var(--text-muted)">Lookalike addresses, risky downloads, sites that ask for too much. All checked on this computer; nothing is looked up.</div></div>
          <button data-close aria-label="Close" style="background:none;border:0;color:var(--text-muted);cursor:pointer">${icon('x')}</button>
        </div>
        <div data-body style="overflow-y:auto;padding:12px 14px;font-size:12.5px"></div>
      </div>`;
    const bodyEl = overlay.querySelector('[data-body]');
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-close]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id: 'web-safety-ui' });

    const btn = 'background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;color:var(--text);cursor:pointer;font:inherit;font-size:11.5px';
    const list = (items, kind, empty) => items.length
      ? items.map(v => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</span><button data-forget="${kind}" data-value="${esc(v)}" style="${btn}">Remove</button></div>`).join('')
      : `<div style="color:var(--text-muted);padding:4px 0">${esc(empty)}</div>`;

    const draw = (state) => {
      const here = this.currentOrigin();
      bodyEl.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px">How often Vex warns</div>
        ${this.LEVELS.map(l => `
          <label style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;cursor:pointer">
            <input type="radio" name="ws-level" value="${l.id}" ${state.sensitivity === l.id ? 'checked' : ''} style="margin-top:3px">
            <span><b>${esc(l.label)}</b><br><span style="color:var(--text-muted);font-size:11.5px">${esc(l.text)}</span></span>
          </label>`).join('')}
        <div style="font-weight:600;margin:16px 0 6px">Check an address</div>
        <div style="display:flex;gap:8px"><input data-check type="text" placeholder="paypa1.com" aria-label="Address to check" class="set-input" style="flex:1"><button data-check-go style="${btn}">Check</button></div>
        <div data-check-out style="margin-top:6px;color:var(--text-muted);font-size:11.5px"></div>
        <div style="font-weight:600;margin:16px 0 6px">Paranoid sites</div>
        <div style="color:var(--text-muted);font-size:11.5px;margin-bottom:6px">For a site you do not trust: no cookies are sent to or accepted from other sites it loads, WebRTC does not reveal your network address, it is never asked to use camera, microphone or location, and it cannot open windows.</div>
        ${list(state.paranoid, 'paranoid', 'No site is in paranoid mode.')}
        <div style="margin-top:6px"><button data-toggle-here style="${btn}" ${here ? '' : 'disabled'}>${here ? (state.paranoid.includes(here) ? 'Turn paranoid mode off for ' : 'Turn paranoid mode on for ') + esc(here) : 'Open a website to switch it on'}</button></div>
        <div style="font-weight:600;margin:16px 0 6px">Sites you said not to warn about</div>
        ${list(state.allow, 'allow', 'None.')}`;
      bodyEl.querySelectorAll('input[name="ws-level"]').forEach(r => r.addEventListener('change', async () => {
        try { draw(await this._api().setSensitivity(r.value)); } catch (err) { window.showToast?.(err.message, 'error'); }
      }));
      const out = bodyEl.querySelector('[data-check-out]');
      const go = async () => {
        const v = bodyEl.querySelector('[data-check]').value.trim();
        if (!v) return;
        try {
          const r = await this._api().check(v);
          out.innerHTML = r.flagged
            ? `<b style="color:var(--vex-danger,#b4232a)">Flagged.</b> ${esc(r.line)}<ul style="margin:4px 0 0;padding-left:18px">${(r.reasons || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
            : `${esc(r.host)} looks like itself: no known site is imitated by this name.`;
        } catch (err) { out.textContent = err.message; }
      };
      bodyEl.querySelector('[data-check-go]').addEventListener('click', go);
      bodyEl.querySelector('[data-check]').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      bodyEl.querySelector('[data-toggle-here]').addEventListener('click', async () => {
        try { await this.toggleCurrent(); draw(await this._api().get()); } catch (err) { window.showToast?.(err.message, 'error'); }
      });
      bodyEl.querySelectorAll('[data-forget]').forEach(b => b.addEventListener('click', async () => {
        try {
          const api = this._api();
          draw(b.dataset.forget === 'paranoid' ? await api.setParanoid(b.dataset.value, false) : await api.forgetHost(b.dataset.value));
        } catch (err) { window.showToast?.(err.message, 'error'); }
      }));
    };
    try { draw(await this._api().get()); }
    catch (err) { bodyEl.textContent = err.message; }
    return overlay;
  },
};

if (typeof window !== 'undefined') window.WebSafetyUI = WebSafetyUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { WebSafetyUI };
