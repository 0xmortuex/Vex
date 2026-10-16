// === Copy with its source =====================================================
//
// Select text on a page, press Ctrl+K › Copy selection as..., pick how it should
// read, and the clipboard gets the text WITH where it came from:
//
//   Markdown link   [Page title](https://...)
//   Quote           > the text
//                   >
//                   > Page title (https://...), 2026-10-16
//   Citation        "the text". Page title. example.com. https://... Accessed 2026-10-16.
//   Plain           the text, nothing added
//
// A quote or citation of 50 or more words says so (that much verbatim text is
// usually better paraphrased); it still copies. The citations tracker
// (js/citation-tracker.js, "Citations in Notes") already appends a source link
// when you PASTE a page copy into a Vex note; this adds the formats and the
// copy-time choice, and tells the tracker about the copy so a later paste into
// a note is still matched.
//
// Reads only the selection of the page in front, when you ask. Nothing is
// sent anywhere and the clipboard is never read.

const VexCopySource = {
  PREF: 'vex.copySource.prefs',        // { enabled, format } -- the format Enter picks first
  WARN_WORDS: 50,
  FORMATS: [
    { id: 'markdown-link', label: 'Markdown link' },
    { id: 'quote', label: 'Quote with source' },
    { id: 'citation', label: 'Citation' },
    { id: 'plain', label: 'Plain text' },
  ],

  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); } catch { raw = null; }
    const format = raw && this.FORMATS.some(f => f.id === raw.format) ? raw.format : 'quote';
    return { enabled: !raw || raw.enabled !== false, format };
  },
  enabled() { return this.prefs().enabled; },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    if (!this.FORMATS.some(f => f.id === next.format)) throw new Error('Unknown copy format ' + next.format);
    try { localStorage.setItem(this.PREF, JSON.stringify({ enabled: !!next.enabled, format: next.format })); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return this.prefs();
  },
  setEnabled(on) { return this.setPrefs({ enabled: !!on }).enabled; },

  // ---- pure ---------------------------------------------------------------------
  words(text) { const t = String(text == null ? '' : text).trim(); return t ? t.split(/\s+/).length : 0; },
  _ymd(ms) { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  _label(title, url) { return String(title || url || '').replace(/[\[\]\n\r]/g, ' ').replace(/\s+/g, ' ').trim(); },

  // -> { text, warning }  (warning is '' unless a quote or citation is 50+ words)
  format(kind, { text, title, url, now = Date.now() }) {
    const body = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
    if (!body) throw new Error('Select some text on the page first');
    if (!this.FORMATS.some(f => f.id === kind)) throw new Error('Unknown copy format ' + kind);
    const link = /^https?:\/\//i.test(String(url || ''));
    if (kind !== 'plain' && !link) throw new Error('This page has no web address to cite; use Plain text');
    const label = this._label(title, url);
    const day = this._ymd(now);
    let out;
    if (kind === 'plain') out = body;
    else if (kind === 'markdown-link') out = '[' + label + '](' + url + ')';
    else if (kind === 'quote') out = body.split('\n').map(l => '> ' + l).join('\n') + '\n>\n> ' + label + ' (' + url + '), ' + day;
    else out = '"' + body.replace(/\s+/g, ' ') + '". ' + label + '. ' + this._host(url) + '. ' + url + ' Accessed ' + day + '.';
    const n = this.words(body);
    const warning = (kind === 'quote' || kind === 'citation') && n >= this.WARN_WORDS
      ? n + ' words verbatim. That much is usually better paraphrased, with the source kept.' : '';
    return { text: out, warning };
  },

  // ---- the page in front ------------------------------------------------------------
  async _selection() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const wv = WebviewManager.getActiveWebview?.();
    const tab = TabManager.getActiveTab?.();
    if (!wv || !tab) throw new Error('There is no page in front');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('Copy with source is off in private and Tor tabs');
    const sel = await Promise.race([
      wv.executeJavaScript('(window.getSelection() || "").toString()'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 1500)),
    ]);
    let url = tab.url, title = tab.title;
    try { url = wv.getURL() || url; title = wv.getTitle() || title; } catch (err) { window.VexProblems?.note('Copy with source', 'Could not ask the page for its address; using the tab record', err); }
    return { text: String(sel || ''), url, title };
  },

  async copyAs(kind, picked) {
    const src = picked || await this._selection();
    const r = this.format(kind, src);
    if (!navigator.clipboard) throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(r.text);
    if (typeof CitationTracker !== 'undefined' && CitationTracker.enabled()) CitationTracker.record({ text: src.text, url: src.url, title: src.title });
    if (typeof VexUsage !== 'undefined') VexUsage.touch('copy-source');
    // A copy that carries its source is a citation: the sources list keeps the passage under its page
    // (js/sources.js) and "archive on cite" may offer to keep a copy of the page (js/archive-on-cite.js).
    // Both are no-ops while off and neither can stop the copy, which is already done.
    if (kind !== 'plain') {
      if (typeof VexSources !== 'undefined') VexSources.keepPassage({ text: src.text, kind: 'quote' });
      document.dispatchEvent(new CustomEvent('vex:source-cited', { detail: { url: src.url, title: src.title, via: 'copy-source' } }));
    }
    window.showToast?.(r.warning ? 'Copied. ' + r.warning : 'Copied as ' + this.FORMATS.find(f => f.id === kind).label.toLowerCase(), r.warning ? 'warn' : 'info', r.warning ? 6000 : 3000);
    return r;
  },

  // Ctrl+K › Copy selection as...
  async choose() {
    if (!this.enabled()) { window.showToast?.('Copy with source is switched off in Settings', 'info'); return; }
    let src;
    try { src = await this._selection(); if (!src.text.trim()) throw new Error('Select some text on the page first'); }
    catch (err) { window.showToast?.(err.message, 'error'); return; }
    const { body, close } = VexSettingsGroups.dialog({ id: 'vex-copy-source', title: 'Copy selection as', sub: this.words(src.text) + ' words from ' + (this._label(src.title, src.url) || 'this page') });
    const first = this.prefs().format;
    const order = [this.FORMATS.find(f => f.id === first), ...this.FORMATS.filter(f => f.id !== first)];
    order.forEach((f, i) => {
      let shown;
      try { shown = this.format(f.id, src).text; } catch (err) { shown = err.message; }
      const b = VexSettingsGroups.button(f.label, async () => {
        try { await this.copyAs(f.id, src); close(); } catch (err) { window.showToast?.(err.message, 'error'); }
      }, { primary: i === 0, label: 'Copy as ' + f.label });
      const pre = document.createElement('div');
      pre.className = 'vexsr-mode';
      pre.style.cssText = 'white-space:pre-wrap;margin:2px 0 10px;max-height:5.5em;overflow:hidden';
      pre.textContent = shown.slice(0, 300);
      body.append(b, pre);
    });
  },

  group(el) {
    el.appendChild(VexSettingsGroups.note('Ctrl+K › Copy selection as... copies the selected text with its source as a Markdown link, a quote, a citation or plain text. It warns on 50 or more words of verbatim text.'));
    el.appendChild(VexSettingsGroups.button('Copy selection as...', () => this.choose(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexCopySource = VexCopySource;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'copy-source', title: 'Copy with source', keywords: 'copy source quote citation markdown link selection cite', before: 'about', build: (el) => VexCopySource.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'copy-selection-as', label: 'Copy selection as...', hint: 'Markdown link, quote with source, citation or plain', icon: 'copy', action: () => VexCopySource.choose() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCopySource };
