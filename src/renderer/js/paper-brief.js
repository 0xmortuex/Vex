// === Paper / PDF brief with a chapter map =========================================
//
// You open a PDF (the file button; drag a file onto the box). Vex reads its text in the main
// process (the 'doc:text' reader, page by page), then:
//
//   1. Chapter map   found WITHOUT any model, from the headings in the text (1 Introduction,
//                    2. Methods, Abstract, References ...) with their page numbers. Always
//                    there, always the same for the same file.
//   2. Per-chapter summary on demand: the LOCAL model only (Ollama, through AIRouter 'local'),
//                    asked for a summary and up to four claims, each with the EXACT sentence
//                    and its page. A claim whose sentence is not found on that page is
//                    dropped and counted, so a made-up quote never reaches the brief.
//   3. The brief     a reduce over the chapter summaries: question, method, finding,
//                    limitation, and a read / skim / skip suggestion. Every line says it came
//                    from the model; claims carry "p. N".
//
// Nothing is sent to the cloud, ever: if no local model answers, it says so and stops. The
// file stays on this computer. A scan (no text) is refused plainly (OCR is not run here).
// When the PDF's page order could not be read the page numbers are marked approximate.
//
// Pure and tested: chapters, chunk, verifyQuote, parseModelJson, toMarkdown.
const VexPaperBrief = {
  PREF: 'vex.paperBrief.enabled',
  MAX_BYTES: 32 * 1024 * 1024,
  CHUNK_CHARS: 6000,
  MAX_CLAIMS: 4,
  MAX_CHAPTERS: 40,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- pure -----------------------------------------------------------------------
  norm(s) { return String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase(); },

  // Headings: "1 Introduction", "2.1 Related work", "Abstract", "References", "CHAPTER 3 ...".
  // -> [{ title, page (1-based), index }] in reading order. A numbered heading is taken only at the
  // start of a line and only when short; the same heading repeated as a running header is kept once.
  chapters(pages) {
    const NAMED = /^(abstract|introduction|background|related work|methods?|methodology|materials and methods|results?|discussion|conclusions?|conclusion and future work|limitations|acknowledg(?:e)?ments|references|bibliography|appendix(?:\s+[a-z0-9]+)?)\.?$/i;
    const NUMBERED = /^((?:chapter|section|bölüm)\s+)?(\d{1,2}(?:\.\d{1,2}){0,2})[.)]?\s+([A-ZÇĞİÖŞÜ][^\n]{2,80})$/i;
    const out = [];
    const seen = new Set();
    (pages || []).forEach((text, pi) => {
      for (const raw of String(text || '').split('\n')) {
        const line = raw.trim();
        if (line.length < 3 || line.length > 90) continue;
        let title = null;
        if (NAMED.test(line)) title = line.replace(/\.$/, '');
        else {
          const m = NUMBERED.exec(line);
          if (m && !/[.!?]$/.test(m[3]) && !/^\d+(\.\d+)?$/.test(m[3]) && m[3].split(/\s+/).length <= 10) title = m[2] + ' ' + m[3];
        }
        if (!title) continue;
        const key = this.norm(title);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title: title.slice(0, 90), page: pi + 1, index: out.length });
        if (out.length >= this.MAX_CHAPTERS) return;
      }
    });
    // Each chapter runs to the page where the next begins.
    return out.map((c, i) => ({ ...c, endPage: i + 1 < out.length ? Math.max(c.page, out[i + 1].page) : (pages || []).length }));
  },

  // Text of pages [from..to] (1-based, inclusive) with [[page N]] markers, cut into pieces for the model.
  chunk(pages, from, to, size = this.CHUNK_CHARS) {
    const pieces = [];
    let cur = '';
    for (let p = Math.max(1, from); p <= Math.min(pages.length, to); p++) {
      const body = '[[page ' + p + ']]\n' + String(pages[p - 1] || '');
      if (cur && (cur.length + body.length) > size) { pieces.push(cur); cur = ''; }
      if (body.length > size) { for (let i = 0; i < body.length; i += size) pieces.push((i ? '[[page ' + p + ' continued]]\n' : '') + body.slice(i, i + size)); }
      else cur += (cur ? '\n' : '') + body;
    }
    if (cur) pieces.push(cur);
    return pieces;
  },

  // Is `quote` really on that page? (Whitespace, quote marks and case do not matter; a line break
  // or hyphen at a line end is allowed in the page.)
  verifyQuote(quote, pageText) {
    const q = this.norm(quote).replace(/[.…]+$/, '');
    if (q.length < 12) return false;
    const page = this.norm(String(pageText || '').replace(/-\s*\n\s*/g, ''));
    return page.includes(q);
  },

  // The model's answer as an object: a bare JSON object, one wrapped in {"reply": "..."} or in a code fence.
  parseModelJson(text) {
    let t = String(text == null ? '' : text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const take = (s) => { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('The model did not answer with the expected structure'); return JSON.parse(s.slice(a, b + 1)); };
    let o;
    try { o = take(t); } catch (err) { throw new Error('The model\'s answer could not be read: ' + err.message); }
    if (o && typeof o.reply === 'string' && !('summary' in o) && !('question' in o)) { try { o = take(o.reply); } catch { /* the reply was prose, kept below as a summary */ o = { summary: o.reply }; } }
    return o;
  },

  // pages-in-order claims, verified. -> { claims: [{quote,page}], dropped }
  checkClaims(claims, pages, scope) {
    const kept = []; let dropped = 0;
    for (const c of Array.isArray(claims) ? claims.slice(0, this.MAX_CLAIMS) : []) {
      const quote = String(c && c.quote || '').trim();
      const page = Number(c && c.page);
      let ok = false, at = page;
      // Page as the model said it first, then the other pages of the chunk (it may misread a marker).
      if (Number.isInteger(page) && page >= 1 && page <= pages.length && this.verifyQuote(quote, pages[page - 1])) ok = true;
      else for (let p = scope.from; p <= scope.to; p++) if (this.verifyQuote(quote, pages[p - 1])) { ok = true; at = p; break; }
      if (ok) kept.push({ quote, page: at }); else dropped++;
    }
    return { claims: kept, dropped };
  },

  toMarkdown(brief) {
    const L = ['# Brief: ' + (brief.title || brief.fileName || 'PDF'), '', '_Written by a local model from the text of the file. Quotes are checked against the page; the rest is the model\'s reading._' + (brief.pagesApprox ? ' _Page numbers are approximate for this file._' : ''), ''];
    const s = brief.summary || {};
    if (s.decision) L.push('**Suggestion:** ' + s.decision + (s.why ? ' - ' + s.why : ''), '');
    for (const [k, label] of [['question', 'Question'], ['method', 'Method'], ['finding', 'Main finding'], ['limitation', 'Limitation']]) if (s[k]) L.push('**' + label + ':** ' + s[k], '');
    L.push('## Chapters', '');
    for (const c of brief.chapters || []) {
      L.push('- ' + c.title + ' (pp. ' + c.page + (c.endPage > c.page ? '-' + c.endPage : '') + ')' + (c.summary ? ': ' + c.summary : ''));
      for (const q of c.claims || []) L.push('  - "' + q.quote + '" (p. ' + q.page + ')');
      if (c.dropped) L.push('  - ' + c.dropped + ' claim(s) left out: the quoted sentence was not on the page.');
    }
    return L.join('\n') + '\n';
  },

  // ---- reading the file ----------------------------------------------------------------------
  async readFile(file) {
    if (!file) throw new Error('Choose a PDF first');
    if (file.size > this.MAX_BYTES) throw new Error('That file is larger than 32 MB');
    if (!window.vex || typeof window.vex.docText !== 'function') throw new Error('Reading files is not available in this build');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await window.vex.docText(bytes, file.name);
    if (!r || r.ok === false) throw new Error((r && r.error) || 'The file could not be read');
    if (r.kind !== 'pdf') throw new Error('That is not a PDF');
    if (!Array.isArray(r.pages) || !r.pages.length) throw new Error('The pages of that PDF could not be told apart');
    return { fileName: file.name, pages: r.pages, pagesApprox: !!r.pagesApprox };
  },

  // ---- the local model ----------------------------------------------------------------------------
  async _ask(system, message) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') throw new Error('The AI router is not available');
    let out;
    try { out = await AIRouter.callOn('local', 'chat', { message, conversationHistory: [], pageContext: null, persona: { systemPrompt: system, temperature: 0.1 } }); }
    catch (err) { throw new Error('The local model did not answer (' + (err && err.message) + '). Start Ollama and pick a model; this feature never uses the cloud.'); }
    if (!out || out.backend !== 'local') throw new Error('Only the local model is used here, and it did not answer');
    return this.parseModelJson(out.result);
  },
  MAP_SYSTEM: 'You summarise one part of a paper. Use only the text given. Reply with ONLY a JSON object: {"summary": "two or three sentences", "claims": [{"quote": "one sentence copied EXACTLY from the text", "page": 3}]}. At most 4 claims. The page is the number in the nearest [[page N]] marker above the sentence. Never invent a quote.',
  REDUCE_SYSTEM: 'You brief a reader on a paper from chapter summaries. Reply with ONLY a JSON object: {"question": "...", "method": "...", "finding": "...", "limitation": "...", "decision": "read" or "skim" or "skip", "why": "one short sentence"}. Use only what the summaries say; write "not stated" when they do not say.',

  async summarizeChapter(doc, ch) {
    const pieces = this.chunk(doc.pages, ch.page, ch.endPage);
    const summaries = [];
    let claims = [], dropped = 0;
    for (const piece of pieces.slice(0, 6)) {
      const o = await this._ask(this.MAP_SYSTEM, 'Chapter: ' + ch.title + '\n\n' + piece);
      if (o.summary) summaries.push(String(o.summary).slice(0, 600));
      const c = this.checkClaims(o.claims, doc.pages, { from: ch.page, to: ch.endPage });
      claims = claims.concat(c.claims); dropped += c.dropped;
    }
    return { summary: summaries.join(' '), claims: claims.slice(0, this.MAX_CLAIMS * 2), dropped };
  },

  // The whole brief as one heavy job (it waits for a quiet moment and is refused in a game).
  async brief(doc, onStep) {
    if (typeof VexJobs === 'undefined') throw new Error('The job queue is not loaded');
    const run = await VexJobs.heavy('Paper brief', async () => {
      const chapters = (doc.chapters || this.chapters(doc.pages)).slice(0, 12).map(c => ({ ...c }));
      if (!chapters.length) chapters.push({ title: 'Whole document', page: 1, endPage: doc.pages.length, index: 0 });
      let i = 0;
      for (const ch of chapters) {
        if (onStep) onStep(++i, chapters.length, ch.title);
        if (/^(references|bibliography|acknowledg)/i.test(ch.title)) continue;
        Object.assign(ch, await this.summarizeChapter(doc, ch));
      }
      const digest = chapters.filter(c => c.summary).map(c => c.title + ' (pp. ' + c.page + '-' + c.endPage + '): ' + c.summary).join('\n');
      if (!digest) throw new Error('No chapter could be summarised');
      const summary = await this._ask(this.REDUCE_SYSTEM, digest);
      return { fileName: doc.fileName, pagesApprox: doc.pagesApprox, chapters, summary };
    }, { kind: 'ai-ask', feature: 'paper-brief' });
    if (!run.ran) throw new Error('The brief did not run: ' + run.reason);
    return run.value;
  },

  // ---- screen ------------------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('paper-brief');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-paper-brief', title: 'Paper brief', sub: 'Choose a PDF. The chapter map comes from its headings; summaries use only the local model and quote the page.' });
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,.pdf';
    input.setAttribute('aria-label', 'Choose a PDF');
    const out = document.createElement('div');
    const status = G.note('');
    body.append(input, status, out);
    let doc = null, brief = null;
    const say = (t) => { status.textContent = t; };
    const fail = (e) => { say(''); window.showToast?.(e.message, 'error'); };
    const drawMap = () => {
      out.textContent = '';
      out.appendChild(G.note((doc.pages.length) + ' pages' + (doc.pagesApprox ? '; page numbers are approximate for this file' : '') + '. ' + doc.chapters.length + ' headings found.'));
      for (const c of doc.chapters) {
        const row = document.createElement('div');
        row.className = 'vexsr-rule';
        row.style.cssText = 'display:block;margin:6px 0';
        if (c.summary && typeof VexProvenance !== 'undefined') row.appendChild(VexProvenance.chip({ kind: 'local', read: 'the text of this chapter' }));
        row.appendChild(G.note(c.title + ' (pp. ' + c.page + (c.endPage > c.page ? '-' + c.endPage : '') + ')' + (c.summary ? ': ' + c.summary : '')));
        for (const q of c.claims || []) row.appendChild(G.note('"' + q.quote + '" (p. ' + q.page + ')'));
        if (c.dropped) row.appendChild(G.note(c.dropped + ' claim(s) left out: the sentence was not on the page.'));
        row.appendChild(G.button(c.summary ? 'Summarise again' : 'Summarise this chapter', async () => {
          try { say('Asking the local model...'); const r = await VexJobs.heavy('Paper chapter', () => this.summarizeChapter(doc, c), { kind: 'ai-ask', feature: 'paper-brief' }); if (!r.ran) throw new Error(r.reason); Object.assign(c, r.value); say(''); drawMap(); }
          catch (e) { fail(e); }
        }));
        out.appendChild(row);
      }
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
      bar.append(G.button('Write the brief', async () => {
        try { brief = await this.brief(doc, (i, n, t) => say('Reading ' + i + ' of ' + n + ': ' + t)); say(''); drawBrief(); } catch (e) { fail(e); }
      }, { primary: true }));
      out.appendChild(bar);
    };
    const drawBrief = () => {
      out.textContent = '';
      const md = this.toMarkdown(brief);
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font-size:12.5px;max-height:50vh;overflow:auto';
      pre.textContent = md;
      if (typeof VexProvenance !== 'undefined') out.appendChild(VexProvenance.chip({ kind: 'local', read: 'the text of the PDF' }));
      out.appendChild(pre);
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
      bar.append(
        G.button('Save as a note', () => { try { AgentTools.saveNote('Brief: ' + brief.fileName, md, undefined, { origin: 'paper-brief' }); window.showToast?.('Saved to Notes'); } catch (e) { fail(e); } }, { primary: true }),
        G.button('Copy', async () => { try { await navigator.clipboard.writeText(md); window.showToast?.('Copied'); } catch (e) { fail(e); } }),
        G.button('Back to the chapters', () => { doc.chapters = brief.chapters; drawMap(); }),
      );
      out.appendChild(bar);
    };
    input.addEventListener('change', async () => {
      try {
        say('Reading the file...');
        doc = await this.readFile(input.files[0]);
        doc.chapters = this.chapters(doc.pages);
        say('');
        drawMap();
      } catch (e) { fail(e); }
    });
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Open a PDF to get a chapter map from its headings, summaries by your local model, and claims quoted with their page. Cloud AI is never used here.'));
    el.appendChild(G.button('Open a paper', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexPaperBrief = VexPaperBrief;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'paper-brief', title: 'Paper brief', keywords: 'paper pdf brief chapter map summary claims page citation local model', build: (el) => VexPaperBrief.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'paper-brief', label: 'Paper Brief', hint: 'Chapter map and cited summary of a PDF, with the local model', icon: 'file', action: () => VexPaperBrief.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPaperBrief };
