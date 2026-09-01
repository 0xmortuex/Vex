// === Vex Site Identity — what this page sees about the browser ===
// A diagnostic for "unsupported browser" / bot-check failures. It reads, from
// the ACTIVE page's own world, the signals sites use to decide whether Vex is a
// real Chrome — user-agent, userAgentData brands, window.chrome, navigator.
// webdriver, WebGL vendor — and shows them with a PASS/FAIL compatibility
// verdict so a site-compat problem is a five-second look instead of a trace.
// Ctrl+K -> "Show This Site's Browser Identity".
const SiteIdentity = {
  // Runs in the guest's main world; Electron-privileged so it bypasses page CSP.
  _PROBE: `(async () => {
    const uad = navigator.userAgentData || null;
    let fullVersionList = [];
    try {
      if (uad) { const h = await uad.getHighEntropyValues(['fullVersionList']);
        fullVersionList = (h.fullVersionList || []).map(b => b.brand + ' ' + b.version); }
    } catch (e) {}
    let glVendor = '?', glRenderer = '?';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        glVendor = String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : 0x1F00) || '?');
        glRenderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : 0x1F01) || '?'); }
    } catch (e) {}
    return JSON.stringify({
      ua: navigator.userAgent,
      brands: uad ? uad.brands.map(b => b.brand + ' ' + b.version) : null,
      fullVersionList,
      hasGoogleChrome: uad ? uad.brands.some(b => b.brand === 'Google Chrome') : false,
      chrome: typeof window.chrome,
      chromeRuntime: !!(window.chrome && window.chrome.runtime),
      webdriver: navigator.webdriver === true,
      platform: navigator.platform,
      languages: (navigator.languages || []).join(', '),
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      glVendor, glRenderer
    });
  })()`,

  async open() {
    let wv = null, url = '';
    try {
      wv = WebviewManager.webviews.get(TabManager.activeTabId);
      const t = TabManager.getActiveTab();
      url = (wv && wv.getURL && wv.getURL()) || (t && t.url) || '';
    } catch {}
    if (!wv || !/^https?:/i.test(url)) { window.showToast?.('Open a website first'); return; }
    let d;
    try { d = JSON.parse(await wv.executeJavaScript(this._PROBE, false)); }
    catch (e) { window.showToast?.('Could not read this page'); return; }
    this._render(d, url);
  },

  // A site flags Vex as "not a real browser" when the Chrome brand is missing,
  // webdriver leaks true, or window.chrome is absent — those are the checks the
  // Adobe/Turnstile-style gates use, so they drive the verdict.
  _verdict(d) {
    const fails = [];
    if (!d.hasGoogleChrome) fails.push('userAgentData has no "Google Chrome" brand — sites like Adobe read this and reject the browser.');
    if (d.webdriver) fails.push('navigator.webdriver is true — reads as an automated/bot browser.');
    if (d.chrome !== 'object') fails.push('window.chrome is missing — some sites check it to confirm real Chrome.');
    const warns = [];
    if (!d.chromeRuntime) warns.push('window.chrome.runtime is absent (minor — most gates do not require it).');
    if (d.brands == null) warns.push('userAgentData is unavailable on this page.');
    return { pass: fails.length === 0, fails, warns };
  },

  _render(d, url) {
    document.getElementById('vex-siteident')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s ?? '')) : String(s ?? '');
    let host = url; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const v = this._verdict(d);
    const row = (k, val, ok) => `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="flex:0 0 150px;color:var(--text-muted);font-size:11.5px">${esc(k)}</span>
      <span style="flex:1;word-break:break-word;font-size:12px${ok === false ? ';color:#e5484d' : ok === true ? ';color:#30a46c' : ''}">${esc(val)}</span></div>`;

    const m = document.createElement('div');
    m.id = 'vex-siteident';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const verdictBox = v.pass
      ? `<div style="padding:11px 13px;border-radius:9px;background:rgba(48,164,108,0.12);border:1px solid rgba(48,164,108,0.4);color:#30a46c;font-weight:700;font-size:12.5px">✓ Looks like real Chrome — this site should accept Vex.</div>`
      : `<div style="padding:11px 13px;border-radius:9px;background:rgba(229,72,77,0.12);border:1px solid rgba(229,72,77,0.4);font-size:12px">
          <div style="color:#e5484d;font-weight:700;margin-bottom:5px">✕ This browser may be flagged as unsupported</div>
          ${v.fails.map(f => `<div style="color:var(--text);margin:2px 0">• ${esc(f)}</div>`).join('')}
        </div>`;
    const warnBox = v.warns.length
      ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">${v.warns.map(w => `• ${esc(w)}`).join('<br>')}</div>` : '';

    m.innerHTML = `<div style="width:600px;max-width:95vw;max-height:86vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 8px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🕵️ Browser identity · <span style="color:var(--primary,var(--accent))">${esc(host)}</span></span>
        <button id="si-copy" style="${this._chip()}">Copy</button>
        <button id="si-close" style="${this._chip()}">✕</button>
      </div>
      <div style="overflow-y:auto;padding:6px 20px 20px;color:var(--text)">
        ${verdictBox}${warnBox}
        <div style="margin-top:12px">
          ${row('User-Agent', d.ua)}
          ${row('UA brands', (d.brands || []).join('  ·  ') || '(none)', d.hasGoogleChrome)}
          ${row('Full version list', (d.fullVersionList || []).join('  ·  ') || '(none)')}
          ${row('"Google Chrome" brand', d.hasGoogleChrome ? 'present' : 'MISSING', d.hasGoogleChrome)}
          ${row('window.chrome', d.chrome + (d.chromeRuntime ? ' · runtime present' : ' · no runtime'), d.chrome === 'object')}
          ${row('navigator.webdriver', String(d.webdriver), !d.webdriver)}
          ${row('Platform', d.platform)}
          ${row('Languages', d.languages)}
          ${row('CPU / Memory', (d.hardwareConcurrency ?? '?') + ' cores · ' + (d.deviceMemory ?? '?') + ' GB')}
          ${row('WebGL vendor', d.glVendor)}
          ${row('WebGL renderer', d.glRenderer)}
        </div>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#si-close').addEventListener('click', () => m.remove());
    const escKey = (e) => { if (e.key === 'Escape') { m.remove(); document.removeEventListener('keydown', escKey, true); } };
    document.addEventListener('keydown', escKey, true);
    m.querySelector('#si-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify({ site: host, verdict: v.pass ? 'PASS' : 'FAIL', ...d }, null, 2));
        window.showToast?.('Copied identity report'); } catch {}
    });
  },

  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },
};

if (typeof window !== 'undefined') window.SiteIdentity = SiteIdentity;
