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

  // The whole page, top to bottom, in one image (src/main/full-page-capture.js).
  async captureFull() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) { window.showToast?.('No active tab to capture'); return null; }
    let wcId = null;
    try { wcId = wv.getWebContentsId(); } catch {}
    if (typeof wcId !== 'number' || wcId < 0) { window.showToast?.('This page has not finished opening yet', 'error'); return null; }
    window.showToast?.('Capturing the whole page — it scrolls through once so every image loads');
    const r = await window.vex.captureFullPage(wcId);
    if (!r || !r.ok) { window.showToast?.((r && r.error) || 'Could not capture the page', 'error'); return null; }
    let out;
    try { out = await this.stitch(r); }
    catch (err) { window.showToast?.('Could not put the page together: ' + err.message, 'error'); return null; }
    if (r.cut) window.showToast?.('The page is extremely long — this is the top of it, ' + out.width + '×' + out.height);
    else if (out.scaled) window.showToast?.('The page is very long, so the image was scaled down to ' + out.width + '×' + out.height);
    this.showPreview(out.dataUrl);
    return out;
  },

  // One screenful per tile, each carrying the scroll position it was REALLY
  // taken at (the last one overlaps: a page cannot scroll past its end). Drawn
  // in order, so an overlap is simply painted over by the same pixels.
  MAX_EDGE: 16000,                    // output px, under Chromium's canvas limit
  async stitch({ tiles, width, height }) {
    if (!Array.isArray(tiles) || !tiles.length) throw new Error('nothing was captured');
    const load = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('a piece of the page would not load'));
      img.src = src;
    });
    const images = await Promise.all(tiles.map(t => load(t.dataUrl)));
    // Tiles are device pixels; positions are CSS pixels.
    const ratio = images[0].naturalWidth / width || 1;
    const scale = Math.min(1, this.MAX_EDGE / (height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio * scale);
    canvas.height = Math.round(height * ratio * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas to draw on');
    tiles.forEach((t, i) => {
      const img = images[i];
      ctx.drawImage(img, 0, Math.round(t.y * ratio * scale), Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
    });
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, scaled: scale < 1 };
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
          <button class="ss-annotate">Annotate</button>
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
  // Mark up a picture of the page: pen, highlighter, box, arrow, text, and
  // REDACT — pixelate a region so a screenshot can be shared without the
  // email address, the name or the balance that happened to be on screen.
  // Redaction replaces the pixels in the saved image; it is not a layer that
  // can be peeled off afterwards.
  TOOLS: [
    ['pen', 'Pen', 'edit'], ['highlight', 'Highlight', 'marker'], ['rect', 'Box', 'maximize'],
    ['arrow', 'Arrow', 'arrow-right'], ['text', 'Text', 'type'], ['redact', 'Redact', 'eye'],
  ],

  // Pixelate a rectangle of RGBA pixels in place: each block becomes its
  // average colour. Pure, so it can be tested without a canvas. Blocks are
  // large enough that text inside cannot be read back.
  pixelate(data, width, height, rect, block) {
    const x0 = Math.max(0, Math.floor(Math.min(rect.x, rect.x + rect.w)));
    const y0 = Math.max(0, Math.floor(Math.min(rect.y, rect.y + rect.h)));
    const x1 = Math.min(width, Math.ceil(Math.max(rect.x, rect.x + rect.w)));
    const y1 = Math.min(height, Math.ceil(Math.max(rect.y, rect.y + rect.h)));
    const size = Math.max(4, Math.round(block || 12));
    for (let by = y0; by < y1; by += size) {
      for (let bx = x0; bx < x1; bx += size) {
        const ex = Math.min(bx + size, x1), ey = Math.min(by + size, y1);
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++;
        }
        if (!n) continue;
        r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const i = (y * width + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  // Capture what is on screen and go straight to marking it up.
  async markUp() {
    const wv = WebviewManager.getActiveWebview();
    if (!wv) throw new Error('No page is open');
    const image = await wv.capturePage();
    if (!image || image.isEmpty()) throw new Error('The page could not be captured');
    return this.annotate(image.toDataURL());
  },

  // A blank page to draw on: the same editor, on white, with nothing to redact.
  whiteboard() {
    const c = document.createElement('canvas');
    c.width = this.BOARD_W; c.height = this.BOARD_H;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    return this.annotate(c.toDataURL('image/png'), { board: true });
  },
  BOARD_W: 1600,
  BOARD_H: 1000,

  annotate(dataUrl, { board = false } = {}) {
    document.getElementById('vex-annotate')?.remove();
    const icon = (name) => (window.VexIcons ? VexIcons.svg(name, { size: 14 }) : '');
    const btn = 'display:inline-flex;align-items:center;gap:5px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;padding:6px 10px;cursor:pointer;font:inherit;font-size:12.5px';
    const wrap = document.createElement('div');
    wrap.id = 'vex-annotate';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99000;background:rgba(0,0,0,0.78);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px';
    wrap.innerHTML = `
      <div role="toolbar" aria-label="Mark up" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 12px">
        ${this.TOOLS.filter(([id]) => !(board && id === 'redact')).map(([id, label, ic]) => `<button data-tool="${id}" class="an-tool" type="button" title="${label}" style="${btn}">${icon(ic)}${label}</button>`).join('')}
        <input type="color" id="an-color" value="${board ? '#1f2937' : '#ef4444'}" aria-label="Colour" style="width:30px;height:30px;border:none;background:none;cursor:pointer">
        <span style="width:1px;height:20px;background:var(--border)"></span>
        <button id="an-undo" type="button" style="${btn}">${icon('undo')}Undo</button>
        <button id="an-save" type="button" style="${btn};background:var(--primary);color:#fff;border-color:var(--primary)">${icon('save')}Save</button>
        <button id="an-copy" type="button" style="${btn}">${icon('copy')}Copy</button>
        <button id="an-close" type="button" aria-label="Close" style="${btn}">${icon('x')}</button>
      </div>
      <div id="an-hint" style="font-size:12px;color:#ddd;min-height:16px"></div>
      <canvas id="an-canvas" style="max-width:92vw;max-height:78vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.6);cursor:crosshair"></canvas>`;
    document.body.appendChild(wrap);

    const canvas = wrap.querySelector('#an-canvas');
    const ctx = canvas.getContext('2d');
    const hint = wrap.querySelector('#an-hint');
    const HINTS = {
      pen: 'Draw freely.', highlight: 'Drag across text to highlight it.', rect: 'Drag to draw a box.',
      arrow: 'Drag from where the arrow starts to what it points at.', text: 'Click where the words should go.',
      redact: 'Drag over anything private. It is pixelated in the saved image, not just covered.',
    };
    const img = new Image();
    let tool = 'pen', drawing = false, sx = 0, sy = 0;
    const history = [];
    const snapshot = () => { history.push(ctx.getImageData(0, 0, canvas.width, canvas.height)); if (history.length > 25) history.shift(); };
    img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0); snapshot(); };
    img.src = dataUrl;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
    const setTool = (t) => {
      tool = t;
      wrap.querySelectorAll('.an-tool').forEach(b => { const on = b.dataset.tool === t; b.style.outline = on ? '2px solid var(--primary)' : 'none'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      hint.textContent = HINTS[t] || '';
    };
    wrap.querySelectorAll('.an-tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    setTool('pen');
    const line = () => Math.max(3, canvas.width / 400);

    const drawShape = (p) => {
      ctx.putImageData(history[history.length - 1], 0, 0);
      ctx.save();
      ctx.strokeStyle = wrap.querySelector('#an-color').value;
      ctx.lineWidth = line(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (tool === 'rect') ctx.strokeRect(sx, sy, p.x - sx, p.y - sy);
      else if (tool === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(p.x, p.y);
        const ang = Math.atan2(p.y - sy, p.x - sx), L = Math.max(12, canvas.width / 70);
        ctx.lineTo(p.x - L * Math.cos(ang - 0.45), p.y - L * Math.sin(ang - 0.45));
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - L * Math.cos(ang + 0.45), p.y - L * Math.sin(ang + 0.45));
        ctx.stroke();
      } else if (tool === 'highlight') {
        ctx.globalAlpha = 0.35;
        const picked = wrap.querySelector('#an-color').value;
        ctx.fillStyle = (picked === '#ef4444' || picked === '#1f2937') ? '#ffe14d' : picked;   // the default pen colour highlights in yellow
        const h = Math.max(line() * 6, Math.abs(p.y - sy) || line() * 6);
        ctx.fillRect(Math.min(sx, p.x), Math.min(sy, p.y) - (Math.abs(p.y - sy) ? 0 : h / 2), Math.abs(p.x - sx), h);
      } else if (tool === 'redact') {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.strokeRect(sx, sy, p.x - sx, p.y - sy);
      }
      ctx.restore();
    };

    canvas.addEventListener('mousedown', async (e) => {
      const p = pos(e); sx = p.x; sy = p.y;
      if (tool === 'text') {
        const words = await vexPrompt({ title: 'Add text', label: 'Text', placeholder: 'This one', okLabel: 'Add' });
        if (!words) return;
        ctx.save();
        const size = Math.max(16, Math.round(canvas.width / 55));
        ctx.font = `600 ${size}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        // A dark outline keeps it readable on any background.
        ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(words, sx, sy);
        ctx.fillStyle = wrap.querySelector('#an-color').value; ctx.fillText(words, sx, sy);
        ctx.restore();
        snapshot();
        return;
      }
      drawing = true;
      if (tool === 'pen') {
        ctx.strokeStyle = wrap.querySelector('#an-color').value;
        ctx.lineWidth = line(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy);
      }
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      if (tool === 'pen') { ctx.lineTo(p.x, p.y); ctx.stroke(); }
      else drawShape(p);
    });
    const end = (e) => {
      if (!drawing) return;
      drawing = false;
      if (tool === 'redact' && e) {
        const p = pos(e);
        ctx.putImageData(history[history.length - 1], 0, 0);
        const w = p.x - sx, h = p.y - sy;
        if (Math.abs(w) > 2 && Math.abs(h) > 2) {
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          this.pixelate(frame.data, canvas.width, canvas.height, { x: sx, y: sy, w, h }, Math.max(10, canvas.width / 90));
          ctx.putImageData(frame, 0, 0);
        }
      }
      snapshot();
    };
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', (e) => { if (drawing && tool !== 'redact') end(e); });
    wrap.querySelector('#an-undo').addEventListener('click', () => {
      if (history.length > 1) { history.pop(); ctx.putImageData(history[history.length - 1], 0, 0); }
    });
    wrap.querySelector('#an-save').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `vex-${board ? 'whiteboard' : 'annotated'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      a.click(); wrap.remove(); window.showToast?.(board ? 'Whiteboard saved' : 'Marked-up picture saved');
    });
    wrap.querySelector('#an-copy').addEventListener('click', () => {
      canvas.toBlob(async (blob) => {
        // A failed copy used to be swallowed: the window closed and nothing
        // was on the clipboard. Say so, and keep the work open to save instead.
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); window.showToast?.('Copied'); wrap.remove(); }
        catch (err) { window.showToast?.('Could not copy the picture — use Save instead (' + ((err && err.message) || 'clipboard refused') + ')', 'error'); }
      });
    });
    wrap.querySelector('#an-close').addEventListener('click', async () => {
      // A whiteboard is work of its own, not a picture that can be taken again.
      if (board && history.length > 1) {
        const ok = await window.vexConfirm({ title: 'Close the whiteboard?', message: 'What you drew is not saved. Use Save or Copy first to keep it.', okLabel: 'Close without saving', danger: true });
        if (!ok) return;
      }
      wrap.remove();
    });
    return wrap;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = { ScreenshotTool };
