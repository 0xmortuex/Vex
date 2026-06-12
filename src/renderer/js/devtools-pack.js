// === Vex Developer Tools pack ===
//
// JsonApiViewer — a built-in REST client + JSON formatter. Send any GET/POST/…
//   request (CORS-free, via main's api:request) and browse the response as a
//   collapsible, syntax-coloured tree; or "Format JSON" the current raw-JSON tab.
// ResponsivePreview — Polypane-lite: the current page rendered side-by-side at
//   several device widths in one overlay, so you can eyeball responsive layouts.

const JsonApiViewer = {
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },

  // --- Collapsible, coloured JSON tree ---
  renderValue(v, key) {
    const kHtml = key != null ? `<span style="color:#7dd3fc">${this.esc(key)}</span>: ` : '';
    if (v === null) return `<div>${kHtml}<span style="color:#fca5a5">null</span></div>`;
    const t = typeof v;
    if (t === 'number' || t === 'boolean') return `<div>${kHtml}<span style="color:#fbbf24">${this.esc(v)}</span></div>`;
    if (t === 'string') return `<div>${kHtml}<span style="color:#86efac">"${this.esc(v)}"</span></div>`;
    if (Array.isArray(v)) {
      if (!v.length) return `<div>${kHtml}<span style="color:var(--text-muted)">[]</span></div>`;
      const inner = v.map((x, i) => this.renderValue(x, i)).join('');
      return `<details open style="margin-left:12px"><summary style="cursor:pointer;list-style:none">${kHtml}<span style="color:var(--text-muted)">[${v.length}]</span></summary><div style="border-left:1px solid var(--border);margin-left:4px;padding-left:8px">${inner}</div></details>`;
    }
    if (t === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) return `<div>${kHtml}<span style="color:var(--text-muted)">{}</span></div>`;
      const inner = keys.map(k => this.renderValue(v[k], k)).join('');
      return `<details open style="margin-left:12px"><summary style="cursor:pointer;list-style:none">${kHtml}<span style="color:var(--text-muted)">{${keys.length}}</span></summary><div style="border-left:1px solid var(--border);margin-left:4px;padding-left:8px">${inner}</div></details>`;
    }
    return `<div>${kHtml}${this.esc(v)}</div>`;
  },

  async formatCurrentPage() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('Open a page first'); return; }
    let txt = '';
    try { txt = await wv.executeJavaScript('(document.body&&(document.body.innerText||document.body.textContent)||"").slice(0,5000000)'); } catch {}
    let parsed;
    try { parsed = JSON.parse(txt.trim()); } catch { window.showToast?.('This page is not raw JSON'); return; }
    this.open();
    const out = document.getElementById('api-response');
    if (out) out.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Formatted from current tab</div><div style="font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5">${this.renderValue(parsed)}</div>`;
  },

  open(prefillUrl) {
    document.getElementById('vex-api')?.remove();
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    const url = prefillUrl || (t && t.url && /^https?:/i.test(t.url) ? t.url : '');
    const m = document.createElement('div');
    m.id = 'vex-api';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:780px;max-width:95vw;height:80vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <select id="api-method" style="font-family:'JetBrains Mono',monospace;font-weight:700">
            ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(x => `<option>${x}</option>`).join('')}
          </select>
          <input id="api-url" type="text" placeholder="https://api.example.com/v1/…" value="${this.esc(url)}" spellcheck="false" style="flex:1;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;outline:none">
          <button id="api-send" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Send</button>
          <button id="api-close" style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">✕</button>
        </div>
        <div style="display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid var(--border)">
          <textarea id="api-headers" placeholder="Headers — one per line:&#10;Authorization: Bearer …&#10;Content-Type: application/json" spellcheck="false" style="flex:1;height:54px;resize:vertical;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11.5px;outline:none"></textarea>
          <textarea id="api-body" placeholder="Request body (POST/PUT)…" spellcheck="false" style="flex:1;height:54px;resize:vertical;padding:6px 9px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:11.5px;outline:none"></textarea>
        </div>
        <div id="api-status" style="padding:6px 14px;font-size:12px;color:var(--text-muted);font-family:'JetBrains Mono',monospace"></div>
        <div id="api-response" style="flex:1;overflow:auto;padding:6px 14px 16px">
          <div style="color:var(--text-muted);font-size:12.5px;padding:8px">Build a request and hit <strong>Send</strong>. JSON responses render as a collapsible tree; anything else shows raw.</div>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#api-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const urlEl = m.querySelector('#api-url');
    urlEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.send(m); });
    m.querySelector('#api-send').addEventListener('click', () => this.send(m));
    setTimeout(() => urlEl.focus(), 40);
  },

  parseHeaders(text) {
    const h = {};
    (text || '').split(/\n+/).forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k) h[k] = v; }
    });
    return h;
  },

  async send(m) {
    const url = m.querySelector('#api-url').value.trim();
    if (!url) { window.showToast?.('Enter a URL'); return; }
    const method = m.querySelector('#api-method').value;
    const headers = this.parseHeaders(m.querySelector('#api-headers').value);
    const body = m.querySelector('#api-body').value;
    const statusEl = m.querySelector('#api-status');
    const out = m.querySelector('#api-response');
    statusEl.textContent = '⏳ Sending…';
    out.innerHTML = '';
    const res = await window.vex.apiRequest({ url, method, headers, body }).catch(() => null);
    if (!res || !res.ok) { statusEl.innerHTML = `<span style="color:#fca5a5">✕ ${this.esc((res && res.error) || 'Request failed')}</span>`; return; }
    const okColor = res.status < 300 ? '#86efac' : res.status < 400 ? '#fbbf24' : '#fca5a5';
    const kb = res.size < 1024 ? res.size + ' B' : (res.size / 1024).toFixed(1) + ' KB';
    statusEl.innerHTML = `<span style="color:${okColor};font-weight:700">${res.status} ${this.esc(res.statusText)}</span> · ${res.timeMs} ms · ${kb}${res.capped ? ' (truncated)' : ''}`;
    let parsed, isJson = false;
    try { parsed = JSON.parse(res.body); isJson = true; } catch {}
    if (isJson) {
      out.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5">${this.renderValue(parsed)}</div>`;
    } else {
      out.innerHTML = `<pre style="white-space:pre-wrap;word-break:break-word;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--text);margin:0">${this.esc(res.body.slice(0, 200000))}</pre>`;
    }
  },
};

const ResponsivePreview = {
  DEVICES: [
    { name: 'iPhone SE', w: 375, h: 667 },
    { name: 'iPhone 14', w: 390, h: 844 },
    { name: 'iPad', w: 768, h: 1024 },
    { name: 'Laptop', w: 1280, h: 800 },
    { name: 'Desktop', w: 1440, h: 900 },
  ],

  open(url) {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    url = url || (t && t.url) || '';
    if (!url || !/^https?:/i.test(url)) { window.showToast?.('Open a website first'); return; }
    document.getElementById('vex-responsive')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-responsive';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:var(--bg);display:flex;flex-direction:column';
    const frames = this.DEVICES.map((d, i) => {
      const scale = d.h > 900 ? 900 / d.h : 1;
      const dispW = Math.round(d.w * scale), dispH = Math.round(d.h * scale);
      return `<div style="flex:none;display:flex;flex-direction:column;align-items:center;gap:6px">
        <div style="font-size:11.5px;color:var(--text-muted);font-family:'Outfit',sans-serif">${d.name} · ${d.w}×${d.h}</div>
        <div style="width:${dispW}px;height:${dispH}px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.25)">
          <webview data-rp="${i}" src="${this.esc(url)}" partition="persist:main" style="width:${d.w}px;height:${d.h}px;transform:scale(${scale});transform-origin:top left;border:none"></webview>
        </div></div>`;
    }).join('');
    m.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)">
        <strong style="font-size:14px;color:var(--text)">📱 Responsive Preview</strong>
        <span style="flex:1;font-size:12px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this.esc(url)}</span>
        <button id="rp-reload" style="padding:7px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px">Reload all</button>
        <button id="rp-close" style="padding:7px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px;font-weight:600">Close</button>
      </div>
      <div style="flex:1;overflow:auto;display:flex;gap:26px;padding:24px;align-items:flex-start">${frames}</div>`;
    document.body.appendChild(m);
    m.querySelector('#rp-close').addEventListener('click', () => m.remove());
    m.querySelector('#rp-reload').addEventListener('click', () => m.querySelectorAll('webview[data-rp]').forEach(w => { try { w.reload(); } catch {} }));
  },
};

if (typeof window !== 'undefined') { window.JsonApiViewer = JsonApiViewer; window.ResponsivePreview = ResponsivePreview; }
if (typeof module !== 'undefined' && module.exports) module.exports = { JsonApiViewer, ResponsivePreview };
