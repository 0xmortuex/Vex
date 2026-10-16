// === Library links: backlinks, related-from-my-library, conflicts, saved copies ========
//
// Add-ons to the knowledge base (js/knowledge.js) and the "Ask my library" answer. Nothing here
// indexes or fetches anything of its own; it reads what the knowledge base, the notes and the
// archive library already hold.
//
//   Backlinks            which notes cite a page (their source address, or the address written in
//                        their text) and which sources a note cites.
//   Related panel        "Related from my library" for the page you are on, or for the research
//                        board: Knowledge.relatedBlock (no model call), the notes that link to the
//                        page, and your archived copy of it.
//   Conflicts            after an answer, your LOCAL model is asked where its cited sources
//                        disagree. Every position names its source and carries a quote; a quote
//                        that is not in that source's passage drops the position. Positions are
//                        listed side by side, never merged into one statement and never ruled on.
//   Saved copies         a result whose page you archived gets "Your copy": it opens from the
//                        archive library even when the page is gone (links rot; the library does not).
//   Listen               an answer read aloud (ListenReader.speakText) with its sources summarised:
//                        "Three sources, one disputed."
//
// Pure helpers have no DOM and are tested directly (tests/renderer/libraryLinks.test.js).
const VexLibraryLinks = {
  FEATURE: 'library-links',
  PREF: 'vex.libraryLinks.enabled',
  MAX_PASSAGE: 1800,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) {
    try { localStorage.setItem(this.PREF, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message, { cause: err }); }
    return !!on;
  },

  // ---- addresses and backlinks (pure) -------------------------------------------------------
  // One key for "this page": no scheme, www, fragment, tracking parameters or trailing slash.
  urlKey(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    const keep = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    return u.hostname.toLowerCase().replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '/') + (keep.length ? '?' + keep.map(([k, v]) => k + '=' + v).join('&') : '');
  },

  // Web addresses written in a text.
  urlsIn(text) {
    const out = [];
    for (const m of String(text == null ? '' : text).matchAll(/https?:\/\/[^\s<>()\[\]"'`]+/gi)) {
      const clean = m[0].replace(/[.,;:!?]+$/, '');
      if (this.urlKey(clean) && !out.includes(clean)) out.push(clean);
    }
    return out;
  },

  // The sources a note cites: its source page, then the addresses in its text.
  sourcesOf(note) {
    const out = [];
    const seen = new Set();
    const add = (url, via, title) => { const k = this.urlKey(url); if (k && !seen.has(k)) { seen.add(k); out.push({ url, via, title: title || '' }); } };
    if (note && note.sourceUrl) add(note.sourceUrl, 'source', note.sourceTitle);
    for (const u of this.urlsIn(note && note.content)) add(u, 'mention');
    return out;
  },

  // The notes that cite `url`: [{ id, title, via }]. The note's own text is not asked to be a link.
  backlinks(url, notes) {
    const key = this.urlKey(url);
    if (!key) return [];
    const out = [];
    for (const n of (Array.isArray(notes) ? notes : [])) {
      if (!n || !n.id || n.private || n.locked || n.encrypted) continue;
      const hit = this.sourcesOf(n).find(s => this.urlKey(s.url) === key);
      if (hit) out.push({ id: n.id, title: n.title || 'Untitled note', via: hit.via });
    }
    return out;
  },

  // For one knowledge-base hit: a note -> its sources; anything with an address -> the notes citing it.
  linksFor(hit, notes) {
    const list = Array.isArray(notes) ? notes : [];
    if (hit && hit.kind === 'note') {
      const id = String(hit.id || '').replace(/^note:/, '');
      const note = list.find(n => n && n.id === id);
      return note ? { kind: 'sources', items: this.sourcesOf(note) } : { kind: 'sources', items: [] };
    }
    return { kind: 'notes', items: hit && hit.url ? this.backlinks(hit.url, list).filter(n => 'note:' + n.id !== hit.id) : [] };
  },

  // ---- conflicts between sources (pure) ----------------------------------------------------------
  conflictPrompt(question, sources) {
    const body = (Array.isArray(sources) ? sources : []).filter(s => s && (s.passage || s.text)).map(s => '[' + s.n + '] ' + (s.title || 'Source') + '\n' + String(s.passage || s.text).slice(0, this.MAX_PASSAGE)).join('\n\n');
    if (!body) throw new Error('There are no sources to compare');
    return 'Below are numbered sources. Find points where two or more sources DISAGREE, such as different numbers, dates, claims or conclusions. ' +
      'Do not merge them, do not average them and do not say who is right. Use ONLY the sources. ' +
      'Reply as JSON: {"conflicts": [{"topic": "short name of the point", "positions": [{"n": 1, "says": "what source 1 says", "quote": "words copied exactly from source [1], 8 to 25 words"}, {"n": 2, "says": "...", "quote": "..."}]}]}. ' +
      'Give a quote for every position, copied word for word from that source. If the sources do not disagree reply {"conflicts": []}.\n\n' +
      'Question: ' + String(question || '').slice(0, 512) + '\n\nSources:\n' + body;
  },

  parseConflicts(result) {
    let o = result && typeof result === 'object' && !Array.isArray(result.conflicts) && result.result !== undefined ? result.result : result;
    if (typeof o === 'string') {
      const raw = o.trim();
      const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
      if (a < 0 || b <= a) throw new Error('The local model did not answer in the form asked for. Try again.');
      try { o = JSON.parse(raw.slice(a, b + 1)); }
      catch (err) { throw new Error('The local model\'s answer could not be read: ' + err.message, { cause: err }); }
    }
    if (!o || typeof o !== 'object' || !Array.isArray(o.conflicts)) throw new Error('The local model returned no comparison. Try again.');
    return o.conflicts.slice(0, 8).filter(c => c && Array.isArray(c.positions)).map(c => ({
      topic: String(c.topic || '').trim().slice(0, 120),
      positions: c.positions.slice(0, 6).filter(p => p && Number.isFinite(Number(p.n))).map(p => ({ n: Number(p.n), says: String(p.says || '').trim().slice(0, 400), quote: String(p.quote || '').trim().slice(0, 600) })),
    }));
  },

  // Keeps a position only when its quote is in the passage of the source it names; keeps a conflict
  // only when two different sources survive. -> { conflicts, dropped } (dropped: how many conflicts).
  checkConflicts(parsed, sources) {
    if (typeof VexAnswerCitations === 'undefined') throw new Error('The citation checker is not loaded, so no disagreement can be verified');
    const byN = new Map((Array.isArray(sources) ? sources : []).map(s => [Number(s.n), s]));
    const conflicts = [];
    let dropped = 0;
    for (const c of parsed) {
      const seen = new Set();
      const positions = [];
      for (const p of c.positions) {
        const src = byN.get(p.n);
        if (!src || !p.says || !p.quote || seen.has(p.n)) continue;
        if (VexAnswerCitations.find(String(src.passage != null ? src.passage : (src.text || '')), p.quote) < 0) continue;
        seen.add(p.n);
        positions.push({ n: p.n, source: src.title || 'Source ' + p.n, url: src.url || '', says: p.says, quote: p.quote });
      }
      if (positions.length >= 2) conflicts.push({ topic: c.topic || 'A point the sources differ on', positions }); else dropped++;
    }
    return { conflicts, dropped };
  },

  NUMBER_WORDS: ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  numberWord(n) { return n >= 0 && n < this.NUMBER_WORDS.length ? this.NUMBER_WORDS[n] : String(n); },

  // "Three sources, one disputed." conflicts: null when they were not checked.
  citationSummary(sourceCount, conflicts) {
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    if (!(sourceCount > 0)) return 'No sources were cited.';
    const base = cap(this.numberWord(sourceCount)) + (sourceCount === 1 ? ' source' : ' sources');
    if (conflicts == null) return base + ', not checked for disagreement.';
    if (sourceCount === 1) return base + '.';
    return base + ', ' + (conflicts.length ? this.numberWord(conflicts.length) + ' disputed' : 'none disputed') + '.';
  },

  // The answer without its [n] markers, and the summary, as two chapters for the Listen panel.
  spokenAnswer({ answer, sources, cited, conflicts }) {
    const text = String(answer == null ? '' : answer).replace(/\s*\[\d{1,2}\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('There is no answer to read aloud');
    const count = Array.isArray(cited) && cited.length ? cited.length : (Array.isArray(sources) ? sources.length : 0);
    const lines = [this.citationSummary(count, conflicts)];
    if (Array.isArray(conflicts)) for (const c of conflicts.slice(0, 3)) lines.push('Disputed: ' + c.topic.replace(/[.!?]*$/, '') + '.');
    return [{ title: 'Answer', level: 1, paras: [text] }, { title: 'Sources', level: 1, paras: lines }];
  },

  // ---- the app side --------------------------------------------------------------------------------
  _api() { return (typeof window !== 'undefined' && window.vex) || null; },

  _notes() {
    if (typeof NotesPanel === 'undefined' || !Array.isArray(NotesPanel.notes)) return [];
    return NotesPanel.notes.map(n => (typeof NotesPanel.normalize === 'function' ? NotesPanel.normalize(n) : n));
  },

  // Your archived copy of a page: the archive library's entry, or null.
  async copyFor(url) {
    const api = this._api();
    if (!api || typeof api.pageArchiveFind !== 'function' || !/^https?:/i.test(String(url || ''))) return null;
    const r = await api.pageArchiveFind(url);
    if (r && r.ok === false) throw new Error(r.error || 'The archive library did not answer');
    return r && r.entry ? r.entry : null;
  },

  async checkSources(question, sources) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The local AI is not available here');
    let res;
    try { res = await AIRouter.callOn('local', 'chat', { message: this.conflictPrompt(question, sources), conversationHistory: [] }); }
    catch (err) { throw new Error('Your local model could not answer: ' + String((err && err.message) || err).replace(/\.$/, '') + '. Nothing was sent to the cloud.', { cause: err }); }
    return this.checkConflicts(this.parseConflicts(res && res.result), sources);
  },

  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _open(url) { if (typeof TabManager !== 'undefined' && /^https?:/i.test(url || '')) { TabManager.createTab(url, true); return true; } return false; },

  _renderConflicts(host, result) {
    host.textContent = '';
    if (!result.conflicts.length) host.appendChild(this._el('div', 'vexsr-sub', 'No disagreement between the cited sources was found that could be checked against their words.' + (result.dropped ? ' ' + result.dropped + ' possible one(s) were dropped because a quote was not in its source.' : '')));
    for (const c of result.conflicts) {
      const box = this._el('div', 'vexsr-rule');
      box.style.cssText = 'display:block;margin:6px 0';
      box.appendChild(this._el('div', 'vexsr-host', 'Sources disagree: ' + c.topic));
      for (const p of c.positions) {
        const line = this._el('div', 'vexsr-sub', '[' + p.n + '] ' + p.source + ' says: ' + p.says);
        line.appendChild(this._el('div', 'vexsr-mode', 'Its words: "' + p.quote + '"'));
        box.appendChild(line);
      }
      host.appendChild(box);
    }
    if (result.conflicts.length && result.dropped) host.appendChild(this._el('div', 'vexsr-mode', result.dropped + ' other possible disagreement(s) were dropped because a quote was not in its source.'));
    host.appendChild(this._el('div', 'vexsr-mode', 'Both sides are shown as each source states them. Vex does not decide which is right.'));
  },

  // Buttons under an answer: check the sources for conflicts, read it aloud.
  decorateAnswer(host, result, { question = '', say } = {}) {
    if (!this.enabled() || !host || !result || !Array.isArray(result.sources) || !result.sources.length) return null;
    const fail = (e) => { if (say) say((e && e.message) || String(e), true); else window.showToast?.((e && e.message) || String(e), 'error'); };
    const bar = this._el('div', 'vexsr-row');
    bar.style.cssText = 'margin-top:8px;flex-wrap:wrap;align-items:center';
    const out = this._el('div');
    let conflicts = null;
    const check = this._el('button', 'vexsr-x', 'Check sources for conflicts');
    check.title = 'Your local model compares the cited sources; each position must quote its source';
    check.addEventListener('click', async () => {
      check.disabled = true;
      try { const r = await this.checkSources(question, result.sources); conflicts = r.conflicts; this._renderConflicts(out, r); }
      catch (e) { fail(e); }
      check.disabled = false;
    });
    const listen = this._el('button', 'vexsr-x', 'Listen to this answer');
    listen.title = 'Read aloud with a short summary of its sources';
    listen.addEventListener('click', () => {
      this.listen(result, conflicts).catch(fail);
    });
    bar.append(check, listen);
    host.append(bar, out);
    return bar;
  },

  async listen(result, conflicts) {
    if (typeof ListenReader === 'undefined' || typeof ListenReader.speakText !== 'function') throw new Error('Listen is not available here');
    const sections = this.spokenAnswer({ answer: result.answer, sources: result.sources, cited: result.cited, conflicts });
    return ListenReader.speakText({ title: 'Answer from my library', sections });
  },

  // A saved result with an archived copy gets "Your copy"; every hit gets a links line on request.
  decorateRow(row, hit, { say } = {}) {
    if (!this.enabled() || !row || !hit) return;
    const btn = (label, aria, run) => { const b = this._el('button', 'vexsr-x', label); b.setAttribute('aria-label', aria + ': ' + (hit.title || hit.url)); b.addEventListener('click', run); return b; };
    const info = this._el('div', 'vexsr-sub'); info.hidden = true;
    const text = row.firstChild;
    if (text) text.appendChild(info);
    row.appendChild(btn('Links', 'Show backlinks of', () => {
      try {
        const l = this.linksFor(hit, this._notes());
        info.hidden = false;
        if (l.kind === 'sources') info.textContent = l.items.length ? 'This note cites: ' + l.items.map(s => (s.title || s.url) + (s.via === 'mention' ? ' (in its text)' : '')).join(' · ') : 'This note cites no page.';
        else info.textContent = l.items.length ? 'Notes that cite this page: ' + l.items.map(n => n.title).join(' · ') : 'No note cites this page.';
      } catch (e) { say?.(e.message, true); }
    }));
    if (hit.url && /^https?:/i.test(hit.url)) {
      this.copyFor(hit.url).then((entry) => {
        if (!entry || !row.isConnected) return;
        const b = btn('Your copy', 'Open your saved copy of', async () => {
          try { await ArchiveLibrary.openCopy(entry.id); } catch (e) { say?.(e.message, true); }
        });
        b.title = 'Saved ' + new Date(entry.at).toLocaleDateString() + '. Opens even if the page is gone.';
        row.appendChild(b);
      }).catch((err) => { if (typeof VexProblems !== 'undefined') VexProblems.note('Library links', 'Could not look for your copy', err); });
    }
  },

  // "Related from my library" for a page: { title, url, text }.
  async renderRelated(host, page) {
    host.textContent = '';
    const fail = (e) => host.appendChild(this._el('div', 'vexsr-sub', (e && e.message) || String(e)));
    if (typeof Knowledge === 'undefined') { fail(new Error('The knowledge base is not available')); return; }
    if (!Knowledge.enabled()) { fail(new Error('The knowledge base is off. Turn it on in Settings, Knowledge base.')); return; }
    try {
      const block = await Knowledge.relatedBlock(page, { limit: 6 });
      host.appendChild(this._el('div', 'vexsr-host', block.heading));
      if (!block.items.length) host.appendChild(this._el('div', 'vexsr-sub', 'Nothing you kept relates to this yet.'));
      for (const it of block.items) {
        const row = this._el('div', 'vexsr-rule');
        row.style.flexWrap = 'wrap';
        const t = this._el('div'); t.style.cssText = 'flex:1;min-width:200px';
        t.appendChild(this._el('div', 'vexsr-host', it.title || it.url || 'Untitled'));
        t.appendChild(this._el('div', 'vexsr-mode', [it.kindLabel, it.at ? new Date(it.at).toLocaleDateString() : ''].filter(Boolean).join(' · ')));
        if (it.snippet) t.appendChild(this._el('div', 'vexsr-sub', String(it.snippet).slice(0, 240)));
        row.appendChild(t);
        if (it.url && /^https?:/i.test(it.url)) { const o = this._el('button', 'vexsr-x', 'Open'); o.addEventListener('click', () => this._open(it.url)); row.appendChild(o); }
        this.decorateRow(row, { id: it.id, kind: it.kind, title: it.title, url: it.url }, { say: (m) => fail(new Error(m)) });
        host.appendChild(row);
      }
      if (page && page.url) {
        const notes = this.backlinks(page.url, this._notes());
        host.appendChild(this._el('div', 'vexsr-sub', notes.length ? 'Notes that cite this page: ' + notes.map(n => n.title).join(' · ') : 'No note cites this page.'));
        const copy = await this.copyFor(page.url);
        if (copy) {
          const row = this._el('div', 'vexsr-sub', 'You kept a copy on ' + new Date(copy.at).toLocaleDateString() + '. ');
          const b = this._el('button', 'vexsr-x', 'Open your copy');
          b.addEventListener('click', () => { ArchiveLibrary.openCopy(copy.id).catch(fail); });
          row.appendChild(b);
          host.appendChild(row);
        }
      }
    } catch (e) { fail(e); }
  },

  async openRelatedPanel() {
    if (!this.enabled()) throw new Error('Library links are switched off in Settings');
    if (typeof Knowledge === 'undefined') throw new Error('The knowledge base is not available');
    const page = await Knowledge._pageText();
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const { body } = VexSettingsGroups.dialog({ id: 'vex-library-related', title: 'Related from my library', sub: page.title || page.url });
    await this.renderRelated(body, page);
  },

  // For the research board: its quotes are the text, the board is the page.
  boardPage(items) {
    const list = Array.isArray(items) ? items : [];
    return { title: 'Research board', url: '', text: list.map(q => q.text).join('\n').slice(0, 20000) };
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Add-ons to your knowledge base: backlinks between notes and the pages they cite, a related-from-my-library panel on the page you read and on the research board, a check for conflicts between the sources of an answer (your local model; every position quotes its source), your saved copy beside a result, and an answer read aloud with its sources summarised.'));
    el.appendChild(G.button('Related from my library', () => { this.openRelatedPanel().catch(e => window.showToast?.(e.message, 'error')); }, { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexLibraryLinks = VexLibraryLinks;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'library-links', title: 'Library links', keywords: 'knowledge library backlinks related conflicts contradiction sources copy archive listen answer', build: (el) => VexLibraryLinks.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'library-related', label: 'Related From My Library (Panel)', hint: 'What you kept that relates to this page, the notes that cite it, and your saved copy', icon: 'link', action: () => { VexLibraryLinks.openRelatedPanel().catch(e => window.showToast?.(e.message, 'error')); } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexLibraryLinks };
