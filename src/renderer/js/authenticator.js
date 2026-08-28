// === Vex Authenticator — TOTP (2FA) codes for Discord/Roblox/GitHub/etc. ===
// Codes are generated in the MAIN process (RFC 6238); this renderer only ever
// receives metadata (totpList) and the finished 6-digit codes (totpCodes) — the
// secret never reaches this (web-adjacent) context. Secrets are encrypted at
// rest with the OS keychain/DPAPI, same as the password vault.
const Authenticator = {
  _timer: null,
  _codes: {},
  _el: null,

  async renderPanel(el) {
    this._el = el;
    el.innerHTML = `
      <div class="auth-panel">
        <div class="auth-head">
          <h3>🔐 Authenticator</h3>
          <button id="auth-add-toggle" class="auth-add-btn">+ Add</button>
        </div>
        <div id="auth-add-form" class="auth-add-form" style="display:none">
          <p class="auth-hint">Scan a QR screenshot, or add manually: on the site's 2FA screen choose <b>“can't scan / enter a code manually”</b> and paste that setup key — or the whole <code>otpauth://</code> link.</p>
          <div id="auth-qr-drop" class="auth-qr-drop" title="Click to pick a QR image — or drag one here, or paste (Ctrl+V) a screenshot">
            <span class="auth-qr-icon">📷</span>
            <span>Scan a QR code — <b>click</b>, drag an image here, or paste a screenshot</span>
          </div>
          <input id="auth-qr-file" type="file" accept="image/*" style="display:none">
          <div class="auth-or">or enter it manually</div>
          <input id="auth-secret" type="text" placeholder="Setup key  or  otpauth://… link" autocomplete="off" spellcheck="false">
          <input id="auth-label" type="text" placeholder="Label — e.g. Discord (you@email)" autocomplete="off">
          <div class="auth-actions">
            <button id="auth-save" class="auth-save">Add account</button>
            <span id="auth-status" class="auth-status"></span>
          </div>
        </div>
        <div id="auth-list" class="auth-list"></div>
      </div>`;
    this._injectStyles();
    el.querySelector('#auth-add-toggle').addEventListener('click', () => {
      const f = el.querySelector('#auth-add-form');
      f.style.display = f.style.display === 'none' ? 'block' : 'none';
      if (f.style.display === 'block') el.querySelector('#auth-secret').focus();
    });
    el.querySelector('#auth-save').addEventListener('click', () => this._add());
    el.querySelector('#auth-secret').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._add(); });
    el.querySelector('#auth-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._add(); });

    // --- QR import: click to pick, drag-drop an image, or paste a screenshot ---
    const drop = el.querySelector('#auth-qr-drop');
    const fileInput = el.querySelector('#auth-qr-file');
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { const f = fileInput.files && fileInput.files[0]; if (f) this._handleQrFile(f); fileInput.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this._handleQrFile(f);
    });
    // Paste a screenshot anywhere while the add form is open.
    if (this._onPaste) document.removeEventListener('paste', this._onPaste);
    this._onPaste = (e) => {
      const form = el.querySelector('#auth-add-form');
      if (!form || form.style.display === 'none') return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); this._handleQrFile(f); return; } }
      }
    };
    document.addEventListener('paste', this._onPaste);

    await this._refreshList();
    this._startTicking();
  },

  // Decode a QR code out of an image File and, if it's an otpauth:// URI, add it.
  async _handleQrFile(file) {
    const el = this._el; if (!el) return;
    const status = el.querySelector('#auth-status');
    const form = el.querySelector('#auth-add-form');
    if (form && form.style.display === 'none') form.style.display = 'block';
    if (!file || !/^image\//.test(file.type || '')) { if (status) status.textContent = 'That’s not an image.'; return; }
    if (typeof jsQR === 'undefined') { if (status) status.textContent = 'QR reader failed to load.'; return; }
    if (status) status.textContent = 'Reading QR…';
    let text = null;
    try { text = await this._decodeQrFromFile(file); } catch { text = null; }
    if (!text) { if (status) status.textContent = 'No QR code found in that image — try a clearer/tighter screenshot.'; return; }
    if (!/^otpauth:\/\//i.test(text.trim())) { if (status) status.textContent = 'That QR isn’t a 2FA (otpauth) code.'; return; }
    el.querySelector('#auth-secret').value = text.trim();
    if (status) status.textContent = 'QR read — adding…';
    await this._add();
  },

  _decodeQrFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { try { resolve(this._decodeQrFromImage(img)); } finally { URL.revokeObjectURL(url); } };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  },

  _decodeQrFromImage(img) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const r = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    return r && r.data ? r.data : null;
  },

  async _add() {
    const el = this._el;
    const secret = el.querySelector('#auth-secret').value.trim();
    const label = el.querySelector('#auth-label').value.trim();
    const status = el.querySelector('#auth-status');
    if (!secret) { status.textContent = 'Paste a key or link first.'; return; }
    status.textContent = 'Adding…';
    const r = await window.vex.totpAdd({ secret, label }).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    if (r && r.ok) {
      el.querySelector('#auth-secret').value = '';
      el.querySelector('#auth-label').value = '';
      el.querySelector('#auth-add-form').style.display = 'none';
      status.textContent = '';
      await this._refreshList();
      window.showToast?.('Account added');
    } else {
      status.textContent = (r && r.error) ? r.error : 'Could not add — check the key.';
    }
  },

  async _refreshList() {
    const el = this._el; if (!el) return;
    const list = await window.vex.totpList().catch(() => []);
    const box = el.querySelector('#auth-list');
    if (!list.length) {
      box.innerHTML = `<div class="auth-empty">No accounts yet.<br>Add one to get its 2FA codes here — no phone needed.</div>`;
      return;
    }
    box.innerHTML = list.map(a => {
      const iss = (a.issuer || '').trim();
      const lab = (a.label || '').trim();
      const title = iss && lab && lab.toLowerCase() !== iss.toLowerCase() ? `${iss} · ${lab}` : (iss || lab || 'Account');
      return `<div class="auth-item" data-id="${this._esc(a.id)}" title="Click to copy the code" role="button" tabindex="0">
        <div class="auth-info">
          <div class="auth-name">${this._esc(title)}</div>
          <div class="auth-code" data-code>••• •••</div>
        </div>
        <div class="auth-ctrls">
          <svg class="auth-ring" width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--border)" stroke-width="2"/><circle data-ring cx="11" cy="11" r="9" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" transform="rotate(-90 11 11)" stroke-dasharray="56.55" stroke-dashoffset="0"/></svg>
          <button class="auth-del" data-del title="Remove account">🗑</button>
        </div>
      </div>`;
    }).join('');
    // Delete — stopPropagation so removing an account doesn't also copy its code.
    box.querySelectorAll('.auth-del').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = e.currentTarget.closest('.auth-item').dataset.id;
      const ok = await (window.vexConfirm ? window.vexConfirm({ title: 'Remove this account?', message: 'You will need the site’s setup key again to re-add it — make sure you still have another way to sign in.', okLabel: 'Remove', danger: true }) : Promise.resolve(true));
      if (!ok) return;
      await window.vex.totpDelete(id);
      await this._refreshList();
    }));
    // Click ANYWHERE on the row (or Enter/Space) to copy the code — no button hunt.
    const copyFrom = (item) => {
      const id = item.dataset.id;
      const code = this._codes[id] && this._codes[id].code;
      if (!code) return;
      try { navigator.clipboard.writeText(code); } catch {}
      window.showToast?.('Code copied');
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 550);
    };
    box.querySelectorAll('.auth-item').forEach(item => {
      item.addEventListener('click', (e) => { if (!e.target.closest('.auth-del')) copyFrom(item); });
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyFrom(item); } });
    });
    await this._tick();
  },

  async _tick() {
    const panel = document.getElementById('panel-authenticator');
    if (!this._el || !panel || panel.style.display === 'none') return;
    const codes = await window.vex.totpCodes().catch(() => []);
    this._codes = {};
    codes.forEach(c => { this._codes[c.id] = c; });
    codes.forEach(c => {
      const item = this._el.querySelector(`.auth-item[data-id="${CSS.escape(c.id)}"]`);
      if (!item) return;
      const codeEl = item.querySelector('[data-code]');
      if (codeEl) codeEl.textContent = c.code ? c.code.replace(/^(\d{3})(\d.*)$/, '$1 $2') : '——— ———';
      const ring = item.querySelector('[data-ring]');
      if (ring) {
        const frac = Math.max(0, Math.min(1, c.remaining / (c.period || 30)));
        ring.style.strokeDashoffset = String((1 - frac) * 56.55);
        ring.style.stroke = c.remaining <= 5 ? 'var(--danger, #e2231a)' : 'var(--primary)';
      }
    });
  },

  _startTicking() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 1000);
  },

  _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },

  _injectStyles() {
    if (document.getElementById('auth-styles')) return;
    const st = document.createElement('style');
    st.id = 'auth-styles';
    st.textContent = `
      .auth-panel{padding:12px 14px;font-family:inherit;color:var(--text)}
      .auth-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      .auth-head h3{margin:0;font-size:15px}
      .auth-add-btn{background:var(--primary);color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600}
      .auth-add-form{background:rgba(127,127,127,.08);border:1px solid var(--border);border-radius:10px;padding:11px;margin-bottom:12px}
      .auth-hint{font-size:11.5px;color:var(--text-muted);margin:0 0 8px;line-height:1.5}
      .auth-qr-drop{display:flex;align-items:center;gap:9px;padding:12px 12px;margin-bottom:8px;border:1.5px dashed var(--vex-border-medium,var(--border));border-radius:10px;background:rgba(127,127,127,.05);color:var(--text-muted);font-size:11.5px;line-height:1.4;cursor:pointer;text-align:left;transition:border-color .12s,background .12s,color .12s}
      .auth-qr-drop:hover{border-color:var(--primary);color:var(--text);background:color-mix(in srgb, var(--primary) 7%, transparent)}
      .auth-qr-drop.drag{border-color:var(--primary);background:color-mix(in srgb, var(--primary) 14%, transparent);color:var(--text)}
      .auth-qr-drop b{color:var(--text);font-weight:600}
      .auth-qr-icon{font-size:19px;flex-shrink:0;filter:grayscale(.2)}
      .auth-or{display:flex;align-items:center;gap:8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin:2px 0 8px}
      .auth-or::before,.auth-or::after{content:'';flex:1;height:1px;background:var(--border)}
      .auth-add-form input[type=text]{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:7px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font:inherit;font-size:12.5px}
      .auth-actions{display:flex;align-items:center;gap:10px}
      .auth-save{background:var(--primary);color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600}
      .auth-status{font-size:11.5px;color:var(--text-muted)}
      .auth-list{display:flex;flex-direction:column;gap:8px}
      .auth-empty{color:var(--text-muted);font-size:12.5px;text-align:center;padding:24px 8px;line-height:1.6}
      .auth-item{display:flex;align-items:center;justify-content:space-between;background:rgba(127,127,127,.06);border:1px solid var(--border);border-radius:10px;padding:9px 11px;cursor:pointer;user-select:none;transition:background .12s,border-color .12s,transform .06s}
      .auth-item:hover{background:rgba(127,127,127,.13);border-color:var(--vex-border-medium,var(--border))}
      .auth-item:active{transform:scale(0.995)}
      .auth-item:focus-visible{outline:2px solid var(--primary);outline-offset:1px}
      .auth-item.copied{background:color-mix(in srgb, var(--primary) 22%, transparent);border-color:var(--primary)}
      .auth-name{font-size:11.5px;color:var(--text-muted);margin-bottom:2px}
      .auth-code{font-size:20px;font-weight:600;letter-spacing:2px;font-variant-numeric:tabular-nums}
      .auth-ctrls{display:flex;align-items:center;gap:6px}
      .auth-del{background:none;border:none;cursor:pointer;font-size:14px;opacity:.6;padding:3px;line-height:1}
      .auth-del:hover{opacity:1}
    `;
    document.head.appendChild(st);
  },
};
if (typeof window !== 'undefined') window.Authenticator = Authenticator;
