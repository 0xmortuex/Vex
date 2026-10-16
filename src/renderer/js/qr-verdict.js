// === QR verdict: read a QR code on this computer, judge the address BEFORE opening it (T3-101) ===
//
// QR codes are the way a scam link gets past every "hover to see where it goes" habit: on a
// screen, in a chat image, on a poster, you cannot read the address. Pick an image (or paste a
// screenshot, or drop one) and Vex reads the code here, on this computer, and shows:
//
//   what the code holds   a web address, a 2FA setup code, a payment, a Wi-Fi login, plain text
//   the real address      wrappers unwrapped (Google, Facebook and other redirects), tracking removed
//   the verdict           from the same checks as everywhere else: the lookalike check of the
//                         web-safety layer (webSafety.check), the guarded-brand list in link-safety.js,
//                         "not encrypted", "a shortener hides the real address", and whether you have
//                         ever visited the site
//   buttons               Copy the address, Open it (in a throwaway session if you like), or Close
//
// It NEVER opens anything by itself, not even a clean address. A 2FA code (otpauth://) is not
// shown and never leaves the image: it says what it is and points to the Authenticator panel.
// The image is read in memory and is not kept, uploaded or looked up.
const VexQrVerdict = {
  KEY: 'vex.qrVerdict',          // 'off' turns it off
  MAX_BYTES: 12 * 1024 * 1024,   // an image bigger than this is refused
  MAX_SIDE: 1600,                // read at most this many pixels on the long side (bigger is shrunk first)
  SHORTENERS: ['bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'rb.gy', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'qrco.de', 'qr.page', 'l.ead.me', 'lnkd.in', 'goo.gl', 'v.gd', 'trib.al', 'bl.ink', 'short.io', 'clck.ru', 'cli.re', 't.ly', 'urlz.fr'],

  enabled() { try { return localStorage.getItem(this.KEY) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.KEY, on ? 'on' : 'off'); return !!on; },

  // --- what the code holds -------------------------------------------------------------
  // → { type: 'url'|'otp'|'wifi'|'pay'|'contact'|'text', text (safe to show), url? }
  classify(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) throw new Error('The QR code is empty');
    if (/^otpauth(?:-migration)?:\/\//i.test(text)) return { type: 'otp', text: '' };
    if (/^https?:\/\//i.test(text)) { let u; try { u = new URL(text); } catch { return { type: 'text', text: text.slice(0, 300) }; } return { type: 'url', text: u.href, url: u.href }; }
    // A bare address ("www.example.com/x") is read as a web address too, since phones do.
    if (/^(?:www\.)[^\s]+\.[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(text)) return { type: 'url', text: 'https://' + text, url: 'https://' + text };
    if (/^WIFI:/i.test(text)) { const ssid = /S:((?:\\.|[^;])*);/i.exec(text); return { type: 'wifi', text: 'Wi-Fi network' + (ssid ? ' “' + ssid[1].replace(/\\(.)/g, '$1').slice(0, 60) + '”' : '') + ' (the password in the code is not shown)' }; }
    if (/^(?:upi|bitcoin|ethereum|litecoin|monero|paypal|venmo|cashapp):/i.test(text) || /^TR\d{2}(?:\s?\d{4}){5}\s?\d{2}$/i.test(text)) return { type: 'pay', text: text.slice(0, 200) };
    if (/^(?:tel|sms|smsto|mailto|mecard|begin:vcard|geo):/i.test(text)) return { type: 'contact', text: text.slice(0, 200) };
    return { type: 'text', text: text.slice(0, 300) };
  },

  // --- the verdict on an address ----------------------------------------------------------
  // webCheck: the web-safety layer's answer for the host ({ flagged, line, reasons }) or null.
  // visits: how many history entries the site has, or null when that is not known.
  verdict(url, { webCheck = null, visits = null } = {}) {
    const info = typeof LinkSafety !== 'undefined' ? LinkSafety.describe(url) : { url, real: url, clean: url, wrapped: false, tracked: false, host: '', insecure: /^http:/i.test(url), lookalike: null };
    const host = String(info.host || '').toLowerCase().replace(/^www\./, '');
    const signs = [];
    if (webCheck && webCheck.flagged) signs.push({ level: 'high', text: webCheck.line, more: webCheck.reasons || [] });
    if (info.lookalike) signs.push({ level: 'high', text: info.lookalike.why });
    if (this.SHORTENERS.some(s => host === s || host.endsWith('.' + s))) signs.push({ level: 'medium', text: 'It is a shortened link, so the real address is hidden until it is followed.' });
    if (info.insecure) signs.push({ level: 'medium', text: 'It is not encrypted (http), so anyone on the network could change the page.' });
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) signs.push({ level: 'high', text: 'It goes to a number address, not a named site. Real services do not put QR codes on those.' });
    if (visits === 0) signs.push({ level: 'low', text: 'You have never visited ' + host + ' (it is not in your history).' });
    if (info.wrapped) signs.push({ level: 'info', text: 'The code holds a wrapper link; it really goes to ' + info.real + '.' });
    const level = signs.some(s => s.level === 'high') ? 'high' : signs.some(s => s.level === 'medium') ? 'medium' : 'none';
    return { info, host, signs, level,
      headline: level === 'high' ? 'Do not open this one' : level === 'medium' ? 'Look at this before you open it' : 'No warning signs found' };
  },

  // --- reading the image -----------------------------------------------------------------------
  async _loadJsQR() {
    if (typeof jsQR === 'undefined') {
      if (typeof VexLazy === 'undefined') throw new Error('The QR reader cannot be loaded here');
      await VexLazy.ensure('vendor/jsQR.js');
    }
    if (typeof jsQR === 'undefined') throw new Error('The QR reader failed to load');
    return jsQR;
  },
  _bitmapOf(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image')); };
      img.src = url;
    });
  },
  // Decode the QR code in an image File. Returns the text, or throws "no QR code found".
  async decodeFile(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('That is not an image');
    if (file.size > this.MAX_BYTES) throw new Error('That image is over ' + Math.round(this.MAX_BYTES / 1048576) + ' MB; crop it to the code first');
    const read = await this._loadJsQR();
    const img = await this._bitmapOf(file);
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('That image has no size');
    const scale = Math.min(1, this.MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const r = read(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (!r || !r.data) throw new Error('No QR code found in that image. Try a tighter, sharper screenshot of just the code.');
    return r.data;
  },

  // Everything for one image: what it holds, and for an address the verdict.
  async inspectFile(file) {
    const text = await this.decodeFile(file);
    const held = this.classify(text);
    if (held.type !== 'url') return { held };
    let webCheck = null, visits = null;
    const host = (() => { try { return new URL(held.url).hostname; } catch { return ''; } })();
    // The web-safety layer judges the host; a failure to ask is said, not turned into "no signs".
    const real = typeof LinkSafety !== 'undefined' ? LinkSafety.describe(held.url) : null;
    const askHost = real && real.host ? real.host : host;
    if (askHost && window.vex && window.vex.webSafety && typeof window.vex.webSafety.check === 'function') webCheck = await window.vex.webSafety.check(askHost);
    if (askHost && typeof VexChatLinks !== 'undefined') {
      try { visits = VexChatLinks.visits(askHost); } catch (err) { window.VexProblems?.note('QR verdict', 'Could not look in your history', err); }
    }
    return { held, verdict: this.verdict(held.url, { webCheck, visits }) };
  },

  // --- the window ------------------------------------------------------------------------------------
  async open() {
    if (!window.VexSettingsGroups || typeof VexSettingsGroups.dialog !== 'function') throw new Error('The QR window needs the platform dialog');
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-qr-verdict', title: 'Check a QR code', sub: 'Pick, drop or paste a picture of the code. It is read on this computer; nothing is opened until you press Open.' });
    const drop = document.createElement('div');
    drop.className = 'auth-qr-drop';
    drop.tabIndex = 0;
    drop.setAttribute('role', 'button');
    drop.textContent = 'Click to pick an image, drop one here, or paste a screenshot (Ctrl+V)';
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
    const out = document.createElement('div');
    out.setAttribute('aria-live', 'polite');
    out.style.marginTop = '10px';
    body.append(drop, file, out);
    const go = async (f) => {
      out.textContent = 'Reading the code…';
      try { this._render(out, await this.inspectFile(f), close); }
      catch (err) { out.textContent = ''; const p = document.createElement('div'); p.setAttribute('role', 'alert'); p.style.color = 'var(--danger, #b4232a)'; p.textContent = err.message; out.appendChild(p); }
    };
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) go(f); });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); });
    drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) go(f); });
    const onPaste = (e) => {
      if (!body.isConnected) { document.removeEventListener('paste', onPaste, true); return; }
      for (const it of (e.clipboardData && e.clipboardData.items) || []) {
        if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) { e.preventDefault(); go(f); return; } }
      }
    };
    document.addEventListener('paste', onPaste, true);
    drop.focus();
    return { body, close };
  },

  _render(out, r, close) {
    out.textContent = '';
    const line = (text, style) => { const d = document.createElement('div'); d.textContent = text; if (style) d.style.cssText = style; out.appendChild(d); return d; };
    const btn = (text, fn, kind) => {
      const b = VexSettingsGroups.button(text, () => { Promise.resolve().then(fn).catch(err => window.showToast?.((err && err.message) || String(err), 'error')); }, { danger: kind === 'danger', primary: kind === 'primary' });
      return b;
    };
    const row = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px'; out.appendChild(d); return d; };
    const h = r.held;
    if (h.type === 'otp') {
      line('This is a 2FA setup code.', 'font-weight:650');
      line('Vex does not show it, and it does not leave this picture. To add it, use the Authenticator panel and pick the same image there.', 'color:var(--text-muted);font-size:12px;margin-top:4px');
      return;
    }
    if (h.type !== 'url') {
      const label = { wifi: 'A Wi-Fi login', pay: 'A payment or bank detail', contact: 'A contact, call, message or place', text: 'Plain text' }[h.type];
      line(label + '. Vex does not open this kind.', 'font-weight:650');
      line(h.text, 'margin-top:4px;word-break:break-all');
      if (h.type === 'pay') line('Check the name and amount in your own banking app before you pay anything a code asks for.', 'color:var(--text-muted);font-size:12px;margin-top:4px');
      const rw = row(); rw.appendChild(btn('Copy', () => navigator.clipboard.writeText(h.text).then(() => window.showToast?.('Copied'))));
      return;
    }
    const v = r.verdict;
    line(v.headline, 'font-weight:700;font-size:14px;color:' + (v.level === 'high' ? 'var(--danger, #b4232a)' : v.level === 'medium' ? 'var(--vex-warning, #b07a00)' : 'var(--text)'));
    line('The code goes to:', 'margin-top:8px;color:var(--text-muted);font-size:12px');
    line(v.info.clean || v.info.real, 'word-break:break-all;font-weight:600');
    if (v.signs.length) {
      const ul = document.createElement('ul'); ul.style.cssText = 'margin:8px 0 0;padding-left:18px;font-size:12.5px';
      for (const s of v.signs) { const li = document.createElement('li'); li.textContent = s.text; ul.appendChild(li); }
      out.appendChild(ul);
    } else line('Vex found no lookalike name, no hidden shortener and no missing encryption. That is not a promise the site is honest.', 'margin-top:8px;color:var(--text-muted);font-size:12px');
    const rw = row();
    const open = (partition) => { TabManager.createTab(v.info.clean || v.info.real, true, null, partition ? { partition } : null); close(); };
    rw.appendChild(btn(v.level === 'none' ? 'Open it' : 'Open anyway', () => open(null), v.level === 'high' ? 'danger' : 'primary'));
    rw.appendChild(btn('Open in a throwaway session', () => open('otr-qr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))));
    rw.appendChild(btn('Copy the address', () => navigator.clipboard.writeText(v.info.clean || v.info.real).then(() => window.showToast?.('Copied the address'))));
    if (this.SHORTENERS.some(s => v.host === s || v.host.endsWith('.' + s)) && typeof LinkSafety !== 'undefined') {
      rw.appendChild(btn('Follow the short link first', async () => {
        const f = await LinkSafety.follow(v.info.real);
        line('It ends at: ' + f.final.clean + (f.final.lookalike ? ' — ' + f.final.lookalike.why : ''), 'margin-top:8px;word-break:break-all');
      }));
    }
  },
};

if (typeof window !== 'undefined') window.VexQrVerdict = VexQrVerdict;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexQrVerdict };
