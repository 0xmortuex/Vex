// === Vex Password Health ===
// A local, privacy-respecting audit of the saved-password vault: reused
// passwords, weak passwords, and sites that have a password but no 2FA set up.
// The analysis of the actual password values happens in the MAIN process
// (vault:health) — only findings (hosts/usernames), never passwords, reach here.
// Opens from Ctrl+K → "Password Health" or the Logins & Codes hub.
const PasswordHealth = {
  async open() {
    document.getElementById('vex-pwhealth')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-pwhealth';
    m.style.cssText = 'position:fixed;inset:0;z-index:100051;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:560px;max-width:95vw;max-height:84vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:18px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">🛡️ Password Health</span>
        <button id="pwh-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="pwh-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)">Analyzing…</div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#pwh-close').addEventListener('click', () => m.remove());
    this._paint(m);
  },

  // Strip a hostname down to its registrable-ish root for loose matching against
  // authenticator issuer names (e.g. "github.com" ~ issuer "GitHub").
  _root(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    const parts = h.split('.');
    return (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || h;
  },

  async _paint(m) {
    const body = m.querySelector('#pwh-body'); if (!body) return;
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    let health = { total: 0, reused: [], weak: [] }, list = [], totp = [];
    try { health = (await window.vex.vaultHealth()) || health; } catch {}
    try { list = (await window.vex.vaultList()) || []; } catch {}
    try { totp = (await window.vex.totpList()) || []; } catch {}

    // Sites with a saved password but no matching authenticator entry.
    const totpRoots = new Set();
    for (const a of totp) {
      const s = (a.issuer || a.label || '').toLowerCase();
      s.split(/[^a-z0-9]+/).filter(Boolean).forEach(w => totpRoots.add(w));
    }
    const seen = new Set();
    const no2fa = [];
    for (const e of list) {
      const root = this._root(e.host);
      if (seen.has(e.host)) continue; seen.add(e.host);
      if (!totpRoots.has(root)) no2fa.push(e.host);
    }

    const card = (color, title, count) => `<div style="margin:12px 0 6px;font-weight:700"><span style="color:${color}">${title}</span> <span style="font-size:11px;color:var(--text-muted);font-weight:400">· ${count}</span></div>`;
    const rowbox = (rows) => `<div style="border:1px solid var(--border);border-radius:9px;max-height:160px;overflow-y:auto">${rows}</div>`;
    const line = (left, right) => `<div style="display:flex;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border)"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${left}</span><span style="color:var(--text-muted);white-space:nowrap">${right}</span></div>`;

    let html = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${health.total} saved password${health.total === 1 ? '' : 's'} checked. Nothing here leaves your machine — the analysis runs locally.</div>`;

    // Reused
    html += card('#e5556a', '♻️ Reused passwords', (health.reused || []).length);
    if ((health.reused || []).length) {
      html += rowbox((health.reused).map(g =>
        line(g.entries.map(x => esc(x.host)).join(', '), `${g.count}× same password`)
      ).join(''));
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Give each of these a unique password — one leak shouldn't unlock the rest.</div>`;
    } else html += `<div style="font-size:12px;color:var(--text-muted)">None — every saved password is unique. 👍</div>`;

    // Weak
    html += card('#e8a13a', '⚠️ Weak passwords', (health.weak || []).length);
    if ((health.weak || []).length) {
      html += rowbox((health.weak).map(w =>
        line(esc(w.host) + (w.username ? ` <span style="color:var(--text-muted)">· ${esc(w.username)}</span>` : ''), esc((w.reasons || []).join(', ')))
      ).join(''));
    } else html += `<div style="font-size:12px;color:var(--text-muted)">None flagged — no short, digit-only, or common passwords. 👍</div>`;

    // No 2FA
    html += card('#8a8aa5', '🔑 No 2FA in Vex', no2fa.length);
    if (no2fa.length) {
      html += rowbox(no2fa.slice(0, 40).map(h => line(esc(h), 'no authenticator')).join(''));
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">You have a password saved but no authenticator code here. If the site supports 2FA, add it in the Authenticator panel.</div>`;
    } else if (list.length) {
      html += `<div style="font-size:12px;color:var(--text-muted)">Every saved login has a matching authenticator entry. 👍</div>`;
    } else {
      html += `<div style="font-size:12px;color:var(--text-muted)">No saved passwords yet.</div>`;
    }

    body.innerHTML = html;
  },
};

if (typeof window !== 'undefined') window.PasswordHealth = PasswordHealth;
if (typeof module !== 'undefined' && module.exports) module.exports = { PasswordHealth };
