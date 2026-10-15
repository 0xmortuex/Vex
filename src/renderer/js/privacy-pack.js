// === Vex Privacy Hardening pack (renderer) ===
//
// UI for three main-process privacy features (all default OFF):
//   - Fingerprint protection (canvas/WebGL/audio farbling + navigator normalize)
//   - DNS-over-HTTPS (Cloudflare / Google / Quad9; opportunistic or strict)
//   - Tracker tally — a live shield report of what the ad/tracker blocker stopped
// Config + counters live in main.js; this module just renders the controls and
// the "Privacy Report" overlay (Ctrl+K → Privacy Report).

const PrivacyPack = {
  cfg: { farble: false, doh: 'off', dohProvider: 'cloudflare', httpsOnly: false, gpc: true, referrer: 'default' },

  async init() {
    try { const c = await window.vex?.privacyGetConfig?.(); if (c) this.cfg = { ...this.cfg, ...c }; } catch {}
  },

  // Main's answer is the truth. The error used to be swallowed, so a private
  // window (where main refuses the change) said "HTTPS-Only mode on" while
  // nothing had changed (found 2026-09-29).
  async setCfg(patch) {
    const saved = await window.vex.privacySetConfig(patch);
    this.cfg = { ...this.cfg, ...(saved || patch) };
  },

  // Change a setting and say so; if main refused, put the control back and
  // say why.
  async _change(patch, said, control, previous) {
    try {
      await this.setCfg(patch);
      window.showToast?.(said);
    } catch (err) {
      if (control) { if (control.type === 'checkbox') control.checked = previous; else control.value = previous; }
      window.showToast?.('Not changed: ' + (err && err.message ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'Vex did not accept it'), 'error');
    }
  },

  renderSettings(container) {
    if (!container) return;
    const c = this.cfg;
    container.innerHTML = `
      <div class="setting-toggle-row">
        <span>Fingerprint protection <span class="muted" style="font-size:11px">— randomize canvas / WebGL / audio so sites can't fingerprint you</span></span>
        <label class="toggle"><input type="checkbox" id="priv-farble" aria-label="Fingerprint protection" ${c.farble ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <p class="setting-info muted" style="margin:4px 0 12px;font-size:11px">Applies to pages you open <em>after</em> toggling. A few canvas-heavy apps (some games, design tools) may look slightly off — turn back off if so.</p>

      <div class="setting-toggle-row">
        <span>HTTPS-Only mode <span class="muted" style="font-size:11px">— always try the encrypted https version of a site first</span></span>
        <label class="toggle"><input type="checkbox" id="priv-https-only" aria-label="HTTPS-Only mode" ${c.httpsOnly ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <p class="setting-info muted" style="margin:4px 0 12px;font-size:11px">Upgrades page loads from http to https. If a site genuinely has no https, Vex falls back to http for that site automatically (with a warning) so nothing breaks.</p>

      <div class="setting-toggle-row">
        <span>Global Privacy Control <span class="muted" style="font-size:11px">— tell every site you do not want your data sold or shared</span></span>
        <label class="toggle"><input type="checkbox" id="priv-gpc" aria-label="Global Privacy Control" ${c.gpc !== false ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <p class="setting-info muted" style="margin:4px 0 6px;font-size:11px">Sends one extra request header, Sec-GPC: 1, and sets navigator.globalPrivacyControl, which some laws (California, Colorado and others) make sites honour. Never in a Tor tab. Sites you list here are not sent it:</p>
      <div id="priv-gpc-sites" class="priv-sites"></div>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <input id="priv-gpc-add-host" class="set-input" style="flex:1" placeholder="example.com" aria-label="A site to leave out of Global Privacy Control">
        <button id="priv-gpc-add" class="btn-secondary" type="button">Leave it out</button>
      </div>

      <div class="setting-row-label">Referrer trimming <span class="muted" style="font-size:11px">— what the address you came from says when a link or a page loads another site</span></div>
      <div style="margin-top:6px">
        <select id="priv-referrer" aria-label="Referrer trimming">
          <option value="default" ${c.referrer === 'default' || !c.referrer ? 'selected' : ''}>Browser default</option>
          <option value="origin" ${c.referrer === 'origin' ? 'selected' : ''}>Trim to the site's name when it goes to another site</option>
          <option value="strict" ${c.referrer === 'strict' ? 'selected' : ''}>Strict: send nothing to another site, only the name within a site</option>
        </select>
      </div>
      <p class="setting-info muted" style="margin:6px 0 6px;font-size:11px">Off by default: some sign-in, payment and download-link flows check where you came from and stop working. It changes what is sent, not what a page reads in document.referrer, and not in Tor tabs. When a site breaks, use "This site needs the referrer" in its site panel, or list it here:</p>
      <div id="priv-referrer-sites" class="priv-sites"></div>
      <div style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">
        <input id="priv-referrer-add-host" class="set-input" style="flex:1" placeholder="example.com" aria-label="A site that needs the referrer">
        <button id="priv-referrer-add" class="btn-secondary" type="button">Needs the referrer</button>
      </div>

      <div class="setting-row-label">DNS-over-HTTPS (encrypt your DNS lookups)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <select id="priv-doh" aria-label="DNS-over-HTTPS">
          <option value="off" ${c.doh === 'off' ? 'selected' : ''}>Off (use system DNS)</option>
          <option value="auto" ${c.doh === 'auto' ? 'selected' : ''}>On — opportunistic (safe)</option>
          <option value="strict" ${c.doh === 'strict' ? 'selected' : ''}>On — strict (DoH only)</option>
        </select>
        <select id="priv-doh-provider" aria-label="DNS-over-HTTPS provider" ${c.doh === 'off' ? 'disabled' : ''}>
          <option value="cloudflare" ${c.dohProvider === 'cloudflare' ? 'selected' : ''}>Cloudflare (1.1.1.1)</option>
          <option value="google" ${c.dohProvider === 'google' ? 'selected' : ''}>Google (8.8.8.8)</option>
          <option value="quad9" ${c.dohProvider === 'quad9' ? 'selected' : ''}>Quad9 (9.9.9.9)</option>
        </select>
      </div>
      <p class="setting-info muted" style="margin:6px 0 12px;font-size:11px">“Strict” is hardest but can break some public Wi-Fi sign-in pages. Applies immediately, browser-wide.</p>

      <button id="priv-report" style="padding:8px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Privacy Report</button>`;

    container.querySelector('#priv-farble').addEventListener('change', (e) => {
      this._change({ farble: e.target.checked }, e.target.checked ? 'Fingerprint protection on (new pages)' : 'Fingerprint protection off', e.target, !e.target.checked);
    });
    container.querySelector('#priv-https-only').addEventListener('change', (e) => {
      this._change({ httpsOnly: e.target.checked }, e.target.checked ? 'HTTPS-Only mode on' : 'HTTPS-Only mode off', e.target, !e.target.checked);
    });
    container.querySelector('#priv-gpc').addEventListener('change', (e) => {
      this._change({ gpc: e.target.checked }, e.target.checked ? 'Global Privacy Control on' : 'Global Privacy Control off', e.target, !e.target.checked);
    });
    const refSel = container.querySelector('#priv-referrer');
    refSel.addEventListener('change', (e) => {
      const said = { default: 'Referrer: the browser default', origin: 'Referrer trimmed to the site name for other sites', strict: 'Referrer: strict' };
      this._change({ referrer: e.target.value }, said[e.target.value], e.target, this.cfg.referrer || 'default');
    });
    this._siteLists(container);
    const dohSel = container.querySelector('#priv-doh');
    const provSel = container.querySelector('#priv-doh-provider');
    dohSel.addEventListener('change', async (e) => {
      const was = this.cfg.doh;
      await this._change({ doh: e.target.value }, e.target.value === 'off' ? 'DNS-over-HTTPS off' : 'DNS-over-HTTPS ' + (e.target.value === 'strict' ? '(strict)' : '(opportunistic)'), e.target, was);
      provSel.disabled = e.target.value === 'off';
    });
    provSel.addEventListener('change', (e) => { this._change({ dohProvider: e.target.value }, 'DoH provider: ' + e.target.value, e.target, this.cfg.dohProvider); });
    container.querySelector('#priv-report').addEventListener('click', () => this.showReport());
  },

  // The two lists of sites beside the header settings are the site switches
  // 'gpc' and 'referrer' (main/site-rules.js) — the same store as the site
  // panel's, so there is one list, seen from two places.
  _siteHosts(what) {
    if (typeof SiteRulesUI === 'undefined') return [];
    return Object.entries(SiteRulesUI.rules()).filter(([, r]) => r && r[what] === 'off').map(([h]) => h).sort();
  },
  _siteLists(container) {
    const esc = (s) => window.escapeHtml(s);
    const lists = [
      { what: 'gpc', box: '#priv-gpc-sites', input: '#priv-gpc-add-host', add: '#priv-gpc-add', none: 'No site is left out.', said: 'Not sending Global Privacy Control to ' },
      { what: 'referrer', box: '#priv-referrer-sites', input: '#priv-referrer-add-host', add: '#priv-referrer-add', none: 'No site is listed.', said: 'Referrer left alone for ' },
    ];
    const guard = (fn) => async () => {
      try { await fn(); } catch (err) { window.showToast?.('Not changed: ' + (err && err.message ? err.message : 'Vex did not accept it'), 'error'); }
    };
    for (const l of lists) {
      const box = container.querySelector(l.box);
      const draw = () => {
        const hosts = this._siteHosts(l.what);
        box.innerHTML = hosts.length
          ? hosts.map(h => `<div class="setting-toggle-row" style="margin:2px 0"><span>${esc(h)}</span><button type="button" class="btn-secondary" data-host="${esc(h)}" aria-label="Remove ${esc(h)} from the list">Remove</button></div>`).join('')
          : `<div class="muted" style="font-size:11px">${l.none}</div>`;
      };
      draw();
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-host]');
        if (!b) return;
        guard(async () => { await SiteRulesUI.set('https://' + b.dataset.host + '/', l.what, false); draw(); })();
      });
      container.querySelector(l.add).addEventListener('click', guard(async () => {
        const input = container.querySelector(l.input);
        const host = String(input.value || '').trim().replace(/^https?:\/\//i, '').replace(/[/:?#].*$/, '').replace(/^www\./, '').toLowerCase();
        if (!host || !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(host)) throw new Error('Type a web address such as example.com');
        await SiteRulesUI.set('https://' + host + '/', l.what, true);
        input.value = '';
        draw();
        window.showToast?.(l.said + host);
      }));
    }
  },

  async showReport() {
    const esc = (s) => window.escapeHtml(s);
    let stats = { total: 0, byHost: [], crossSite: [] };
    try { stats = (await window.vex?.privacyTrackerStats?.()) || stats; } catch {}
    document.getElementById('vex-privacy-report')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-privacy-report';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const rows = stats.byHost.slice(0, 25).map(t => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px"><span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.host)}</span><span style="color:var(--primary);font-weight:700;font-family:'JetBrains Mono',monospace">${t.count}</span></div>`).join('') || '<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0">Nothing blocked yet this session.</div>';
    const cross = (stats.crossSite || []);
    const crossRows = cross.length ? cross.slice(0, 12).map(t => `<div style="padding:7px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px"><span style="color:var(--text);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.host)}</span><span style="color:#f97316;font-weight:700;font-family:'JetBrains Mono',monospace;flex:none">${t.siteCount} sites</span></div>
        <div style="font-size:10.5px;color:var(--text-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.sites.join(' · '))}</div></div>`).join('')
      : '<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0">No tracker has been seen across multiple sites yet — browse a bit and check back.</div>';
    const dohLabel = this.cfg.doh === 'off' ? 'Off' : (this.cfg.doh === 'strict' ? 'Strict — ' + this.cfg.dohProvider : 'On — ' + this.cfg.dohProvider);
    m.innerHTML = `<div style="width:440px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:18px 20px 12px">
          <div style="font-size:17px;font-weight:700;color:var(--text)">Privacy Report</div>
          <div style="display:flex;gap:18px;margin-top:14px">
            <div style="flex:1;background:var(--bg);border-radius:11px;padding:12px"><div style="font-size:26px;font-weight:800;color:var(--primary);font-family:'JetBrains Mono',monospace">${stats.total}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">trackers &amp; ads blocked<br>this session</div></div>
            <div style="flex:1;background:var(--bg);border-radius:11px;padding:12px"><div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">Fingerprint</div><div style="font-size:12px;color:${this.cfg.farble ? 'var(--success)' : 'var(--text-muted)'}">${this.cfg.farble ? '● Protected' : '○ Off'}</div><div style="font-size:13px;font-weight:700;color:var(--text);margin:8px 0 4px">DNS</div><div style="font-size:12px;color:${this.cfg.doh !== 'off' ? 'var(--success)' : 'var(--text-muted)'}">${this.cfg.doh !== 'off' ? '● ' : '○ '}${esc(dohLabel)}</div></div>
          </div>
        </div>
        <div style="padding:4px 20px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700">Following you across sites</div>
        <div style="padding:0 20px;max-height:30vh;overflow-y:auto">${crossRows}</div>
        <div style="padding:12px 20px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700">Top blocked domains</div>
        <div style="padding:0 20px;overflow-y:auto;flex:1">${rows}</div>
        <div style="padding:14px 20px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
          <button id="pr-reset" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Reset counters</button>
          <button id="pr-close" style="padding:8px 18px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Done</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    // Escape closes it the way Done does; it did nothing (found 2026-09-29).
    // Capture phase, so nothing underneath takes the same key; an Escape meant
    // for a Vex dialog on top is left to that dialog. Focus moves in, or with
    // the page focused the key never reached Vex at all.
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.querySelector('#pr-close').focus({ preventScroll: true });
    m.querySelector('#pr-close').addEventListener('click', close);
    m.querySelector('#pr-reset').addEventListener('click', async () => { try { await window.vex?.privacyTrackerReset?.(); } catch {} close(); window.showToast?.('Tracker counters reset'); });
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
  },
};

if (typeof window !== 'undefined') window.PrivacyPack = PrivacyPack;
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivacyPack };
