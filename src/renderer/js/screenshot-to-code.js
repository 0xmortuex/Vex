// === Vex Screenshot → Code ===
//
// Capture the current page (or any tab) and ask the AI to reproduce it as a
// single self-contained HTML/Tailwind/React file you can preview in a new tab or
// copy. Vision request → the Vex AI worker's "screenshot-to-code" action (needs
// the worker deployed with that action; older workers return a clear message).

const ScreenshotToCode = {
  esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; },

  async start() {
    const wv = typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null;
    if (!wv || typeof wv.capturePage !== 'function') { window.showToast?.('Open a page first'); return; }
    let dataUrl = '';
    try {
      const img = await wv.capturePage();
      const resized = (img && typeof img.resize === 'function') ? img.resize({ width: 1200 }) : img;
      dataUrl = resized.toDataURL();
    } catch (e) { window.showToast?.('Could not capture this page'); return; }
    if (!dataUrl || dataUrl.length < 100) { window.showToast?.('Capture was empty'); return; }
    this.openModal(dataUrl);
  },

  openModal(dataUrl) {
    document.getElementById('vex-s2c')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-s2c';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:760px;max-width:95vw;height:82vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5);overflow:hidden">
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)">
          <strong style="font-size:15px;color:var(--text)">🖼 Screenshot → Code</strong>
          <span style="flex:1"></span>
          <select id="s2c-fw" style="font-size:12.5px"><option value="html">Plain HTML + CSS</option><option value="tailwind">HTML + Tailwind</option><option value="react">React (CDN)</option></select>
          <button id="s2c-gen" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-weight:600">Generate</button>
          <button id="s2c-close" style="padding:8px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">✕</button>
        </div>
        <div style="display:flex;flex:1;min-height:0">
          <div style="width:230px;flex:none;border-right:1px solid var(--border);padding:12px;overflow:auto;background:var(--bg)">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Captured</div>
            <img src="${dataUrl}" style="width:100%;border:1px solid var(--border);border-radius:8px">
          </div>
          <div style="flex:1;display:flex;flex-direction:column;min-width:0">
            <div id="s2c-status" style="padding:8px 14px;font-size:12px;color:var(--text-muted);border-bottom:1px solid var(--border)">Pick a target and press Generate.</div>
            <textarea id="s2c-code" spellcheck="false" style="flex:1;resize:none;border:none;outline:none;padding:12px 14px;background:transparent;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.5" placeholder="Generated code will appear here…"></textarea>
            <div style="display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--border)">
              <button id="s2c-preview" style="padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px" disabled>Preview in new tab</button>
              <button id="s2c-copy" style="padding:8px 14px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px" disabled>Copy</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector('#s2c-close').addEventListener('click', close);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    const codeEl = m.querySelector('#s2c-code');
    const status = m.querySelector('#s2c-status');
    const previewBtn = m.querySelector('#s2c-preview');
    const copyBtn = m.querySelector('#s2c-copy');
    m.querySelector('#s2c-gen').addEventListener('click', async () => {
      const framework = m.querySelector('#s2c-fw').value;
      status.textContent = '⏳ Generating… (vision request, ~10–20s)';
      codeEl.value = '';
      previewBtn.disabled = copyBtn.disabled = true;
      try {
        const code = await this.generate(dataUrl, framework);
        codeEl.value = code;
        status.textContent = '✓ Generated — preview or tweak the code';
        previewBtn.disabled = copyBtn.disabled = false;
      } catch (err) {
        status.textContent = '✕ ' + (err.message || 'Generation failed');
      }
    });
    previewBtn.addEventListener('click', () => {
      const code = codeEl.value;
      if (!code) return;
      try { TabManager.createTab('data:text/html;charset=utf-8,' + encodeURIComponent(code), true); } catch {}
    });
    copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(codeEl.value); window.showToast?.('Code copied'); });
  },

  async generate(image, framework) {
    const url = (typeof AIRouter !== 'undefined' && AIRouter.cloudWorkerUrl && AIRouter.cloudWorkerUrl()) || '';
    if (!url) throw new Error('Cloud AI not configured (Settings → AI). Screenshot-to-code needs the cloud vision model.');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'screenshot-to-code', image, framework }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      // Older workers don't know this action.
      if (r.status === 400 && /invalid action/i.test(e.error || '')) throw new Error('Your AI worker needs updating to support screenshot-to-code (redeploy vex-ai-worker).');
      throw new Error(e.error || ('Worker returned ' + r.status));
    }
    const data = await r.json();
    if (!data.result) throw new Error('Empty response');
    return data.result;
  },
};

if (typeof window !== 'undefined') window.ScreenshotToCode = ScreenshotToCode;
if (typeof module !== 'undefined' && module.exports) module.exports = { ScreenshotToCode };
