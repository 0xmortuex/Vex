// === Scriptable page actions ===
//
// Small scripts you write per site — "click Accept, scroll to comments" — and
// run on demand from Ctrl+K. They are plain text you can read, one step per
// line, in a deliberately tiny language (NOT JavaScript):
//
//   # a comment
//   click "Accept all"            click the button/link whose text has these words
//   click selector: #accept       click the first element matching a CSS selector
//   scroll to "Comments"          scroll a heading/section with these words into view
//   scroll to selector: #comments
//   scroll top   |   scroll bottom
//   wait 500                      milliseconds, at most 5000 per step
//   hide selector: .newsletter    hide matching elements until the page reloads
//   type selector: #q = "text"    put text in a field (never submits)
//
// What keeps it safe:
//   - Off until you turn it on; turning it on shows a warning you must accept.
//   - A script is bound to ONE exact origin (https://example.com — scheme, host
//     and port) and refuses to run anywhere else.
//   - It runs only when you ask, unless you mark that script "auto-run" for its
//     origin, which also asks first.
//   - The language has no way to make a request, read cookies, storage or page
//     data back out, or run code: a step is a click, a scroll, a wait, a hide
//     or a typed value, performed by a fixed interpreter below.
//   - Never in a private window, a private tab, a Tor tab or a routed tab.
//
// Stored in 'vex.pageActions'; not part of Vex Sync.

const PageActions = {
  KEY: 'vex.pageActions',
  MAX_STEPS: 40,
  MAX_SOURCE: 4000,
  MAX_WAIT: 5000,
  MAX_SCRIPTS: 100,

  // --- the language ------------------------------------------------------
  // → { steps, errors:[{line, message}] }
  parse(source) {
    const steps = [], errors = [];
    const text = String(source == null ? '' : source);
    if (text.length > this.MAX_SOURCE) return { steps, errors: [{ line: 0, message: 'The script is longer than ' + this.MAX_SOURCE + ' characters' }] };
    const lines = text.split(/\r?\n/);
    const quoted = (s) => { const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim()); return m ? m[1].replace(/\\(.)/g, '$1') : null; };
    const selectorOf = (s) => {
      const m = /^selector\s*:\s*(.+)$/i.exec(s.trim());
      return m ? m[1].trim() : null;
    };
    lines.forEach((raw, i) => {
      const line = i + 1;
      const t = raw.trim();
      if (!t || t.startsWith('#')) return;
      const fail = (message) => errors.push({ line, message });
      if (steps.length >= this.MAX_STEPS) { if (steps.length === this.MAX_STEPS) { fail('A script has at most ' + this.MAX_STEPS + ' steps'); steps.push(null); } return; }
      let m;
      if ((m = /^click\s+(.+)$/i.exec(t))) {
        const sel = selectorOf(m[1]); const q = quoted(m[1]);
        if (sel) steps.push({ op: 'click', by: 'selector', value: sel });
        else if (q) steps.push({ op: 'click', by: 'text', value: q });
        else fail('click needs "some words" or selector: …');
      } else if ((m = /^scroll\s+to\s+(.+)$/i.exec(t))) {
        const sel = selectorOf(m[1]); const q = quoted(m[1]);
        if (sel) steps.push({ op: 'scroll', by: 'selector', value: sel });
        else if (q) steps.push({ op: 'scroll', by: 'text', value: q });
        else fail('scroll to needs "some words" or selector: …');
      } else if ((m = /^scroll\s+(top|bottom)$/i.exec(t))) {
        steps.push({ op: 'scroll', by: m[1].toLowerCase(), value: '' });
      } else if ((m = /^wait\s+(\d{1,5})$/i.exec(t))) {
        const ms = Number(m[1]);
        if (ms > this.MAX_WAIT) fail('wait is at most ' + this.MAX_WAIT + ' milliseconds');
        else steps.push({ op: 'wait', by: '', value: String(ms) });
      } else if ((m = /^hide\s+(.+)$/i.exec(t))) {
        const sel = selectorOf(m[1]);
        if (sel) steps.push({ op: 'hide', by: 'selector', value: sel });
        else fail('hide needs selector: …');
      } else if ((m = /^type\s+selector\s*:\s*(.+?)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/i.exec(t))) {
        steps.push({ op: 'type', by: 'selector', value: m[1].trim(), text: quoted(m[2]) });
      } else {
        fail('Not a step: ' + t.slice(0, 60));
      }
    });
    return { steps: steps.filter(Boolean), errors };
  },

  // The fixed interpreter handed to the guest. `steps` goes in as JSON data;
  // nothing the user wrote is ever concatenated into the code. It returns one
  // short line per step. No fetch, no storage, no eval.
  guestCode(steps) {
    const data = JSON.stringify(steps.map(s => ({ op: s.op, by: s.by, value: String(s.value == null ? '' : s.value).slice(0, 500), text: s.text == null ? '' : String(s.text).slice(0, 500) })));
    return `(async function(){
  var steps = ${data};
  var out = [];
  var norm = function(s){ return String(s||'').replace(/\\s+/g,' ').trim().toLowerCase(); };
  var visible = function(el){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var byText = function(sel, want){
    var w = norm(want); var all = document.querySelectorAll(sel);
    for (var i = 0; i < all.length; i++) {
      var el = all[i]; var t = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '');
      if (t && t.indexOf(w) !== -1 && visible(el)) return el;
    }
    return null;
  };
  var find = function(s, textSel){
    if (s.by === 'selector') { var el = document.querySelector(s.value); return el; }
    return byText(textSel, s.value);
  };
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  for (var n = 0; n < steps.length; n++) {
    var s = steps[n]; var label = (n + 1) + ' ' + s.op;
    try {
      if (s.op === 'wait') { await sleep(Math.min(5000, Number(s.value) || 0)); out.push(label + ': ok'); continue; }
      if (s.op === 'scroll' && s.by === 'top') { window.scrollTo({ top: 0, behavior: 'smooth' }); out.push(label + ': ok'); continue; }
      if (s.op === 'scroll' && s.by === 'bottom') { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); out.push(label + ': ok'); continue; }
      var el = null;
      if (s.op === 'click') el = find(s, 'a,button,[role=button],input[type=button],input[type=submit],summary,label');
      else if (s.op === 'scroll') el = find(s, 'h1,h2,h3,h4,h5,h6,section,article,[id],[role=heading]');
      else el = s.by === 'selector' ? document.querySelector(s.value) : null;
      if (!el) { out.push(label + ': not found'); continue; }
      if (s.op === 'click') { el.click(); }
      else if (s.op === 'scroll') { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (s.op === 'hide') { document.querySelectorAll(s.value).forEach(function(x){ x.style.setProperty('display', 'none', 'important'); }); }
      else if (s.op === 'type') { el.focus(); el.value = s.text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      out.push(label + ': ok');
    } catch (e) { out.push(label + ': ' + String(e && e.message || e).slice(0, 80)); }
  }
  return out;
})()`;
  },

  // --- storage ----------------------------------------------------------
  _load() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { raw = null; }
    const out = { enabled: false, scripts: [] };
    if (!raw || typeof raw !== 'object') return out;
    out.enabled = raw.enabled === true;
    if (Array.isArray(raw.scripts)) {
      out.scripts = raw.scripts.filter(s => s && typeof s === 'object'
        && typeof s.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(s.id)
        && typeof s.name === 'string' && typeof s.origin === 'string' && /^https?:\/\/[^/]+$/i.test(s.origin)
        && typeof s.source === 'string' && s.source.length <= this.MAX_SOURCE)
        .map(s => ({ id: s.id, name: s.name.slice(0, 80), origin: s.origin.toLowerCase(), source: s.source, autoRun: s.autoRun === true }))
        .slice(0, this.MAX_SCRIPTS);
    }
    return out;
  },
  _save(state) {
    try { localStorage.setItem(this.KEY, JSON.stringify(state)); }
    catch (err) { throw new Error('The page actions could not be saved: ' + ((err && err.message) || err)); }
  },

  // True only when a person has turned it on, outside a private window.
  available() { return !this._privateWindow(); },
  _privateWindow() { return !!(typeof window !== 'undefined' && window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow); },
  enabled() { return this.available() && this._load().enabled; },
  scripts() { return this._load().scripts; },
  originOf(url) { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin.toLowerCase() : ''; } catch { return ''; } },

  async setEnabled(on) {
    if (this._privateWindow()) throw new Error('Page actions are not available in a private window');
    const state = this._load();
    if (on && !state.enabled) {
      const ok = await vexConfirm({
        title: 'Turn on page actions?',
        message: 'A page action is a short script you write that clicks, scrolls, hides or fills things on a site. It can act as you on that site (for example, click "Buy" or "Delete") exactly as if you had done it yourself.\n\nIt runs only on the one site you bound it to, only when you pick it from Ctrl+K (unless you mark it auto-run), and never in private or Tor tabs. Only write or paste scripts you have read and understand.',
        okLabel: 'Turn on',
      });
      if (!ok) return false;
    }
    state.enabled = !!on;
    this._save(state);
    this._registerCommands();
    return state.enabled;
  },

  add({ name, origin, source }) {
    if (this._privateWindow()) throw new Error('Page actions are not available in a private window');
    const n = String(name || '').trim().slice(0, 80);
    if (!n) throw new Error('Give the script a name');
    const o = this.originOf(origin);
    if (!o) throw new Error('A script needs the exact site it belongs to, such as https://example.com');
    const parsed = this.parse(source);
    if (parsed.errors.length) throw new Error('Line ' + parsed.errors[0].line + ': ' + parsed.errors[0].message);
    if (!parsed.steps.length) throw new Error('The script has no steps');
    const state = this._load();
    if (state.scripts.length >= this.MAX_SCRIPTS) throw new Error('That is the most scripts Vex keeps (' + this.MAX_SCRIPTS + ')');
    const id = 'pa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.scripts.push({ id, name: n, origin: o, source: String(source), autoRun: false });
    this._save(state);
    this._registerCommands();
    return id;
  },

  update(id, { name, source }) {
    const state = this._load();
    const s = state.scripts.find(x => x.id === id);
    if (!s) throw new Error('That script no longer exists');
    if (source != null) {
      const parsed = this.parse(source);
      if (parsed.errors.length) throw new Error('Line ' + parsed.errors[0].line + ': ' + parsed.errors[0].message);
      if (!parsed.steps.length) throw new Error('The script has no steps');
      s.source = String(source);
      // A changed script is a different script: it asks again before running by itself.
      s.autoRun = false;
    }
    if (name != null) { const n = String(name).trim().slice(0, 80); if (!n) throw new Error('Give the script a name'); s.name = n; }
    this._save(state);
    this._registerCommands();
  },

  remove(id) {
    const state = this._load();
    state.scripts = state.scripts.filter(s => s.id !== id);
    this._save(state);
    this._registerCommands();
  },

  async setAutoRun(id, on) {
    const state = this._load();
    const s = state.scripts.find(x => x.id === id);
    if (!s) throw new Error('That script no longer exists');
    if (on) {
      const ok = await vexConfirm({
        title: 'Run "' + s.name + '" by itself?',
        message: 'It will run every time a page on ' + s.origin + ' finishes loading, without asking, and click, scroll or fill things as you. Read the script again before you agree.',
        okLabel: 'Auto-run on ' + s.origin.replace(/^https?:\/\//, ''),
      });
      if (!ok) return false;
    }
    s.autoRun = !!on;
    this._save(state);
    return s.autoRun;
  },

  // --- running -----------------------------------------------------------
  // Why a webview may not run page actions ('' = it may).
  refusal(webview, url) {
    if (this._privateWindow()) return 'Page actions are not available in a private window';
    if (!webview) return 'There is no page to act on';
    const p = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    if (!p || typeof p.canReadWebview !== 'function' || !p.canReadWebview(webview)) return 'Page actions are not available in private, Tor or routed tabs';
    if (!this.originOf(url)) return 'Page actions work on web pages only';
    return '';
  },

  async run(id, { auto = false } = {}) {
    const state = this._load();
    if (!state.enabled || !this.available()) throw new Error('Page actions are turned off (Settings › Boosts)');
    const s = state.scripts.find(x => x.id === id);
    if (!s) throw new Error('That script no longer exists');
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = tab && typeof WebviewManager !== 'undefined' ? WebviewManager.webviews.get(tab.id) : null;
    return this._runOn(s, tab, wv, auto);
  },

  async _runOn(s, tab, wv, auto) {
    const url = tab ? tab.url : '';
    const why = this.refusal(wv, url);
    if (why) throw new Error(why);
    if (this.originOf(url) !== s.origin) throw new Error('"' + s.name + '" is for ' + s.origin + ', not this page');
    const parsed = this.parse(s.source);
    if (parsed.errors.length || !parsed.steps.length) throw new Error('The script has an error: ' + (parsed.errors[0] ? 'line ' + parsed.errors[0].line + ' — ' + parsed.errors[0].message : 'no steps'));
    const total = parsed.steps.reduce((t, st) => t + (st.op === 'wait' ? Number(st.value) : 0), 0);
    if (total > 15000) throw new Error('The script waits more than 15 seconds in total');
    const result = await wv.executeJavaScript(this.guestCode(parsed.steps));
    const lines = Array.isArray(result) ? result.map(x => String(x).slice(0, 100)) : [];
    const bad = lines.filter(l => !/: ok$/.test(l));
    if (!auto || bad.length) {
      window.showToast?.(bad.length ? s.name + ': ' + bad.join('; ') : s.name + ': done', bad.length ? 'error' : undefined);
    }
    return lines;
  },

  // --- the editor --------------------------------------------------------
  edit(id) {
    const existing = id ? this._load().scripts.find(s => s.id === id) : null;
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const origin = existing ? existing.origin : (tab ? this.originOf(tab.url) : '');
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.getElementById('vex-pageaction-edit')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-pageaction-edit';
    m.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Page action" style="width:520px;max-width:94vw;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5))">
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:10px">${existing ? 'Edit page action' : 'New page action'}</div>
      <label style="font-size:12px;color:var(--text-muted)">Name</label>
      <input id="pa-name" class="set-input" type="text" maxlength="80" value="${esc(existing ? existing.name : '')}" style="width:100%;margin:4px 0 10px">
      <label style="font-size:12px;color:var(--text-muted)">Site (exact origin, runs nowhere else)</label>
      <input id="pa-origin" class="set-input" type="text" value="${esc(origin)}" ${existing ? 'readonly' : ''} style="width:100%;margin:4px 0 10px">
      <label style="font-size:12px;color:var(--text-muted)">Steps</label>
      <textarea id="pa-source" spellcheck="false" rows="9" style="width:100%;margin:4px 0 6px;font-family:'JetBrains Mono',monospace;font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical">${esc(existing ? existing.source : '# One step per line\nclick "Accept all"\nscroll to "Comments"')}</textarea>
      <div id="pa-errors" role="status" style="font-size:11.5px;color:var(--danger,#ef4444);min-height:16px;margin-bottom:6px"></div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:12px">Steps: click "words" · click selector: … · scroll to "words" · scroll top/bottom · wait 500 · hide selector: … · type selector: … = "text"</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="pa-cancel" type="button" class="btn-secondary" style="padding:8px 14px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;cursor:pointer">Cancel</button>
        <button id="pa-save" type="button" class="btn-primary" style="padding:8px 14px;background:var(--primary,var(--accent));color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-weight:600">Save</button>
      </div>
    </div>`;
    document.body.appendChild(m);
    const q = (s) => m.querySelector(s);
    const check = () => {
      const r = this.parse(q('#pa-source').value);
      q('#pa-errors').textContent = r.errors.length ? 'Line ' + r.errors[0].line + ': ' + r.errors[0].message : '';
      return r;
    };
    q('#pa-source').addEventListener('input', check);
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    q('#pa-cancel').addEventListener('click', close);
    q('#pa-save').addEventListener('click', () => {
      try {
        if (existing) this.update(existing.id, { name: q('#pa-name').value, source: q('#pa-source').value });
        else this.add({ name: q('#pa-name').value, origin: q('#pa-origin').value, source: q('#pa-source').value });
      } catch (err) { q('#pa-errors').textContent = err.message; return; }
      close();
      window.showToast?.('Page action saved');
      if (typeof SettingsUI !== 'undefined' && document.querySelector('#setting-page-actions')) this.renderSettings(document.querySelector('#setting-page-actions .vex-module-group-body'));
    });
    check();
    setTimeout(() => q('#pa-name').focus(), 30);
    return m;
  },

  // --- Settings › Boosts --------------------------------------------------
  renderSettings(container) {
    if (!container) return;
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    if (!this.available()) { container.innerHTML = '<div class="muted" style="font-size:12px">Page actions are not available in a private window.</div>'; return; }
    const state = this._load();
    container.innerHTML = `
      <p class="setting-info muted" style="margin-bottom:10px">Small scripts you write per site (click a button, scroll to a section) and run from Ctrl+K. Off until you turn it on; never in private or Tor tabs; they cannot make requests or read the page back.</p>
      <label class="setting-toggle-row" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input type="checkbox" id="pa-enabled" ${state.enabled ? 'checked' : ''} aria-label="Turn on page actions"><span>Turn on page actions</span>
      </label>
      <div id="pa-list">${state.scripts.map(s => `
        <div class="site-settings-row" data-id="${esc(s.id)}">
          <div class="site-settings-info">
            <div class="site-settings-host">${esc(s.name)}</div>
            <div class="site-settings-what">${esc(s.origin)}${s.autoRun ? ' · runs by itself' : ''}</div>
          </div>
          <label style="font-size:11.5px;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" data-act="auto" ${s.autoRun ? 'checked' : ''} ${state.enabled ? '' : 'disabled'}>Auto-run</label>
          <button type="button" class="btn-secondary-sm" data-act="edit">Edit</button>
          <button type="button" class="btn-secondary-sm" data-act="delete">Delete</button>
        </div>`).join('')}</div>
      <button type="button" class="btn-secondary" id="pa-new" style="margin-top:8px" ${state.enabled ? '' : 'disabled'}>New page action for the open site</button>`;
    const again = () => this.renderSettings(container);
    container.querySelector('#pa-enabled').addEventListener('change', async (e) => {
      try { await this.setEnabled(e.target.checked); } catch (err) { window.showToast?.(err.message, 'error'); }
      again();
    });
    container.querySelector('#pa-new').addEventListener('click', () => this.edit(null));
    container.querySelectorAll('[data-act]').forEach(el => {
      const id = el.closest('[data-id]') && el.closest('[data-id]').dataset.id;
      if (!id) return;
      const act = el.dataset.act;
      el.addEventListener(act === 'auto' ? 'change' : 'click', async () => {
        try {
          if (act === 'edit') this.edit(id);
          else if (act === 'auto') await this.setAutoRun(id, el.checked);
          else if (act === 'delete') {
            const s = this._load().scripts.find(x => x.id === id);
            if (await vexConfirm({ title: 'Delete page action?', message: 'Delete "' + (s ? s.name : '') + '"?', okLabel: 'Delete', danger: true })) this.remove(id);
          }
        } catch (err) { window.showToast?.(err.message, 'error'); }
        again();
      });
    });
  },

  // --- Ctrl+K ------------------------------------------------------------
  _registerCommands() {
    if (typeof window === 'undefined' || !window.VexModuleCommands) return;
    const list = [];
    if (this.enabled()) {
      list.push({
        id: 'pageaction:new', label: 'New page action for this site', hint: 'Write a small click-and-scroll script for the open site', icon: 'terminal',
        action: () => { try { this.edit(null); } catch (err) { window.showToast?.(err.message, 'error'); } },
      });
      for (const s of this._load().scripts) {
        list.push({
          id: 'pageaction:run:' + s.id, label: 'Run page action: ' + s.name, hint: s.origin, icon: 'play',
          action: async () => { try { await this.run(s.id); } catch (err) { window.showToast?.(err.message, 'error'); } },
        });
      }
    } else {
      list.push({
        id: 'pageaction:enable', label: 'Page actions (turn on)', hint: 'Small per-site scripts you write: click, scroll, hide. Off by default', icon: 'terminal',
        action: async () => { try { await this.setEnabled(true); } catch (err) { window.showToast?.(err.message, 'error'); } },
      });
    }
    VexModuleCommands.set('pageaction:', list);
  },

  // Auto-run: only a script the person marked, only for its exact origin, once
  // per page load, never where page actions are refused.
  _onSettled(e) {
    if (!this.enabled()) return;
    const id = e && e.detail && e.detail.tabId;
    if (!id || typeof TabManager === 'undefined' || typeof WebviewManager === 'undefined') return;
    const tab = (TabManager.tabs || []).find(t => t.id === id);
    const wv = WebviewManager.webviews && WebviewManager.webviews.get(id);
    if (!tab || !wv || this.refusal(wv, tab.url)) return;
    const origin = this.originOf(tab.url);
    for (const s of this._load().scripts) {
      if (!s.autoRun || s.origin !== origin) continue;
      this._runOn(s, tab, wv, true).catch(err => console.error('[PageActions] auto-run failed:', err.message));
    }
  },

  init() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('vex:tab-settled', (e) => this._onSettled(e));
    if (window.VexSettingsGroups) {
      VexSettingsGroups.register({ id: 'page-actions', title: 'Page actions — boost scripts', render: (c) => this.renderSettings(c) });
    }
    this._registerCommands();
  },
};

if (typeof window !== 'undefined') { window.PageActions = PageActions; PageActions.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { PageActions };
