// === Vex Boosts — per-site customization (Arc-style) ===
//
// Three layers, all keyed by hostname and persisted in 'vex.boosts':
//   zaps — element selectors hidden via injected CSS (right answer for ads,
//          banners, sidebars: pick them with the Zap Element picker)
//   css  — freeform user CSS for the site
//   js   — freeform user JS, run at dom-ready
// Applied to every tab webview on dom-ready (hook in webview.js). Managed via
// the command bar (Zap Element / Boost This Site) and Settings → Boosts.

const VexBoosts = {
  KEY: 'vex.boosts',
  boosts: {},

  init() {
    try { this.boosts = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch { this.boosts = {}; }
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.boosts)); } catch {} },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  forHost(host) { return this.boosts[host] || null; },

  // Inject this site's boost into a webview. Idempotent per navigation —
  // the style tag is replaced, not duplicated.
  applyTo(webview, url) {
    const host = this._host(url);
    if (!host) return;
    const b = this.boosts[host];
    if (!b) return;
    const cssParts = [];
    if (Array.isArray(b.zaps) && b.zaps.length) {
      cssParts.push(b.zaps.map(sel => `${sel}{display:none!important;visibility:hidden!important}`).join('\n'));
    }
    if (b.css) cssParts.push(b.css);
    const css = cssParts.join('\n');
    const js = `(function(){try{
      var id='vex-boost-style';
      var el=document.getElementById(id);
      if(!el){el=document.createElement('style');el.id=id;document.documentElement.appendChild(el);}
      el.textContent=${JSON.stringify(css)};
    }catch(e){}})();`;
    try { webview.executeJavaScript(js).catch(() => {}); } catch {}
    if (b.js) {
      try { webview.executeJavaScript(`(function(){try{${b.js}\n}catch(e){console.warn('[VexBoost]',e)}})();`).catch(() => {}); } catch {}
    }
  },

  _activeWv() { return typeof WebviewManager !== 'undefined' ? WebviewManager.getActiveWebview() : null; },
  _activeHost() {
    const t = typeof TabManager !== 'undefined' ? TabManager.getActiveTab() : null;
    return t && t.url ? this._host(t.url) : '';
  },

  // --- Zap Element: pick an element in the page, hide it forever on this site ---
  async startZapper() {
    const wv = this._activeWv();
    const host = this._activeHost();
    if (!wv || !host) { window.showToast?.('Open a page first'); return; }
    window.showToast?.('Zap mode: click an element to hide it (Esc cancels)');
    const picker = `new Promise((resolve) => {
      const prev = { el: null, outline: '' };
      const clear = () => { if (prev.el) { prev.el.style.outline = prev.outline; prev.el = null; } };
      const cssPath = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        while (el && el.nodeType === 1 && parts.length < 5) {
          let p = el.tagName.toLowerCase();
          const cls = Array.from(el.classList || []).filter(c => /^[A-Za-z][\\w-]*$/.test(c)).slice(0, 2);
          if (cls.length) p += '.' + cls.map(c => CSS.escape(c)).join('.');
          else {
            const sibs = el.parentElement ? Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName) : [];
            if (sibs.length > 1) p += ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')';
          }
          parts.unshift(p);
          if (el.id) { parts[0] = '#' + CSS.escape(el.id); break; }
          el = el.parentElement;
        }
        return parts.join(' > ');
      };
      const onMove = (e) => { clear(); prev.el = e.target; prev.outline = e.target.style.outline; e.target.style.outline = '2px solid #ef4444'; };
      const done = (val) => {
        clear();
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onClick = (e) => { e.preventDefault(); e.stopPropagation(); done(cssPath(e.target)); };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    })`;
    let sel = null;
    try { sel = await wv.executeJavaScript(picker, true); } catch (err) { console.warn('[Boosts] zapper failed:', err); }
    if (!sel) { window.showToast?.('Zap cancelled'); return; }
    const b = this.boosts[host] || (this.boosts[host] = { zaps: [], css: '', js: '' });
    if (!Array.isArray(b.zaps)) b.zaps = [];
    if (!b.zaps.includes(sel)) b.zaps.push(sel);
    this.save();
    this.applyTo(wv, 'https://' + host + '/');
    window.showToast?.('Zapped — hidden on ' + host);
  },

  // --- Boost editor: per-site custom CSS / JS ---
  openEditor(host) {
    host = host || this._activeHost();
    if (!host) { window.showToast?.('Open a page first'); return; }
    const b = this.boosts[host] || { zaps: [], css: '', js: '' };
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    document.getElementById('boost-edit-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'boost-edit-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div style="width:560px;max-width:94vw;max-height:88vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">Boost ${esc(host)}</div>
      <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 14px">Custom CSS and JS applied to every page on this site. ${(b.zaps || []).length} zapped element${(b.zaps || []).length === 1 ? '' : 's'}.</p>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Custom CSS</label>
      <textarea id="bm-css" rows="6" spellcheck="false" placeholder="body { font-family: Georgia !important; }" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(b.css || '')}</textarea>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin:12px 0 5px">Custom JS (runs at page load)</label>
      <textarea id="bm-js" rows="5" spellcheck="false" placeholder="// document.querySelector('.paywall')?.remove()" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(b.js || '')}</textarea>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px">
        <button id="bm-clear-zaps" style="padding:8px 14px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px"${(b.zaps || []).length ? '' : ' disabled'}>Un-zap all (${(b.zaps || []).length})</button>
        <span style="flex:1"></span>
        <button id="bm-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="bm-save" style="padding:8px 18px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Save &amp; apply</button>
      </div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#bm-cancel').addEventListener('click', () => m.remove());
    m.querySelector('#bm-clear-zaps').addEventListener('click', () => {
      b.zaps = [];
      this.boosts[host] = b; this.save();
      window.showToast?.('Zaps cleared — reload the page');
      m.remove();
    });
    m.querySelector('#bm-save').addEventListener('click', () => {
      b.css = m.querySelector('#bm-css').value;
      b.js = m.querySelector('#bm-js').value;
      if (!b.css && !b.js && !(b.zaps || []).length) delete this.boosts[host];
      else this.boosts[host] = b;
      this.save();
      const wv = this._activeWv();
      if (wv) this.applyTo(wv, 'https://' + host + '/');
      window.showToast?.('Boost saved');
      m.remove();
    });
  },

  // --- Settings → Boosts list ---
  renderPanel(container) {
    if (!container) return;
    const hosts = Object.keys(this.boosts).sort();
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Per-site tweaks: hidden elements (zaps), custom CSS, and custom JS. Use <strong>Ctrl+K → "Zap Element"</strong> on any page, or <strong>"Boost This Site"</strong> for the editor.</p>`;
    if (!hosts.length) {
      container.innerHTML += '<div style="font-size:12.5px;color:var(--text-muted)">No boosted sites yet.</div>';
      return;
    }
    hosts.forEach(host => {
      const b = this.boosts[host];
      const bits = [];
      if ((b.zaps || []).length) bits.push((b.zaps || []).length + ' zap' + ((b.zaps || []).length === 1 ? '' : 's'));
      if (b.css) bits.push('CSS');
      if (b.js) bits.push('JS');
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border)';
      row.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:600;color:var(--text)">${esc(host)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${esc(bits.join(' · ') || 'empty')}</div>
        </div>
        <button data-edit style="padding:5px 12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">Edit</button>
        <button data-del style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>`;
      row.querySelector('[data-edit]').addEventListener('click', () => this.openEditor(host));
      row.querySelector('[data-del]').addEventListener('click', () => {
        delete this.boosts[host]; this.save(); this.renderPanel(container);
      });
      container.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.VexBoosts = VexBoosts;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBoosts };
