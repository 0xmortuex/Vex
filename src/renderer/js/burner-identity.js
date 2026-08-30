// === Vex Burner Identity ===
// One click for a throwaway online identity: an off-the-record container (its own
// in-memory cookie jar, wiped on close), optionally routed through Tor, opened on
// a disposable-email service — so a sketchy signup never ties back to you. Composes
// Vex's OTR partitions + per-container Tor routing + a temp-mail site.
const BurnerIdentity = {
  MAIL: [
    { name: 'Temp Mail', url: 'https://temp-mail.org/' },
    { name: 'Mailinator', url: 'https://www.mailinator.com/' },
    { name: 'Guerrilla Mail', url: 'https://www.guerrillamail.com/' },
  ],

  open() {
    document.getElementById('vex-burner')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-burner';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    const chip = "padding:7px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px;font-family:'Outfit',sans-serif";
    const prim = "padding:9px 16px;background:var(--primary,var(--accent,#d4a574));color:#111;border:1px solid transparent;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif";
    m.innerHTML = `<div style="width:440px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,0.5);color:var(--text)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:15px;font-weight:700;flex:1">🔥 Burner identity</span><button id="bi-close" style="${chip}">✕</button></div>
      <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:14px">Opens a disposable-email site in a fresh <b>off-the-record</b> container (cookies vanish when you close it) — so you can sign up for something without it tying back to you.</div>
      <div style="font-size:12px;margin-bottom:6px">Disposable email service:</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        ${this.MAIL.map((s, i) => `<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer"><input type="radio" name="bi-mail" value="${i}" ${i === 0 ? 'checked' : ''}> ${window.escapeHtml ? window.escapeHtml(s.name) : s.name}</label>`).join('')}
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:16px;cursor:pointer"><input type="checkbox" id="bi-tor"> 🧅 Route it through Tor too (slower, maximum anonymity)</label>
      <div id="bi-msg" style="font-size:11.5px;color:var(--text-muted);min-height:16px;margin-bottom:10px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button id="bi-close2" style="${chip}">Cancel</button><button id="bi-go" style="${prim}">🔥 Start burner</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    const close = () => m.remove();
    m.querySelector('#bi-close').addEventListener('click', close);
    m.querySelector('#bi-close2').addEventListener('click', close);
    const msg = (t) => { const e = m.querySelector('#bi-msg'); if (e) e.textContent = t; };
    m.querySelector('#bi-go').addEventListener('click', async () => {
      const idx = parseInt((m.querySelector('input[name=bi-mail]:checked') || {}).value || '0', 10);
      const useTor = m.querySelector('#bi-tor').checked;
      const svc = this.MAIL[idx] || this.MAIL[0];
      const part = 'otr-burner-' + Date.now().toString(36);
      try {
        if (useTor) {
          msg('Connecting to Tor…');
          const r = await window.vex.routingSet(part, 'tor');
          if (!r || !r.ok) { msg('Tor unavailable — starting without it.'); }
        }
        TabManager.createTab(svc.url, true, null, { partition: part });
        window.showToast?.('🔥 Burner session opened' + (useTor ? ' over Tor' : '') + ' — grab a disposable address');
        close();
      } catch (e) { msg('Failed: ' + (e && e.message)); }
    });
  },
};

if (typeof window !== 'undefined') window.BurnerIdentity = BurnerIdentity;
