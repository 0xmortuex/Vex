// === Research mode: a short brief in which every claim points at a quote =========
//
// Pick some tabs (right-click a tab > Research these tabs, pick several and press
// Research, a tab group's menu, the AI panel, or Ctrl+K > Research mode). Vex shows
// which pages it will read, where the reading runs and exactly what would leave this
// computer, then writes a brief: Summary, Key facts, Where sources agree, Where
// sources disagree, Open questions and the sources.
//
// The honest part is js/research-core.js: the model returns every claim as
// { text, sourceId, quote } and Vex checks in code that the quote is in the text of
// that page. A claim that fails is NOT shown as a fact: it is listed under
// "Unverified", with the reason, and counted in the header ("12 claims, 11 verified").
//
// Privacy
//   * never read: private windows and tabs, Tor, routed and other session-only tabs,
//     Vex's own pages, anything on a bank, payment, sign-in, mail, vault or health
//     site, a page that holds a card number, key or other secret, a locked Vex,
//     and the sites on your own list. Each is named with its reason.
//   * the AI is the one you set up (js/ai-router.js): your local model first when it
//     is running and big enough, else your own key (Connect an AI) or your Worker.
//     The cloud's sensitivity gate and spend cap apply as to every cloud request.
//   * what is sent is page text only, cut to a size shown on the preview. Pages stay
//     in memory while the window is open; a saved brief keeps the claims, the short
//     quotes and the addresses, never the page text. Nothing is synced.
//
// Stored here: vex.research.prefs (the settings) and vex.research.briefs (history).
// Notes: "Save to Notes" writes the brief as a note (js/study-notes.js).
const VexResearch = {
  FEATURE: 'research-mode',
  PREF: 'vex.research.prefs',
  HISTORY: 'vex.research.briefs',
  MAX_BRIEFS: 20,
  MAX_ROWS: 30,
  DEFAULTS: { enabled: true, maxPages: 8, where: 'auto', language: 'auto', defaultSources: 'group', exclude: [] },
  CHOICES: {
    maxPages: [3, 4, 5, 6, 8, 10, 12],
    where: ['auto', 'local', 'cloud'],
    language: ['auto', 'en', 'tr'],
    defaultSources: ['group', 'picked', 'all'],
  },
  // A local model smaller than this (billions of parameters) writes a thin brief and invents quotes more often.
  GOOD_LOCAL_B: 3,

  // ---- words in the person's language ------------------------------------------------------
  // The text in the interface's language with its {1} {2} holes left in (for a caller that fills them itself).
  tr(text) { return typeof window !== 'undefined' && typeof window.vexTr === 'function' ? window.vexTr(text) : text; },
  T(text, ...args) { return this.tr(text).replace(/\{(\d)\}/g, (_m, i) => (args[Number(i) - 1] == null ? '' : String(args[Number(i) - 1]))); },
  core() {
    if (typeof VexResearchCore === 'undefined') throw new Error('Research mode is still loading. Try again in a moment.');
    return VexResearchCore;
  },
  uiLanguage() { return typeof VexI18n !== 'undefined' && VexI18n.locale() === 'tr' ? 'tr' : 'en'; },
  language(prefs = this.prefs()) { return prefs.language === 'auto' ? this.uiLanguage() : prefs.language; },

  // ---- settings ------------------------------------------------------------------------------
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.PREF) || 'null'); }
    catch (err) { throw new Error('The Research mode settings could not be read: ' + err.message, { cause: err }); }
    const o = raw && typeof raw === 'object' ? raw : {};
    const pick = (k) => (this.CHOICES[k].includes(o[k]) ? o[k] : this.DEFAULTS[k]);
    return {
      enabled: typeof o.enabled === 'boolean' ? o.enabled : this.DEFAULTS.enabled,
      maxPages: this.CHOICES.maxPages.includes(o.maxPages) ? o.maxPages : this.DEFAULTS.maxPages,
      where: pick('where'), language: pick('language'), defaultSources: pick('defaultSources'),
      exclude: Array.isArray(o.exclude) ? o.exclude.map(s => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 200) : [],
    };
  },
  setPrefs(patch) {
    const next = { ...this.prefs(), ...patch };
    try { localStorage.setItem(this.PREF, JSON.stringify(next)); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message, { cause: err }); }
    return this.prefs();
  },
  enabled() { try { return this.prefs().enabled; } catch (err) { console.error('[Research]', err.message); return false; } },
  setEnabled(on) { return this.setPrefs({ enabled: !!on }).enabled; },

  // ---- the history of briefs --------------------------------------------------------------------
  history() {
    let list;
    try { list = JSON.parse(localStorage.getItem(this.HISTORY) || '[]'); }
    catch (err) { throw new Error('The saved research briefs could not be read: ' + err.message, { cause: err }); }
    if (!Array.isArray(list)) throw new Error('The saved research briefs are damaged');
    return list.filter(b => b && typeof b === 'object' && typeof b.id === 'string' && Array.isArray(b.sources) && b.sections && b.counts);
  },
  _writeHistory(list) {
    try { localStorage.setItem(this.HISTORY, JSON.stringify(list.slice(0, this.MAX_BRIEFS))); }
    catch (err) { throw new Error('The brief could not be kept: ' + err.message, { cause: err }); }
  },
  keep(brief) {
    const list = this.history().filter(b => b.id !== brief.id);
    list.unshift(brief);
    this._writeHistory(list);
  },
  forget(id) {
    const list = this.history();
    const gone = list.find(b => b.id === id) || null;
    this._writeHistory(list.filter(b => b.id !== id));
    return gone;
  },

  // ---- which tabs may be read -------------------------------------------------------------------
  hostOf(url) { return this.core().hostOf(url); },
  // Why a tab is not read, or '' when it may be. Before its text is looked at.
  leftOutBecause(tab, prefs = this.prefs()) {
    if (!tab || !tab.url) return this.T('no address');
    if (!/^https?:\/\//i.test(tab.url)) return this.T('not a web page');
    if (typeof VexTabPolicy === 'undefined') throw new Error('The tab privacy rules are not loaded, so no tab is read');
    if (!VexTabPolicy.canShareTab(tab)) return this.T('a private, Tor or routed tab');
    if (typeof VexPageSensitivity !== 'undefined' && VexPageSensitivity.reason(tab.url)) return this.T('looks like a bank, payment, sign-in, mail or health page');
    if (typeof VexSensitivity === 'undefined') throw new Error('The sensitivity gate is not loaded, so no tab is read');
    const hit = VexSensitivity.classify('research', { tabContexts: [{ url: tab.url }] }).classes[0];
    if (hit) return VexSensitivity.LABELS[hit.id] || hit.id;
    const host = this.hostOf(tab.url);
    if (host && prefs.exclude.some(x => host === x || host.endsWith('.' + x))) return this.T('on your exclude list');
    if (tab.sleeping || tab._lazy) return this.T('asleep, not loaded');
    return '';
  },
  // Everything that stops research before any tab is looked at.
  blockedBecause() {
    if (typeof VexTabPolicy !== 'undefined' && VexTabPolicy.isPrivateWindow) return this.T('This is a private window: its tabs are never read.');
    if (typeof VexLock !== 'undefined' && VexLock.locked()) return this.T('Vex is locked.');
    return '';
  },

  // The text of one tab, or the reason it cannot be used. -> { ok: true, title, url, text } | { ok: false, why }
  async readTab(tab) {
    if (typeof WebviewManager === 'undefined' || typeof PageContext === 'undefined') throw new Error('Pages cannot be read in this window');
    const wv = WebviewManager.webviews.get(tab.id);
    if (!wv) return { ok: false, why: this.T('not loaded') };
    const ctx = await PageContext.extractPageContext(wv);
    if (!ctx) return { ok: false, why: this.T('the page changed while it was read, or may not be read') };
    const core = this.core();
    const text = core.tidy(ctx.text || '');
    if (core.words(text) < 30) return { ok: false, why: this.T('no readable text on the page') };
    // The page's own text is judged too: a card number, key or code in it keeps the whole page out.
    const found = VexSensitivity.classify('research', { message: text.slice(0, 200000), tabContexts: [{ url: ctx.url || tab.url }] }).classes[0];
    if (found) return { ok: false, why: this.T('holds {1}', VexSensitivity.LABELS[found.id] || found.id) };
    return { ok: true, title: String(ctx.title || tab.title || tab.url), url: String(ctx.url || tab.url), text, hash: this.hash(text), injection: core.looksLikeInstruction(text) };
  },
  // A short fingerprint of a page's text, to tell on an update which pages changed.
  hash(text) {
    const s = this.core().norm(text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  },

  // ---- where it runs ---------------------------------------------------------------------------------
  _billions(model) {
    const m = /[:\-_](\d+(?:\.\d+)?)b\b/i.exec(String(model || ''));
    return m ? parseFloat(m[1]) : null;
  },
  /**
   * -> { backend: 'local' | 'cloud' | 'none', label, model, via?, notes: [], fix? }
   * Local first when Ollama answers and the model is big enough; then your own key or Worker; then a small local
   * model with a warning. 'local' and 'cloud' in the settings are never overridden: no quiet move to the other.
   */
  async route(prefs = this.prefs()) {
    if (typeof AIRouter === 'undefined') throw new Error('The AI is not available in this window');
    await AIRouter.refreshOllamaStatus();
    const localUp = AIRouter.isOllamaAvailable();
    const model = AIRouter.getModel();
    const size = this._billions(model);
    const goodLocal = size === null || size >= this.GOOD_LOCAL_B;
    const target = AIRouter.cloudConfigured('research') ? AIRouter.cloudTarget('research') : null;
    let cloud = null;
    let spendStop = '';
    if (target && target.kind !== 'missing-key' && AIRouter.isOnline()) {
      const keyModel = target.kind === 'key' && typeof AIKeys !== 'undefined' ? AIKeys.modelFor(target.provider, 'research') : '';
      cloud = { backend: 'cloud', via: target.kind, label: AIRouter.cloudLabel('research'), model: keyModel || '', notes: [] };
      if (typeof VexAISpend !== 'undefined' && VexAISpend.reached()) {
        cloud = null;
        spendStop = VexAISpend.limitText();
      }
    }
    const local = localUp ? { backend: 'local', label: this.T('your local model'), model, notes: goodLocal ? [] : [this.T('{1} is a small model, so the brief may be thin and more claims may fail the check.', model)] } : null;
    const none = (reason) => ({ backend: 'none', label: '', model: '', notes: [reason], fix: 'connect' });
    const noAi = this.T('No AI is connected. Connect your own key in Settings, start Ollama, or add an AI Worker.');
    if (prefs.where === 'local') return local || none(this.T('Research is set to your local model only, and Ollama is not running. Start Ollama, or change this in Settings > Research mode.'));
    if (prefs.where === 'cloud') {
      if (cloud) return cloud;
      return none(spendStop ? spendStop + this.T(', and Research is set to the cloud only.') : this.T('Research is set to the cloud only, and no cloud AI is connected.'));
    }
    if (local && goodLocal) return local;
    if (cloud) return cloud;
    if (local) return local;
    return none(spendStop ? spendStop + this.T(', and no local model is running.') : noAi);
  },

  // What the preview says will be sent, and its size: { chars, tokens, cost, currency }.
  sizeOf(prompt, route) {
    const chars = prompt.length;
    const tokens = this.core().estimateTokens(chars);
    let cost = null, currency = '';
    if (route.backend === 'cloud' && route.model && typeof VexAIMoney !== 'undefined') {
      cost = VexAIMoney.cost(route.model, tokens, Math.min(1800, this.core().LIMITS.cloud.maxTokens));
      currency = VexAIMoney.currency();
    }
    return { chars, tokens, cost, currency };
  },

  // ---- writing the brief --------------------------------------------------------------------------------
  /**
   * chosen: [{ id, tab, title, url, text, raw, hash }] with `text` already cut to its budget.
   * -> the brief object that is kept and shown.
   */
  async write({ chosen, left, route, language, signal, onProgress, updates = null }) {
    if (route.backend !== 'local' && route.backend !== 'cloud') throw new Error('There is no AI to write the brief');
    if (typeof AIRouter === 'undefined') throw new Error('The AI is not available in this window');
    const core = this.core();
    const sources = chosen.map((c) => ({ id: c.id, title: c.title, url: c.url, text: c.text }));
    const budget = core.budget(route.backend, chosen.length);
    const prompt = core.buildPrompt({ sources, language });
    const request = { message: prompt, maxTokens: budget.maxTokens, numCtx: budget.numCtx, signal };
    if (typeof onProgress === 'function') request.onToken = (_piece, full) => onProgress(full.length);
    const out = await AIRouter.callOn(route.backend, 'research', request);
    const raw = out && out.result;
    const parsed = core.parseReply(raw);
    const checked = core.verify(parsed, sources);
    const now = Date.now();
    const brief = {
      id: typeof vexId === 'function' ? vexId('rb_') : 'rb_' + now + '_' + Math.random().toString(36).slice(2, 7),
      createdAt: now,
      title: this.titleOf(chosen),
      language,
      route: { backend: route.backend, via: route.via || '', model: String((out && out.model) || route.model || ''), label: route.label },
      sources: chosen.map((c, i) => ({ id: c.id, n: i + 1, title: c.title, url: c.url, words: c.words, totalWords: c.totalWords, truncated: c.words < c.totalWords, hash: c.hash, injection: c.injection })),
      skipped: left.map(l => ({ title: String(l.tab.title || ''), url: String(l.tab.url || ''), why: l.why })),
      sections: checked.sections,
      unverified: checked.unverified,
      open: checked.open,
      counts: checked.counts,
      updates,
    };
    this.keep(brief);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return brief;
  },
  titleOf(chosen) {
    const first = String(chosen[0].title || chosen[0].url).replace(/\s+/g, ' ').trim().slice(0, 60);
    return chosen.length > 1 ? first + ' + ' + (chosen.length - 1) + ' ' + this.T('more') : first;
  },
  // The reason a failed request gives, in a sentence; and the fix to offer.
  explain(err) {
    const e = err || {};
    if (e.code === 'vex-byok' && e.byok) return { text: e.byok.text, fix: e.byok.fix === 'settings' ? 'connect' : e.byok.fix };
    if (e.code === 'vex-spend-cap') return { text: String(e.message), fix: 'spend' };
    if (e.code === 'vex-sensitive') return { text: String(e.message), fix: '' };
    return { text: String((e && e.message) || e), fix: '' };
  },

  // ---- the window -----------------------------------------------------------------------------------------
  _el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  },
  _btn(text, onClick, { primary = false, danger = false, label } = {}) {
    const b = this._el('button', 'rs-btn ' + (primary ? 'btn-primary' : danger ? 'btn-danger' : 'btn-secondary'), text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  },
  _icon(name, size = 14) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _fail(err) {
    if (typeof VexProblems !== 'undefined') VexProblems.note('Research mode', 'Something did not work', err);
    window.showToast?.((err && err.message) || String(err), 'error', 6000);
  },
  _num(n) { return Number(n).toLocaleString(this.uiLanguage() === 'tr' ? 'tr-TR' : 'en-US'); },
  _date(ts) { return new Date(ts).toLocaleString(this.uiLanguage() === 'tr' ? 'tr-TR' : undefined, { dateStyle: 'medium', timeStyle: 'short' }); },
  _dialog(id, title, sub) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog system is not loaded');
    const d = VexSettingsGroups.dialog({ id, title, sub });
    d.overlay.classList.add('rs-overlay');
    d.body.classList.add('rs');
    return d;
  },

  // The tabs that start a run. opts: { tabs?, seed?, updateOf? }
  _initialTabs(opts) {
    const all = typeof TabManager !== 'undefined' ? TabManager.tabs.slice() : [];
    if (!all.length) throw new Error('There are no tabs to read');
    const prefs = this.prefs();
    const seed = opts.seed || all.find(t => t.id === TabManager.activeTabId) || all[0];
    let first;
    if (opts.tabs && opts.tabs.length) first = opts.tabs.slice();
    else if (prefs.defaultSources === 'all') first = all.slice();
    else if (prefs.defaultSources === 'picked') {
      const picked = typeof VexTabSelect !== 'undefined' ? VexTabSelect.tabs() : [];
      first = picked.length >= 2 ? picked : [seed];
    } else first = seed.groupId ? all.filter(t => t.groupId === seed.groupId) : [seed];
    const firstIds = new Set(first.map(t => t.id));
    return { all, first, others: all.filter(t => !firstIds.has(t.id)), prefs };
  },

  async start(opts = {}) {
    if (!this.enabled()) { window.showToast?.(this.T('Research mode is off. Turn it on in Settings > Research mode.'), 'info', 5000); return; }
    const blocked = this.blockedBecause();
    if (blocked) { window.showToast?.(blocked, 'warn', 5000); return; }
    this.core();
    const { first, others, prefs } = this._initialTabs(opts);
    const firstIds = new Set(first.map(t => t.id));
    // Every tab is judged before any is read: the ones that may be read are listed first, the others with their reason.
    const plan = this.core().planTabs([...first, ...others], { check: (tab) => this.leftOutBecause(tab, prefs), max: this.MAX_ROWS });
    const rows = [
      ...plan.use.map(tab => ({ tab, checked: firstIds.has(tab.id), why: '', read: null, busy: false })),
      ...plan.left.map(l => ({ tab: l.tab, checked: false, why: this.T(l.why), read: null, busy: false })),
    ];
    await this._chooser({ rows, prefs, updateOf: opts.updateOf || null, missing: opts.missing || [] });
  },

  async _chooser(state) {
    const T = (...a) => this.T(...a);
    const core = this.core();
    const { body, close, overlay } = this._dialog('vex-research', T('Research mode'), T('A short brief in which every claim points to a quote in a page you chose.'));
    const ctl = { abort: null, alive: true };
    const closeAll = () => { ctl.alive = false; if (ctl.abort) ctl.abort.abort(); for (const r of state.rows) r.read = null; close(); };
    // The close button of the dialog frame also stops a run and lets go of the page text.
    new MutationObserver((_m, obs) => { if (!overlay.isConnected) { ctl.alive = false; if (ctl.abort) ctl.abort.abort(); for (const r of state.rows) r.read = null; obs.disconnect(); } }).observe(document.body, { childList: true });
    const language = { value: state.prefs.language === 'auto' ? 'auto' : state.prefs.language };

    const list = this._el('div', 'rs-list');
    const where = this._el('div', 'rs-box');
    const leaves = this._el('div', 'rs-box');
    const warn = this._el('div', 'rs-warn');
    warn.hidden = true;
    const actions = this._el('div', 'rs-actions');
    const status = this._el('div', 'rs-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    let route = null;

    const rowsReadable = () => state.rows.filter(r => r.checked && r.read && r.read.ok);
    const plan = () => {
      const picked = rowsReadable().slice(0, state.prefs.maxPages);
      const budget = core.budget(route ? route.backend : 'local', picked.length);
      return picked.map((r, i) => {
        const ex = core.excerpt(r.read.text, budget.perSource);
        return { id: 'S' + (i + 1), row: r, tab: r.tab, title: r.read.title, url: r.read.url, text: ex.text, words: ex.words, totalWords: ex.totalWords, hash: r.read.hash, injection: r.read.injection };
      });
    };

    const redraw = () => {
      if (!ctl.alive) return;
      list.textContent = '';
      const checkedCount = state.rows.filter(r => r.checked && (!r.read || r.read.ok)).length;
      const atLimit = checkedCount >= state.prefs.maxPages;
      const chosen = plan();
      const chosenById = new Map(chosen.map(c => [c.row, c]));
      for (const r of state.rows) {
        const item = this._el('label', 'rs-row');
        const cb = this._el('input');
        cb.type = 'checkbox';
        cb.checked = r.checked && !r.why;
        cb.disabled = !!r.why || (!cb.checked && atLimit);
        cb.setAttribute('aria-label', T('Read {1}', r.tab.title || r.tab.url));
        cb.addEventListener('change', () => { r.checked = cb.checked; if (r.checked) ensure(r); else redraw(); });
        const text = this._el('span', 'rs-row-text');
        text.append(this._el('span', 'rs-row-title', r.tab.title || r.tab.url), this._el('span', 'rs-row-host', this.hostOf(r.tab.url) || r.tab.url));
        const note = this._el('span', 'rs-row-note');
        const c = chosenById.get(r);
        if (r.why) { note.textContent = T('Not read: {1}', r.why); item.classList.add('is-left'); }
        else if (r.busy) note.textContent = T('Reading the page...');
        else if (c) {
          note.textContent = c.words < c.totalWords ? T('Reads the first {1} of {2} words', this._num(c.words), this._num(c.totalWords)) : T('Reads all {1} words', this._num(c.words));
          if (c.injection) { const w = this._el('span', 'rs-chip rs-chip-warn', T('Tries to instruct an AI: read as plain text')); note.append(' ', w); }
          if (state.updateOf) {
            const old = state.updateOf.sources.find(s => this.core().pageKey(s.url) === this.core().pageKey(c.url));
            if (old) note.append(' ', this._el('span', 'rs-chip', old.hash === c.hash ? T('Unchanged since the last brief') : T('Changed since the last brief')));
          }
        } else if (r.checked && r.read && !r.read.ok) { note.textContent = T('Not read: {1}', r.read.why); item.classList.add('is-left'); }
        else note.textContent = r.checked ? '' : T('Not chosen');
        item.append(cb, text, note);
        list.appendChild(item);
      }
      if (state.missing.length) list.appendChild(this._el('div', 'rs-muted', T('No longer open: {1}', state.missing.map(s => s.title || s.url).join('; '))));
      drawWhere(chosen);
      const ready = chosen.length > 0 && route && route.backend !== 'none' && !state.rows.some(r => r.busy);
      runBtn.disabled = !ready;
      status.textContent = chosen.length ? '' : T('Choose at least one page to read.');
    };

    const drawWhere = (chosen) => {
      where.textContent = '';
      leaves.textContent = '';
      warn.hidden = true;
      where.append(this._el('div', 'rs-h', T('Where the AI runs')));
      leaves.append(this._el('div', 'rs-h', T('What leaves this computer')));
      if (!route) { where.append(this._el('div', 'rs-muted', T('Checking...'))); return; }
      if (route.backend === 'none') {
        where.append(this._el('div', 'rs-line', route.notes[0]));
        leaves.append(this._el('div', 'rs-line', T('Nothing: no AI can run yet.')));
        const b = this._btn(T('Connect an AI'), () => { closeAll(); this.openConnect(); }, { primary: true });
        where.appendChild(b);
        return;
      }
      const model = route.model ? ' (' + route.model + ')' : '';
      where.append(this._el('div', 'rs-line', route.backend === 'local' ? T('On this computer, with {1}{2}.', T(route.label), model) : T('In the cloud, with {1}{2}.', T(route.label), model)));
      for (const n of route.notes) where.append(this._el('div', 'rs-muted', n));
      if (!chosen.length) { leaves.append(this._el('div', 'rs-muted', T('Nothing yet: no page is chosen.'))); return; }
      const prompt = core.buildPrompt({ sources: chosen.map(c => ({ id: c.id, title: c.title, url: c.url, text: c.text })), language: this._lang(language.value) });
      const words = chosen.reduce((n, c) => n + c.words, 0);
      const size = this.sizeOf(prompt, route);
      if (route.backend === 'local') {
        leaves.append(this._el('div', 'rs-line', T('Nothing. The page text stays on this computer and is read by your local model.')));
        leaves.append(this._el('div', 'rs-muted', T('{1} words from {2} page{3}, about {4} tokens.', this._num(words), chosen.length, VexPlural.s(chosen.length), this._num(size.tokens))));
      } else {
        leaves.append(this._el('div', 'rs-line', T('The text of {1} page{2} ({3} words, about {4} tokens) goes to {5}, together with the instructions.', chosen.length, VexPlural.s(chosen.length), this._num(words), this._num(size.tokens), T(route.label))));
        leaves.append(this._el('div', 'rs-muted', size.cost != null
          ? T('Estimated cost: about {1} {2}. This is an estimate from the model\'s list price, not a bill.', size.cost.toFixed(size.cost < 0.1 ? 3 : 2), size.currency)
          : T('Cost: unknown for this model. Your spend limit in Settings still applies.')));
        if (typeof VexAISpend !== 'undefined' && VexAISpend.cap() > 0) leaves.append(this._el('div', 'rs-muted', T('Your daily cloud limit: {1} of {2} calls used.', VexAISpend.used(), VexAISpend.cap())));
      }
      const det = this._el('details', 'rs-details');
      det.append(this._el('summary', null, T('Show the exact text that would be read')));
      for (const c of chosen) {
        det.append(this._el('div', 'rs-src-h', c.id + ': ' + c.title));
        const pre = this._el('pre', 'rs-pre', c.text);
        pre.tabIndex = 0;
        det.append(pre);
      }
      leaves.append(det);
      const cut = chosen.filter(c => c.words < c.totalWords);
      if (cut.length) {
        warn.hidden = false;
        warn.textContent = T('Long pages are cut: Vex reads the first words of {1} page{2}, so the brief covers only that part.', cut.length, VexPlural.s(cut.length));
      }
    };

    const ensure = async (r) => {
      if (r.read || r.busy || r.why) { redraw(); return; }
      r.busy = true; redraw();
      try { r.read = await this.readTab(r.tab); }
      catch (err) { r.read = { ok: false, why: String((err && err.message) || err) }; this._fail(err); }
      r.busy = false;
      redraw();
    };

    const langRow = this._el('label', 'rs-lang');
    langRow.append(this._el('span', null, T('Write the brief in')));
    const sel = this._el('select', 'set-input');
    for (const [v, text] of [['auto', T('My language (from the interface)')], ['en', 'English'], ['tr', 'Türkçe']]) {
      const o = this._el('option', null, text);
      o.value = v;
      sel.appendChild(o);
    }
    sel.value = language.value;
    sel.addEventListener('change', () => { language.value = sel.value; redraw(); });
    langRow.appendChild(sel);

    const runBtn = this._btn(T('Write the brief'), async () => {
      const chosen = plan();
      if (!chosen.length) return;
      runBtn.disabled = true;
      const abort = new AbortController();
      ctl.abort = abort;
      body.textContent = '';
      const prog = this._el('div', 'rs-running');
      prog.setAttribute('role', 'status');
      prog.setAttribute('aria-live', 'polite');
      const msg = this._el('div', 'rs-line', T('Reading {1} page{2} with {3}...', chosen.length, VexPlural.s(chosen.length), route.model || route.label));
      const count = this._el('div', 'rs-muted', T('This can take a minute or more on a local model.'));
      body.append(prog);
      prog.append(msg, count, this._btn(T('Stop'), () => abort.abort(), {}));
      try {
        const left = [...state.rows.filter(r => r.why).map(r => ({ tab: r.tab, why: r.why })),
          ...state.rows.filter(r => r.checked && r.read && !r.read.ok).map(r => ({ tab: r.tab, why: r.read.why }))];
        const brief = await this.write({
          chosen, left, route, language: this._lang(language.value), signal: abort.signal,
          onProgress: (n) => { if (ctl.alive) count.textContent = T('The AI has written {1} characters...', this._num(n)); },
          updates: state.updateOf ? state.updateOf.id : null,
        });
        for (const r of state.rows) r.read = null;
        if (!ctl.alive) return;
        body.textContent = '';
        this.renderBrief(body, brief, { close: closeAll });
      } catch (err) {
        if (!ctl.alive) return;
        for (const r of state.rows) r.read = null;
        body.textContent = '';
        this.renderFailure(body, err, closeAll);
      }
    }, { primary: true });
    runBtn.disabled = true;
    actions.append(runBtn, this._btn(T('Cancel'), closeAll));

    body.append(list, this._el('div', 'rs-sub', T('Only pages that are not private, not a bank, mail or sign-in page, and hold no secret are read. Tick another tab to add it.')), where, leaves, warn, langRow, status, actions);
    // Read the chosen pages, then ask where it runs (that needs the AI status).
    redraw();
    await Promise.all(state.rows.filter(r => r.checked).map(r => ensure(r)));
    try { route = await this.route(state.prefs); }
    catch (err) { route = { backend: 'none', label: '', model: '', notes: [String(err.message || err)], fix: 'connect' }; this._fail(err); }
    redraw();
  },
  _lang(value) { return value === 'auto' ? this.language() : value; },

  openConnect() {
    if (typeof SettingsUI === 'undefined') throw new Error('Settings is not ready yet');
    SettingsUI.openSection('vex-sg-ai-connect');
  },

  renderFailure(body, err, close) {
    const { text, fix } = this.explain(err);
    body.append(this._el('div', 'rs-h', this.T('The brief could not be written')), this._el('div', 'rs-fail', text));
    const row = this._el('div', 'rs-actions');
    if (fix === 'connect') row.append(this._btn(this.T('Connect an AI'), () => { close(); this.openConnect(); }, { primary: true }));
    if (fix === 'spend') row.append(this._btn(this.T('Open the spend limit'), () => { close(); if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('setting-ai-spend'); }));
    row.append(this._btn(this.T('Close'), close));
    body.append(row);
    if (err && err.message && /did not answer with a brief|not in the shape/.test(err.message)) {
      body.append(this._el('div', 'rs-muted', this.T('Nothing is shown as a fact when the AI does not return claims with quotes.')));
    }
  },

  // ---- the brief ---------------------------------------------------------------------------------------------
  /** Opens the passage: the tab, with the quote marked by the browser's find. */
  async showWhere(brief, sourceId, quote, closeFn) {
    if (typeof VexAnswerCitations === 'undefined') throw new Error('Showing a passage is not available in this window');
    const src = brief.sources.find(s => s.id === sourceId);
    if (!src) throw new Error('That source is not part of this brief');
    if (closeFn) closeFn();
    this._backPill(brief);
    await VexAnswerCitations.showWhere({ url: src.url }, quote);
  },
  // After a jump into a page the brief is closed; this small button brings it back.
  _backPill(brief) {
    document.getElementById('rs-back')?.remove();
    const b = this._btn(this.T('Back to the research brief'), () => { b.remove(); this.openBrief(brief); }, { primary: true });
    b.id = 'rs-back';
    b.className += ' rs-back';
    document.body.appendChild(b);
    setTimeout(() => { if (b.isConnected) b.remove(); }, 20 * 60 * 1000);
  },
  openBrief(brief) {
    const { body, close } = this._dialog('vex-research', this.T('Research brief'), '');
    this.renderBrief(body, brief, { close });
  },

  renderBrief(body, brief, { close }) {
    const T = (...a) => this.T(...a);
    const core = this.core();
    body.textContent = '';
    const dialogTitle = body.closest('.vexsr-card')?.querySelector('.vexsr-title');
    if (dialogTitle) dialogTitle.textContent = T('Research brief');
    const sub = body.closest('.vexsr-card')?.querySelector('.vexsr-sub');
    const byId = new Map(brief.sources.map(s => [s.id, s]));

    const head = this._el('div', 'rs-head');
    head.append(this._el('div', 'rs-title', brief.title));
    const ok = brief.counts.verified === brief.counts.claims && brief.counts.claims > 0;
    const badge = this._el('span', 'rs-badge ' + (ok ? 'is-ok' : 'is-warn'));
    badge.innerHTML = this._icon(ok ? 'check' : 'warning', 13);
    badge.append(' ' + core.headline(brief.counts, (s) => this.tr(s)));
    head.append(badge);
    body.append(head);
    if (typeof VexProvenance !== 'undefined') VexProvenance.attach(head, VexProvenance.fromResult({ backend: brief.route.backend, model: brief.route.model }, { read: 'the pages you chose' }));
    const how = brief.route.backend === 'local' ? T('Written on this computer by {1}', brief.route.model || T(brief.route.label)) : T('Written by {1} with {2}', brief.route.model || '?', T(brief.route.label));
    body.append(this._el('div', 'rs-muted', how + ' - ' + this._date(brief.createdAt)));
    body.append(this._el('div', 'rs-muted', T('Verified means the quote was found in that page\'s text. It does not prove the claim means what the quote says: use the numbers to check.')));
    if (sub) sub.remove();

    const cite = (id, quote) => {
      const s = byId.get(id);
      const b = this._el('button', 'rs-cite', '[' + (s ? s.n : '?') + ']');
      b.type = 'button';
      b.title = T('Open {1} and mark the quote', s ? s.title : id);
      b.setAttribute('aria-label', T('Source {1}: {2}. Open it and mark the quote.', s ? s.n : '?', s ? s.title : id));
      b.addEventListener('click', () => this.showWhere(brief, id, quote, close).catch(err => this._fail(err)));
      return b;
    };
    const quoteLine = (quote) => {
      const q = this._el('div', 'rs-quote');
      q.append('“' + quote + '”');
      return q;
    };
    const section = (title, items, draw) => {
      if (!items.length) return;
      const sec = this._el('section', 'rs-sec');
      sec.append(this._el('h3', 'rs-sec-h', title));
      const ul = this._el('ul', 'rs-claims');
      for (const it of items) { const li = this._el('li', 'rs-claim'); draw(li, it); ul.append(li); }
      sec.append(ul);
      body.append(sec);
    };
    const simple = (li, c) => { const t = this._el('div', 'rs-claim-text'); t.append(c.text + ' ', cite(c.sourceId, c.quote)); li.append(t, quoteLine(c.quote)); };
    section(T('Summary'), brief.sections.summary, simple);
    section(T('Key facts'), brief.sections.keyFacts, simple);
    section(T('Where sources agree'), brief.sections.agree, (li, c) => {
      const t = this._el('div', 'rs-claim-text');
      t.append(c.text + ' ');
      for (const s of c.support) t.append(cite(s.sourceId, s.quote));
      li.append(t);
      for (const s of c.support) li.append(quoteLine(s.quote));
    });
    section(T('Where sources disagree'), brief.sections.disagree, (li, d) => {
      li.append(this._el('div', 'rs-claim-text rs-strong', d.topic));
      for (const p of d.positions) {
        const s = byId.get(p.sourceId);
        const row = this._el('div', 'rs-pos');
        const t = this._el('div', 'rs-claim-text');
        t.append(this._el('span', 'rs-strong', (s ? s.title : p.sourceId) + ': '), p.text + ' ', cite(p.sourceId, p.quote));
        row.append(t, quoteLine(p.quote));
        li.append(row);
      }
    });
    if (brief.open.length) {
      const sec = this._el('section', 'rs-sec');
      sec.append(this._el('h3', 'rs-sec-h', T('Open questions')), this._el('div', 'rs-muted', T('The AI\'s own questions. They are not from the sources and have no quote.')));
      const ul = this._el('ul', 'rs-claims');
      for (const q of brief.open) ul.append(this._el('li', 'rs-claim', q));
      sec.append(ul);
      body.append(sec);
    }
    if (!brief.counts.claims) body.append(this._el('div', 'rs-fail', T('The AI returned no claims that could be checked.')));
    if (brief.unverified.length) {
      const det = this._el('details', 'rs-details rs-unverified');
      det.append(this._el('summary', null, T('Unverified: {1} claim{2} the check could not confirm', brief.unverified.length, VexPlural.s(brief.unverified.length))));
      det.append(this._el('div', 'rs-muted', T('These are NOT shown as facts. The quote was not found in the source the AI named, or the claim did not meet the rules above. Do not rely on them.')));
      const ul = this._el('ul', 'rs-claims');
      for (const u of brief.unverified) {
        const li = this._el('li', 'rs-claim');
        li.append(this._el('div', 'rs-claim-text', u.text || T('(no text)')));
        if (u.quote) li.append(quoteLine(u.quote));
        li.append(this._el('div', 'rs-reason', T('Why: {1}', T(u.reason))));
        for (const part of u.parts || []) li.append(this._el('div', 'rs-reason', (part.sourceId ? part.sourceId + ': ' : '') + T(part.reason)));
        ul.append(li);
      }
      det.append(ul);
      body.append(det);
    }

    const src = this._el('section', 'rs-sec');
    src.append(this._el('h3', 'rs-sec-h', T('Sources')));
    const ol = this._el('ol', 'rs-sources');
    for (const s of brief.sources) {
      const li = this._el('li', 'rs-source');
      const a = this._el('button', 'rs-link', s.title || s.url);
      a.type = 'button';
      a.title = s.url;
      a.addEventListener('click', () => {
        const tab = typeof TabManager !== 'undefined' ? TabManager.tabs.find(t => core.pageKey(t.url) === core.pageKey(s.url)) : null;
        close();
        if (tab) TabManager.switchTab(tab.id); else if (typeof TabManager !== 'undefined') TabManager.createTab(s.url, true);
      });
      li.append(a, this._el('span', 'rs-muted', ' ' + this.hostOf(s.url) + ' - ' + (s.truncated ? T('read the first {1} of {2} words', this._num(s.words), this._num(s.totalWords)) : T('read all {1} words', this._num(s.words)))));
      if (s.injection) li.append(' ', this._el('span', 'rs-chip rs-chip-warn', T('Tried to instruct an AI: read as plain text')));
      ol.append(li);
    }
    src.append(ol);
    if (brief.skipped.length) {
      const det = this._el('details', 'rs-details');
      det.append(this._el('summary', null, T('Not read: {1}', brief.skipped.length)));
      const ul = this._el('ul', 'rs-claims');
      for (const s of brief.skipped) ul.append(this._el('li', 'rs-claim', (s.title || s.url) + ' - ' + s.why));
      det.append(ul);
      src.append(det);
    }
    body.append(src);

    const bar = this._el('div', 'rs-actions');
    bar.append(
      this._btn(T('Copy as Markdown'), () => this.copyMarkdown(brief).catch(err => this._fail(err)), { primary: true }),
      this._btn(T('Save to Notes'), () => { try { this.saveToNotes(brief); } catch (err) { this._fail(err); } }),
      this._btn(T('Export .md'), () => { try { this.exportMarkdown(brief); } catch (err) { this._fail(err); } }),
      this._btn(T('Update'), () => { close(); this.update(brief).catch(err => this._fail(err)); }, { label: T('Read the same pages again and write a new brief') }),
      this._btn(T('Past briefs'), () => { close(); this.openHistory(); }),
      this._btn(T('Close'), close),
    );
    body.append(bar);
  },

  // ---- taking the brief away ------------------------------------------------------------------------------------
  markdown(brief) { return this.core().toMarkdown(brief); },
  async copyMarkdown(brief) {
    await navigator.clipboard.writeText(this.markdown(brief));
    window.showToast?.(this.T('Copied the brief as Markdown, with a numbered source list'), 'info', 3500);
  },
  saveToNotes(brief) {
    if (typeof VexStudyNotes === 'undefined') throw new Error('Notes are not available here');
    VexStudyNotes.addNote({ title: this.T('Research brief') + ': ' + brief.title, content: this.markdown(brief), tags: ['research'], sourceUrl: brief.sources[0] ? brief.sources[0].url : '', sourceTitle: brief.sources[0] ? brief.sources[0].title : '' });
    window.showToast?.(this.T('Saved to Notes'), 'success', 3500);
  },
  fileName(brief) {
    const slug = this.core().norm(brief.title).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'brief';
    return 'vex-research-' + new Date(brief.createdAt).toISOString().slice(0, 10) + '-' + slug + '.md';
  },
  exportMarkdown(brief) {
    const blob = new Blob([this.markdown(brief)], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName(brief);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  // Read the same pages again (those still open) and write a new brief; the preview says which pages changed.
  async update(brief) {
    const core = this.core();
    const open = typeof TabManager !== 'undefined' ? TabManager.tabs : [];
    const tabs = [], missing = [];
    for (const s of brief.sources) {
      const tab = open.find(t => core.pageKey(t.url) === core.pageKey(s.url));
      if (tab) tabs.push(tab); else missing.push(s);
    }
    if (!tabs.length) throw new Error('None of the pages from that brief is open any more. Open them again, then press Update.');
    await this.start({ tabs, updateOf: brief, missing });
  },

  // ---- past briefs ------------------------------------------------------------------------------------------------------
  openHistory() {
    const T = (...a) => this.T(...a);
    const { body, close } = this._dialog('vex-research-history', T('Research briefs'), T('Briefs you have written, newest first. They keep the claims, the short quotes and the addresses, never the page text.'));
    const draw = () => {
      body.textContent = '';
      let list;
      try { list = this.history(); } catch (err) { body.append(this._el('div', 'rs-fail', err.message)); return; }
      if (!list.length) { body.append(this._el('div', 'rs-muted', T('No briefs yet. Right-click a tab and choose Research these tabs.'))); return; }
      for (const b of list) {
        const row = this._el('div', 'rs-hist');
        const text = this._el('div', 'rs-hist-text');
        text.append(this._el('div', 'rs-strong', b.title), this._el('div', 'rs-muted', this._date(b.createdAt) + ' - ' + this.core().headline(b.counts, (s) => this.tr(s)) + ' - ' + b.sources.length + ' ' + T('pages')));
        row.append(text,
          this._btn(T('Open'), () => { close(); this.openBrief(b); }),
          this._btn(T('Remove'), () => {
            const gone = this.forget(b.id);
            draw();
            if (gone && window.VexUndo) window.VexUndo.offer({ message: T('Removed a research brief'), undo: () => { this.keep(gone); if (body.isConnected) draw(); } });
          }, { danger: true, label: T('Remove the brief {1}', b.title) }));
        body.append(row);
      }
    };
    draw();
  },

  // ---- ways in ------------------------------------------------------------------------------------------------------------
  _failToast(err) { window.showToast?.((err && err.message) || String(err), 'error', 6000); },
  menuItems(tab) {
    if (!this.enabled() || !tab || !/^https?:\/\//i.test(tab.url || '')) return [];
    const picked = typeof VexTabSelect !== 'undefined' ? VexTabSelect.tabs() : [];
    const mine = picked.length >= 2 && picked.some(t => t.id === tab.id) ? picked : null;
    return [{ label: mine ? this.T('Research these {1} tabs...', mine.length) : this.T('Research these tabs...'), action: () => this.start({ tabs: mine || undefined, seed: tab }).catch(err => this._failToast(err)) }];
  },
  // The group menu's line (js/tabs.js).
  groupLabel(count) { return count === 1 ? this.T('Research this tab') : this.T('Research these {1} tabs', count); },

  // ---- Settings -----------------------------------------------------------------------------------------------------------------
  group(el) {
    const T = (...a) => this.T(...a);
    el.appendChild(VexSettingsGroups.note(T('Pick some tabs and Vex writes a short brief in which every claim points to a quote in one of those pages. Vex checks each quote against the page text; a claim whose quote is not found is shown as Unverified, never as a fact. Right-click a tab, a tab group, or use Ctrl+K > Research mode.')));
    let prefs;
    try { prefs = this.prefs(); } catch (err) { el.appendChild(VexSettingsGroups.note(err.message)); return; }
    const row = (label, control) => { const l = this._el('label', 'rs-set'); l.append(this._el('span', null, label), control); el.appendChild(l); return control; };
    const save = (patch) => { try { this.setPrefs(patch); } catch (err) { this._fail(err); } };

    const on = this._el('input'); on.type = 'checkbox'; on.checked = prefs.enabled;
    on.setAttribute('aria-label', T('Turn Research mode on'));
    on.addEventListener('change', () => save({ enabled: on.checked }));
    row(T('Research mode is on'), on);

    const select = (label, key, options, parse = (v) => v) => {
      const s = this._el('select', 'set-input');
      for (const [v, text] of options) { const o = this._el('option', null, text); o.value = String(v); s.appendChild(o); }
      s.value = String(prefs[key]);
      s.addEventListener('change', () => save({ [key]: parse(s.value) }));
      row(label, s);
    };
    select(T('Most pages in one brief'), 'maxPages', this.CHOICES.maxPages.map(n => [n, String(n)]), Number);
    select(T('Where it runs'), 'where', [['auto', T('Local model first, then my own key or Worker')], ['local', T('My local model only')], ['cloud', T('My own key or Worker only')]]);
    select(T('Language of the brief'), 'language', [['auto', T('My language (from the interface)')], ['en', 'English'], ['tr', 'Türkçe']]);
    select(T('Pages chosen at the start'), 'defaultSources', [['group', T('The tab group of the page I am on')], ['picked', T('The tabs I picked')], ['all', T('All my open tabs')]]);

    const ta = this._el('textarea', 'set-input');
    ta.rows = 3; ta.spellcheck = false; ta.value = prefs.exclude.join('\n');
    ta.setAttribute('aria-label', T('Sites Research mode never reads, one per line'));
    ta.addEventListener('change', () => save({ exclude: ta.value.split('\n').map(s => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean) }));
    el.appendChild(this._el('div', 'rs-muted', T('Also never read, one site per line (private and Tor tabs, banks, mail and sign-in pages are always left out):')));
    el.appendChild(ta);

    const actions = this._el('div', 'rs-actions');
    actions.append(
      this._btn(T('Research mode'), () => this.start().catch(err => this._failToast(err)), { primary: true }),
      this._btn(T('Past briefs'), () => this.openHistory()),
      this._btn(T('Clear all briefs'), async () => {
        if (!await window.vexConfirm({ title: T('Remove every saved research brief?'), message: T('The list of briefs on this computer is emptied. Notes you saved from them are not touched.'), okLabel: T('Remove them') })) return;
        try { this._writeHistory([]); window.showToast?.(T('The briefs were removed'), 'info', 3000); } catch (err) { this._fail(err); }
      }, { danger: true }));
    el.appendChild(actions);
  },
};

if (typeof window !== 'undefined') {
  window.VexResearch = VexResearch;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'research', title: 'Research mode', keywords: 'research brief sources claims quotes verify citations tabs summary agree disagree arastirma ozet kaynak', before: 'about', build: (el) => VexResearch.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'research-mode', label: 'Research mode', hint: 'A short brief from some tabs, every claim traced to a quote', icon: 'book', action: () => VexResearch.start().catch(err => VexResearch._failToast(err)) });
    VexExtras.registerCommand({ id: 'research-briefs', label: 'Research briefs', hint: 'Briefs you wrote with Research mode', icon: 'book', action: () => VexResearch.openHistory() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexResearch };
