// === Draft and evidence checks (T3-104) ============================================
//
// For an essay draft in one of your notes: which sentences make a claim, and does anything
// you saved support each one? It FINDS; it never writes.
//
//   - The claims are the sentences with a number, a year, a percentage, or a word such as
//     "shows", "found", "caused", "increased", "according to".
//   - Your sources are what you already keep: your highlights, your other notes and your
//     read-later list (title and saved text). Nothing is looked up on the internet.
//   - A claim is "supported" when most of its important words (and every number in it) turn
//     up together in one passage of one source, "partly" when some do, "no source" when none
//     does. That is a word match and it can be wrong either way; the passage is always shown
//     so you judge it.
//   - Optionally your LOCAL model (Ollama) reads a claim and the best passage and answers
//     only "supports", "partly" or "does not support". Its answer is shown as a label; the
//     text of your draft is never sent to a cloud model and is never rewritten.
//   - Also listed: paragraphs with no citation mark ((Smith, 2020), [3] or an address), and
//     sources you saved that no claim leans on.
//
//   VexDraftCheck.claims(text)                  pure
//   VexDraftCheck.check(text, sources)          pure -> { claims:[{text, verdict, best}], uncited:[], unused:[] }
//   VexDraftCheck.sources(excludeNoteId)        gathers your sources
const VexDraftCheck = {
  PREF: 'vex.draftCheck.enabled',
  MAX_CLAIMS: 60,
  CUES: /\b(show(?:s|ed|n)?|found|find(?:s|ings?)?|prove[sd]?|caus(?:e|es|ed)|lead(?:s|ing)?\s+to|led\s+to|increas(?:e|es|ed)|decreas(?:e|es|ed)|reduc(?:e|es|ed)|according\s+to|studies|research|evidence|percent|average|majority|significant(?:ly)?|because|result(?:s|ed)?\s+in|gösteri(?:r|yor)|araştırma|yüzde|neden(?:i)?)\b/i,

  _flag: null,
  _f() { return this._flag || (this._flag = VexStudyKit.flag(this.PREF)); },
  enabled() { return this._f().enabled(); },
  setEnabled(on) { this._f().set(on); },

  sentences(text) {
    return String(text == null ? '' : text).replace(/\r/g, '').split(/\n+/).flatMap(line => {
      if (/^\s*#{1,6}\s/.test(line) || !line.trim()) return [];
      return line.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9"(])/).map(s => s.trim()).filter(Boolean);
    });
  },

  claims(text) {
    const out = [];
    for (const s of this.sentences(text)) {
      if (s.endsWith('?') || s.split(/\s+/).length < 6) continue;
      if (/\d/.test(s) || this.CUES.test(s)) out.push(s);
      if (out.length >= this.MAX_CLAIMS) break;
    }
    return out;
  },

  _cited(par) { return /\([A-ZÇĞİÖŞÜ][^()]{1,60},?\s*(?:19|20)\d\d[a-z]?\)|\[\d{1,3}(?:[,–-]\s*\d{1,3})*\]|https?:\/\//.test(par); },

  _keys(s) {
    const K = VexStudyKit;
    const nums = (String(s).match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.'));
    const w = [...new Set(K.words(s.replace(/\d+(?:[.,]\d+)?/g, ' ')).map(x => K.stem(x)))].filter(x => x.length >= 3);
    return { nums: [...new Set(nums)], words: w };
  },

  _passages(source) {
    const t = String(source.text || '');
    const parts = t.split(/\n{1,}|(?<=[.!?])\s+/).map(p => p.trim()).filter(p => p.length >= 20);
    const out = [];
    // A passage is two neighbouring sentences, so a claim spread over two still matches.
    for (let i = 0; i < parts.length; i++) out.push(parts[i] + (parts[i + 1] ? ' ' + parts[i + 1] : ''));
    if (!out.length && t.trim()) out.push(t.trim());
    return out.slice(0, 400);
  },

  score(claimKeys, passage) {
    const pk = this._keys(passage);
    const pw = new Set(pk.words), pn = new Set(pk.nums);
    const total = claimKeys.words.length + claimKeys.nums.length;
    if (!total) return { ratio: 0, hit: 0, numsAll: true };
    const hw = claimKeys.words.filter(w => pw.has(w) || [...pw].some(x => x.length > 4 && (x.startsWith(w) || w.startsWith(x)))).length;
    const hn = claimKeys.nums.filter(n => pn.has(n)).length;
    return { ratio: (hw + hn) / total, hit: hw + hn, numsAll: hn === claimKeys.nums.length };
  },

  check(text, sources) {
    const claims = this.claims(text);
    const prep = (sources || []).map(s => ({ s, passages: this._passages(s) }));
    const used = new Set();
    const res = claims.map(c => {
      const ck = this._keys(c);
      let best = null;
      for (const { s, passages } of prep) {
        for (const p of passages) {
          const sc = this.score(ck, p);
          if (!best || sc.ratio > best.ratio) best = { ratio: sc.ratio, hit: sc.hit, numsAll: sc.numsAll, passage: p, source: s };
        }
      }
      let verdict = 'none';
      if (best && best.hit >= 3 && best.ratio >= 0.6 && best.numsAll) verdict = 'supported';
      else if (best && best.hit >= 2 && best.ratio >= 0.35) verdict = 'partly';
      if (verdict !== 'none' && best) used.add(best.source.id);
      return { text: c, verdict, best: verdict === 'none' ? null : { passage: best.passage.slice(0, 400), source: { id: best.source.id, title: best.source.title, url: best.source.url, kind: best.source.kind } } };
    });
    const uncited = String(text || '').split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 80 && !/^#{1,6}\s/.test(p) && !this._cited(p)).map(p => p.slice(0, 120) + (p.length > 120 ? '...' : ''));
    const unused = (sources || []).filter(s => s.kind !== 'note' && !used.has(s.id)).map(s => ({ title: s.title, url: s.url }));
    return { claims: res, uncited, unused };
  },

  // What you keep, as { id, kind, title, url, text }. A note being checked is left out.
  sources(excludeNoteId) {
    const K = VexStudyKit;
    const out = [];
    for (const n of K.notes()) if (n.id !== excludeNoteId && typeof n.content === 'string' && n.content.trim()) out.push({ id: 'n:' + n.id, kind: 'note', title: String(n.title || 'Untitled note'), url: String(n.sourceUrl || ''), text: n.content });
    let ann = {};
    try { ann = (typeof Annotations !== 'undefined' && Annotations.store) ? Annotations.store : K.store('vex.annotations', {}).get(); } catch (err) { throw new Error('The highlights could not be read: ' + err.message); }
    for (const [url, list] of Object.entries(ann || {})) {
      const arr = (Array.isArray(list) ? list : []).filter(h => h && h.text);
      if (!arr.length) continue;
      out.push({ id: 'a:' + url, kind: 'highlights', title: String(arr[0].title || url), url: String(arr[0].url || url), text: arr.map(h => h.text + (h.note ? ' ' + h.note : '')).join('\n') });
    }
    const rl = K.store('vex.readLater', []).get();
    for (const r of Array.isArray(rl) ? rl : []) {
      const t = [r && r.title, r && (r.text || r.excerpt || r.summary || r.content)].filter(Boolean).join('\n');
      if (t.trim()) out.push({ id: 'r:' + (r.id || r.url), kind: 'saved page', title: String(r.title || r.url || ''), url: String(r.url || ''), text: t });
    }
    return out;
  },

  // ---- two-source contrast -------------------------------------------------------------------
  // The claims of the draft against TWO sources you pick: for each claim, what each source says
  // about it (supports / partly / numbers differ / may disagree / silent) and the passage. A word and
  // number match, so it can be wrong either way; the passages are shown so you judge.
  NEG: /\b(not|no|never|none|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|without|değil|yok|asla)\b/i,
  stanceIn(claim, source) {
    const ck = this._keys(claim);
    let best = null;
    for (const p of this._passages(source)) {
      const sc = this.score(ck, p);
      if (!best || sc.ratio > best.ratio) best = { ratio: sc.ratio, hit: sc.hit, numsAll: sc.numsAll, passage: p };
    }
    if (!best || best.hit < 2 || best.ratio < 0.35) return { stance: 'silent', passage: '' };
    const passage = best.passage.slice(0, 400);
    if (!best.numsAll && ck.nums.length && best.ratio >= 0.5) return { stance: 'numbers differ', passage };
    if (best.ratio >= 0.5 && this.NEG.test(claim) !== this.NEG.test(best.passage)) return { stance: 'may disagree', passage };
    if (best.hit >= 3 && best.ratio >= 0.6 && best.numsAll) return { stance: 'supports', passage };
    return { stance: 'partly', passage };
  },
  // -> { rows: [{ claim, a, b, relation }], counts }. relation: agree | conflict | only-a | only-b | neither
  contrast(text, sourceA, sourceB) {
    if (!sourceA || !sourceB) throw new Error('Pick two sources to compare');
    if (sourceA.id === sourceB.id) throw new Error('Pick two different sources');
    const counts = { agree: 0, conflict: 0, 'only-a': 0, 'only-b': 0, neither: 0 };
    const rows = this.claims(text).map(claim => {
      const a = this.stanceIn(claim, sourceA), b = this.stanceIn(claim, sourceB);
      const has = (x) => x.stance !== 'silent';
      const bad = (x) => x.stance === 'numbers differ' || x.stance === 'may disagree';
      let relation = 'neither';
      if (has(a) && has(b)) relation = (bad(a) !== bad(b) || (bad(a) && bad(b) && a.stance !== b.stance)) ? 'conflict' : 'agree';
      else if (has(a)) relation = 'only-a';
      else if (has(b)) relation = 'only-b';
      counts[relation]++;
      return { claim, a, b, relation };
    });
    return { rows, counts };
  },

  // ---- rubric ----------------------------------------------------------------------------------
  RUBRIC_KEY: 'vex.draftCheck.rubric',
  MAX_CUSTOM: 8,
  THESIS: /\b(this (?:essay|paper|report|article|piece)|i (?:will |shall )?(?:argue|claim|contend|show)|thesis|aims? to|will (?:show|examine|discuss|argue|explore)|bu (?:makale|yazı|çalışma))\b/i,
  COUNTER: /\b(however|on the other hand|critics|counter-?arguments?|nevertheless|although|opponents|some argue|yet|ancak|fakat)\b/i,
  CONCLUSION: /\b(in conclusion|to conclude|to sum up|in summary|in short|overall|all in all|sonuç olarak|özetle)\b/i,
  rubricPrefs() {
    const v = VexStudyKit.store(this.RUBRIC_KEY, {}).get();
    const o = v && typeof v === 'object' ? v : {};
    const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
    return { minWords: n(o.minWords), maxWords: n(o.maxWords), custom: (Array.isArray(o.custom) ? o.custom : []).map(s => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, this.MAX_CUSTOM) };
  },
  saveRubricPrefs(p) {
    const clean = { minWords: Number(p.minWords) > 0 ? Math.round(Number(p.minWords)) : 0, maxWords: Number(p.maxWords) > 0 ? Math.round(Number(p.maxWords)) : 0, custom: (Array.isArray(p.custom) ? p.custom : []).map(s => String(s).trim().slice(0, 200)).filter(Boolean).slice(0, this.MAX_CUSTOM) };
    if (clean.minWords && clean.maxWords && clean.minWords > clean.maxWords) throw new Error('The shortest length is more than the longest');
    VexStudyKit.store(this.RUBRIC_KEY, {}).set(clean);
    return clean;
  },
  // Pure. `result` is check()'s answer for the same text. pass: true | false | null (cannot tell).
  rubricCheck(text, result, prefs) {
    const t = String(text == null ? '' : text);
    const pars = t.split(/\n{2,}/).map(p => p.trim()).filter(p => p && !/^#{1,6}\s/.test(p));
    const words = t.split(/\s+/).filter(Boolean).length;
    const items = [];
    const add = (id, label, pass, detail) => items.push({ id, label, pass, detail });
    add('thesis', 'States what the piece is about or argues, near the start', pars.length ? pars.slice(0, 2).some(p => this.THESIS.test(p)) : null, 'Looks for "this essay", "I argue", "aims to" and similar in the first two paragraphs.');
    const claims = result && result.claims ? result.claims : [];
    if (claims.length) {
      const backed = claims.filter(c => c.verdict !== 'none').length;
      add('evidence', 'Most claims have something you saved behind them', backed / claims.length >= 0.6, backed + ' of ' + claims.length + ' claims have a matching source.');
    } else add('evidence', 'Most claims have something you saved behind them', null, 'No claims were found.');
    const unc = result && result.uncited ? result.uncited.length : 0;
    add('citations', 'Every long paragraph carries a citation', unc === 0, unc ? unc + ' long paragraph' + (unc === 1 ? ' has' : 's have') + ' no citation mark.' : 'No long paragraph without a citation mark.');
    add('counter', 'Looks at the other side', this.COUNTER.test(t), 'Looks for "however", "critics", "on the other hand" and similar.');
    add('conclusion', 'Ends with a conclusion', pars.length ? this.CONCLUSION.test(pars[pars.length - 1]) : null, 'Looks for "in conclusion", "overall" and similar in the last paragraph.');
    const p = prefs || { minWords: 0, maxWords: 0 };
    if (p.minWords || p.maxWords) {
      const ok = (!p.minWords || words >= p.minWords) && (!p.maxWords || words <= p.maxWords);
      add('length', 'Length is within ' + (p.minWords || 0) + ' to ' + (p.maxWords || 'any') + ' words', ok, words + ' words.');
    }
    return items;
  },
  // One of YOUR rubric lines, judged by the local model against the start of the draft.
  async judgeRubricLine(line, text) {
    const out = await VexStudyKit.generateLocal(
      'You mark an essay draft against one rubric line. Answer with exactly one word: YES, PARTLY or NO. Do not explain. Do not rewrite anything.',
      'RUBRIC LINE:\n' + String(line).slice(0, 200) + '\n\nDRAFT:\n' + String(text).slice(0, 3500) + '\n\nDoes the draft meet the line? One word.', { maxTokens: 8 });
    const w = /\b(YES|PARTLY|NO)\b/i.exec(out);
    if (!w) throw new Error('The local model did not answer with YES, PARTLY or NO');
    return w[1].toLowerCase();
  },

  // Your local model judges a claim against the best passage. Only a label comes back.
  async judge(claim, passage) {
    const out = await VexStudyKit.generateLocal(
      'You compare a claim with a passage. Answer with exactly one word: SUPPORTS, PARTLY or NO. Do not explain. Do not rewrite anything.',
      'CLAIM:\n' + claim.slice(0, 600) + '\n\nPASSAGE:\n' + passage.slice(0, 900) + '\n\nDoes the passage support the claim? One word.', { maxTokens: 8 });
    const w = /\b(SUPPORTS|PARTLY|NO)\b/i.exec(out);
    if (!w) throw new Error('The local model did not answer with SUPPORTS, PARTLY or NO');
    return w[1].toUpperCase() === 'SUPPORTS' ? 'supports' : (w[1].toUpperCase() === 'PARTLY' ? 'partly' : 'does not support');
  },

  LABEL: { supported: 'Supported', partly: 'Partly', none: 'No source' },

  async open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('draft-check');
    const K = VexStudyKit, G = VexSettingsGroups;
    const notes = K.notes();
    if (!notes.length) { window.showToast?.('You have no notes yet. Write the draft in a note first.'); return; }
    const { body } = G.dialog({ id: 'vex-draft-check', title: 'Check a draft', sub: 'Finds the claims in a note and what you saved that supports them. It does not write or change anything.' });
    const sel = K.el('select', { 'aria-label': 'Draft note' }, notes.map(n => K.el('option', { value: n.id, text: String(n.title || 'Untitled note').slice(0, 80) })));
    const out = K.el('div', { style: 'margin-top:12px' });
    const run = (judge) => K.guard(async () => {
      const n = notes.find(x => x.id === sel.value);
      const r = this.check(String(n.content || ''), this.sources(n.id));
      out.textContent = '';
      out.appendChild(K.el('h3', { text: r.claims.length + ' claim' + VexPlural.s(r.claims.length) + ' found (a word match, so judge each yourself)' }));
      for (const c of r.claims) {
        const row = K.el('div', { style: 'margin:10px 0;padding:8px;border-left:3px solid ' + (c.verdict === 'supported' ? '#22c55e' : (c.verdict === 'partly' ? '#eab308' : '#ef4444')) },
          K.el('div', { text: c.text }), K.el('div', { class: 'vex-platform-note', text: this.LABEL[c.verdict] + (c.best ? ': ' + c.best.source.title + (c.best.source.url ? ' (' + c.best.source.url + ')' : '') : '') }));
        if (c.best) row.appendChild(K.el('blockquote', { text: c.best.passage, style: 'margin:4px 0;opacity:.8;font-size:.92em' }));
        if (judge && c.best) {
          const tag = K.el('div', { class: 'vex-platform-note', text: 'Local model: reading...' });
          row.appendChild(tag);
          this.judge(c.text, c.best.passage).then(v => { tag.textContent = 'Local model says: ' + v; }, e => { tag.textContent = 'Local model: ' + e.message; });
        }
        out.appendChild(row);
      }
      if (r.uncited.length) { out.appendChild(K.el('h3', { text: 'Paragraphs with no citation mark' })); for (const u of r.uncited) out.appendChild(K.el('div', { class: 'vex-platform-note', text: u })); }
      if (r.unused.length) { out.appendChild(K.el('h3', { text: 'Saved sources no claim leans on' })); for (const u of r.unused.slice(0, 30)) out.appendChild(K.el('div', { class: 'vex-platform-note', text: u.title + (u.url ? ' (' + u.url + ')' : '') })); }
    });
    // Two-source contrast table: pick two of the things you saved and see what each says per claim.
    const pickSrc = (label) => K.el('select', { 'aria-label': label });
    const selA = pickSrc('First source'), selB = pickSrc('Second source');
    let pool = [];
    const fill = () => {
      pool = this.sources(sel.value);
      for (const s of [selA, selB]) {
        s.textContent = '';
        pool.forEach((src, i) => s.appendChild(K.el('option', { value: String(i), text: ('[' + src.kind + '] ' + src.title).slice(0, 90) })));
      }
      if (pool.length > 1) selB.value = '1';
    };
    sel.addEventListener('change', fill);
    fill();
    const STANCE = { agree: 'Both say about the same', conflict: 'The sources differ', 'only-a': 'Only the first source covers it', 'only-b': 'Only the second source covers it', neither: 'Neither source covers it' };
    const compare = K.guard(async () => {
      const n = notes.find(x => x.id === sel.value);
      const r = this.contrast(String(n.content || ''), pool[Number(selA.value)], pool[Number(selB.value)]);
      out.textContent = '';
      out.appendChild(K.el('h3', { text: r.rows.length + ' claim' + (r.rows.length === 1 ? '' : 's') + ': ' + r.counts.agree + ' agree, ' + r.counts.conflict + ' differ, ' + (r.counts['only-a'] + r.counts['only-b']) + ' in one source only, ' + r.counts.neither + ' in neither' }));
      const th = (t) => K.el('th', { text: t, style: 'text-align:left;padding:4px 6px' });
      const td = (t, st) => K.el('td', { text: t, style: 'vertical-align:top;padding:4px 6px;border-top:1px solid rgba(128,128,128,.3)' + (st || '') });
      const tbl = K.el('table', { style: 'width:100%;border-collapse:collapse;font-size:.92em' },
        K.el('thead', {}, K.el('tr', {}, th('Claim'), th('First source'), th('Second source'), th('Together'))));
      const tb = K.el('tbody');
      for (const row of r.rows) {
        tb.appendChild(K.el('tr', {}, td(row.claim),
          td(row.a.stance + (row.a.passage ? ': ' + row.a.passage : '')),
          td(row.b.stance + (row.b.passage ? ': ' + row.b.passage : '')),
          td(STANCE[row.relation], 'font-weight:600')));
      }
      tbl.appendChild(tb);
      out.appendChild(tbl);
    });
    // Rubric: built-in checks you can read at a glance, your own lines judged by your local model.
    const rubric = (judgeCustom) => K.guard(async () => {
      const n = notes.find(x => x.id === sel.value);
      const prefs = this.rubricPrefs();
      const text = String(n.content || '');
      const items = this.rubricCheck(text, this.check(text, this.sources(n.id)), prefs);
      out.textContent = '';
      out.appendChild(K.el('h3', { text: 'Rubric (a word and pattern check; you decide)' }));
      for (const it of items) out.appendChild(K.el('div', { style: 'margin:6px 0' }, K.el('strong', { text: (it.pass === true ? 'Met: ' : (it.pass === false ? 'Not met: ' : 'Cannot tell: ')) + it.label }), K.el('div', { class: 'vex-platform-note', text: it.detail })));
      for (const line of prefs.custom) {
        const tag = K.el('div', { class: 'vex-platform-note', text: judgeCustom ? 'Local model: reading...' : 'Press "Rubric + my lines" to have your local model judge this line.' });
        out.appendChild(K.el('div', { style: 'margin:6px 0' }, K.el('strong', { text: 'Your line: ' + line }), tag));
        if (judgeCustom) this.judgeRubricLine(line, text).then(v => { tag.textContent = 'Local model says: ' + v; }, e => { tag.textContent = 'Local model: ' + e.message; });
      }
    });
    const minIn = K.el('input', { type: 'number', min: '0', 'aria-label': 'Shortest length in words', placeholder: 'min words', style: 'width:96px' });
    const maxIn = K.el('input', { type: 'number', min: '0', 'aria-label': 'Longest length in words', placeholder: 'max words', style: 'width:96px' });
    const lines = K.el('textarea', { 'aria-label': 'Your rubric lines, one per line', rows: '3', placeholder: 'Your own rubric lines, one per line (up to ' + this.MAX_CUSTOM + ')', style: 'width:100%' });
    const pf = this.rubricPrefs();
    minIn.value = pf.minWords || ''; maxIn.value = pf.maxWords || ''; lines.value = pf.custom.join('\n');
    const saveRubric = K.guard(async () => {
      this.saveRubricPrefs({ minWords: minIn.value, maxWords: maxIn.value, custom: lines.value.split(/\n+/) });
      window.showToast?.('Rubric saved', 'success');
    });
    body.append(K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, sel,
      G.button('Check', run(false), { primary: true }),
      G.button('Check, then ask my local model', run(true))),
    K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px' }, selA, selB, G.button('Compare the two sources', compare)),
    K.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px' }, minIn, maxIn,
      G.button('Rubric', rubric(false)), G.button('Rubric + my lines (local model)', rubric(true)), G.button('Save rubric', saveRubric)),
    lines, out);
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('Lists the claims in a draft note and whether your saved notes, highlights and read-later pages support them. Finds, never writes. A local model is optional and the draft is never sent to a cloud model.'));
    el.appendChild(G.button('Check a draft', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') window.VexDraftCheck = VexDraftCheck;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexDraftCheck };
