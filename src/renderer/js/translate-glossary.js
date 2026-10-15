// === Translate in place, with a glossary ====================================
//
// Translate-side-by-side (translate-side.js) already puts a translation under
// each paragraph, using the translator the main process talks to
// ('translate:text'). What it cannot do is leave a name alone: a product, a
// person, a function called "Bridge" comes back as "Puente".
//
// A glossary is a list of terms for one site (or for every site, under "*"),
// each either kept exactly as written or translated to a word you chose.
// Before a paragraph goes to the translator each term is swapped for a
// placeholder, and after it comes back the placeholder is put back as the term
// (or your replacement). So the translator never sees the term and cannot
// change it. This uses the existing translator — there is no local-model
// translation here; the local model is not involved at all.
//
// If the translator mangles a placeholder so a term cannot be put back, the
// paragraph is NOT sent again (that would hand the term to the translator after
// all, silently). It is shown as translated, with the terms that did survive
// put back, stray tokens removed and a visible "glossary not applied" marker in
// front. The count of such paragraphs is kept in `stats`.

const GlossaryTranslate = {
  KEY: 'vex.translateGlossary',     // { "<host>" | "*": [{ term, to }] }
  MAX_TERMS: 200,
  NOT_APPLIED: '[glossary not applied] ',
  stats: { protectedTerms: 0, unprotected: 0 },

  // --- storage -------------------------------------------------------------
  _all() {
    try {
      const o = JSON.parse(localStorage.getItem(this.KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch { return {}; }
  },
  _write(o) {
    try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (err) { throw new Error('The glossary could not be saved: ' + err.message); }
  },
  _clean(list) {
    return (Array.isArray(list) ? list : [])
      .filter(e => e && typeof e.term === 'string' && e.term.trim())
      .map(e => ({ term: e.term.trim(), to: typeof e.to === 'string' ? e.to.trim() : '' }));
  },

  hostOf(url) {
    if (typeof TranslateSide !== 'undefined' && TranslateSide._host) return TranslateSide._host(url);
    try { return /^https?:/i.test(url) ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
  },

  // Terms that apply on a host: that host's own, then the all-sites ones.
  termsFor(host) {
    const all = this._all();
    const mine = host ? this._clean(all[host]) : [];
    const shared = this._clean(all['*']);
    const have = new Set(mine.map(e => e.term.toLowerCase()));
    return mine.concat(shared.filter(e => !have.has(e.term.toLowerCase())));
  },

  list(host) { return this._clean(this._all()[host]); },

  addTerm(host, term, to) {
    const key = host || '';
    if (!key) throw new Error('Open a web page first, or use the all-sites list');
    const t = String(term == null ? '' : term).trim();
    if (!t) throw new Error('Write the term first');
    if (t.length > 80) throw new Error('That term is too long');
    const all = this._all();
    const list = this._clean(all[key]);
    const i = list.findIndex(e => e.term.toLowerCase() === t.toLowerCase());
    const entry = { term: t, to: String(to == null ? '' : to).trim() };
    if (i >= 0) list[i] = entry;
    else {
      if (list.length >= this.MAX_TERMS) throw new Error('This glossary is full (' + this.MAX_TERMS + ' terms)');
      list.push(entry);
    }
    all[key] = list;
    this._write(all);
    return entry;
  },

  removeTerm(host, term) {
    const all = this._all();
    const list = this._clean(all[host]);
    const next = list.filter(e => e.term.toLowerCase() !== String(term).toLowerCase());
    if (next.length === list.length) return false;
    if (next.length) all[host] = next; else delete all[host];
    this._write(all);
    return true;
  },

  // --- protecting terms ----------------------------------------------------
  _esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },

  // Letters+digits only, so a translator has nothing to "fix".
  _token(n) { return 'ZXQ' + n + 'QXZ'; },

  protect(text, terms) {
    const found = [];
    let out = String(text);
    // Longest first, so "New York City" wins over "New York".
    const ordered = terms.slice().sort((a, b) => b.term.length - a.term.length);
    for (const e of ordered) {
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + this._esc(e.term) + '(?![\\p{L}\\p{N}])', 'giu');
      out = out.replace(re, (m) => {
        const n = found.length;
        found.push(e.to || m);
        return this._token(n);
      });
    }
    return { text: out, found };
  },

  // Puts the terms back; returns null if any placeholder did not survive.
  restore(text, found) {
    let seen = 0;
    const out = String(text).replace(/Z\s?X\s?Q\s?(\d+)\s?Q\s?X\s?Z/gi, (m, n) => {
      const v = found[Number(n)];
      if (v === undefined) return m;
      seen++;
      return v;
    });
    if (seen < found.length) return null;
    if (/Z\s?X\s?Q\s?\d+\s?Q\s?X\s?Z/i.test(out)) return null;
    return out;
  },

  // What can be recovered from an answer that lost a placeholder: the terms
  // that survived go back, the broken tokens go.
  restorePartial(text, found) {
    return String(text)
      .replace(/Z\s?X\s?Q\s?(\d+)\s?Q\s?X\s?Z/gi, (m, n) => (found[Number(n)] === undefined ? '' : found[Number(n)]))
      .replace(/\s{2,}/g, ' ')
      .trim();
  },

  // One paragraph through the translator, with the glossary applied.
  async translate(text, tl, host) {
    const send = (t) => window.vex.translateText(t, tl);
    const terms = this.termsFor(host);
    if (!terms.length) return send(text);
    const p = this.protect(text, terms);
    if (!p.found.length) return send(text);
    const raw = await send(p.text);
    if (raw == null) return raw;
    const back = this.restore(raw, p.found);
    if (back !== null) { this.stats.protectedTerms += p.found.length; return back; }
    // Not sent again: the term would reach the translator. Say so instead.
    this.stats.unprotected++;
    return this.NOT_APPLIED + this.restorePartial(raw, p.found);
  },

  // --- running it on the front tab -----------------------------------------
  async run(tl) {
    if (typeof TranslateSide === 'undefined') throw new Error('Side-by-side translation is not part of this build');
    return TranslateSide.run(tl);      // translateAll() asks this module per paragraph
  },

  // --- UI -------------------------------------------------------------------
  _currentHost() {
    try {
      const t = (typeof TabManager !== 'undefined' && TabManager.getActiveTab) ? TabManager.getActiveTab() : null;
      return t ? this.hostOf(t.url) : '';
    } catch { return ''; }
  },

  async addTermInteractive(host) {
    const h = host || this._currentHost();
    if (!h) throw new Error('Open a web page first');
    const term = await window.vexPrompt({ title: 'Glossary term for ' + h, label: 'Term to protect (a name, product, jargon)', value: '' });
    if (term === null || term === undefined || !String(term).trim()) return null;
    const to = await window.vexPrompt({ title: 'How should “' + String(term).trim() + '” appear?', label: 'Leave empty to keep it exactly as written', value: '' });
    if (to === null || to === undefined) return null;
    return this.addTerm(h, term, to);
  },

  open(host) {
    const h = host || this._currentHost() || '*';
    document.querySelector('.vex-glossary-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const ico = (n, s = 13) => (window.VexIcons ? VexIcons.svg(n, { size: s }) : '');
    const overlay = document.createElement('div');
    overlay.className = 'vex-glossary-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:9vh';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Translation glossary" style="width:min(520px,92vw);max-height:74vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:13.5px;font-weight:650;color:var(--text)">Translation glossary</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${h === '*' ? 'Terms for every site' : 'Terms for ' + esc(h)}</div>
          </div>
          <button type="button" data-add style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 8px;cursor:pointer;display:inline-flex;gap:5px;align-items:center">${ico('plus')}Add term</button>
        </div>
        <div data-list style="overflow-y:auto;padding:6px 10px;flex:1"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">A term is kept as written, or shown as the word you give, whatever the translator would have done.</div>
      </div>`;
    const listEl = overlay.querySelector('[data-list]');
    const draw = () => {
      const terms = this.list(h);
      listEl.textContent = '';
      if (!terms.length) {
        listEl.innerHTML = '<div style="padding:22px;text-align:center;font-size:12.5px;color:var(--text-muted)">No terms yet.</div>';
        return;
      }
      for (const e of terms) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--border)';
        row.innerHTML = `<span style="flex:1;font-size:12.5px;color:var(--text)">${esc(e.term)}</span>
          <span style="font-size:12px;color:var(--text-muted)">${e.to ? 'shown as ' + esc(e.to) : 'kept as written'}</span>
          <button type="button" aria-label="Remove ${esc(e.term)}" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--danger);padding:2px 6px;cursor:pointer;display:inline-flex">${ico('trash')}</button>`;
        row.querySelector('button').addEventListener('click', () => { this.removeTerm(h, e.term); draw(); });
        listEl.appendChild(row);
      }
    };
    overlay.querySelector('[data-add]').addEventListener('click', async () => {
      try { if (await this.addTermInteractive(h === '*' ? '*' : h)) draw(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    draw();
    return overlay;
  },

  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="translate-glossary"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'translate-glossary');
    g.innerHTML = `
      <label class="setting-label">Translation glossary</label>
      <p class="setting-info muted" style="margin-bottom:8px">Names and jargon the translator should leave alone, or show your way. Terms are kept per site; the all-sites list applies everywhere. They are used by Side by side, including “Always translate this site”.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" data-gl-site>Terms for this site</button>
        <button type="button" class="btn-secondary" data-gl-all>Terms for every site</button>
      </div>`;
    g.querySelector('[data-gl-site]').addEventListener('click', () => this.open());
    g.querySelector('[data-gl-all]').addEventListener('click', () => this.open('*'));
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    const have = new Set(CommandBar.commands.map(c => c.id));
    const add = (c) => { if (!have.has(c.id)) CommandBar.commands.push(c); };
    add({ id: 'glossary-open', label: 'Translation Glossary for This Site', hint: 'Names and terms the translator must not change', icon: 'globe', action: () => this.open() });
    add({ id: 'glossary-add', label: 'Add Glossary Term for This Site', hint: 'Keep a name or term fixed when translating', icon: 'plus',
      action: async () => {
        try { const e = await this.addTermInteractive(); if (e) window.showToast?.('“' + e.term + '” will be kept in translations of this site'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      } });
  },

  init() {
    this.registerCommands();
    this.injectSettings();
  },
};

if (typeof window !== 'undefined') {
  window.GlossaryTranslate = GlossaryTranslate;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => GlossaryTranslate.init());
    else GlossaryTranslate.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { GlossaryTranslate };
