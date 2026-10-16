// === Text snippets in any web field (T2-017) =================================
//
// Type ":addr" and press Tab or Space in a text box on any page and it becomes
// the address you saved. A snippet may carry {date} {time} {title} {url}
// {selection} {user} and {cursor}.
//
// What it will not do, by construction:
//   * it only acts on a real key press (event.isTrusted) of Tab or Space: it never
//     presses Enter or a send button, and a page cannot make it expand by script;
//   * it never touches a password field, a card / payment / one-time-code field, a
//     field whose name looks like a secret, or any field of a form that has a password
//     or a card box;
//   * it is not put into private, Tor or routed tabs (VexTabPolicy.canReadWebview);
//   * the page-side script is fixed (this file's two functions, below) and the only
//     thing sent to the page is the list of snippets as JSON data; it is never built
//     from page text and the page cannot read the list back (it lives in a closure);
//   * per site off: Settings, "Off on this site".
//
// The two page-side functions run INSIDE the page (their source is sent to it), so
// they use nothing from this file. The pure one is tested directly.

// -> { value, caret, text } or null. `ctx` fills the placeholders.
function vexSnippetExpand(value, caret, snippets, ctx) {
  var before = String(value).slice(0, caret);
  var m = /(^|\s)(:[a-z0-9_-]{1,24})$/i.exec(before);
  if (!m) return null;
  var trig = m[2].toLowerCase();
  var hit = null;
  for (var i = 0; i < snippets.length; i++) { if (snippets[i].t === trig) { hit = snippets[i]; break; } }
  if (!hit) return null;
  var c = ctx || {};
  var text = String(hit.x).replace(/\{(date|time|title|url|selection|user)\}/g, function (_, k) { return c[k] == null ? '' : String(c[k]); });
  var at = text.indexOf('{cursor}');
  var clean = text.replace(/\{cursor\}/g, '');
  var start = before.length - m[2].length;
  var out = String(value).slice(0, start) + clean + String(value).slice(caret);
  return { value: out, caret: start + (at >= 0 ? at : clean.length), text: clean, start: start, end: caret };
}

function vexSnippetsInstall(expand, cfg) {
  if (window.__vexSnip) { window.__vexSnip.set(cfg); return 'updated'; }
  var state = cfg;
  var SECRET = /pass|pwd|pin|cvv|cvc|card|ccnum|ssn|otp|token|secret|iban|security|verification|auth|account.?num|routing|expir|cardholder|checkout|payment/i;
  var AUTO = /cc-|password|one-time-code|username|current-|new-/i;
  var TYPES = { text: 1, search: 1, url: 1, '': 1 };
  function safeField(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' && !(String(el.getAttribute('type') || '').toLowerCase() in TYPES)) return false;
    if (el.disabled || el.readOnly) return false;
    if (SECRET.test((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || ''))) return false;
    if (AUTO.test(el.getAttribute('autocomplete') || '')) return false;
    var form = el.form || (el.closest && el.closest('form'));
    if (form && form.querySelector('input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"]')) return false;
    if (!form && document.querySelector('input[type="password"]')) return false;
    return true;
  }
  function ctxNow() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var sel = '';
    try { sel = String(window.getSelection() || '').slice(0, 500); } catch (e) { sel = ''; }
    return { date: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), time: p(d.getHours()) + ':' + p(d.getMinutes()), title: document.title, url: location.href.split('#')[0], selection: sel, user: state.user || '' };
  }
  function onKey(e) {
    if (!state.on || !e.isTrusted || e.defaultPrevented) return;
    if (e.key !== 'Tab' && e.key !== ' ') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'input') {
      if (!safeField(el)) return;
      var caret = el.selectionStart;
      if (caret == null || caret !== el.selectionEnd) return;
      var r = expand(el.value, caret, state.snippets, ctxNow());
      if (!r) return;
      e.preventDefault(); e.stopPropagation();
      var proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      var tail = e.key === ' ' ? ' ' : '';
      setter.call(el, r.value.slice(0, r.start) + r.text + tail + r.value.slice(r.start + r.text.length));
      var pos = r.caret + (r.caret === r.start + r.text.length ? tail.length : 0);
      el.setSelectionRange(pos, pos);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (el.isContentEditable) {
      if (document.querySelector('input[type="password"]')) return;
      var sel = window.getSelection();
      if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return;
      var node = sel.anchorNode, off = sel.anchorOffset;
      var rr = expand(node.data, off, state.snippets, ctxNow());
      if (!rr) return;
      e.preventDefault(); e.stopPropagation();
      var range = document.createRange();
      range.setStart(node, rr.start); range.setEnd(node, off);
      sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('insertText', false, rr.text + (e.key === ' ' ? ' ' : ''));
    }
  }
  document.addEventListener('keydown', onKey, true);
  window.__vexSnip = { set: function (c) { state = c; } };
  return 'installed';
}

const VexSnippets = {
  KEY: 'vex.textSnippets',
  PREFS_KEY: 'vex.textSnippets.prefs',
  MAX: 100,
  MAX_TEXT: 2000,
  TRIGGER: /^:[a-z0-9_-]{1,24}$/,

  // ---- storage ------------------------------------------------------------------
  _read(key, fallback) {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  },
  list() { const v = this._read(this.KEY, []); return Array.isArray(v) ? v.filter(s => s && this.TRIGGER.test(s.trigger) && typeof s.text === 'string') : []; },
  prefs() { const p = this._read(this.PREFS_KEY, {}); return { enabled: p.enabled !== false, offSites: Array.isArray(p.offSites) ? p.offSites.filter(x => typeof x === 'string') : [] }; },
  _savePrefs(p) { localStorage.setItem(this.PREFS_KEY, JSON.stringify(p)); },
  enabled() { return this.prefs().enabled; },
  setEnabled(on) { this._savePrefs({ ...this.prefs(), enabled: !!on }); this.refreshAll(); },

  normTrigger(t) {
    let s = String(t == null ? '' : t).trim().toLowerCase();
    if (s && s[0] !== ':') s = ':' + s;
    if (!this.TRIGGER.test(s)) throw new Error('A trigger is a colon and 1 to 24 letters, digits, dashes or underscores, like :addr');
    return s;
  },
  save(trigger, text) {
    const t = this.normTrigger(trigger);
    const x = String(text == null ? '' : text);
    if (!x.trim()) throw new Error('A snippet needs some text');
    if (x.length > this.MAX_TEXT) throw new Error('A snippet can be at most ' + this.MAX_TEXT + ' characters');
    const all = this.list().filter(s => s.trigger !== t);
    if (all.length >= this.MAX) throw new Error('You can keep at most ' + this.MAX + ' snippets');
    all.push({ trigger: t, text: x });
    all.sort((a, b) => a.trigger.localeCompare(b.trigger));
    localStorage.setItem(this.KEY, JSON.stringify(all));
    this.refreshAll();
    return t;
  },
  remove(trigger) {
    localStorage.setItem(this.KEY, JSON.stringify(this.list().filter(s => s.trigger !== trigger)));
    this.refreshAll();
  },

  // ---- per site -------------------------------------------------------------------
  hostOf(url) { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; } },
  siteOff(url) { const h = this.hostOf(url); return !!h && this.prefs().offSites.includes(h); },
  setSiteOff(url, off) {
    const h = this.hostOf(url);
    if (!h) throw new Error('Open a web page first');
    const p = this.prefs();
    const sites = p.offSites.filter(x => x !== h);
    if (off) sites.push(h);
    this._savePrefs({ ...p, offSites: sites.slice(-200) });
    this.refreshAll();
  },

  // ---- the page -----------------------------------------------------------------
  script(url) {
    const on = this.enabled() && !this.siteOff(url);
    const cfg = { on, snippets: on ? this.list().map(s => ({ t: s.trigger, x: s.text })) : [], user: this._user() };
    return '(' + vexSnippetsInstall.toString() + ')(' + vexSnippetExpand.toString() + ',' + JSON.stringify(cfg) + ')';
  },
  _user() {
    if (typeof FormFill === 'undefined' || typeof FormFill._load !== 'function') return '';
    const p = FormFill._load();
    return String((p && p.fullName) || '').slice(0, 80);
  },
  _mayInject(wv, url) {
    if (!this.hostOf(url)) return false;
    const policy = typeof window !== 'undefined' ? window.VexTabPolicy : null;
    return !!policy && policy.canReadWebview(wv);
  },
  // Called on a page's dom-ready (js/webview.js) and after every change.
  async applyTo(wv, url) {
    if (!this._mayInject(wv, url)) return false;
    if (!this.enabled() && !wv.__vexSnipOn) return false;   // never reached, nothing to switch off
    if (!this.list().length && !wv.__vexSnipOn) return false;
    await wv.executeJavaScript(this.script(url), false);
    wv.__vexSnipOn = true;
    return true;
  },
  refreshAll() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    for (const wv of WebviewManager.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }       // not attached yet: its dom-ready applies it
      this.applyTo(wv, url).catch(err => window.VexProblems?.note('Text snippets', 'Could not update a page', err));
    }
  },

  // ---- Settings ---------------------------------------------------------------------
  currentUrl() {
    if (typeof TabManager === 'undefined') return '';
    const t = TabManager.getActiveTab && TabManager.getActiveTab();
    return (t && t.url) || '';
  },
  render(body) {
    const G = window.VexSettingsGroups;
    const note = G.note('Type a trigger like :addr in a text box and press Tab or Space. Placeholders: {date} {time} {title} {url} {selection} {user} {cursor}. Never in password, card or payment fields, never presses Enter or Send.');
    const list = document.createElement('div');
    const draw = () => {
      list.textContent = '';
      const items = this.list();
      if (!items.length) list.append(G.note('No snippets yet.'));
      for (const s of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0';
        const label = document.createElement('span');
        label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px';
        label.textContent = s.trigger + '  ' + s.text.replace(/\s+/g, ' ');
        row.append(label,
          G.button('Edit', async () => {
            const text = await window.vexPrompt({ title: 'Edit ' + s.trigger, label: 'Text', value: s.text, okLabel: 'Save', multiline: true });
            if (text == null) return;
            try { this.save(s.trigger, text); draw(); } catch (err) { window.showToast?.(err.message, 'error'); }
          }),
          G.button('Delete', async () => {
            const ok = await vexConfirm({ title: 'Delete ' + s.trigger + '?', message: 'This snippet is removed.', okLabel: 'Delete', danger: true });
            if (ok) { this.remove(s.trigger); draw(); }
          }, { danger: true }));
        list.append(row);
      }
    };
    const add = G.button('Add a snippet', async () => {
      const trig = await window.vexPrompt({ title: 'New snippet', label: 'Trigger, like :addr', okLabel: 'Next' });
      if (trig == null) return;
      try {
        const t = this.normTrigger(trig);
        const text = await window.vexPrompt({ title: 'Text for ' + t, label: 'What it becomes', okLabel: 'Save', multiline: true });
        if (text == null) return;
        this.save(t, text); draw();
      } catch (err) { window.showToast?.(err.message, 'error'); }
    }, { primary: true });
    const toggle = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = this.enabled();
    cb.addEventListener('change', () => this.setEnabled(cb.checked));
    toggle.append(cb, document.createTextNode(' Expand snippets in web pages'));
    const site = G.button('Turn off on the current site', () => {
      try { const u = this.currentUrl(); this.setSiteOff(u, true); window.showToast?.('Snippets are off on ' + this.hostOf(u)); drawSites(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    const sites = document.createElement('div');
    const drawSites = () => {
      sites.textContent = '';
      for (const h of this.prefs().offSites) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:2px 0;font-size:12px';
        const name = document.createElement('span'); name.style.flex = '1'; name.textContent = h + ' (off)';
        row.append(name, G.button('Turn on', () => { this.setSiteOff('https://' + h + '/', false); drawSites(); }));
        sites.append(row);
      }
    };
    draw(); drawSites();
    body.append(toggle, note, list, add, site, sites);
  },

  start() {
    if (this._started || typeof window === 'undefined' || !window.VexSettingsGroups) return;
    this._started = true;
    window.VexSettingsGroups.register({ id: 'text-snippets', title: 'Text snippets', keywords: 'expander shortcut template trigger canned reply signature address', render: (body) => this.render(body) });
  },
};

if (typeof window !== 'undefined') window.VexSnippets = VexSnippets;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSnippets, vexSnippetExpand, vexSnippetsInstall };
