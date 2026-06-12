// === Vex Privacy Hardening pack (renderer) ===
//
// UI for three main-process privacy features (all default OFF):
//   - Fingerprint protection (canvas/WebGL/audio farbling + navigator normalize)
//   - DNS-over-HTTPS (Cloudflare / Google / Quad9; opportunistic or strict)
//   - Tracker tally — a live shield report of what the ad/tracker blocker stopped
// Config + counters live in main.js; this module just renders the controls and
// the "Privacy Report" overlay (Ctrl+K → Privacy Report).

const PrivacyPack = {
  cfg: { farble: false, doh: 'off', dohProvider: 'cloudflare' },

  async init() {
    try { const c = await window.vex?.privacyGetConfig?.(); if (c) this.cfg = { ...this.cfg, ...c }; } catch {}
  },

  async setCfg(patch) {
    this.cfg = { ...this.cfg, ...patch };
    try { await window.vex?.privacySetConfig?.(patch); } catch {}
  },

  renderSettings(container) {
    if (!container) return;
    const c = this.cfg;
    container.innerHTML = `
      <div class="setting-toggle-row">
        <span>Fingerprint protection <span class="muted" style="font-size:11px">— randomize canvas / WebGL / audio so sites can't fingerprint you</span></span>
        <label class="toggle"><input type="checkbox" id="priv-farble" ${c.farble ? 'checked' : ''}><span class="toggle-slider"></span></label>
      </div>
      <p class="setting-info muted" style="margin:4px 0 12px;font-size:11px">Applies to pages you open <em>after</em> toggling. A few canvas-heavy apps (some games, design tools) may look slightly off — turn back off if so.</p>

      <div class="setting-row-label">DNS-over-HTTPS (encrypt your DNS lookups)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <select id="priv-doh">
          <option value="off" ${c.doh === 'off' ? 'selected' : ''}>Off (use system DNS)</option>
          <option value="auto" ${c.doh === 'auto' ? 'selected' : ''}>On — opportunistic (safe)</option>
          <option value="strict" ${c.doh === 'strict' ? 'selected' : ''}>On — strict (DoH only)</option>
        </select>
        <select id="priv-doh-provider" ${c.doh === 'off' ? 'disabled' : ''}>
          <option value="cloudflare" ${c.dohProvider === 'cloudflare' ? 'selected' : ''}>Cloudflare (1.1.1.1)</option>
          <option value="google" ${c.dohProvider === 'google' ? 'selected' : ''}>Google (8.8.8.8)</option>
          <option value="quad9" ${c.dohProvider === 'quad9' ? 'selected' : ''}>Quad9 (9.9.9.9)</option>
        </select>
      </div>
      <p class="setting-info muted" style="margin:6px 0 12px;font-size:11px">“Strict” is hardest but can break some public Wi-Fi sign-in pages. Applies immediately, browser-wide.</p>

      <button id="priv-report" style="padding:8px 16px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">🛡 Privacy Report</button>`;

    container.querySelector('#priv-farble').addEventListener('change', (e) => {
      this.setCfg({ farble: e.target.checked });
      window.showToast?.(e.target.checked ? '🛡 Fingerprint protection on (new pages)' : 'Fingerprint protection off');
    });
    const dohSel = container.querySelector('#priv-doh');
    const provSel = container.querySelector('#priv-doh-provider');
    dohSel.addEventListener('change', (e) => {
      provSel.disabled = e.target.value === 'off';
      this.setCfg({ doh: e.target.value });
      window.showToast?.(e.target.value === 'off' ? 'DNS-over-HTTPS off' : '🔒 DNS-over-HTTPS ' + (e.target.value === 'strict' ? '(strict)' : '(opportunistic)'));
    });
    provSel.addEventListener('change', (e) => { this.setCfg({ dohProvider: e.target.value }); window.showToast?.('DoH provider: ' + e.target.value); });
    container.querySelector('#priv-report').addEventListener('click', () => this.showReport());
  },

  async showReport() {
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    let stats = { total: 0, byHost: [] };
    try { stats = (await window.vex?.privacyTrackerStats?.()) || stats; } catch {}
    document.getElementById('vex-privacy-report')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-privacy-report';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const rows = stats.byHost.slice(0, 25).map(t => `<div style="display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid var(--border);font-size:12.5px"><span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.host)}</span><span style="color:var(--primary);font-weight:700;font-family:'JetBrains Mono',monospace">${t.count}</span></div>`).join('') || '<div style="color:var(--text-muted);font-size:12.5px;padding:8px 0">Nothing blocked yet this session.</div>';
    const dohLabel = this.cfg.doh === 'off' ? 'Off' : (this.cfg.doh === 'strict' ? 'Strict — ' + this.cfg.dohProvider : 'On — ' + this.cfg.dohProvider);
    m.innerHTML = `<div style="width:440px;max-width:94vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="padding:18px 20px 12px">
          <div style="font-size:17px;font-weight:700;color:var(--text)">🛡 Privacy Report</div>
          <div style="display:flex;gap:18px;margin-top:14px">
            <div style="flex:1;background:var(--bg);border-radius:11px;padding:12px"><div style="font-size:26px;font-weight:800;color:var(--primary);font-family:'JetBrains Mono',monospace">${stats.total}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">trackers &amp; ads blocked<br>this session</div></div>
            <div style="flex:1;background:var(--bg);border-radius:11px;padding:12px"><div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:4px">Fingerprint</div><div style="font-size:12px;color:${this.cfg.farble ? '#22c55e' : 'var(--text-muted)'}">${this.cfg.farble ? '● Protected' : '○ Off'}</div><div style="font-size:13px;font-weight:700;color:var(--text);margin:8px 0 4px">DNS</div><div style="font-size:12px;color:${this.cfg.doh !== 'off' ? '#22c55e' : 'var(--text-muted)'}">${this.cfg.doh !== 'off' ? '● ' : '○ '}${esc(dohLabel)}</div></div>
          </div>
        </div>
        <div style="padding:4px 20px 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);font-weight:700">Top blocked domains</div>
        <div style="padding:0 20px;overflow-y:auto;flex:1">${rows}</div>
        <div style="padding:14px 20px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
          <button id="pr-reset" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Reset counters</button>
          <button id="pr-close" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Done</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#pr-close').addEventListener('click', close);
    m.querySelector('#pr-reset').addEventListener('click', async () => { try { await window.vex?.privacyTrackerReset?.(); } catch {} close(); window.showToast?.('Tracker counters reset'); });
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
  },
};

if (typeof window !== 'undefined') window.PrivacyPack = PrivacyPack;
if (typeof module !== 'undefined' && module.exports) module.exports = { PrivacyPack };
