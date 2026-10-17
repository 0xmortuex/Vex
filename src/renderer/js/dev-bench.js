// === Developer bench: the shared parts and the one Settings section ===========
// vex-layer-exempt: drawn inside the guest page (injected script), not a window overlay
//
// Eight small tools for working on code, each its own file and each switchable,
// all OFF until you turn them on in Settings > Developer bench:
//
//   js/bug-bundle.js            Copy bug report: console errors, failed requests, versions
//   js/response-overrides-ui.js Response overrides and header rules (localhost, banner while live)
//   js/selection-tools.js       Send a selection to one of your own MCP tools (with a confirm)
//   js/log-tailer.js            Follow one log file or a local websocket, read-only
//   js/error-memory.js          Remember which page fixed an error message
//   js/docs-pin.js              Pin a docs version per project; age of Stack Overflow answers
//   js/pkg-card.js              Age, licence, deprecation and advisories on npm / PyPI / crates pages
//   js/code-library.js          Code blocks saved with their source address and licence
//
// This file loads FIRST: a tool calls VexBench.register({...}) when its own file
// loads. It gathers their right-click rows for the page menu (js/webview.js asks
// three times: a selection, a link and the page), tells them when a page has
// settled (the vex:tab-settled event), puts a small card or bar INSIDE a page
// when a tool needs one, and draws the Settings section.
//
// Nothing here sends anything anywhere. Tools that read a page refuse private,
// Tor and routed tabs (VexTabPolicy.canReadWebview).
const VexBench = {
  _features: [],

  // A tool: { id, title, enabled(), setEnabled(on), settingsRows(box),
  //           textItems?(selection, webview, opts), linkItems?(url), pageItems?(webview),
  //           onSettled?(tab, webview) }
  register(feature) {
    if (!feature || !/^[a-z][a-z0-9-]{0,40}$/.test(String(feature.id || ''))) throw new Error('A developer bench tool needs an id of lowercase letters, digits and dashes');
    for (const fn of ['enabled', 'setEnabled', 'settingsRows']) if (typeof feature[fn] !== 'function') throw new Error('Developer bench tool ' + feature.id + ' needs ' + fn + '()');
    this._features = this._features.filter(f => f.id !== feature.id);
    this._features.push(feature);
    return feature.id;
  },
  features() { return this._features.slice(); },

  flag(key) {
    try { return localStorage.getItem(key) === 'true'; }
    catch (err) { console.error('[DevBench] a switch could not be read:', err); return false; }
  },
  setFlag(key, on) { localStorage.setItem(key, on ? 'true' : 'false'); },

  esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  toast(msg, kind) { if (typeof window !== 'undefined' && window.showToast) window.showToast(msg, kind); },
  fail(err) { this.toast((err && err.message) || 'That did not work', 'error'); },
  async copy(text, done) {
    await navigator.clipboard.writeText(String(text));
    this.toast(done || 'Copied');
  },
  // Wraps a menu action: an error is shown, never swallowed.
  safe(fn) { return () => { Promise.resolve().then(fn).catch((e) => this.fail(e)); }; },

  activeWebview() { return typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview ? WebviewManager.getActiveWebview() : null; },
  pageUrl(wv) {
    try { return (wv && wv.getURL && wv.getURL()) || ''; }
    catch (err) { console.error('[DevBench] the address of the page could not be read:', err); return ''; }
  },
  // Whether Vex may read, keep or look up things about this tab (not private, Tor or routed).
  canRead(wv) { return !!wv && typeof VexTabPolicy !== 'undefined' && VexTabPolicy.canReadWebview(wv); },

  // Right-click rows -------------------------------------------------------
  _items(method, ...args) {
    const out = [];
    for (const f of this._features) {
      if (typeof f[method] !== 'function' || !f.enabled()) continue;
      try { out.push(...f[method](...args)); }
      catch (err) { console.error('[DevBench] ' + f.id + ' could not make its menu rows:', err); }
    }
    return out;
  },
  textItems(selection, webview, opts) {
    const sel = String(selection == null ? '' : selection);
    return sel.trim() ? this._items('textItems', sel, webview, opts || {}) : [];
  },
  linkItems(url) { return /^https?:\/\//i.test(String(url || '')) ? this._items('linkItems', String(url)) : []; },
  pageItems(webview) { return this._items('pageItems', webview); },

  // A page has settled ------------------------------------------------------
  onSettled(tabId) {
    const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => t.id === tabId) : null;
    const wv = this.activeWebview();
    if (!tab || !wv || (TabManager.activeTabId !== tabId)) return;
    for (const f of this._features) {
      if (typeof f.onSettled !== 'function' || !f.enabled()) continue;
      Promise.resolve().then(() => f.onSettled(tab, wv)).catch(err => {
        if (typeof VexProblems !== 'undefined') VexProblems.note(f.title || f.id, 'could not look at this page', err);
        else console.error('[DevBench] ' + f.id + ':', err);
      });
    }
  },

  // A card or bar inside the page ---------------------------------------------
  // spec: { id, mode: 'card'|'bar', tone: 'ok'|'caution'|'warning'|'info', title, rows: [[k, v]],
  //         lines: [text], actions: [{ label, copy? , href? }] }. Everything is set with
  // textContent in a closed shadow root, so nothing the page says can run or restyle it.
  async inPage(wv, spec) {
    const code = '(' + function (s) {
      const old = document.getElementById(s.id);
      if (old) old.remove();
      const host = document.createElement('div');
      host.id = s.id;
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;' + (s.mode === 'bar' ? 'top:0;left:0;right:0;' : 'right:16px;bottom:16px;max-width:340px;');
      const root = host.attachShadow({ mode: 'closed' });
      const tones = { ok: '#3fb950', caution: '#d29922', warning: '#f85149', info: '#58a6ff' };
      const css = document.createElement('style');
      css.textContent = ':host{all:initial}.b{font:13px/1.45 system-ui,Segoe UI,sans-serif;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-left:4px solid ' + (tones[s.tone] || tones.info)
        + ';border-radius:8px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.45);' + (s.mode === 'bar' ? 'border-radius:0;display:flex;gap:12px;align-items:center;flex-wrap:wrap;' : '') + '}'
        + '.t{font-weight:600;margin-bottom:4px}.r{display:flex;gap:8px;justify-content:space-between}.k{color:#8b949e}.l{margin-top:4px}'
        + 'button,a{font:12px system-ui,sans-serif;color:#e6edf3;background:#21262d;border:1px solid #30363d;border-radius:6px;padding:3px 9px;margin:6px 6px 0 0;cursor:pointer;text-decoration:none;display:inline-block}'
        + 'button:hover,a:hover{background:#30363d}';
      const box = document.createElement('div');
      box.className = 'b';
      box.setAttribute('role', 'status');
      if (s.title) { const t = document.createElement('div'); t.className = 't'; t.textContent = s.title; box.appendChild(t); }
      for (const [k, v] of s.rows || []) {
        const r = document.createElement('div'); r.className = 'r';
        const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
        const b = document.createElement('span'); b.textContent = v;
        r.append(a, b); box.appendChild(r);
      }
      for (const line of s.lines || []) { const l = document.createElement('div'); l.className = 'l'; l.textContent = line; box.appendChild(l); }
      const bar = document.createElement('div');
      for (const act of s.actions || []) {
        let el;
        if (act.href && /^https?:\/\//i.test(act.href)) { el = document.createElement('a'); el.href = act.href; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
        else { el = document.createElement('button'); el.type = 'button'; }
        el.textContent = act.label;
        if (act.scrollTo) el.addEventListener('click', () => { const t = document.getElementById(act.scrollTo); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        if (typeof act.copy === 'string') {
          el.addEventListener('click', () => {
            navigator.clipboard.writeText(act.copy).then(() => { el.textContent = 'Copied'; }, () => { el.textContent = 'Copy failed'; });
          });
        }
        bar.appendChild(el);
      }
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = 'Dismiss'; close.addEventListener('click', () => host.remove());
      bar.appendChild(close);
      box.appendChild(bar);
      root.append(css, box);
      document.documentElement.appendChild(host);
    }.toString() + ')(' + JSON.stringify(spec) + ')';
    await wv.executeJavaScript(code);
  },
  async clearInPage(wv, id) {
    await wv.executeJavaScript('(function(){var e=document.getElementById(' + JSON.stringify(id) + ');if(e)e.remove();})()');
  },

  // Settings --------------------------------------------------------------
  renderSettings(body) {
    const note = document.createElement('p');
    note.className = 'setting-info muted';
    note.textContent = 'Small tools for working on code. Every one is off until you switch it on here. None runs a command or sends anything anywhere without you asking.';
    body.appendChild(note);
    for (const f of this._features) {
      const box = document.createElement('div');
      box.style.cssText = 'border-top:1px solid var(--border);padding-top:8px;margin-top:8px';
      box.appendChild(VexSettingsGroup.toggle(f.title || f.id, f.enabled(), (on) => { f.setEnabled(on); if (typeof VexSettingsGroups !== 'undefined') VexSettingsGroups.inject(); }, f.hint || ''));
      if (f.enabled()) {
        try { f.settingsRows(box); }
        catch (err) {
          console.error('[DevBench] ' + f.id + ' could not draw its settings:', err);
          box.appendChild(VexSettingsGroup.note('This tool could not be shown: ' + ((err && err.message) || err)));
        }
      }
      body.appendChild(box);
    }
  },
};

if (typeof window !== 'undefined') {
  window.VexBench = VexBench;
  document.addEventListener('vex:tab-settled', (e) => { if (e && e.detail) VexBench.onSettled(e.detail.tabId); });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'dev-bench',
      title: 'Developer bench',
      keywords: 'developer bug report console network override response header mcp tool log tail serial qemu error memory docs version stack overflow package npm pypi crates code library snippet licence license',
      before: 'about',
      render: (body) => VexBench.renderSettings(body),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexBench };
