// === Reading and watching with judgement (local model, your decision) ========
//
// Four small features that use the LOCAL model (Ollama) or no model at all.
// None of them sends a page, a title or a note to a cloud model, none runs
// anything unattended, and none changes or deletes what you saved.
//
//   ReadingTriage    T3-017  ranks the read-later queue against the goals you
//                    typed: read now / skim / drop, each with one line of why.
//                    "Drop" is a suggestion; the queue is never touched, and the
//                    raw order is one click away. It is also weighed against the focus block
//                    you are in now and against how often you finish what you save from a
//                    site (finish rate), both from what is already on this computer.
//   SeenBefore       T3-037  "have I seen this before?": your history, notes,
//                    highlights and read-later list searched for the page in
//                    front, with a similarity hint. Words only, on this computer.
//   AiRecipes        T3-065  a recipe is a saved AI skill, an optional page to
//                    read, and a reminder. When the reminder fires, Vex opens the
//                    recipe with its inputs ready and waits: the AI runs only when
//                    you press Run. Nothing runs by itself.
//   WatchJudgement   T3-103  a page watch gets a condition in your words ("only if
//                    the price drops or stock appears"). The local model reads the
//                    change and says whether it matters; a change that does not
//                    is not announced (it is listed under "what I held back",
//                    with an Undo), and one that does is announced with the
//                    evidence. If the model cannot be asked, the watch announces
//                    as it always did: judgement only ever makes a notice better,
//                    never the only way to learn of a change.

const AiLocal = {
  model() {
    if (typeof Ollama === 'undefined' || typeof AIRouter === 'undefined') return '';
    return AIRouter.isOllamaAvailable() ? String(AIRouter.getModel() || '') : '';
  },
  async generate(system, prompt, { maxTokens = 500, timeoutMs = 45000 } = {}) {
    const model = this.model();
    if (!model) throw new Error('No local model is set up (Ollama). This text is never sent to a cloud model.');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return String(await Ollama.generate(model, prompt, { systemPrompt: system, temperature: 0.1, maxTokens, signal: ctl.signal }) || '').trim();
    } finally { clearTimeout(timer); }
  },
  // The first {...} or [...] in a model's answer, parsed.
  json(text, open = '{') {
    const close = open === '{' ? '}' : ']';
    const s = String(text || '');
    const a = s.indexOf(open), b = s.lastIndexOf(close);
    if (a < 0 || b <= a) throw new Error('The local model did not answer in the form asked for');
    try { return JSON.parse(s.slice(a, b + 1)); }
    catch (err) { throw new Error('The local model did not answer in the form asked for', { cause: err }); }
  },
};

const AiWords = {
  STOP: new Set('the and for are but not you your with from this that have has was were will can all any one out new how why what when who which their there about into over more most some than then them they his her its our too very just also been being had did does doing his she him get got use using used per via vs com www http https html page site web'.split(' ')),
  tokens(text) {
    const out = [];
    for (const w of String(text == null ? '' : text).toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3 && !this.STOP.has(w) && !/^\d+$/.test(w)) out.push(w);
    }
    return out;
  },
  counts(text, max = 600) {
    const m = new Map();
    for (const w of this.tokens(text).slice(0, max)) m.set(w, (m.get(w) || 0) + 1);
    return m;
  },
  ago(ms) {
    const d = Math.floor((Date.now() - ms) / 86400000);
    if (d < 1) return 'today';
    if (d < 31) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
    if (d < 730) return Math.round(d / 30.4) + ' months ago';
    return Math.round(d / 365) + ' years ago';
  },
  // A stored JSON record, or the fallback with the problem noted (never silently).
  record(key, fallback, area) {
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (err) { console.error('[' + area + '] ' + key + ' could not be read:', err.message); return fallback(); }
    if (raw == null) return fallback();
    try { return JSON.parse(raw); }
    catch (err) {
      console.error('[' + area + '] ' + key + ' is not readable and is started again:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note(area, key + ' was not readable and was started again', err);
      return fallback();
    }
  },
};

function aiPrefs(key, defaults, area) {
  return {
    state() {
      const v = AiWords.record(key, () => ({ ...defaults }), area);
      return v && typeof v === 'object' && !Array.isArray(v) ? { ...defaults, ...v } : { ...defaults };
    },
    save(s) { localStorage.setItem(key, JSON.stringify(s)); },
    enabled() { return this.state().enabled !== false; },
    setEnabled(on) { const s = this.state(); s.enabled = !!on; this.save(s); },
  };
}

function aiOpen(url) {
  if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
  TabManager.createTab(String(url), true);
}
function aiFail(what, err) {
  console.error('[AI] ' + what + ':', err);
  window.showToast?.(what + ': ' + ((err && err.message) || err), 'error');
}

// ---------------------------------------------------------------------------------
// T3-017  Reading triage by goals
const ReadingTriage = {
  KEY: 'vex.readingTriage',
  FEATURE: 'reading-triage',
  MAX_GOALS: 10,
  MAX_GOAL_CHARS: 80,
  MODEL_ROWS: 15,
  OLD_DAYS: 30,
  ...aiPrefs('vex.readingTriage', { enabled: true, goals: '' }, 'Reading triage'),

  goals() {
    return String(this.state().goals || '').split(/[\n,;]+/).map(g => g.trim()).filter(Boolean).slice(0, this.MAX_GOALS);
  },
  setGoals(text) {
    const list = String(text == null ? '' : text).split(/[\n,;]+/).map(g => g.trim()).filter(Boolean);
    if (list.length > this.MAX_GOALS) throw new Error('At most ' + this.MAX_GOALS + ' goals');
    for (const g of list) if (g.length > this.MAX_GOAL_CHARS) throw new Error('Keep each goal under ' + this.MAX_GOAL_CHARS + ' characters');
    const s = this.state(); s.goals = list.join('\n'); this.save(s);
    return list;
  },

  queue() {
    if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) return ReadLater.items.filter(i => i && !i.read && i.url);
    const v = AiWords.record('vex.readLater', () => [], 'Reading triage');
    if (!Array.isArray(v)) throw new Error('The read-later list is not readable');
    return v.filter(i => i && !i.read && i.url);
  },

  // The goal of the focus block running now (Focus OS), or null when none runs or Focus OS is not loaded.
  focus() {
    if (typeof FocusOS === 'undefined' || typeof FocusOS.active !== 'function') return null;
    const b = FocusOS.active();
    const g = b && typeof FocusOS.goal === 'function' ? FocusOS.goal(b.goalId) : null;
    return g && g.title ? { title: String(g.title), words: AiWords.tokens(String(g.title)) } : null;
  },
  // Every saved item, read or not: the base of the finish rate.
  all() {
    if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) return ReadLater.items.filter(i => i && i.url);
    const v = AiWords.record('vex.readLater', () => [], 'Reading triage');
    if (!Array.isArray(v)) throw new Error('The read-later list is not readable');
    return v.filter(i => i && i.url);
  },
  // How often you finish what you save from each site: { [host]: { saved, read, rate } }. A site's items saved in the
  // last three days are not counted yet; they have not had time to be read.
  finishRates(items, now = Date.now()) {
    const out = {};
    for (const i of items || []) {
      const host = this._host(i.url);
      if (!host || (!i.read && i.at && now - i.at < 3 * 86400000)) continue;
      const e = out[host] || (out[host] = { saved: 0, read: 0, rate: 0 });
      e.saved++; if (i.read) e.read++;
    }
    for (const e of Object.values(out)) e.rate = e.saved ? e.read / e.saved : 0;
    return out;
  },
  // Pure. -> { score, matched: [goal], verdict, reason }
  // ctx (optional): { focus: { title, words }, rates } from focus() and finishRates().
  score(item, goals, now = Date.now(), ctx = {}) {
    let host = '', path = '';
    try { const u = new URL(item.url); host = u.hostname.replace(/^www\./, ''); path = decodeURIComponent(u.pathname); } catch { host = ''; }
    const have = new Set(AiWords.tokens([item.title || '', host, path].join(' ')));
    const days = item.at ? Math.max(0, (now - item.at) / 86400000) : 0;
    const matched = [];
    let partial = 0;
    for (const g of goals) {
      const gw = AiWords.tokens(g);
      if (!gw.length) continue;
      const hit = gw.filter(w => have.has(w)).length;
      const share = hit / gw.length;
      if (share >= 0.5) matched.push(g); else partial += share;
    }
    let score = matched.length * 3 + partial;
    if (Number.isFinite(item.minutes)) score += item.minutes <= 10 ? 1 : (item.minutes > 30 ? -1 : 0);
    score += days <= 7 ? 1 : (days > 60 ? -1 : 0);
    // The block you are in now: a title that shares half its words with the block's goal.
    let inBlock = false;
    if (ctx.focus && ctx.focus.words && ctx.focus.words.length) {
      const share = ctx.focus.words.filter(w => have.has(w)).length / ctx.focus.words.length;
      if (share >= 0.5) { inBlock = true; score += 2; }
    }
    // The site's finish rate, once there is enough to say (four saved or more).
    let habit = '';
    const rate = ctx.rates && ctx.rates[host];
    if (rate && rate.saved >= 4) {
      if (rate.rate >= 0.6) { score += 1; habit = 'you usually finish what you save from ' + host; }
      else if (rate.rate <= 0.2) { score -= 1; habit = 'you rarely finish what you save from ' + host; }
    }
    let verdict, reason;
    if (!goals.length && !(inBlock && score >= 3)) { verdict = 'skim'; reason = 'No goals are set yet, so this is only the order you saved it in'; }
    else if (matched.length && score >= 3) { verdict = 'read now'; reason = 'Matches your goal "' + matched[0] + '"' + (Number.isFinite(item.minutes) ? ', ' + item.minutes + ' min' : ''); }
    else if (!matched.length && inBlock && score >= 3) { verdict = 'read now'; reason = 'Fits the block you are in (' + ctx.focus.title.slice(0, 40) + ')'; inBlock = false; }
    else if (matched.length) { verdict = 'skim'; reason = 'Touches your goal "' + matched[0] + '", but it is long or old'; }
    else if (days > this.OLD_DAYS) { verdict = 'drop'; reason = 'Nothing to do with your goals, saved ' + Math.round(days) + ' days ago'; }
    else { verdict = 'skim'; reason = 'Nothing on your goals, but it is recent'; }
    if (inBlock) reason += '; fits the block you are in (' + ctx.focus.title.slice(0, 40) + ')';
    if (habit) reason += '; ' + habit;
    return { score: Math.round(score * 100) / 100, matched, verdict, reason, inBlock };
  },

  rank(items, goals, now = Date.now(), ctx = {}) {
    return items.map((item, i) => ({ item, i, ...this.score(item, goals, now, ctx), by: 'rules' }))
      .sort((a, b) => b.score - a.score || (b.item.at || 0) - (a.item.at || 0) || a.i - b.i);
  },

  // Asks the local model for a sentence per item. Titles and sites only are sent, to the local model.
  async explain(rows, goals) {
    const top = rows.slice(0, this.MODEL_ROWS);
    if (!top.length) return rows;
    const system = 'You triage a reading list against a person\'s goals. Reply ONLY with a JSON array of objects {"i": number, "verdict": "read now" | "skim" | "drop", "why": "one short sentence"} covering each item. Judge only from the title and site given.';
    const prompt = 'Goals:\n' + goals.map(g => '- ' + g).join('\n') + '\n\nItems:\n' + top.map((r, n) => n + '. ' + String(r.item.title || r.item.url).slice(0, 140) + ' (' + this._host(r.item.url) + (Number.isFinite(r.item.minutes) ? ', ' + r.item.minutes + ' min' : '') + ')').join('\n');
    const answer = AiLocal.json(await AiLocal.generate(system, prompt, { maxTokens: 700 }), '[');
    if (!Array.isArray(answer)) throw new Error('The local model did not answer with a list');
    const out = rows.map(r => ({ ...r }));
    for (const a of answer) {
      if (!a || !Number.isInteger(a.i) || a.i < 0 || a.i >= top.length) continue;
      const row = out[a.i];
      if (['read now', 'skim', 'drop'].includes(a.verdict)) row.verdict = a.verdict;
      if (typeof a.why === 'string' && a.why.trim()) { row.reason = a.why.trim().slice(0, 160); row.by = 'local model'; }
    }
    return out;
  },
  _host(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },

  open() {
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-reading-triage', title: 'Reading triage', sub: 'Your read-later queue against your goals. Suggestions only: nothing is removed or marked read.' });
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const goals = el('textarea', 'set-input'); goals.rows = 3; goals.style.cssText = 'width:100%;font-family:inherit'; goals.value = this.goals().join('\n');
    goals.placeholder = 'One goal per line, e.g. Cloudflare Workers\nelectron security';
    goals.setAttribute('aria-label', 'Your reading goals');
    const list = el('div', 'vexsr-list');
    const status = S.note(''); status.setAttribute('role', 'status');
    let rows = [], raw = false;
    const draw = () => {
      list.textContent = '';
      const shown = raw ? rows.slice().sort((a, b) => a.i - b.i) : rows;
      for (const r of shown) {
        const bar = el('div'); bar.style.cssText = 'display:flex;gap:6px';
        bar.append(S.button('Open', () => { try { aiOpen(r.item.url); } catch (err) { aiFail('Reading triage', err); } }, { label: 'Open ' + (r.item.title || r.item.url) }));
        const text = el('span', 'vexsr-host'); text.style.wordBreak = 'normal';
        text.append(el('div', '', r.verdict.toUpperCase() + ': ' + (r.item.title || r.item.url)), Object.assign(el('div', 'vexsr-mode', r.reason + (r.by === 'local model' ? ' (local model)' : '')), { style: 'white-space:normal' }));
        const row = el('div', 'vexsr-rule'); row.append(text, bar);
        list.appendChild(row);
      }
      if (!shown.length) list.appendChild(S.note('The queue is empty.'));
    };
    const rank = () => {
      this.setGoals(goals.value);
      rows = this.rank(this.queue(), this.goals(), Date.now(), { focus: this.focus(), rates: this.finishRates(this.all()) });
      status.textContent = rows.length + ' unread. Ranked by rules; ask the local model for reasons if you like.';
      draw();
    };
    const run = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { aiFail('Reading triage', err); } }, opts);
    body.append(S.note('Your goals'), goals,
      Object.assign(el('div'), { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0' }), status, list);
    body.children[2].append(
      run('Rank my queue', rank, { primary: true }),
      run('Ask the local model for reasons', async () => {
        if (!rows.length) rank();
        status.textContent = 'Asking the local model...';
        rows = await this.explain(rows, this.goals());
        status.textContent = 'Reasons from the local model for the top ' + Math.min(rows.length, this.MODEL_ROWS) + '. The queue itself is unchanged.';
        draw();
      }),
      run('Show the order I saved them in', () => { raw = !raw; draw(); }),
    );
    rank();
  },
};

// ---------------------------------------------------------------------------------
// T3-037  Have I seen this before?
const SeenBefore = {
  KEY: 'vex.seenBefore',
  FEATURE: 'seen-before',
  MAX_TEXT: 6000,
  MAX_HITS: 8,
  ...aiPrefs('vex.seenBefore', { enabled: true }, 'Seen before'),

  canonical(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol)) return '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|ref_src$)/i.test(k)) u.searchParams.delete(k);
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + (u.search || '');
  },

  _history() {
    if (typeof HistoryPanel !== 'undefined' && Array.isArray(HistoryPanel.entries) && HistoryPanel.entries.length) return HistoryPanel.entries;
    const v = AiWords.record('vex.history', () => [], 'Seen before');
    return Array.isArray(v) ? v : (v && Array.isArray(v.entries) ? v.entries : []);
  },
  _notes() {
    if (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) return NotesPanel.notes;
    const v = AiWords.record('vex.notes', () => [], 'Seen before');
    return Array.isArray(v) ? v : [];
  },
  _highlights() {
    const store = typeof Annotations !== 'undefined' && Annotations.store ? Annotations.store : AiWords.record('vex.annotations', () => ({}), 'Seen before');
    const out = [];
    if (store && typeof store === 'object') for (const [key, list] of Object.entries(store)) for (const h of Array.isArray(list) ? list : []) if (h && h.text) out.push({ key, h });
    return out;
  },
  _readLater() {
    if (typeof ReadLater !== 'undefined' && Array.isArray(ReadLater.items)) return ReadLater.items;
    const v = AiWords.record('vex.readLater', () => [], 'Seen before');
    return Array.isArray(v) ? v : [];
  },

  // Every place a page could have been seen, as plain documents.
  corpus() {
    const docs = [];
    const ts = (t) => (typeof t === 'number' ? t : Date.parse(t || '') || 0);
    for (const e of this._history()) {
      if (!e || !e.url) continue;
      let path = '';
      try { path = decodeURIComponent(new URL(e.url).pathname); } catch { path = ''; }
      docs.push({ where: 'history', title: String(e.title || e.url), url: String(e.url), at: ts(e.time || e.at), key: this.canonical(e.url), text: String(e.title || '') + ' ' + path });
    }
    for (const n of this._notes()) {
      if (!n) continue;
      docs.push({ where: 'note', title: String(n.title || 'Untitled note'), url: String(n.sourceUrl || ''), at: ts(n.updatedAt || n.createdAt), key: this.canonical(n.sourceUrl || ''), text: String(n.title || '') + ' ' + String(n.content || '').slice(0, 3000) });
    }
    for (const { key, h } of this._highlights()) {
      docs.push({ where: 'highlight', title: String(h.text).slice(0, 100), url: String(h.url || key), at: ts(h.at || h.createdAt || h.time), key: this.canonical(h.url || key), text: String(h.text) + ' ' + String(h.note || '') });
    }
    for (const r of this._readLater()) {
      if (r && r.url) docs.push({ where: 'read-later', title: String(r.title || r.url), url: String(r.url), at: ts(r.at), key: this.canonical(r.url), text: String(r.title || '') });
    }
    return docs;
  },

  // Pure. query: { url, title, text }. -> { same, similar, hint }
  find(query, docs, now = Date.now()) {
    const key = this.canonical(query.url);
    const sameDocs = key ? docs.filter(d => d.key === key && d.where === 'history') : [];
    let visits = sameDocs.length;
    const last = sameDocs.reduce((m, d) => Math.max(m, d.at), 0);
    // The visit that is happening now is in the history too.
    if (visits && now - last < 120000) visits -= 1;
    const earlier = sameDocs.filter(d => !(now - d.at < 120000));
    const first = earlier.reduce((m, d) => (d.at && (!m || d.at < m) ? d.at : m), 0);
    const lastBefore = earlier.reduce((m, d) => Math.max(m, d.at), 0);
    const same = visits > 0 ? { visits, first, last: lastBefore } : null;

    const q = AiWords.counts([query.title || '', query.text || ''].join(' '), 700);
    if (!q.size) return { same, similar: [], hint: this.hint(same, []) };
    const cand = docs.filter(d => d.key !== key || d.where !== 'history').map(d => ({ d, c: AiWords.counts(d.text) })).filter(x => [...q.keys()].some(w => x.c.has(w)));
    const df = new Map();
    for (const { c } of cand) for (const w of c.keys()) df.set(w, (df.get(w) || 0) + 1);
    const n = cand.length + 1;
    const idf = (w) => Math.log((n + 1) / ((df.get(w) || 0) + 1)) + 1;
    const vec = (m) => { const v = new Map(); let norm = 0; for (const [w, c] of m) { const x = (1 + Math.log(c)) * idf(w); v.set(w, x); norm += x * x; } return { v, norm: Math.sqrt(norm) }; };
    const qv = vec(q);
    const seen = new Set();
    const similar = [];
    for (const { d, c } of cand) {
      const dv = vec(c);
      if (!dv.norm) continue;
      let dot = 0;
      for (const [w, x] of qv.v) { const y = dv.v.get(w); if (y) dot += x * y; }
      const score = dot / (qv.norm * dv.norm);
      if (score < 0.2) continue;
      const id = d.where + '|' + (d.key || d.title);
      if (seen.has(id)) continue;
      seen.add(id);
      similar.push({ where: d.where, title: d.title, url: d.url, at: d.at, score: Math.round(score * 100) / 100, label: score >= 0.55 ? 'very similar' : (score >= 0.35 ? 'similar' : 'a little similar') });
    }
    similar.sort((a, b) => b.score - a.score);
    const top = similar.slice(0, this.MAX_HITS);
    return { same, similar: top, hint: this.hint(same, top) };
  },

  hint(same, similar) {
    const parts = [];
    if (same) parts.push('You opened this page ' + same.visits + (same.visits === 1 ? ' time' : ' times') + ' before' + (same.last ? ', last ' + AiWords.ago(same.last) : '') + '.');
    const note = similar.find(s => s.where === 'note'), hl = similar.find(s => s.where === 'highlight'), hist = similar.find(s => s.where === 'history'), rl = similar.find(s => s.where === 'read-later');
    if (note) parts.push('Your note "' + note.title.slice(0, 50) + '" is ' + note.label + '.');
    if (hl) parts.push('A highlight of yours is ' + hl.label + '.');
    if (hist) parts.push('You read something ' + hist.label + ' (' + hist.title.slice(0, 50) + ')' + (hist.at ? ' ' + AiWords.ago(hist.at) : '') + '.');
    if (rl) parts.push('A page in your read-later list is ' + rl.label + '.');
    return parts.length ? parts.join(' ') : 'Nothing like this in your history, notes, highlights or read-later list.';
  },

  async _pageText() {
    if (typeof WebviewManager === 'undefined' || typeof TabManager === 'undefined') throw new Error('Tabs are not loaded');
    const tab = TabManager.getActiveTab?.();
    const wv = WebviewManager.getActiveWebview?.();
    if (!tab || !wv) throw new Error('There is no page in front');
    if (!/^https?:/i.test(tab.url || '')) throw new Error('Only a web page can be compared');
    if (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab)) throw new Error('This is off in private and Tor tabs');
    let text = '';
    try {
      text = await Promise.race([
        wv.executeJavaScript('(document.body ? document.body.innerText : "").slice(0, ' + this.MAX_TEXT + ')'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('The page did not answer in time')), 2500)),
      ]);
    } catch (err) {
      console.error('[SeenBefore] the page text could not be read; comparing by title and address:', err.message);
    }
    return { url: tab.url, title: tab.title || '', text: String(text || '') };
  },

  async check() {
    if (!this.enabled()) throw new Error('"Have I seen this before?" is switched off (Settings > Reading and watching with AI)');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const page = await this._pageText();
    return { page, ...this.find(page, this.corpus()) };
  },

  async open() {
    const S = VexSettingsGroups;
    const r = await this.check();
    const { body } = S.dialog({ id: 'vex-seen-before', title: 'Have I seen this before?', sub: r.page.title || r.page.url });
    body.appendChild(S.note(r.hint));
    body.appendChild(S.note(r.page.text ? 'Compared by the words of the page against your history, notes, highlights and read-later list. Nothing left this computer.' : 'The page text could not be read, so only its title and address were compared.'));
    const list = document.createElement('div');
    list.className = 'vexsr-list';
    const WHERE = { history: 'History', note: 'Note', highlight: 'Highlight', 'read-later': 'Read later' };
    for (const s of r.similar) {
      const row = document.createElement('div');
      row.className = 'vexsr-rule';
      const t = document.createElement('span');
      t.className = 'vexsr-host';
      t.style.wordBreak = 'normal';
      const a = document.createElement('div'); a.textContent = WHERE[s.where] + ': ' + s.title;
      const b = document.createElement('div'); b.className = 'vexsr-mode'; b.style.whiteSpace = 'normal'; b.textContent = s.label + (s.at ? ', ' + AiWords.ago(s.at) : '');
      t.append(a, b);
      row.appendChild(t);
      if (/^https?:/i.test(s.url)) row.appendChild(S.button('Open', () => { try { aiOpen(s.url); } catch (err) { aiFail('Seen before', err); } }, { label: 'Open ' + s.title }));
      list.appendChild(row);
    }
    body.appendChild(list);
  },
};

// ---------------------------------------------------------------------------------
// T3-065  Scheduled AI recipes: a reminder that opens the recipe; you press Run
const AiRecipes = {
  KEY: 'vex.aiRecipes',
  FEATURE: 'ai-recipes',
  PREFIX: 'Run recipe: ',
  MAX: 20,
  REPEATS: ['', 'daily', 'weekdays', 'weekly'],
  ...aiPrefs('vex.aiRecipes', { enabled: true, recipes: [] }, 'AI recipes'),

  recipes() { const r = this.state().recipes; return Array.isArray(r) ? r : []; },
  skills() {
    if (typeof VexSkills === 'undefined' || !Array.isArray(VexSkills.skills)) throw new Error('AI skills are not available here');
    return VexSkills.skills.filter(s => s && s.id && s.name);
  },

  // Checked first, so a bad recipe makes no reminder.
  validate({ name, skillId, source, repeat }) {
    const label = String(name == null ? '' : name).trim();
    if (!label || label.length > 60) throw new Error('Give the recipe a name of up to 60 characters');
    if (!this.skills().some(s => s.id === skillId)) throw new Error('Choose one of your AI skills');
    const src = String(source == null ? '' : source).trim();
    if (src) {
      let u;
      try { u = new URL(src); } catch { throw new Error('The page to read is not a web address'); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('The page to read must be a web address');
    }
    if (!this.REPEATS.includes(repeat || '')) throw new Error('Repeat is daily, weekdays, weekly or not at all');
    return { label, src };
  },

  async add({ name, skillId, source = '', repeat = '', whenText = '' }) {
    if (!this.enabled()) throw new Error('AI recipes are switched off (Settings > Reading and watching with AI)');
    const { label, src } = this.validate({ name, skillId, source, repeat });
    if (this.recipes().length >= this.MAX) throw new Error('At most ' + this.MAX + ' recipes');
    if (this.recipes().some(r => r.name.toLowerCase() === label.toLowerCase())) throw new Error('There is already a recipe called ' + label);
    const recipe = { id: 'rc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: label, skillId, source: src, repeat: repeat || '', reminderId: null, at: 0, runs: 0, lastRunAt: 0 };
    if (String(whenText).trim()) {
      if (typeof VexQuickReminder === 'undefined') throw new Error('Reminders are not available here');
      const when = VexQuickReminder.parseWhen(whenText);
      const made = await VexQuickReminder.create(this.PREFIX + label, when, repeat ? { repeat } : {});
      recipe.reminderId = made && made.id ? made.id : null;
      recipe.at = when.getTime();
    }
    // Read again: the reminder was made while this waited.
    const s = this.state();
    s.recipes = [...this.recipes(), recipe];
    this.save(s);
    this.registerCommands();
    return recipe;
  },

  async remove(id) {
    const recipe = this.recipes().find(r => r.id === id);
    if (!recipe) throw new Error('That recipe is gone');
    if (recipe.reminderId && typeof VexQuickReminder !== 'undefined') await VexQuickReminder.remove(recipe.reminderId);
    const s = this.state(); s.recipes = this.recipes().filter(r => r.id !== id); this.save(s);
    this.registerCommands();
  },

  // Runs the skill on the page in front. Only ever called from the Run button.
  async run(id) {
    const recipe = this.recipes().find(r => r.id === id);
    if (!recipe) throw new Error('That recipe is gone');
    if (typeof VexSkills === 'undefined' || typeof VexSkills.run !== 'function') throw new Error('AI skills are not available here');
    if (!this.skills().some(s => s.id === recipe.skillId)) throw new Error('The skill of this recipe was deleted');
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    const s = this.state();
    const mine = s.recipes.find(r => r.id === id);
    mine.runs = (mine.runs || 0) + 1; mine.lastRunAt = Date.now();
    this.save(s);
    return VexSkills.run(recipe.skillId);
  },

  // The recipe a fired or clicked reminder belongs to.
  forReminder(r) {
    if (!r) return null;
    const list = this.recipes();
    const byId = r.id ? list.find(x => x.reminderId === r.id) : null;
    if (byId) return byId;
    const msg = String(r.message || '');
    return msg.startsWith(this.PREFIX) ? list.find(x => x.name === msg.slice(this.PREFIX.length)) || null : null;
  },

  // The window a reminder opens. Nothing runs here until Run is pressed.
  open(id) {
    const recipe = this.recipes().find(r => r.id === id);
    if (!recipe) throw new Error('That recipe is gone');
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-ai-recipe', title: recipe.name, sub: 'Nothing runs until you press Run.' });
    const skill = this.skills().find(x => x.id === recipe.skillId);
    body.appendChild(S.note('Skill: ' + (skill ? skill.name : '(deleted)')));
    if (skill && skill.prompt) body.appendChild(S.note(String(skill.prompt).slice(0, 300)));
    body.appendChild(S.note(recipe.source ? 'Reads this page: ' + recipe.source + '. Open it first, wait for it to load, then press Run.' : 'Runs on the page in front.'));
    const out = S.note(''); out.setAttribute('role', 'status');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { aiFail('AI recipe', err); } }, opts);
    if (recipe.source) bar.append(act('Open the page', () => aiOpen(recipe.source)));
    bar.append(act('Run', async () => { out.textContent = 'Started. The answer appears in the AI panel.'; await this.run(id); }, { primary: true }));
    body.append(bar, out);
  },

  manage() {
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-ai-recipes', title: 'AI recipes', sub: 'A recipe is an AI skill with a reminder. When the reminder fires Vex opens the recipe and waits for you to press Run: the AI never runs by itself.' });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const draw = () => {
      body.textContent = '';
      const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { aiFail('AI recipes', err); } }, opts);
      const list = el('div', 'vexsr-list');
      for (const r of this.recipes()) {
        const when = r.at ? (r.repeat ? r.repeat + ' from ' : '') + new Date(r.at).toLocaleString() : 'no reminder';
        const t = el('span', 'vexsr-host'); t.style.wordBreak = 'normal';
        t.append(el('div', '', r.name), Object.assign(el('div', 'vexsr-mode', 'Reminder: ' + when + (r.runs ? '. Run ' + r.runs + ' time' + (r.runs === 1 ? '' : 's') : '')), { style: 'white-space:normal' }));
        const row = el('div', 'vexsr-rule');
        row.append(t, act('Open', () => this.open(r.id), { label: 'Open recipe ' + r.name }), act('Remove', async () => {
          if (!(await vexConfirm({ title: 'Remove this recipe?', message: '"' + r.name + '" and its reminder will be removed.', okLabel: 'Remove', danger: true }))) return;
          await this.remove(r.id); draw();
        }, { danger: true, label: 'Remove recipe ' + r.name }));
        list.appendChild(row);
      }
      if (!list.children.length) list.appendChild(S.note('No recipes yet.'));
      body.appendChild(list);
      let skills = [];
      try { skills = this.skills(); } catch (err) { body.appendChild(S.note(err.message)); return; }
      const name = el('input', 'set-input'); name.type = 'text'; name.placeholder = 'Name, e.g. Monday digest'; name.setAttribute('aria-label', 'Recipe name');
      const skill = el('select', 'set-input'); skill.setAttribute('aria-label', 'AI skill');
      for (const k of skills) skill.appendChild(Object.assign(el('option', '', k.name), { value: k.id }));
      const source = el('input', 'set-input'); source.type = 'text'; source.placeholder = 'Page to read (optional)'; source.spellcheck = false; source.setAttribute('aria-label', 'Page to read');
      const when = el('input', 'set-input'); when.type = 'text'; when.placeholder = 'When, e.g. monday 9am (blank = no reminder)'; when.setAttribute('aria-label', 'When to be reminded');
      const repeat = el('select', 'set-input'); repeat.setAttribute('aria-label', 'Repeat');
      for (const [v, l] of [['', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week']]) repeat.appendChild(Object.assign(el('option', '', l), { value: v }));
      const row = (...k) => { const r = el('div', 'vexsr-rule'); r.append(...k); return r; };
      body.append(S.note('New recipe'), row(name, skill), row(source), row(when, repeat),
        row(act('Add recipe', async () => { await this.add({ name: name.value, skillId: skill.value, source: source.value, repeat: repeat.value, whenText: when.value }); draw(); }, { primary: true })));
    };
    draw();
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return;
    const list = [];
    if (this.enabled()) {
      for (const r of this.recipes()) list.push({ id: 'recipe:' + r.id, label: 'Recipe: ' + r.name, hint: 'Opens the recipe; you press Run', icon: 'sparkles', action: () => { try { this.open(r.id); } catch (err) { aiFail('AI recipe', err); } } });
    }
    VexModuleCommands.set('recipe:', list);
  },

  // A reminder that was clicked opens its recipe. A fired one only needs its own toast.
  start() {
    if (this._started) return;
    const b = typeof window !== 'undefined' && window.vex && window.vex.reminders;
    if (!b || typeof b.onClicked !== 'function') return;
    this._started = true;
    b.onClicked((p) => {
      if (!this.enabled()) return;
      const recipe = this.forReminder(p);
      if (recipe) { try { this.open(recipe.id); } catch (err) { aiFail('AI recipe', err); } }
    });
    this.registerCommands();
  },
};

// ---------------------------------------------------------------------------------
// T3-103  Watch with judgement
const WatchJudgement = {
  KEY: 'vex.watchJudge',
  FEATURE: 'watch-judgement',
  MAX_CONDITION: 200,
  MAX_HELD: 100,
  HELD_DAYS: 30,
  ...aiPrefs('vex.watchJudge', { enabled: true, conditions: {}, held: [] }, 'Watch judgement'),

  conditions() { const c = this.state().conditions; return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; },
  held() { const h = this.state().held; return Array.isArray(h) ? h : []; },

  setCondition(watchId, text) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (t.length > this.MAX_CONDITION) throw new Error('Keep the condition under ' + this.MAX_CONDITION + ' characters');
    if (typeof PageWatch === 'undefined' || !PageWatch.list().some(w => w.id === watchId)) throw new Error('That watch is gone');
    const s = this.state();
    s.conditions = { ...this.conditions() };
    if (t) s.conditions[watchId] = t; else delete s.conditions[watchId];
    this.save(s);
  },
  condition(watchId) { return String(this.conditions()[watchId] || ''); },
  applies(watch) { return !!watch && this.enabled() && !!this.condition(watch.id); },

  // What the model is shown: the lines that changed, or the old and new value.
  evidenceText(watch, verdict, diff) {
    const cut = (l) => String(l).slice(0, 200);
    if (diff && ((diff.added && diff.added.length) || (diff.removed && diff.removed.length))) {
      return ((diff.removed || []).slice(0, 12).map(l => '- ' + cut(l)).concat((diff.added || []).slice(0, 12).map(l => '+ ' + cut(l)))).join('\n');
    }
    return 'before: ' + cut(verdict.from) + '\nafter: ' + cut(verdict.to);
  },

  // -> { notify, why, evidence, by }. A failure to judge notifies (fail open) and says so.
  async judge(watch, verdict, diff) {
    const condition = this.condition(watch.id);
    const evidence = this.evidenceText(watch, verdict, diff);
    try {
      const system = 'You decide whether a change to a web page matters to the person who watches it. Reply ONLY with JSON: {"matters": true or false, "why": "one short sentence", "evidence": "a short quote copied exactly from the changed lines, or empty"}. Say true only if the change clearly meets their condition.';
      const prompt = 'Page: ' + String(watch.title || watch.url).slice(0, 120) + '\nCondition: ' + condition + '\nChanged lines (- removed, + added):\n' + evidence;
      const a = AiLocal.json(await AiLocal.generate(system, prompt, { maxTokens: 200, timeoutMs: 30000 }), '{');
      if (typeof a.matters !== 'boolean') throw new Error('The local model did not say yes or no');
      const why = String(a.why || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      // A quote the model made up is dropped: evidence must be in the changed lines.
      const quote = String(a.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const real = quote && evidence.replace(/\s+/g, ' ').toLowerCase().includes(quote.toLowerCase()) ? quote : '';
      return { notify: a.matters, why, evidence: real, by: 'local model' };
    } catch (err) {
      console.error('[WatchJudgement] could not judge "' + watch.title + '", announcing it as usual:', err.message);
      if (typeof VexProblems !== 'undefined') VexProblems.note('Watch judgement', 'Could not judge a change to ' + watch.url + '; it was announced as usual', err);
      return { notify: true, why: 'Could not be judged (' + err.message + ')', evidence: '', by: 'none' };
    }
  },

  // Called by PageWatch for a change that would be announced.
  // -> { notify, judged } ; a held change is listed and put in the ledger with an Undo.
  async review(watch, verdict, diff) {
    const j = await this.judge(watch, verdict, diff);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    if (j.notify) return { notify: true, judged: j.by === 'none' ? null : { why: j.why, evidence: j.evidence } };
    const entry = { id: 'wh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), watchId: watch.id, title: String(watch.title || watch.url).slice(0, 100), url: String(watch.url), at: Date.now(), why: j.why, summary: String(verdict.sentence || verdict.summary || verdict.why || 'changed').slice(0, 200), condition: this.condition(watch.id) };
    const s = this.state();
    s.held = [entry, ...this.held()].filter(h => Date.now() - h.at < this.HELD_DAYS * 86400000).slice(0, this.MAX_HELD);
    this.save(s);
    if (typeof VexLedger !== 'undefined') {
      VexLedger.record({ feature: this.FEATURE, what: 'Did not announce a change to "' + entry.title + '"', why: 'The local model judged that it does not meet your condition: ' + (j.why || entry.condition), undo: { kind: 'watch-unhold', id: entry.id } });
    }
    return { notify: false, judged: null };
  },

  // Undo of a held change: it is announced now.
  unhold(id) {
    const entry = this.held().find(h => h.id === id);
    if (!entry) throw new Error('That change is no longer in the list');
    const s = this.state(); s.held = this.held().filter(h => h.id !== id); this.save(s);
    const watch = typeof PageWatch !== 'undefined' ? PageWatch.list().find(w => w.id === entry.watchId) : null;
    PageWatch.announce(watch || { id: entry.watchId, title: entry.title, url: entry.url, kind: 'text', source: 'user' }, { changed: true, why: 'changed', sentence: entry.summary });
    return entry;
  },

  // The weekly list: what was held back in the last 7 days.
  heldThisWeek(now = Date.now()) { return this.held().filter(h => now - h.at < 7 * 86400000); },

  manage() {
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-watch-judge', title: 'Watch with judgement', sub: 'A condition in your words for each watched page. The local model decides if a change matters; a change that does not is held back and listed here. If it cannot be asked, you are told as usual.' });
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const act = (text, fn, opts) => S.button(text, async () => { try { await fn(); } catch (err) { aiFail('Watch with judgement', err); } }, opts);
    const draw = () => {
      body.textContent = '';
      const watches = typeof PageWatch !== 'undefined' ? PageWatch.list() : [];
      const wl = el('div', 'vexsr-list');
      for (const w of watches) {
        const input = el('input', 'set-input'); input.type = 'text'; input.value = this.condition(w.id); input.maxLength = this.MAX_CONDITION;
        input.placeholder = 'Tell me only if... (blank = every change)'; input.setAttribute('aria-label', 'Condition for ' + w.title);
        const t = el('span', 'vexsr-host', w.title); t.style.wordBreak = 'normal';
        const r = el('div', 'vexsr-rule'); r.style.flexWrap = 'wrap';
        r.append(t, input, act('Save', () => { this.setCondition(w.id, input.value); window.showToast?.('Saved'); }, { label: 'Save the condition for ' + w.title }));
        wl.appendChild(r);
      }
      if (!wl.children.length) wl.appendChild(S.note('You are not watching any pages. Right-click a page and choose "Watch this page for changes".'));
      body.append(S.note('Your watched pages'), wl, S.note('Held back in the last 7 days'));
      const held = el('div', 'vexsr-list');
      for (const h of this.heldThisWeek()) {
        const t = el('span', 'vexsr-host'); t.style.wordBreak = 'normal';
        t.append(el('div', '', h.title + ': ' + h.summary), Object.assign(el('div', 'vexsr-mode', 'Condition: ' + h.condition + '. ' + (h.why || '') + ' (' + AiWords.ago(h.at) + ')'), { style: 'white-space:normal' }));
        const r = el('div', 'vexsr-rule');
        r.append(t, act('Tell me now', () => { this.unhold(h.id); draw(); }, { label: 'Announce the held change to ' + h.title }));
        held.appendChild(r);
      }
      if (!held.children.length) held.appendChild(S.note('Nothing held back.'));
      body.appendChild(held);
    };
    draw();
  },
};

// ---------------------------------------------------------------------------------
// Settings section and commands
const AiJudgementUI = {
  FEATURES: [
    ['reading-triage', 'Reading triage by goals', ReadingTriage],
    ['seen-before', 'Have I seen this before?', SeenBefore],
    ['ai-recipes', 'Scheduled AI recipes (a reminder; you press Run)', AiRecipes],
    ['watch-judgement', 'Watch with judgement', WatchJudgement],
  ],
  group(el) {
    const S = VexSettingsGroups;
    el.appendChild(S.note('These use only the local model (Ollama) or no model, and run when you ask. None sends a page, title or note to a cloud model, and none runs the AI unattended.'));
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:6px 0';
    const act = (text, fn) => S.button(text, () => { Promise.resolve().then(fn).catch(err => aiFail(text, err)); });
    bar.append(act('Triage my queue', () => ReadingTriage.open()), act('AI recipes', () => AiRecipes.manage()), act('Watch conditions', () => WatchJudgement.manage()));
    el.appendChild(bar);
    for (const [, label, mod] of this.FEATURES) {
      const l = document.createElement('label');
      l.className = 'vex-platform-note';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = mod.enabled();
      box.addEventListener('change', () => { try { mod.setEnabled(box.checked); if (mod.registerCommands) mod.registerCommands(); } catch (err) { aiFail(label, err); } });
      l.append(box, document.createTextNode(' ' + label));
      el.appendChild(l);
    }
  },
};

if (typeof window !== 'undefined') {
  Object.assign(window, { AiLocal, AiWords, ReadingTriage, SeenBefore, AiRecipes, WatchJudgement, AiJudgementUI });
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'ai-judgement', title: 'Reading and watching with AI',
      keywords: 'reading triage goals read later seen before duplicate recipe scheduled skill reminder watch judgement condition local model',
      before: 'about',
      build: (el) => AiJudgementUI.group(el),
    });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    const run = (what, fn) => () => { Promise.resolve().then(fn).catch(err => aiFail(what, err)); };
    VexExtras.registerCommand({ id: 'reading-triage', label: 'Triage my read-later queue', hint: 'Read now, skim or drop, against your goals', icon: 'list', action: run('Reading triage', () => ReadingTriage.open()) });
    VexExtras.registerCommand({ id: 'seen-before', label: 'Have I seen this before?', hint: 'Search your history, notes and highlights for this page', icon: 'history', action: run('Seen before', () => SeenBefore.open()) });
    VexExtras.registerCommand({ id: 'ai-recipes', label: 'AI recipes', hint: 'Skills with a reminder; you press Run', icon: 'sparkles', action: run('AI recipes', () => AiRecipes.manage()) });
    VexExtras.registerCommand({ id: 'watch-judgement', label: 'Watch conditions', hint: 'Tell a watch what counts as worth a notice', icon: 'eye', action: run('Watch with judgement', () => WatchJudgement.manage()) });
  }
  if (typeof VexLedger !== 'undefined' && typeof VexLedger.registerUndo === 'function') {
    VexLedger.registerUndo('watch-unhold', async (token) => { WatchJudgement.unhold(token.id); });
  }
  AiRecipes.start();
  AiRecipes.registerCommands();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AiLocal, AiWords, ReadingTriage, SeenBefore, AiRecipes, WatchJudgement, AiJudgementUI };
