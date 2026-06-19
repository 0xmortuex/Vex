// === Vex Tor Session — maximum-security private tab over Tor ===
//
// Like an Off-the-Record/private tab, but every request (and DNS lookup) is
// routed through a local Tor SOCKS5 proxy, WebRTC is disabled, all site
// permissions are denied, and the session is in-memory (wiped on close). Vex
// doesn't bundle Tor — it connects to a Tor that's already running locally
// (Tor Browser exposes one on port 9150; a tor service uses 9050). If none is
// found we guide the user to start Tor Browser. Opened from the onion button in
// the top-right toolbar.

const TorSession = {
  VERIFY_URL: 'https://check.torproject.org/',

  async open() {
    let r;
    try { r = await window.vex?.createTor?.(); } catch { r = null; }
    if (r && r.ok && r.partition) {
      try {
        TabManager.createTab(this.VERIFY_URL, true, null, { partition: r.partition });
        window.showToast?.(`🧅 Tor session via 127.0.0.1:${r.port} — verifying…`);
      } catch { window.showToast?.('Could not open Tor tab', 'error'); }
      return;
    }
    this._guide(r);
  },

  _guide(r) {
    document.getElementById('vex-tor-guide')?.remove();
    const reason = r && r.reason === 'error'
      ? `Something went wrong starting the Tor session${r.error ? ` (${this._esc(r.error)})` : ''}.`
      : 'Vex couldn’t find Tor running on this machine.';
    const m = document.createElement('div');
    m.id = 'vex-tor-guide';
    m.style.cssText = 'position:fixed;inset:0;z-index:100060;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:460px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.55);padding:22px">
      <div style="font-size:16px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px;margin-bottom:6px">🧅 Tor session</div>
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.55;margin-bottom:14px">
        ${reason}<br><br>
        The easiest way: open <b>Tor Browser</b> and leave it running — it exposes Tor on port <b>9150</b>. Or run the <b>tor</b> service (port 9050). Then click Retry. Vex will route a fully isolated, WebRTC-disabled tab through it.
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <a href="#" id="tor-get" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;text-decoration:none;font-size:12.5px">Get Tor Browser</a>
        <button id="tor-retry" style="padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12.5px">Retry</button>
        <button id="tor-cancel" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:12.5px">Close</button>
      </div></div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelector('#tor-cancel').addEventListener('click', close);
    m.querySelector('#tor-get').addEventListener('click', (e) => {
      e.preventDefault();
      try { TabManager.createTab('https://www.torproject.org/download/', true); } catch {}
      close();
    });
    m.querySelector('#tor-retry').addEventListener('click', () => { close(); this.open(); });
  },

  _esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; },
};

if (typeof window !== 'undefined') window.TorSession = TorSession;
if (typeof module !== 'undefined' && module.exports) module.exports = { TorSession };
