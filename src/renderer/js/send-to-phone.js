// === Vex Send to Phone ===
// Shows a QR code for a URL (the current page by default, or a right-clicked
// link) so you can open it on your phone by scanning. The QR is generated in the
// main process with the bundled `qrcode` package — offline, no external request.
// Opens from Ctrl+K → "Send to Phone", or the page/link right-click menu.
const SendToPhone = {
  async open(url) {
    if (!url) { const t = TabManager.getActiveTab && TabManager.getActiveTab(); url = t && t.url; }
    if (!url || !/^https?:\/\//i.test(url)) { window.showToast?.('Open a web page first to send it to your phone'); return; }

    document.getElementById('vex-sendphone')?.remove();
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s || '')) : String(s || '');
    const m = document.createElement('div');
    m.id = 'vex-sendphone';
    m.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:360px;max-width:92vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);padding:20px;text-align:center">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1;text-align:left">📱 Send to phone</span>
        <button id="sp-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="sp-qr" style="width:280px;height:280px;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:10px;color:#333;font-size:12px">Generating…</div>
      <div style="font-size:12px;color:var(--text-muted);word-break:break-all;margin-bottom:12px">${esc(url)}</div>
      <div style="display:flex;gap:8px;justify-content:center">
        <button id="sp-copy" style="padding:8px 14px;background:var(--primary,var(--accent));color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif">Copy link</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:12px">Scan with your phone's camera to open it there.</div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#sp-close').addEventListener('click', () => m.remove());
    m.querySelector('#sp-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); window.showToast?.('Link copied'); } catch {}
    });

    const qrBox = m.querySelector('#sp-qr');
    try {
      const dataUrl = await window.vex.qrGenerate(url);
      if (dataUrl) qrBox.innerHTML = `<img src="${esc(dataUrl)}" alt="QR code" style="width:264px;height:264px;image-rendering:pixelated">`;
      else qrBox.textContent = 'Could not generate a QR code.';
    } catch { qrBox.textContent = 'Could not generate a QR code.'; }
  },
};

if (typeof window !== 'undefined') window.SendToPhone = SendToPhone;
if (typeof module !== 'undefined' && module.exports) module.exports = { SendToPhone };
