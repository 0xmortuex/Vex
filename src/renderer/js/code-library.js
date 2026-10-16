// === Code-block library with source and license ==================================
//
// Code copied from an answer loses where it came from, and the licence goes with
// it. This keeps the block together with its page address, title, date, language
// and a licence HINT, searchable (here and in Ctrl+K), and copies it back with a
// one-line attribution comment in the right comment style.
//
// Saving: select code on a page > right-click > "Save as code block", or
// right-click the page > "Save code blocks on this page..." to choose from the
// <pre> blocks it has. Nothing is saved without that action, nothing is sent
// anywhere, and a private, Tor or routed tab is never read.
//
// The licence is a hint, never legal advice: Stack Overflow and Stack Exchange
// posts are CC BY-SA (the version depends on the post's date, so the hint says
// 4.0 or 3.0), an SPDX-License-Identifier line in the code wins, and anything
// else is "unknown, check the source".
const VexCodeLibrary = {
  KEY: 'vex.codeLibrary',
  ENABLED_KEY: 'vex.codeLibrary.enabled',
  MAX: 300,
  MAX_CODE: 20000,

  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) { VexBench.setFlag(this.ENABLED_KEY, on); this.registerCommands(); },

  // ---- pure helpers (tested) -----------------------------------------------------------
  detectLicense(url, code) {
    const spdx = /SPDX-License-Identifier:\s*([A-Za-z0-9.+() -]{2,60})/.exec(String(code || ''));
    if (spdx) return spdx[1].trim();
    let host = '';
    try { host = new URL(String(url)).hostname; } catch { /* vex-allow-empty-catch: no readable address means the licence stays unknown, below */ }
    if (/(^|\.)(stackoverflow|serverfault|superuser|askubuntu|stackexchange|mathoverflow)\.com$/.test(host)) return 'CC BY-SA 4.0 (Stack Exchange; posts before May 2019 are 3.0)';
    if (/(^|\.)github\.com$|(^|\.)gitlab\.com$/.test(host)) return 'unknown, see the repository licence';
    return 'unknown, check the source';
  },
  detectLanguage(code, hint) {
    const h = String(hint || '').toLowerCase().replace(/^(language|lang)-/, '');
    if (/^[a-z0-9+#-]{1,16}$/.test(h) && h !== 'none' && h !== 'text') return h;
    const c = String(code || '');
    if (/^#!.*\b(bash|sh|zsh)\b/.test(c) || /^\s*(sudo |apt |pnpm |npm |git |cd |export )/m.test(c)) return 'bash';
    if (/<\?php/.test(c)) return 'php';
    if (/^\s*(def |import \w+$|from \w+ import |print\()/m.test(c) && !/[;{]\s*$/m.test(c)) return 'python';
    if (/^\s*(fn |let mut |use std::|impl )/m.test(c)) return 'rust';
    if (/^\s*(package main|func )/m.test(c)) return 'go';
    if (/\b(const|let|var) \w+\s*=|=>|function\s*\w*\(|console\.log/.test(c)) return 'javascript';
    if (/^\s*(SELECT|INSERT|UPDATE|CREATE TABLE)\b/i.test(c)) return 'sql';
    if (/^\s*</.test(c) && /<\/\w+>/.test(c)) return 'html';
    return '';
  },
  COMMENT: { python: ['# ', ''], bash: ['# ', ''], sh: ['# ', ''], ruby: ['# ', ''], yaml: ['# ', ''], toml: ['# ', ''], powershell: ['# ', ''], sql: ['-- ', ''], lua: ['-- ', ''],
    html: ['<!-- ', ' -->'], xml: ['<!-- ', ' -->'], css: ['/* ', ' */'] },
  attribution(entry) {
    const [open, close] = this.COMMENT[entry.lang] || ['// ', ''];
    const when = new Date(entry.at).toISOString().slice(0, 10);
    return open + 'Source: ' + entry.url + (entry.title ? ' (' + entry.title.replace(/[\r\n]+/g, ' ').slice(0, 100) + ')' : '') + ', saved ' + when + ', licence: ' + entry.license + close;
  },
  withAttribution(entry) { return this.attribution(entry) + '\n' + entry.code; },
  search(list, query) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return list;
    return list.filter(e => (e.code + ' ' + e.title + ' ' + e.url + ' ' + e.lang + ' ' + e.license).toLowerCase().includes(q));
  },

  // ---- the list ----------------------------------------------------------------------------
  _strict() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('The code library is not readable, so it was not changed');
    return list;
  },
  list() {
    try { return this._strict(); }
    catch (err) { console.error('[CodeLibrary] the library could not be read:', err.message); return []; }
  },
  save({ code, url, title, langHint }, now = Date.now()) {
    const text = String(code || '').replace(/\s+$/, '');
    if (!text.trim()) throw new Error('There is no code to save');
    if (text.length > this.MAX_CODE) throw new Error('That block is larger than ' + (this.MAX_CODE / 1000) + ' KB');
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('The page has no web address to credit');
    let list = this._strict();
    if (list.some(e => e.code === text && e.url === url)) return list.find(e => e.code === text && e.url === url);
    const entry = { id: 'cb' + now.toString(36) + Math.random().toString(36).slice(2, 5), code: text, url: String(url).slice(0, 600), title: String(title || '').slice(0, 160), lang: this.detectLanguage(text, langHint), license: this.detectLicense(url, text), at: now };
    list.unshift(entry);
    if (list.length > this.MAX) list = list.slice(0, this.MAX);
    localStorage.setItem(this.KEY, JSON.stringify(list));
    this.registerCommands();
    return entry;
  },
  remove(id) { localStorage.setItem(this.KEY, JSON.stringify(this._strict().filter(e => e.id !== id))); this.registerCommands(); },

  // ---- saving from a page ---------------------------------------------------------------------
  pageTitle(wv) { try { return wv.getTitle ? wv.getTitle() : ''; } catch (err) { console.error('[CodeLibrary] the page title could not be read:', err); return ''; } },
  textItems(selection, wv) {
    if (!VexBench.canRead(wv) || !/\n|[{};=()]/.test(selection) || selection.trim().length < 12) return [];
    return [{ label: 'Save as code block', action: VexBench.safe(() => { const e = this.save({ code: selection, url: VexBench.pageUrl(wv), title: this.pageTitle(wv) }); VexBench.toast('Saved with its source (' + e.license.split(' (')[0] + ')'); }) }];
  },
  pageItems(wv) {
    if (!VexBench.canRead(wv)) return [];
    return [{ label: 'Save code blocks on this page...', action: VexBench.safe(() => this.chooseFromPage(wv)) }];
  },
  async chooseFromPage(wv) {
    const raw = await wv.executeJavaScript('(' + function () {
      return JSON.stringify([...document.querySelectorAll('pre')].slice(0, 40).map((p) => {
        const c = p.querySelector('code');
        const cls = ((c && c.className) || p.className || '').split(/\s+/).find(x => /^(language|lang)-/.test(x)) || '';
        return { code: (p.innerText || '').slice(0, 20000), lang: cls };
      }).filter(b => b.code.trim().length > 5));
    }.toString() + ')()');
    const blocks = JSON.parse(raw);
    if (!blocks.length) { VexBench.toast('No code blocks found on this page'); return; }
    const url = VexBench.pageUrl(wv), title = this.pageTitle(wv);
    const dlg = VexSettingsGroups.dialog({ id: 'vex-code-pick', title: 'Save code blocks', sub: blocks.length + ' on this page. Licence hint: ' + this.detectLicense(url, '') });
    blocks.forEach((b) => {
      const row = document.createElement('div'); row.style.cssText = 'margin:8px 0';
      const pre = document.createElement('pre'); pre.style.cssText = 'max-height:110px;overflow:auto;font-size:12px;white-space:pre-wrap';
      pre.textContent = b.code.split('\n').slice(0, 8).join('\n');
      row.append(pre, VexSettingsGroups.button('Save', () => { try { this.save({ code: b.code, url, title, langHint: b.lang }); VexBench.toast('Saved'); } catch (e) { VexBench.fail(e); } }));
      dlg.body.appendChild(row);
    });
  },

  // ---- the library window -------------------------------------------------------------------------
  open() {
    const dlg = VexSettingsGroups.dialog({ id: 'vex-code-library', title: 'Code library', sub: 'Saved with their source; copy back with an attribution line' });
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Search code, titles, languages'; search.setAttribute('aria-label', 'Search the code library');
    const listEl = document.createElement('div');
    dlg.body.append(search, listEl);
    const draw = () => {
      listEl.textContent = '';
      const items = this.search(this.list(), search.value);
      if (!items.length) { listEl.appendChild(VexSettingsGroup.note('Nothing saved yet. Select code on a page and use "Save as code block".')); return; }
      for (const e of items.slice(0, 100)) {
        const card = document.createElement('div'); card.style.cssText = 'border-top:1px solid var(--border);padding:8px 0';
        const meta = document.createElement('div'); meta.style.cssText = 'font-size:11.5px;color:var(--text-muted)';
        meta.textContent = (e.lang || 'code') + ' - ' + (e.title || e.url) + ' - ' + e.license;
        const pre = document.createElement('pre'); pre.style.cssText = 'max-height:120px;overflow:auto;font-size:12px;white-space:pre-wrap;margin:4px 0';
        pre.textContent = e.code.split('\n').slice(0, 10).join('\n');
        card.append(meta, pre,
          VexSettingsGroups.button('Copy with attribution', () => VexBench.copy(this.withAttribution(e), 'Copied with its source').catch(x => VexBench.fail(x)), { primary: true }),
          VexSettingsGroups.button('Copy code only', () => VexBench.copy(e.code).catch(x => VexBench.fail(x))),
          VexSettingsGroups.button('Open source', () => { if (typeof TabManager !== 'undefined') TabManager.createTab(e.url, true); }),
          VexSettingsGroups.button('Delete', () => { try { this.remove(e.id); draw(); } catch (x) { VexBench.fail(x); } }, { danger: true }));
        listEl.appendChild(card);
      }
    };
    search.addEventListener('input', draw);
    draw();
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    const recent = this.enabled() ? this.list().slice(0, 30).map(e => ({
      id: 'codelib:copy-' + e.id, label: 'Code: ' + (e.code.split('\n').find(l => l.trim()) || '').trim().slice(0, 60), icon: 'braces',
      hint: (e.lang || 'code') + ' from ' + (e.title || e.url).slice(0, 50) + ' (copies with the attribution line)',
      action: VexBench.safe(() => VexBench.copy(this.withAttribution(e), 'Copied with its source')),
    })) : [];
    VexModuleCommands.set('codelib:', this.enabled() ? [{ id: 'codelib:open', label: 'Code library', icon: 'braces', hint: 'Saved code blocks with source and licence', action: () => this.open() }, ...recent] : []);
    return true;
  },
  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note(this.list().length + ' blocks saved on this computer. The licence is a hint, not legal advice.'));
    box.appendChild(VexSettingsGroup.button('Open the library...', () => this.open()));
  },
};

if (typeof window !== 'undefined') {
  window.VexCodeLibrary = VexCodeLibrary;
  VexBench.register({
    id: 'code-library', title: 'Code-block library with source and licence', hint: 'save, search, copy with attribution',
    enabled: () => VexCodeLibrary.enabled(), setEnabled: (on) => VexCodeLibrary.setEnabled(on), settingsRows: (box) => VexCodeLibrary.settingsRows(box),
    textItems: (s, wv) => VexCodeLibrary.textItems(s, wv), pageItems: (wv) => VexCodeLibrary.pageItems(wv),
  });
  VexCodeLibrary.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCodeLibrary };
