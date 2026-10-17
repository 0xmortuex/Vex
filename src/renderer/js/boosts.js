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
  // Returns false when the write failed, so no caller can announce a save that
  // did not happen.
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.boosts)); } catch { return false; }
    return true;
  },

  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  forHost(host) { return this.boosts[host] || null; },

  // Inject this site's boost into a webview. Idempotent per navigation —
  // the style tag is replaced, not duplicated.
  //
  // A host with NO boost is not a no-op: it must actively clear any CSS this
  // webview is still carrying from a boost that has since been edited down or
  // deleted. Returning early here is what made turning a Boost off look broken
  // — the zapped elements stayed hidden on every page already open.
  applyTo(webview, url) {
    const host = this._host(url);
    if (!host) return;
    const b = this.boosts[host];
    // `paused` is set by "This site is broken" (js/site-ladder.js): the boost
    // is kept but not applied until it is put back.
    if (!b || b.paused) { this._writeCss(webview, ''); return; }
    const cssParts = [];
    // Hidden elements are not applied on a banking, payment, sign-in or mail page, even on a site
    // that was zapped elsewhere (T3-090): a hidden "Confirm" or "Cancel" there costs more than an ad.
    const zapsOk = !(typeof VexPageSensitivity !== 'undefined' && VexPageSensitivity.reason(url));
    if (zapsOk && Array.isArray(b.zaps) && b.zaps.length) {
      cssParts.push(b.zaps.filter(sel => this.safeSelector(sel)).map(sel => `${sel}{display:none!important;visibility:hidden!important}`).join('\n'));
    }
    if (b.css) cssParts.push(b.css);
    this._writeCss(webview, cssParts.join('\n'));
    if (b.js) {
      try { webview.executeJavaScript(`(function(){try{${b.js}\n}catch(e){console.warn('[VexBoost]',e)}})();`).catch(() => {}); } catch {}
    }
  },

  // Set (or clear) this webview's boost stylesheet through insertCSS, which
  // needs none of the page's JavaScript: a site whose JavaScript is switched
  // off (its tab is built with javascript=no) got no Boost CSS at all while
  // this was a <style> written by executeJavaScript (final review,
  // 2026-10-09). Each write takes the previous sheet out first; the chain
  // keeps two quick writes in order. A failure is logged, not hidden.
  _writeCss(webview, css) {
    if (typeof webview.insertCSS !== 'function') throw new Error('This page cannot take a stylesheet');
    const run = async () => {
      const old = webview._vexBoostCssKey;
      webview._vexBoostCssKey = null;
      if (old) await webview.removeInsertedCSS(old);
      if (css) webview._vexBoostCssKey = await webview.insertCSS(css);
    };
    webview._vexBoostCss = (webview._vexBoostCss || Promise.resolve())
      .then(run)
      .catch(err => console.error('[Boosts] could not apply this site\'s CSS:', err && err.message));
    return webview._vexBoostCss;
  },

  // Re-apply this host's boost (or clear it) across every open tab showing that
  // host, so turning a boost off takes effect where the user can see it rather
  // than only on the next reload. Returns the number of tabs updated.
  refreshHost(host) {
    if (!host || typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') return 0;
    let n = 0;
    for (const tab of (TabManager.tabs || [])) {
      if (this._host(tab.url) !== host) continue;
      const wv = WebviewManager.webviews?.get(tab.id);
      if (!wv) continue;
      try { this.applyTo(wv, tab.url); n++; } catch {}
    }
    return n;
  },

  // Custom JS has already run in the page; CSS we can take back, JS we cannot.
  // Say which, instead of a flat "done".
  _offMessage(hadJs, tabs) {
    const where = tabs ? ` on ${tabs} open tab${VexPlural.s(tabs)}` : '';
    return hadJs
      ? `Boost off — styling removed${where}. Custom JS already ran; reload the page to undo it.`
      : `Boost off — styling removed${where}.`;
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
    // Never on a banking, payment, sign-in or mail page (T3-090): said once, before the picker starts.
    const pageUrl = (() => { try { return wv.getURL(); } catch { return ''; } })() || ('https://' + host + '/');
    const refused = typeof VexPageSensitivity !== 'undefined' ? VexPageSensitivity.reason(pageUrl) : null;
    if (refused) { window.showToast?.(refused, 'warn', 6000); return; }
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
      const onClick = (e) => {
        e.preventDefault(); e.stopPropagation();
        const el = e.target;
        const sel = cssPath(el);
        let matches = [];
        try { matches = Array.from(document.querySelectorAll(sel)); } catch (err) { done({ error: 'Could not make a rule for that element' }); return; }
        if (el === document.documentElement || el === document.body || el === document.head) { done({ error: 'The whole page cannot be hidden' }); return; }
        if (!matches.includes(el)) { done({ error: 'Could not make a rule that matches only that element' }); return; }
        done({ sel: sel, count: matches.length, tag: el.tagName.toLowerCase(), text: String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) });
      };
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    })`;
    let picked = null;
    try { picked = await wv.executeJavaScript(picker, true); }
    catch (err) { window.showToast?.('Could not pick an element on this page: ' + ((err && err.message) || err), 'error'); return; }
    if (!picked) { window.showToast?.('Zap cancelled'); return; }
    if (picked.error) { window.showToast?.(picked.error, 'warn'); return; }
    const sel = String(picked.sel || '');
    if (!this.safeSelector(sel)) { window.showToast?.('Could not make a safe rule for that element', 'error'); return; }
    // A rule that would hide a lot more than the one thing clicked is said, not hidden quietly.
    if (picked.count > 25) { window.showToast?.('That rule would hide ' + picked.count + ' elements, so nothing was hidden. Click a more specific element.', 'warn', 7000); return; }
    const b = this.boosts[host] || (this.boosts[host] = { zaps: [], css: '', js: '' });
    if (!Array.isArray(b.zaps)) b.zaps = [];
    const added = !b.zaps.includes(sel);
    if (added) b.zaps.push(sel);
    const saved = this.save();
    this.applyTo(wv, pageUrl);
    const what = (picked.text ? '“' + picked.text + '”' : 'a <' + picked.tag + '>') + (picked.count > 1 ? ' and ' + (picked.count - 1) + ' like it' : '');
    if (!saved) { window.showToast?.('Hidden for now, but the zap could not be saved — it will come back when you restart Vex', 'error'); return; }
    if (!added) { window.showToast?.('That element is already hidden on ' + host); return; }
    window.VexUndo.offer({
      message: 'Hid ' + what + ' on ' + host,
      undo: () => this.removeZap(host, sel),
    });
  },

  // A stored hide rule is a CSS selector put in front of a declaration block, so it must not be able to
  // close that block or start another rule. The picker only writes plain selectors; this also covers a
  // rule that was edited into storage.
  safeSelector(sel) {
    return typeof sel === 'string' && sel.length > 0 && sel.length <= 600 && !/[{};<@]|\/\*|\*\//.test(sel);
  },

  // One hidden element back. Used by the Undo on a zap and by the list of hidden elements.
  removeZap(host, sel) {
    const b = this.boosts[host];
    if (!b || !Array.isArray(b.zaps) || !b.zaps.includes(sel)) throw new Error('That element is not hidden any more');
    b.zaps = b.zaps.filter(s => s !== sel);
    if (!b.zaps.length && !b.css && !b.js) delete this.boosts[host];
    const saved = this.save();
    this.refreshHost(host);
    if (!saved) throw new Error('The change could not be saved; it comes back when you restart Vex');
    return b.zaps.length;
  },

  // Hide a rule again after removeZap (the Undo of the list's Remove).
  addZap(host, sel) {
    if (!this.safeSelector(sel)) throw new Error('That is not a safe rule');
    const b = this.boosts[host] || (this.boosts[host] = { zaps: [], css: '', js: '' });
    if (!Array.isArray(b.zaps)) b.zaps = [];
    if (!b.zaps.includes(sel)) b.zaps.push(sel);
    const saved = this.save();
    this.refreshHost(host);
    if (!saved) throw new Error('The change could not be saved');
    return b.zaps.length;
  },

  // Ctrl+K › Hidden elements on this site: each rule with a Remove (Undo on the toast).
  openZapList(host) {
    host = host || this._activeHost();
    if (!host) { window.showToast?.('Open a page first'); return null; }
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings sections are not loaded');
    const { body } = VexSettingsGroups.dialog({ id: 'vex-zap-list', title: 'Hidden elements on ' + host, sub: 'Each rule hides one element of this site. Remove one and it comes back.' });
    const draw = () => {
      body.textContent = '';
      const zaps = ((this.boosts[host] || {}).zaps || []).slice();
      if (!zaps.length) { body.appendChild(VexSettingsGroups.note('Nothing is hidden on ' + host + '. Ctrl+K › Zap Element hides one.')); return; }
      for (const sel of zaps) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        const text = document.createElement('span');
        text.className = 'vexsr-host';
        text.style.wordBreak = 'break-all';
        text.textContent = sel;
        const rm = VexSettingsGroups.button('Remove', () => {
          try {
            this.removeZap(host, sel);
            window.VexUndo.offer({ message: 'Brought back a hidden element on ' + host, undo: () => { this.addZap(host, sel); if (body.isConnected) draw(); } });
            draw();
          } catch (err) { window.showToast?.(err.message, 'error'); }
        }, { danger: true, label: 'Remove the rule ' + sel });
        row.append(text, rm);
        body.appendChild(row);
      }
    };
    draw();
    return body;
  },

  // --- Boost editor: per-site custom CSS / JS ---
  openEditor(host) {
    host = host || this._activeHost();
    if (!host) { window.showToast?.('Open a page first'); return; }
    const b = this.boosts[host] || { zaps: [], css: '', js: '' };
    const esc = (s) => window.escapeHtml(s);
    document.getElementById('boost-edit-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'boost-edit-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Boost this site" style="width:560px;max-width:94vw;max-height:88vh;overflow-y:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:22px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">Boost ${esc(host)}</div>
      <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 14px">Custom CSS and JS applied to every page on this site. ${(b.zaps || []).length} zapped element${VexPlural.s((b.zaps || []).length)}.</p>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:5px">Custom CSS</label>
      <textarea id="bm-css" rows="6" spellcheck="false" placeholder="body { font-family: Georgia !important; }" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(b.css || '')}</textarea>
      <label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin:12px 0 5px">Custom JS (runs at page load)</label>
      <textarea id="bm-js" rows="5" spellcheck="false" placeholder="// document.querySelector('.paywall')?.remove()" style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;outline:none;resize:vertical;font-family:'JetBrains Mono',monospace">${esc(b.js || '')}</textarea>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px">
        <button id="bm-clear-zaps" style="padding:8px 14px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:12.5px"${(b.zaps || []).length ? '' : ' disabled'}>Un-zap all (${(b.zaps || []).length})</button>
        <span style="flex:1"></span>
        <button id="bm-cancel" style="padding:8px 16px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px">Cancel</button>
        <button id="bm-save" style="padding:8px 18px;background:var(--primary);color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600">Save &amp; apply</button>
      </div></div>`;
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'boosts' });
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#bm-cancel').addEventListener('click', () => m.remove());
    // Escape closes it like every other Vex window; it did nothing (found
    // 2026-09-29). An Escape a vexConfirm on top already used is left alone,
    // and the listener goes with the window however it was closed.
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); m.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
    // Focus moves in, so Escape reaches this even when it was opened from a
    // page, which kept the key (found 2026-09-29).
    m.querySelector('#bm-cancel').focus({ preventScroll: true });
    // At once, with Undo on the toast: the zaps come back in their order, and
    // hidden again on the open pages.
    m.querySelector('#bm-clear-zaps').addEventListener('click', () => {
      const zaps = [...(b.zaps || [])];
      b.zaps = [];
      if (!b.css && !b.js) delete this.boosts[host]; else this.boosts[host] = b;
      const saved = this.save();
      const tabs = this.refreshHost(host);
      m.remove();
      if (!saved) { window.showToast?.('Zaps cleared for now, but the change could not be saved — they return when you restart Vex', 'error'); return; }
      window.VexUndo.offer({
        message: `Brought back ${zaps.length} hidden element${VexPlural.s(zaps.length)} on ${host}${tabs ? ` — ${tabs} open tab${VexPlural.s(tabs)} updated` : ''}`,
        undo: () => this.restoreZaps(host, zaps),
      });
    });
    m.querySelector('#bm-save').addEventListener('click', () => {
      const hadJs = !!b.js;
      b.css = m.querySelector('#bm-css').value;
      b.js = m.querySelector('#bm-js').value;
      const emptied = !b.css && !b.js && !(b.zaps || []).length;
      if (emptied) delete this.boosts[host];
      else this.boosts[host] = b;
      const saved = this.save();
      const tabs = this.refreshHost(host) || (() => { const wv = this._activeWv(); if (wv) this.applyTo(wv, 'https://' + host + '/'); return 0; })();
      m.remove();
      if (!saved) { window.showToast?.('Applied for now, but the boost could not be saved — it resets when you restart Vex', 'error'); return; }
      window.showToast?.(emptied ? this._offMessage(hadJs, tabs) : 'Boost saved');
    });
  },

  // Un-zap all's Undo: the zaps back in their order (any zapped since stay,
  // after them), hidden again on the open pages. The site's JS is not run a
  // second time: it never left those pages.
  restoreZaps(host, zaps) {
    if (!host || !Array.isArray(zaps)) throw new Error('Nothing to put back');
    const b = this.boosts[host] || { zaps: [], css: '', js: '' };
    const since = (Array.isArray(b.zaps) ? b.zaps : []).filter(sel => !zaps.includes(sel));
    b.zaps = [...zaps, ...since];
    this.boosts[host] = b;
    const js = b.js;
    b.js = '';
    try { this.refreshHost(host); } finally { b.js = js; }
    if (!this.save()) throw new Error('The zaps could not be saved');
    return b.zaps.length;
  },

  // --- Settings → Boosts list ---
  renderPanel(container) {
    if (!container) return;
    const hosts = Object.keys(this.boosts).sort();
    const esc = (s) => window.escapeHtml(s);
    container.innerHTML = `<p class="setting-info muted" style="margin-bottom:10px">Per-site tweaks: hidden elements (zaps), custom CSS, and custom JS. Use <strong>Ctrl+K → "Zap Element"</strong> on any page, or <strong>"Boost This Site"</strong> for the editor.</p>`;
    if (!hosts.length) {
      container.innerHTML += '<div style="font-size:12.5px;color:var(--text-muted)">No boosted sites yet.</div>';
      return;
    }
    hosts.forEach(host => {
      const b = this.boosts[host];
      const bits = [];
      if ((b.zaps || []).length) bits.push((b.zaps || []).length + ' zap' + VexPlural.s((b.zaps || []).length));
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
        <button data-del aria-label="Delete boost for ${esc(host)}" title="Delete this boost" style="padding:5px 10px;background:var(--bg);color:var(--danger);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center">${window.VexIcons?.svg('trash', { size: 13 }) || 'Delete'}</button>`;
      row.querySelector('[data-edit]').addEventListener('click', () => this.openEditor(host));
      // Gone at once (its CSS out of the open pages); Undo on the toast puts
      // the zaps, CSS and JS back and applies them again.
      row.querySelector('[data-del]').addEventListener('click', () => {
        const hadJs = !!b.js;
        const kept = JSON.parse(JSON.stringify(b));
        delete this.boosts[host];
        const saved = this.save();
        this.refreshHost(host);
        this.renderPanel(container);
        if (!saved) { window.showToast?.('Removed for now, but the change could not be saved — the boost returns when you restart Vex', 'error'); return; }
        window.VexUndo.offer({
          message: 'Deleted the boost for ' + host + (hadJs ? ' — its JS already ran; reload the page to undo that' : ''),
          undo: () => {
            if (this.boosts[host]) throw new Error(host + ' has a boost again already');
            // Its JS never left the open pages, so only the zaps and CSS go
            // back on them; running the JS a second time would not be undoing.
            this.boosts[host] = { ...kept, js: '' };
            this.refreshHost(host);
            this.boosts[host] = kept;
            if (!this.save()) throw new Error('It could not be saved');
            if (container.isConnected) this.renderPanel(container);
          },
        });
      });
      container.appendChild(row);
    });
  },
};

if (typeof window !== 'undefined') window.VexBoosts = VexBoosts;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBoosts };
