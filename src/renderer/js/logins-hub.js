// === Vex Logins & Codes hub ===
// One place to see the three autofill systems that were scattered before: saved
// passwords (vault), authenticator 2FA (TOTP), and email-code autofill — each
// with its status and per-site reliability from the autofill log. Opens from
// Ctrl+K → "Logins & Codes".
const LoginsHub = {
  async open() {
    document.getElementById('vex-loginshub')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-loginshub';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:600px;max-width:95vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🔐 Logins &amp; Codes</span>
        <button id="lh-refresh" style="${this._chip()}">↻</button>
        <button id="lh-close" style="${this._chip()}">✕</button>
      </div>
      <div id="lh-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)">Loading…</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#lh-close').addEventListener('click', () => m.remove());
    m.querySelector('#lh-refresh').addEventListener('click', () => this._paint(m));
    this._paint(m);
  },

  _chip() { return "padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif"; },

  _hiddenReaderOn() { try { return localStorage.getItem('vex.emailCodeHiddenReader') === '1'; } catch { return false; } },

  _gmailStatus() {
    try {
      const isGmail = (s) => /(^|\/\/)mail\.google\.com/i.test(s || '');
      const tab = (TabManager.tabs || []).find(t => isGmail(t.url) || isGmail(t.originalUrl));
      if (!tab) {
        if (this._hiddenReaderOn()) return { level: 'ok', text: 'Reading codes from a hidden background Gmail — no tab needed.' };
        return { level: 'off', text: 'No Gmail tab open — open Gmail, or turn on the hidden reader below.' };
      }
      const kept = TabManager._isKeptAwake && TabManager._isKeptAwake(tab);
      const live = WebviewManager.webviews.has(tab.id);
      if (kept && live) return { level: 'ok', text: 'Gmail is open and kept awake — codes will fill automatically.', tab };
      if (kept) return { level: 'warn', text: 'Gmail is kept awake but not loaded yet — it will materialize.', tab };
      return { level: 'warn', text: 'Gmail is open but can still sleep — keep it awake for reliable code autofill.', tab };
    } catch { return { level: 'off', text: 'No Gmail tab open.' }; }
  },

  async _paint(m) {
    const body = m.querySelector('#lh-body'); if (!body) return;
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    let passwords = [], totp = [];
    try { passwords = (await window.vex.vaultList()) || []; } catch {}
    try { totp = (await window.vex.totpList()) || []; } catch {}
    const stats = (window.AutofillLog && window.AutofillLog.stats()) || { byKind: {}, byHost: {} };
    const rate = (k) => { const s = stats.byKind[k]; return s && s.fills ? Math.round(100 * s.ok / s.fills) + '% · ' + s.fills : '—'; };

    // --- Email codes ---
    const g = this._gmailStatus();
    const dot = { ok: '#4caf50', warn: '#e8a13a', off: '#e5556a' }[g.level];
    let html = `<div style="margin:8px 0 4px;font-weight:700">📧 Email-code autofill <span style="font-size:11px;color:var(--text-muted);font-weight:400">· fills verification codes from your open Gmail</span></div>
      <div style="display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--bg);margin-bottom:6px">
        <span style="width:9px;height:9px;border-radius:50%;background:${dot};flex-shrink:0"></span>
        <span style="flex:1">${esc(g.text)}</span>
        ${g.level === 'off'
          ? `<button id="lh-open-gmail" style="${this._chip()}">Open Gmail</button>`
          : (g.level === 'warn' ? `<button id="lh-keep-gmail" style="${this._chip()}">☕ Keep awake</button>` : '')}
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);margin-bottom:4px;cursor:pointer">
        <input type="checkbox" id="lh-hidden-reader" ${this._hiddenReaderOn() ? 'checked' : ''} style="cursor:pointer">
        Read codes even without a Gmail tab open <span style="color:var(--text-muted)">· uses a hidden background Gmail (your signed-in session)</span>
      </label>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Autofill success: ${rate('emailcode')} attempts logged.</div>`;

    // --- Passwords ---
    html += `<div style="margin:8px 0 4px;font-weight:700">🔑 Saved passwords <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${passwords.length} · fills auto on matching sites</span></div>`;
    if (passwords.length) {
      html += '<div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:9px;margin-bottom:6px">' +
        passwords.slice(0, 60).map(p => `<div style="display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border)">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.host || p.site || '')}</span>
          <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%">${esc(p.username || '')}</span>
        </div>`).join('') + '</div>';
    } else html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">None yet — Vex offers to save when you log in.</div>`;
    html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Autofill success: ${rate('password')} · <a id="lh-manage-pw" style="color:var(--primary,var(--accent));cursor:pointer">Manage in Settings</a></div>`;

    // --- Authenticator (2FA) ---
    html += `<div style="margin:8px 0 4px;font-weight:700">🔢 Authenticator (2FA) <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${totp.length} · fills the 6-digit code on matching sites</span></div>`;
    if (totp.length) {
      html += '<div style="max-height:130px;overflow-y:auto;border:1px solid var(--border);border-radius:9px;margin-bottom:6px">' +
        totp.slice(0, 60).map(a => `<div style="display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border)">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.issuer || a.label || 'Account')}</span>
          <span style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%">${esc(a.issuer ? (a.label || '') : '')}</span>
        </div>`).join('') + '</div>';
    } else html += `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">None yet — add accounts in the Authenticator panel (scan a QR or paste a key).</div>`;
    html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">Autofill success: ${rate('totp')} · <a id="lh-open-auth" style="color:var(--primary,var(--accent));cursor:pointer">Open Authenticator</a></div>`;

    // --- Recent activity ---
    const recent = (window.AutofillLog && window.AutofillLog.all().slice(0, 8)) || [];
    if (recent.length) {
      const icon = { password: '🔑', totp: '🔢', emailcode: '📧' };
      // Plain-language explanation for the logged miss reasons, so a failure
      // says WHY (and what to do) instead of just "failed".
      const why = {
        'no-gmail': 'no Gmail open',
        'gmail-not-loaded': 'Gmail still loading',
        'inbox-empty': 'inbox empty',
        'no-code-arrived': 'no code arrived',
        'no-new-code': 'no new code',
      };
      html += `<div style="margin:8px 0 4px;font-weight:700">📊 Recent autofill activity</div>` +
        recent.map(e => `<div style="display:flex;gap:8px;padding:4px 2px;font-size:12px">
          <span>${icon[e.kind] || '•'}</span>
          <span style="flex:1;color:var(--text)">${esc(e.host)}</span>
          <span style="color:${e.ok ? '#4caf50' : '#e5556a'}">${e.ok ? 'filled' : ('failed' + (e.detail ? ' · ' + esc(why[e.detail] || e.detail) : ''))}</span>
          <span style="color:var(--text-muted)">${this._ago(e.t)}</span>
        </div>`).join('');
    }

    body.innerHTML = html;
    // Wire actions
    body.querySelector('#lh-hidden-reader')?.addEventListener('change', (e) => { try { localStorage.setItem('vex.emailCodeHiddenReader', e.target.checked ? '1' : '0'); } catch {} this._paint(m); });
    body.querySelector('#lh-open-gmail')?.addEventListener('click', () => { try { TabManager.createTab('https://mail.google.com/', true); } catch {} m.remove(); });
    body.querySelector('#lh-keep-gmail')?.addEventListener('click', () => { if (g.tab) { try { TabManager._showKeepAwakeChooser(g.tab); } catch {} } });
    body.querySelector('#lh-manage-pw')?.addEventListener('click', () => { try { SettingsUI.openSection ? SettingsUI.openSection('passwords-panel-content') : SidebarManager.openPanel('settings'); } catch { try { SidebarManager.openPanel('settings'); } catch {} } m.remove(); });
    body.querySelector('#lh-open-auth')?.addEventListener('click', () => { try { SidebarManager.openPanel('authenticator'); } catch {} m.remove(); });
  },

  _ago(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    return Math.round(s / 86400) + 'd';
  },
};

if (typeof window !== 'undefined') window.LoginsHub = LoginsHub;
