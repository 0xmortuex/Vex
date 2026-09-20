// === The Library of everything Vex can do =================================
//
// Vex has over two hundred features and, until now, the only way to meet one
// was to already know its name and type it into Ctrl+K. Discover shows them a
// card at a time and the tour walks past them, but neither is a reference you
// can sit down with — and a feature nobody can find may as well not exist.
//
// This is that reference, in the Library panel beside the things you saved:
// every feature, grouped, searchable, each one saying what it is for, where it
// lives, how to start it, and what it sits next to. Nothing here is written
// twice: the facts come from the catalogue (js/feature-catalog.js), the steps
// from the guide (js/vex-guide.js), the labels and shortcuts from the live
// command registry. A feature added to the catalogue turns up here by itself.
//
// Every entry has three buttons, and they are the point:
//   Open      runs the thing, now
//   Show me   points at the real control on screen (js/tour.js)
//   Ask Vex   asks the assistant about it, with the catalogue entry as the
//             facts, so the answer is about YOUR Vex and not a model's memory
const FeatureLibrary = {
  QUERY_KEY: 'vex.libraryQuery',
  OPEN_KEY: 'vex.libraryOpenFeature',

  _query: '',
  _cat: null,
  _openIds: null,      // which cards are expanded

  _esc(s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); },

  _items() {
    const all = (typeof VexFeatures !== 'undefined' && VexFeatures.ITEMS) || [];
    let list = this._query ? VexFeatures.search(this._query) : all;
    if (this._cat) list = list.filter(f => f.cat === this._cat);
    return list;
  },

  // What one feature's card says, as data — so a test can read it without a
  // DOM, and so the same words can go to the AI.
  card(f) {
    const name = VexFeatures.nameOf(f);
    const keys = VexFeatures.keysOf(f);
    const cat = (VexFeatures.CATS || []).find(c => c.id === f.cat);
    const where = [];
    if (f.panel) where.push('A panel on the sidebar' + (typeof SidebarManager !== 'undefined' && SidebarManager.panelLabel ? ' — ' + SidebarManager.panelLabel(f.panel) : ''));
    if (f.setting) where.push('A switch in Settings' + (f.setting.label ? ' — “' + f.setting.label + '”' : ''));
    if (f.cmd) where.push('In the command bar — Ctrl+K, then “' + (VexFeatures.command(f) || {}).label + '”');
    if (f.sel && !f.panel && !f.cmd) where.push('A control in the window itself');
    if (f.manual && !where.length) where.push('Something you do with the mouse or the keyboard, not a command');
    const steps = (typeof VexGuide !== 'undefined') ? VexGuide.steps(f) : [];
    const near = (VexFeatures.ITEMS || [])
      .filter(o => o.cat === f.cat && o.id !== f.id)
      .slice(0, 4)
      .map(o => VexFeatures.nameOf(o));
    return {
      id: f.id,
      name,
      keys,
      category: cat ? cat.name : f.cat,
      what: f.what,
      // The paragraph after the headline (js/feature-details.js); a feature
      // without one still shows the catalogue's sentence above.
      detail: f.detail || (typeof FeatureDetails !== 'undefined' ? FeatureDetails[f.id] : '') || '',
      where,
      steps,
      near,
      canOpen: !!(f.cmd || f.panel),
      canShow: !!(f.sel || f.panel || f.cmd),
    };
  },

  // ---- Drawing -------------------------------------------------------------

  render(host) {
    if (!host) return;
    host.innerHTML = `
      <div class="flib">
        <div class="flib-ask">
          <div class="flib-ask-head">Ask Vex what you don’t know</div>
          <div class="flib-ask-sub">Searching only finds what you can already name. Say what you are trying to DO — “I keep losing tabs”, “two accounts on one site”, “make Discord lighter” — and Vex says which of its features are for that.</div>
          <form class="flib-ask-form" id="flib-ask-form">
            <input id="flib-ask-q" type="text" placeholder="What are you trying to do?" aria-label="Tell Vex what you are trying to do" autocomplete="off">
            <button type="submit" class="flib-btn primary">Ask</button>
          </form>
          <div class="flib-ask-out" id="flib-ask-out"></div>
          <div class="flib-never" id="flib-never"></div>
        </div>
        <div class="flib-top">
          <input id="flib-q" class="flib-search" type="search" placeholder="Search everything Vex does…" aria-label="Search features" autocomplete="off">
          <div class="flib-cats" id="flib-cats"></div>
        </div>
        <div class="flib-list" id="flib-list"></div>
      </div>`;
    const q = host.querySelector('#flib-q');
    q.value = this._query;
    q.addEventListener('input', () => { this._query = q.value.trim(); this._drawList(host); });
    host.querySelector('#flib-ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.answerInto(host, host.querySelector('#flib-ask-q').value);
    });
    this._drawNever(host);
    this._drawCats(host);
    this._drawList(host);
    return host;
  },

  // ---- Ask Vex what you don't know ----------------------------------------
  //
  // The search box can only find a feature you can already name, which is no
  // use for the thing you do not know exists — and that is most of it. This
  // takes the problem instead of the name: the same matching the guide uses
  // for questions (js/guide-templates.js for the ones people really ask,
  // js/vex-guide.js for the rest), drawn as the Library's own cards so the
  // answer is the entry itself rather than a paraphrase of it.

  // -> { headline, steps, items }  — items are catalogue entries.
  answer(question) {
    const q = String(question || '').trim();
    if (!q) return null;
    const out = { headline: '', steps: [], items: [] };
    if (typeof GuideTemplates !== 'undefined' && GuideTemplates.match(q)) {
      const ready = GuideTemplates.answer(q);
      out.headline = ready.headline;
      out.steps = ready.steps || [];
      if (ready.entry) out.items.push(ready.entry);
    }
    if (typeof VexGuide !== 'undefined') {
      for (const hit of VexGuide.find(q, 6)) {
        if (!out.items.some(f => f.id === hit.entry.id)) out.items.push(hit.entry);
      }
    }
    if (!out.headline) {
      out.headline = out.items.length
        ? 'These are the ones for that.'
        : 'Nothing here matches those words — which may mean Vex cannot do it, or that it calls it something else entirely. The AI has the whole feature list and can be asked in any words at all.';
    }
    return out;
  },

  answerInto(host, question) {
    const out = host.querySelector('#flib-ask-out');
    if (!out) return null;
    const a = this.answer(question);
    if (!a) { out.innerHTML = ''; return null; }
    out.innerHTML = `
      <div class="flib-ask-answer">
        <div class="flib-ask-headline">${this._esc(a.headline)}</div>
        ${a.steps.length ? `<ol class="flib-ask-steps">${a.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}</ol>` : ''}
        ${a.items.map(f => this._cardHtml(this.card(f))).join('')}
        <div class="flib-ask-more">
          <button class="flib-btn" data-ask-ai type="button">${a.items.length ? 'Ask the AI as well' : 'Ask the AI'}</button>
          <span>The AI is given Vex’s own feature list, so it answers about what is really here.</span>
        </div>
      </div>`;
    this._wireCards(out);
    out.querySelector('[data-ask-ai]').addEventListener('click', () => this.askAI(question));
    return a;
  },

  // For when the words match nothing: the assistant, which is handed the
  // catalogue for questions about Vex (js/ai-panel.js _vexKnowledge).
  askAI(question) {
    const q = String(question || '').trim();
    if (!q) return;
    if (typeof AIPanel === 'undefined' || typeof AIPanel.open !== 'function') { window.showToast?.('The AI panel is not available in this window', 'error'); return; }
    AIPanel.open();
    if (typeof AIPanel.sendMessage === 'function') AIPanel.sendMessage('chat', { message: 'In Vex, what can I use for this: ' + q });
  },

  // The other half of "what you don't know": things you have never run. The
  // catalogue reads the command bar's own usage counts, so this is not a guess
  // about what you might like — it is what you have not touched.
  SUGGESTIONS: 3,

  suggestions(n = this.SUGGESTIONS) {
    if (typeof VexFeatures === 'undefined' || typeof VexFeatures.unused !== 'function') return [];
    const never = VexFeatures.unused().filter(f => f.cmd || f.panel);
    // Shuffled per day: not the same three forever, and not reshuffling under
    // the cursor either.
    const day = Math.floor(Date.now() / 86400000);
    return never
      .map((f, i) => ({ f, k: (i * 9301 + day * 49297) % 233280 }))
      .sort((a, b) => a.k - b.k)
      .slice(0, n)
      .map(x => x.f);
  },

  _drawNever(host) {
    const el = host.querySelector('#flib-never');
    if (!el) return;
    const picks = this.suggestions();
    if (!picks.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="flib-never-label">Never tried:</span>' + picks.map(f =>
      `<button class="flib-never-one" data-jump="${this._esc(f.id)}" title="${this._esc(f.what)}">${this._esc(VexFeatures.nameOf(f))}</button>`).join('');
    el.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
      const out = host.querySelector('#flib-ask-out');
      const f = VexFeatures.get(b.dataset.jump);
      if (!out || !f) return;
      out.innerHTML = `<div class="flib-ask-answer">${this._cardHtml(this.card(f))}</div>`;
      this._wireCards(out);
      out.querySelector('.flib-card').classList.add('open');
    }));
  },

  _drawCats(host) {
    const nav = host.querySelector('#flib-cats');
    if (!nav) return;
    const all = (typeof VexFeatures !== 'undefined' && VexFeatures.ITEMS) || [];
    const chip = (id, label, n) => `<button class="flib-chip${this._cat === id ? ' on' : ''}" data-cat="${this._esc(id == null ? '' : id)}">${this._esc(label)} <span>${n}</span></button>`;
    nav.innerHTML = chip(null, 'Everything', all.length)
      + (VexFeatures.CATS || []).map(c => chip(c.id, c.name, VexFeatures.byCat(c.id).length)).join('');
    nav.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
      this._cat = b.dataset.cat || null;
      this._drawCats(host);
      this._drawList(host);
    }));
  },

  _drawList(host) {
    const list = host.querySelector('#flib-list');
    if (!list) return;
    const items = this._items();
    if (!items.length) {
      list.innerHTML = `<div class="flib-empty">Nothing matches “${this._esc(this._query)}”. Try what you would call it — “stop videos playing”, “two accounts”.</div>`;
      return;
    }
    // A search is a flat list — you already said what you wanted. Everything
    // else is filed: by area, and inside an area on shelves (the catalogue's
    // own GROUPS), because fifty-four things under one heading is not an
    // answer to "where is it".
    if (this._query) {
      list.innerHTML = items.map(f => this._cardHtml(this.card(f))).join('');
    } else {
      const cats = (VexFeatures.CATS || []).filter(c => !this._cat || c.id === this._cat);
      list.innerHTML = cats.map(cat => {
        const shelves = VexFeatures.groupsFor(cat.id).filter(g => g.items.length);
        if (!shelves.length) return '';
        return `
          <div class="flib-group">
            <div class="flib-group-name">${this._esc(cat.name)}</div>
            <div class="flib-group-blurb">${this._esc(cat.blurb)}</div>
          </div>
          ${shelves.map(shelf => `
            ${shelf.name ? `<div class="flib-shelf">${this._esc(shelf.name)} <span>${shelf.items.length}</span></div>` : ''}
            ${shelf.items.map(f => this._cardHtml(this.card(f))).join('')}`).join('')}`;
      }).join('');
    }
    this._wireCards(list);
  },

  // Cards behave the same wherever they are drawn: in the list, or in an answer.
  _wireCards(root) {
    root.querySelectorAll('[data-open-card]').forEach(b => b.addEventListener('click', () => {
      b.closest('.flib-card').classList.toggle('open');
    }));
    root.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.run(b.dataset.run); }));
    root.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.show(b.dataset.show); }));
    root.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.ask(b.dataset.ask); }));
  },

  _cardHtml(c) {
    return `
      <div class="flib-card" data-id="${this._esc(c.id)}">
        <button class="flib-head" data-open-card type="button">
          <span class="flib-name">${this._esc(c.name)}</span>
          ${c.keys ? `<kbd>${this._esc(c.keys)}</kbd>` : ''}
          <span class="flib-chevron">›</span>
        </button>
        <div class="flib-what">${this._esc(c.what)}</div>
        <div class="flib-more">
          ${c.detail ? `<p class="flib-detail">${this._esc(c.detail)}</p>` : ''}
          ${c.where.length ? `<div class="flib-sub">Where it lives</div><ul>${c.where.map(w => `<li>${this._esc(w)}</li>`).join('')}</ul>` : ''}
          ${c.steps.length ? `<div class="flib-sub">What to do</div><ol>${c.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}</ol>` : ''}
          ${c.near.length ? `<div class="flib-near">Near it: ${c.near.map(n => this._esc(n)).join(' · ')}</div>` : ''}
          <div class="flib-acts">
            ${c.canOpen ? `<button data-run="${this._esc(c.id)}" class="flib-btn primary" type="button">Open it</button>` : ''}
            ${c.canShow ? `<button data-show="${this._esc(c.id)}" class="flib-btn" type="button">Show me</button>` : ''}
            <button data-ask="${this._esc(c.id)}" class="flib-btn" type="button">Ask Vex about this</button>
          </div>
        </div>
      </div>`;
  },

  // ---- The three buttons ---------------------------------------------------

  run(id) {
    const f = VexFeatures.get(id);
    if (!f) return;
    try { VexGuide.run(f); }
    catch (err) { window.showToast?.((err && err.message) || 'That would not start', 'error'); }
  },

  show(id) {
    const f = VexFeatures.get(id);
    if (!f) return;
    // Pointing at a control means getting out of its way first.
    try { SidebarManager.hideActivePanel?.(); } catch { /* no sidebar in this window */ }
    setTimeout(() => { try { VexGuide.show(f); } catch (err) { window.showToast?.((err && err.message) || 'There is nothing to point at', 'info'); } }, 120);
  },

  // The link to the assistant: it is asked about THIS feature, with the
  // catalogue's own words as the facts, so it explains what Vex really has
  // rather than what a model remembers about browsers in general.
  question(id) {
    const f = VexFeatures.get(id);
    if (!f) return '';
    const c = this.card(f);
    return [
      'Explain this Vex feature to me in plain English: how it works, when it is worth using, and anything to watch out for.',
      '',
      'Feature: ' + c.name,
      'What it is for: ' + c.what,
      c.detail ? 'More: ' + c.detail : '',
      c.keys ? 'Shortcut: ' + c.keys : '',
      c.where.length ? 'Where it lives: ' + c.where.join('; ') : '',
      c.steps.length ? 'Steps: ' + c.steps.join(' ') : '',
      '',
      'Use only these facts about Vex. If something is not here, say you do not know rather than guessing.',
    ].filter(Boolean).join('\n');
  },

  ask(id) {
    const q = this.question(id);
    if (!q) return;
    if (typeof AIPanel === 'undefined' || typeof AIPanel.open !== 'function') { window.showToast?.('The AI panel is not available in this window', 'error'); return; }
    AIPanel.open();
    if (typeof AIPanel.sendMessage === 'function') AIPanel.sendMessage(q);
    else if (typeof AIPanel.ask === 'function') AIPanel.ask(q);
  },

  // Open the Library on one feature — what the guide links to when an answer
  // deserves the whole entry rather than three lines.
  openAt(id) {
    const f = (typeof VexFeatures !== 'undefined') ? VexFeatures.get(id) : null;
    this._query = f ? VexFeatures.nameOf(f) : '';
    this._cat = null;
    if (typeof SidebarManager !== 'undefined') SidebarManager.openPanel('library');
    if (typeof ReadLater !== 'undefined') ReadLater.showTab?.('features');
    setTimeout(() => {
      const card = document.querySelector(`.flib-card[data-id="${CSS.escape(String(id))}"]`);
      if (card) { card.classList.add('open'); card.scrollIntoView({ block: 'center' }); }
    }, 150);
  },
};

if (typeof window !== 'undefined') window.FeatureLibrary = FeatureLibrary;
if (typeof module !== 'undefined' && module.exports) module.exports = { FeatureLibrary };
