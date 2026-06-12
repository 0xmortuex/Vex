// === Vex Screenshot Tool ===

const ScreenshotTool = {
  async capture() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab to capture'); return; }

    try {
      const image = await wv.capturePage();
      if (!image || image.isEmpty()) { window.showToast?.('Screenshot failed'); return; }
      const dataUrl = image.toDataURL();
      this.showPreview(dataUrl);
    } catch (e) {
      window.showToast?.('Screenshot error: ' + e.message);
    }
  },

  showPreview(dataUrl) {
    let overlay = document.getElementById('screenshot-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'screenshot-overlay';
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="screenshot-preview">
        <img src="${dataUrl}" alt="Screenshot">
        <div class="screenshot-actions">
          <button class="ss-annotate">✏️ Annotate</button>
          <button class="ss-save">Save</button>
          <button class="ss-copy">Copy</button>
          <button class="ss-close">Close</button>
        </div>
      </div>
    `;
    overlay.classList.add('visible');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hidePreview(); });

    overlay.querySelector('.ss-annotate')?.addEventListener('click', () => {
      this.hidePreview();
      this.annotate(dataUrl);
    });

    overlay.querySelector('.ss-save')?.addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `vex-screenshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)}.png`;
      a.click();
      this.hidePreview();
      window.showToast?.('Screenshot saved');
    });

    overlay.querySelector('.ss-copy')?.addEventListener('click', async () => {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        window.showToast?.('Copied to clipboard');
      } catch {
        window.showToast?.('Copy failed');
      }
      this.hidePreview();
    });

    overlay.querySelector('.ss-close')?.addEventListener('click', () => this.hidePreview());
  },

  hidePreview() {
    document.getElementById('screenshot-overlay')?.classList.remove('visible');
  },

  // Canvas annotation editor: pen / rectangle / arrow + color, then save/copy.
  annotate(dataUrl) {
    document.getElementById('vex-annotate')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'vex-annotate';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,0.78);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px';
    wrap.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 12px">
        <button data-tool="pen" class="an-tool" style="font-family:'Outfit',sans-serif">✏️ Pen</button>
        <button data-tool="rect" class="an-tool" style="font-family:'Outfit',sans-serif">▭ Box</button>
        <button data-tool="arrow" class="an-tool" style="font-family:'Outfit',sans-serif">➜ Arrow</button>
        <input type="color" id="an-color" value="#ef4444" style="width:30px;height:30px;border:none;background:none;cursor:pointer">
        <span style="width:1px;height:20px;background:var(--border)"></span>
        <button id="an-undo" style="font-family:'Outfit',sans-serif">↩ Undo</button>
        <button id="an-save" style="font-family:'Outfit',sans-serif;background:var(--primary);color:#fff;border:none;border-radius:7px;padding:6px 14px;cursor:pointer">Save</button>
        <button id="an-copy" style="font-family:'Outfit',sans-serif">Copy</button>
        <button id="an-close" style="font-family:'Outfit',sans-serif">✕</button>
      </div>
      <canvas id="an-canvas" style="max-width:92vw;max-height:80vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.6);cursor:crosshair"></canvas>`;
    wrap.querySelectorAll('.an-tool,#an-undo,#an-copy,#an-close').forEach(b => {
      b.style.cssText += ';background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px 10px;cursor:pointer;font-size:12.5px';
    });
    document.body.appendChild(wrap);

    const canvas = wrap.querySelector('#an-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    let tool = 'pen', drawing = false, sx = 0, sy = 0, history = [];
    img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); snapshot(); };
    img.src = dataUrl;
    const snapshot = () => { history.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); if (history.length > 25) history.shift(); };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
    const setTool = (t) => { tool = t; wrap.querySelectorAll('.an-tool').forEach(b => b.style.outline = b.dataset.tool === t ? '2px solid var(--primary)' : 'none'); };
    wrap.querySelectorAll('.an-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    setTool('pen');

    canvas.addEventListener('mousedown', (e) => {
      drawing = true; const p = pos(e); sx = p.x; sy = p.y;
      ctx.strokeStyle = wrap.querySelector('#an-color').value;
      ctx.lineWidth = Math.max(3, canvas.width / 400); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (tool === 'pen') { ctx.beginPath(); ctx.moveTo(sx, sy); }
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      if (tool === 'pen') { ctx.lineTo(p.x, p.y); ctx.stroke(); }
      else {
        ctx.putImageData(history[history.length - 1], 0, 0);
        ctx.beginPath();
        if (tool === 'rect') ctx.strokeRect(sx, sy, p.x - sx, p.y - sy);
        else { // arrow
          ctx.moveTo(sx, sy); ctx.lineTo(p.x, p.y);
          const ang = Math.atan2(p.y - sy, p.x - sx), L = Math.max(12, canvas.width / 70);
          ctx.lineTo(p.x - L * Math.cos(ang - 0.45), p.y - L * Math.sin(ang - 0.45));
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - L * Math.cos(ang + 0.45), p.y - L * Math.sin(ang + 0.45));
          ctx.stroke();
        }
      }
    });
    const end = () => { if (drawing) { drawing = false; snapshot(); } };
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    wrap.querySelector('#an-undo').addEventListener('click', () => {
      if (history.length > 1) { history.pop(); ctx.putImageData(history[history.length - 1], 0, 0); }
    });
    wrap.querySelector('#an-save').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `vex-annotated-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      a.click(); wrap.remove(); window.showToast?.('Annotated screenshot saved');
    });
    wrap.querySelector('#an-copy').addEventListener('click', () => {
      canvas.toBlob(async (blob) => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); window.showToast?.('Copied'); } catch {}
        wrap.remove();
      });
    });
    wrap.querySelector('#an-close').addEventListener('click', () => wrap.remove());
  }
};
