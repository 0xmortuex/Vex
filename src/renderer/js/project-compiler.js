// === Page-to-project compiler ===============================================
//
// Pick some open tabs, notes and clipboard clips, say what you want ("a
// report", "a checklist", "a comparison table", "a study sheet"), and the model
// on this computer writes one structured markdown document with numbered
// source links. It is saved as a note, and ends with a source-coverage list:
// which of the sources the document actually used, and which it did not.
//
// The model is local. It is the Ollama model Vex already runs; nothing is sent
// to the cloud, and a failure is reported, never retried elsewhere. The one
// exception is a switch the person turns on for THIS feature, and even then it
// only applies when the backend Vex is set to use is already the cloud one
// (Settings, below). Private, Tor and routed tabs are never listed or read.
//
// The top half of this file is pure (no DOM, no storage, no model): the prompt,
// the token budget, the citation reading and the coverage list are all tested
// with a fake model in tests/renderer/projectCompiler.test.js. The bottom half
// gathers the sources, asks the model and draws the picker.
//
// Other modules can offer more sources with registerProvider() — a provider is
// { id, label, list(): [{ id, title, url?, detail? }], read(id): text }.

const ProjectCompiler = {
  KEY_CLOUD: 'vex.projectCompiler.cloud',

  // The four things it can write. `shape` is what the model is told to produce.
  KINDS: {
    report: {
      label: 'Report',
      verb: 'a report',
      shape: 'A report. Start with a one-paragraph summary under "## Summary". Then one "##" section per theme, each a few short paragraphs or bullets. End with "## Open questions" listing what the sources leave unanswered.',
    },
    checklist: {
      label: 'Checklist',
      verb: 'a checklist',
      shape: 'A checklist. Group steps under short "##" headings. Every step is a markdown task line starting with "- [ ] " and is one concrete action. Order the steps in the order they should be done.',
    },
    comparison: {
      label: 'Comparison table',
      verb: 'a comparison table',
      shape: 'A comparison. One markdown table: a row per option or source, a column per criterion that the sources actually speak about. Put "unknown" in a cell the sources do not cover. After the table, a short "## Verdict" of at most four sentences.',
    },
    study: {
      label: 'Study sheet',
      verb: 'a study sheet',
      shape: 'A study sheet. "## Key ideas" as a bullet list, "## Terms" as "- **term**: definition" lines, and "## Check yourself" with five questions followed by their answers.',
    },
  },

  // What fits a small local model. Characters, not tokens: the prompt is built
  // from these and nothing else.
  LIMITS: { totalChars: 12000, maxSources: 10, perSourceMax: 6000, outputMin: 40 },

  // ---- sources -----------------------------------------------------------
  _collapse(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  // [{ kind, title, url, text }] -> numbered sources. Every one is kept, in the
  // order given, so the numbers in the document are the numbers the person saw.
  normalizeSources(list) {
    const out = [];
    for (const raw of (Array.isArray(list) ? list : [])) {
      if (!raw || typeof raw !== 'object') continue;
      const text = this._collapse(raw.text);
      const url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : '';
      const title = String(raw.title || url || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Untitled';
      out.push({ n: out.length + 1, kind: String(raw.kind || 'source'), title, url, text, chars: text.length });
    }
    return out;
  },

  // Split `total` characters between sources: the short ones keep all of
  // theirs, and what they leave over goes to the long ones.
  _allocate(lengths, total) {
    const alloc = new Array(lengths.length).fill(0);
    let open = lengths.map((_, i) => i);
    let remaining = total;
    while (open.length) {
      const share = Math.floor(remaining / open.length);
      const small = open.filter(i => lengths[i] <= share);
      if (!small.length) { open.forEach(i => { alloc[i] = share; }); break; }
      for (const i of small) { alloc[i] = lengths[i]; remaining -= lengths[i]; }
      open = open.filter(i => !small.includes(i));
    }
    return alloc;
  },

  _cut(text, max) {
    if (text.length <= max) return text;
    const head = text.slice(0, max);
    const at = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf(' '));
    return (at > max * 0.7 ? head.slice(0, at) : head).trim();
  },

  // Which sources go into the prompt, and how much of each. A source with no
  // text, or past the source limit, is left out and says why.
  fit(sources, limits = this.LIMITS) {
    const readable = sources.filter(s => s.chars > 0);
    const kept = readable.slice(0, limits.maxSources);
    const alloc = this._allocate(kept.map(s => Math.min(s.chars, limits.perSourceMax)), limits.totalChars);
    const included = kept.map((s, i) => {
      const text = this._cut(s.text, alloc[i]);
      return { ...s, text, truncated: text.length < s.chars };
    });
    const omitted = {};
    for (const s of sources) {
      if (s.chars === 0) omitted[s.n] = 'had no readable text';
      else if (!kept.includes(s)) omitted[s.n] = 'was left out because only ' + limits.maxSources + ' sources fit the model';
    }
    return { included, omitted };
  },

  // ---- the prompt --------------------------------------------------------
  buildPrompt({ kind, included, title, instruction }) {
    const k = this.KINDS[kind];
    if (!k) throw new Error('Unknown kind of document: ' + kind);
    if (!Array.isArray(included) || !included.length) throw new Error('There is nothing to build from');
    const numbers = included.map(s => '[' + s.n + ']').join(' ');
    const system = [
      'You turn a set of numbered sources into one markdown document. You write ONLY what the sources say; you add no facts of your own.',
      'Cite the source of every claim with its number in square brackets, like [2] or [1][3]. Use only these numbers: ' + numbers + '.',
      'Write the document in the language of the sources. Do not write a "Sources" list; it is added afterwards.',
      'Reply as JSON: {"reply": "<the whole markdown document>"}.',
    ].join('\n');
    const blocks = included.map(s => '[' + s.n + '] ' + s.title + (s.url ? ' (' + s.url + ')' : '') + (s.truncated ? ' (shortened)' : '') + '\n"""\n' + s.text + '\n"""');
    const user = [
      'Make ' + k.verb + (title ? ' titled "' + String(title).slice(0, 120) + '"' : '') + '.',
      k.shape,
      instruction ? 'The person also asked: ' + String(instruction).slice(0, 300) : '',
      'Sources:',
      blocks.join('\n\n'),
    ].filter(Boolean).join('\n\n');
    return { system, user };
  },

  // The model answers in a JSON envelope ({"reply": ...}); a plain answer, a
  // fenced one and a bare string are all accepted.
  unwrapReply(raw) {
    let text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    if (text.startsWith('{')) {
      try {
        const o = JSON.parse(text);
        for (const key of ['reply', 'document', 'markdown', 'result', 'answer']) {
          if (o && typeof o[key] === 'string' && o[key].trim()) return o[key].trim();
        }
      } catch { /* not JSON after all: the text is the answer */ }
    }
    if (/^"[\s\S]*"$/.test(text)) {
      try { const s = JSON.parse(text); if (typeof s === 'string') return s.trim(); } catch { /* keep */ }
    }
    return text;
  },

  // ---- citations and coverage -------------------------------------------
  // Numbers cited in the body: [2], [1, 3], [1][2]. A task line "[ ]" or "[x]"
  // has no digits and is not one.
  CITE: /\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g,

  // `valid` is the set of numbers that were in the prompt. Returns the body
  // with citations that name nothing taken out, the valid numbers cited, and
  // the invented ones.
  readCitations(body, valid) {
    const ok = valid instanceof Set ? valid : new Set(valid);
    const cited = new Set();
    const invalid = new Set();
    const text = String(body == null ? '' : body).replace(this.CITE, (all, list) => {
      const nums = list.split(/[,;]/).map(x => Number(x.trim()));
      const good = nums.filter(n => ok.has(n));
      nums.forEach(n => { if (ok.has(n)) cited.add(n); else invalid.add(n); });
      if (good.length === nums.length) return all;
      return good.length ? '[' + good.join(', ') + ']' : '';
    });
    return { text: text.replace(/[ \t]+([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' '), cited, invalid: [...invalid].sort((a, b) => a - b) };
  },

  // A "Sources" / "References" section the model wrote anyway: ours replaces it.
  stripTrailingSources(body) {
    const m = /\n#{1,6}\s*(?:sources?|references?|citations?|bibliography)\s*:?\s*\n[\s\S]*$/i.exec('\n' + String(body || ''));
    if (!m) return String(body || '').trim();
    return ('\n' + String(body)).slice(0, m.index).trim();
  },

  // used / unused over ALL the sources given, with the reason for each unused.
  coverage(sources, cited, omitted = {}) {
    const used = [];
    const unused = [];
    for (const s of sources) {
      if (cited.has(s.n)) { used.push(s); continue; }
      unused.push({ ...s, reason: omitted[s.n] || 'was not cited in the document' });
    }
    return { used, unused };
  },

  _link(s) {
    const label = s.title.replace(/[\[\]]/g, '');
    return s.url ? '[' + label + '](' + s.url + ')' : label;
  },

  // The document as saved: title, body, the numbered sources, the coverage.
  assemble({ title, body, sources, coverage, model, at }) {
    const lines = [];
    const heading = String(title || '').trim();
    const first = String(body || '').trim();
    if (heading && !/^#\s/.test(first)) lines.push('# ' + heading, '');
    lines.push(first, '', '## Sources', '');
    sources.forEach(s => lines.push(s.n + '. ' + this._link(s) + (s.kind ? ' (' + s.kind + ')' : '')));
    lines.push('', '## Source coverage', '');
    const total = sources.length;
    lines.push(coverage.used.length === total
      ? 'All ' + total + ' source' + (total === 1 ? ' was' : 's were') + ' used: ' + coverage.used.map(s => s.n).join(', ') + '.'
      : 'Used ' + coverage.used.length + ' of ' + total + (coverage.used.length ? ': ' + coverage.used.map(s => s.n).join(', ') : '') + '.');
    if (coverage.unused.length) {
      const n = coverage.unused.length;
      lines.push('', (n === 1 ? 'This source was' : 'These ' + n + ' sources were') + ' not used:');
      coverage.unused.forEach(s => lines.push('- [' + s.n + '] ' + this._link(s) + ' - ' + s.reason));
    }
    const when = at ? new Date(at).toISOString().slice(0, 10) : '';
    lines.push('', '_Written by ' + (model ? 'the local model ' + model : 'the local model') + (when ? ' on ' + when : '') + ' from the sources above; check it against them._');
    return lines.join('\n').trimEnd() + '\n';
  },

  _titleOf(body, kind, given) {
    const g = String(given || '').trim();
    if (g) return g;
    const m = /^#\s+(.+)$/m.exec(String(body || ''));
    if (m) return m[1].trim().slice(0, 120);
    return (this.KINDS[kind] ? this.KINDS[kind].label : 'Project');
  },

  // The whole job, with the model injected: ask({ system, user }) ->
  // { text, model }. Returns { markdown, title, kind, coverage, warnings, model }.
  async compile({ kind, sources, ask, title, instruction, limits, now } = {}) {
    if (!this.KINDS[kind]) throw new Error('Choose what to make: ' + Object.keys(this.KINDS).join(', '));
    if (typeof ask !== 'function') throw new Error('No model was given to write the document');
    const all = this.normalizeSources(sources);
    if (!all.length) throw new Error('Pick at least one tab, note or clip first');
    const { included, omitted } = this.fit(all, limits || this.LIMITS);
    if (!included.length) throw new Error('None of the selected sources has readable text');
    const prompt = this.buildPrompt({ kind, included, title, instruction });
    const answer = await ask(prompt);
    const raw = this.unwrapReply(answer && typeof answer === 'object' ? answer.text : answer);
    if (raw.length < (limits || this.LIMITS).outputMin) throw new Error('The model answered with almost nothing. Try fewer sources, or a different model in Settings.');
    const stripped = this.stripTrailingSources(raw);
    const valid = new Set(included.map(s => s.n));
    const read = this.readCitations(stripped, valid);
    const warnings = [];
    if (read.invalid.length) warnings.push('The model cited source number' + (read.invalid.length === 1 ? ' ' : 's ') + read.invalid.join(', ') + ', which ' + (read.invalid.length === 1 ? 'does' : 'do') + ' not exist; ' + (read.invalid.length === 1 ? 'it was' : 'they were') + ' removed.');
    if (!read.cited.size) warnings.push('The model cited no source, so every claim in it needs checking.');
    for (const s of included) if (s.truncated) warnings.push('Source ' + s.n + ' was shortened to fit the model.');
    const coverage = this.coverage(all, read.cited, omitted);
    const docTitle = this._titleOf(read.text, kind, title);
    const body = read.text.replace(/^#\s+.+\n+/, '');
    const model = answer && typeof answer === 'object' ? String(answer.model || '') : '';
    const markdown = this.assemble({ title: docTitle, body, sources: all, coverage, model, at: now == null ? Date.now() : now });
    return { markdown, title: docTitle, kind, coverage, warnings, model, sourceCount: all.length };
  },

  // ---- model -------------------------------------------------------------
  cloudAllowed() { try { return localStorage.getItem(this.KEY_CLOUD) === 'on'; } catch { return false; } },
  setCloudAllowed(on) {
    try { localStorage.setItem(this.KEY_CLOUD, on ? 'on' : 'off'); }
    catch (err) { throw new Error('The setting could not be saved: ' + err.message); }
    return !!on;
  },

  // The local model, always. The cloud one only when the person switched it on
  // here AND Vex's chat backend is already the cloud one.
  async askModel(prompt) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') {
      throw new Error('The AI router is not part of this build');
    }
    let backend = 'local';
    if (this.cloudAllowed() && typeof AIRouter.resolveBackend === 'function') {
      try { if (await AIRouter.resolveBackend('chat') === 'cloud') backend = 'cloud'; } catch { backend = 'local'; }
    }
    let out;
    try {
      out = await AIRouter.callOn(backend, 'chat', {
        message: prompt.user,
        pageContext: null,
        conversationHistory: [],
        persona: { systemPrompt: prompt.system, temperature: 0.3 },
      });
    } catch (err) {
      const why = (err && err.message) ? err.message : String(err);
      throw new Error(backend === 'local'
        ? 'The model on this computer did not answer (' + why + '). Start Ollama and try again - nothing was sent anywhere else.'
        : 'The cloud model did not answer (' + why + ').');
    }
    return { text: out && out.result != null ? out.result : '', model: (out && out.model) || '' };
  },

  // ---- providers ---------------------------------------------------------
  _providers: [],
  registerProvider(p) {
    if (!p || typeof p.id !== 'string' || typeof p.list !== 'function' || typeof p.read !== 'function') {
      throw new Error('A source provider needs an id, list() and read()');
    }
    this._providers = this._providers.filter(x => x.id !== p.id);
    this._providers.push({ label: p.id, ...p });
    return p.id;
  },

  _readable(tab, wv) {
    if (!tab || !wv || !/^https?:/i.test(tab.url || '')) return false;
    const pol = window.VexTabPolicy;
    if (pol && (!pol.canReadWebview(wv) || (pol.canShareTab && !pol.canShareTab(tab)))) return false;
    return true;
  },

  _tabProvider() {
    const wvOf = (tab) => (typeof WebviewManager !== 'undefined' && WebviewManager.webviews) ? WebviewManager.webviews.get(tab.id) : null;
    return {
      id: 'tabs',
      kind: 'tab',
      label: 'Open tabs',
      list: async () => {
        const tabs = (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) ? TabManager.tabs : [];
        return tabs.filter(t => this._readable(t, wvOf(t))).map(t => ({ id: String(t.id), title: t.title || t.url, url: t.url, detail: '' }));
      },
      read: async (id) => {
        const tabs = (typeof TabManager !== 'undefined' && Array.isArray(TabManager.tabs)) ? TabManager.tabs : [];
        const tab = tabs.find(t => String(t.id) === String(id));
        const wv = tab ? wvOf(tab) : null;
        if (!this._readable(tab, wv)) throw new Error('That tab cannot be read (it is private, routed, or gone)');
        const code = "(function(){try{var el=document.querySelector('article,main,[role=main]')||document.body;return String(el.innerText||'').slice(0,60000);}catch(e){return '';}})()";
        const text = await window.vexGuestEval(wv, code, false, 8000);
        return typeof text === 'string' ? text : '';
      },
    };
  },

  _noteProvider() {
    const notes = () => (typeof NotesPanel !== 'undefined' && Array.isArray(NotesPanel.notes)) ? NotesPanel.notes.map(n => NotesPanel.normalize(n)) : [];
    return {
      id: 'notes',
      kind: 'note',
      label: 'Notes',
      list: async () => notes().filter(n => n.id && n.content.trim()).map(n => ({ id: n.id, title: n.title || NotesPanel.previewText(n.content, 50), url: n.sourceUrl, detail: n.content.length + ' characters' })),
      read: async (id) => {
        const n = notes().find(x => x.id === id);
        if (!n) throw new Error('That note is gone');
        return n.content;
      },
    };
  },

  _clipProvider() {
    const clips = () => {
      if (typeof ClipboardHistory === 'undefined') return [];
      return [].concat(ClipboardHistory.pinned || [], ClipboardHistory.recent || []).filter(c => c && typeof c.text === 'string' && c.text.trim());
    };
    const idOf = (c, i) => 'c' + i;
    return {
      id: 'clips',
      kind: 'clip',
      label: 'Clips',
      list: async () => clips().slice(0, 60).map((c, i) => ({ id: idOf(c, i), title: (c.title || c.host || 'Clip') + ': ' + c.text.replace(/\s+/g, ' ').slice(0, 60), url: '', detail: '' })),
      read: async (id) => {
        const c = clips()[Number(String(id).slice(1))];
        if (!c) throw new Error('That clip is gone');
        return c.text;
      },
    };
  },

  providers() {
    const own = [this._tabProvider(), this._noteProvider(), this._clipProvider()];
    return own.concat(this._providers);
  },

  // ---- saving ------------------------------------------------------------
  saveAsNote(result) {
    if (typeof NotesPanel === 'undefined' || !Array.isArray(NotesPanel.notes)) throw new Error('Notes are not available');
    const now = new Date().toISOString();
    const note = {
      id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      title: result.title,
      content: result.markdown,
      pinned: false, tags: ['compiled', result.kind], sourceUrl: '', sourceTitle: '',
      createdAt: now, updatedAt: now,
    };
    NotesPanel.notes.unshift(note);
    NotesPanel.save();
    try { NotesPanel.renderList?.(); } catch { /* the panel may not be built yet */ }
    return note;
  },

  // Gather the picked sources, build, save. `picks` is [{ provider, id }].
  async run({ kind, picks, title, instruction, ask }) {
    const byId = new Map(this.providers().map(p => [p.id, p]));
    const sources = [];
    const unread = [];
    for (const pick of picks) {
      const p = byId.get(pick.provider);
      if (!p) { unread.push(pick.id); continue; }
      let text = '';
      try { text = await p.read(pick.id); } catch (err) { unread.push((pick.title || pick.id) + ': ' + err.message); }
      sources.push({ kind: p.kind || 'source', title: pick.title, url: pick.url, text });
    }
    const result = await this.compile({ kind, sources, title, instruction, ask: ask || ((p) => this.askModel(p)) });
    if (unread.length) result.warnings.push('Could not read: ' + unread.join('; '));
    result.note = this.saveAsNote(result);
    return result;
  },

  // ---- the picker --------------------------------------------------------
  async open({ kind } = {}) {
    document.querySelector('.vex-compiler-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const ico = (n, s = 14) => (window.VexIcons ? VexIcons.svg(n, { size: s }) : '');
    const btn = 'display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer';
    const overlay = document.createElement('div');
    overlay.className = 'vex-compiler-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.4);display:grid;place-items:start center;padding-top:6vh';
    const kinds = Object.entries(this.KINDS).map(([id, k]) => '<option value="' + id + '"' + (id === (kind || 'report') ? ' selected' : '') + '>' + esc(k.label) + '</option>').join('');
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="Turn sources into a document" style="width:min(640px,94vw);max-height:84vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap">
          <strong style="flex:1;font-size:13.5px;color:var(--text);min-width:140px">Turn sources into a document</strong>
          <label style="font-size:12px;color:var(--text-muted)">Make
            <select data-kind class="set-input" style="margin-left:6px">${kinds}</select></label>
        </div>
        <div style="padding:8px 14px;border-bottom:1px solid var(--border)">
          <input data-title class="set-input" placeholder="Title (optional)" aria-label="Title" style="width:100%;box-sizing:border-box;margin-bottom:6px">
          <input data-instruction class="set-input" placeholder="Anything it should focus on (optional)" aria-label="Instruction" style="width:100%;box-sizing:border-box">
        </div>
        <div data-list style="overflow-y:auto;padding:8px 14px;flex:1"></div>
        <div data-status role="status" style="padding:8px 14px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted);white-space:pre-wrap;max-height:30vh;overflow:auto"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--border)">
          <span style="flex:1;font-size:11px;color:var(--text-muted);align-self:center" data-where></span>
          <button type="button" data-cancel style="${btn}">Close</button>
          <button type="button" data-build class="btn-primary" style="display:inline-flex;align-items:center;gap:5px">${ico('sparkles')}Build</button>
        </div>
      </div>`;
    const listEl = overlay.querySelector('[data-list]');
    const status = overlay.querySelector('[data-status]');
    overlay.querySelector('[data-where]').textContent = this.cloudAllowed() ? 'Local model; the cloud one only if Vex is set to it' : 'Runs on the model on this computer';
    const rows = [];
    for (const p of this.providers()) {
      let items = [];
      try { items = await p.list(); } catch (err) { items = []; console.warn('[ProjectCompiler] ' + p.id + ' could not be listed:', err.message); }
      if (!items.length) continue;
      const h = document.createElement('div');
      h.style.cssText = 'font-size:11px;font-weight:650;color:var(--text-muted);margin:8px 0 4px;text-transform:uppercase;letter-spacing:.04em';
      h.textContent = p.label;
      listEl.appendChild(h);
      for (const it of items) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:12.5px;color:var(--text);cursor:pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('aria-label', it.title);
        const span = document.createElement('span');
        span.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
        span.textContent = it.title + (it.detail ? ' - ' + it.detail : '');
        row.append(cb, span);
        listEl.appendChild(row);
        rows.push({ cb, pick: { provider: p.id, id: it.id, title: it.title, url: it.url } });
      }
    }
    if (!rows.length) {
      listEl.innerHTML = '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">There is nothing to pick from yet. Open a page, or write a note, and come back.</div>';
    }
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    const build = overlay.querySelector('[data-build]');
    build.addEventListener('click', async () => {
      const picks = rows.filter(r => r.cb.checked).map(r => r.pick);
      if (!picks.length) { status.textContent = 'Tick at least one source.'; return; }
      build.disabled = true;
      status.textContent = 'Asking the model on this computer. This can take a minute.';
      try {
        const r = await this.run({
          kind: overlay.querySelector('[data-kind]').value,
          picks,
          title: overlay.querySelector('[data-title]').value,
          instruction: overlay.querySelector('[data-instruction]').value,
        });
        const lines = ['Saved to Notes as "' + r.note.title + '".', 'Used ' + r.coverage.used.length + ' of ' + r.sourceCount + ' sources.'];
        if (r.coverage.unused.length) lines.push((r.coverage.unused.length === 1 ? 'This source was' : 'These ' + r.coverage.unused.length + ' sources were') + ' not used: ' + r.coverage.unused.map(s => s.title).join('; '));
        r.warnings.forEach(w => lines.push(w));
        status.textContent = lines.join('\n');
        window.showToast?.('Saved to Notes as "' + r.note.title + '"', 'success');
      } catch (err) {
        status.textContent = (err && err.message) || String(err);
      } finally { build.disabled = false; }
    });
    document.body.appendChild(overlay);
    if (typeof VexLayer !== 'undefined') VexLayer.track(overlay, { tier: 'dialog', id: 'project-compiler' });
    return overlay;
  },

  // ---- Settings and the command bar -------------------------------------
  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="project-compiler"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'project-compiler');
    g.innerHTML = `
      <label class="setting-label">Sources into a document</label>
      <p class="setting-info muted" style="margin-bottom:8px">Pick tabs, notes and clips and the model on this computer writes a report, checklist, comparison table or study sheet with numbered sources, and lists the sources it did not use. Private and Tor tabs are never read.</p>
      <div class="setting-toggle-row">
        <span>Let the cloud model write it, when Vex is already set to use the cloud</span>
        <label class="toggle"><input type="checkbox" data-compiler-cloud aria-label="Let the cloud model write documents when Vex is set to use the cloud"><span class="toggle-slider"></span></label>
      </div>
      <div style="margin-top:8px"><button type="button" class="btn-secondary" data-compiler-open>Open</button></div>`;
    const cb = g.querySelector('[data-compiler-cloud]');
    cb.checked = this.cloudAllowed();
    cb.addEventListener('change', () => {
      try { this.setCloudAllowed(cb.checked); } catch (err) { cb.checked = !cb.checked; window.showToast?.(err.message, 'error'); }
    });
    g.querySelector('[data-compiler-open]').addEventListener('click', () => { this.open().catch(err => window.showToast?.(err.message, 'error')); });
    root.appendChild(g);
    return g;
  },

  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    const have = new Set(CommandBar.commands.map(c => c.id));
    for (const [id, k] of Object.entries(this.KINDS)) {
      const cid = 'compile-' + id;
      if (have.has(cid)) continue;
      CommandBar.commands.push({
        id: cid,
        label: 'Turn Sources Into ' + (id === 'report' ? 'a Report' : id === 'checklist' ? 'a Checklist' : id === 'comparison' ? 'a Comparison Table' : 'a Study Sheet'),
        hint: 'Pick tabs, notes and clips; the local model writes ' + k.verb + ' with numbered sources',
        icon: 'sparkles',
        action: () => { this.open({ kind: id }).catch(err => window.showToast?.(err.message, 'error')); },
      });
    }
  },

  init() {
    if (this._wired) return this;
    this._wired = true;
    this.registerCommands();
    this.injectSettings();
    return this;
  },
};

if (typeof window !== 'undefined') {
  window.ProjectCompiler = ProjectCompiler;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ProjectCompiler.init());
    else ProjectCompiler.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ProjectCompiler };
