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
    if (f.setting) where.push((f.setting.section ? 'A section in Settings' : 'A control in Settings') + (f.setting.label ? ' — “' + f.setting.label + '”' : ''));
    if (f.cmd) where.push('In the command bar — Ctrl+K, then “' + ((VexFeatures.command(f) || {}).label || VexFeatures.nameOf(f)) + '”');
    if (f.sel && !f.panel && !f.cmd) where.push('A control in the window itself');
    if (f.manual && !where.length) where.push('Something you do with the mouse or the keyboard, not a command');
    const steps = (typeof VexGuide !== 'undefined') ? VexGuide.steps(f) : [];
    const actions = VexFeatures.actions(f);
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
        off: VexFeatures.offState(f),
      // The paragraph after the headline (js/feature-details.js); a feature
      // without one still shows the catalogue's sentence above.
      detail: f.detail || (typeof FeatureDetails !== 'undefined' ? FeatureDetails[f.id] : '') || '',
      where,
      steps,
      near,
      // What it reads, writes and sends, from its manifest (js/feature-sheet.js, T3-091). Empty when it has none.
      touches: (typeof VexFeatureSheet !== 'undefined') ? VexFeatureSheet.linesForCatalog(f.id) : [],
      // The buttons, in order (VexFeatures.actions): each one really opens
      // something. An entry with none of them gets `how` instead.
      actions,
      canOpen: actions.some(a => a.act !== 'show'),
      canShow: actions.some(a => a.act === 'show'),
      how: (typeof FeatureHow !== 'undefined' && FeatureHow[f.id]) || '',
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
    // The longer paragraphs (js/feature-details.js, ~46 KB) load the first
    // time the Library is opened, not at every start; the cards are drawn
    // again once they are here.
    if (typeof FeatureDetails === 'undefined') {
      this._details().then(() => { if (host.isConnected) this._drawList(host); })
        .catch(err => window.showToast?.('The feature descriptions could not load: ' + ((err && err.message) || err), 'error'));
    }
    // "Did you know?" is a category of its own; its chip appears once its questions are here.
    if (typeof FeatureFaq === 'undefined') {
      this._faqData().then(() => { if (host.isConnected) { this._drawCats(host); this._drawList(host); } })
        .catch(err => window.showToast?.('The questions could not load: ' + ((err && err.message) || err), 'error'));
    }
    return host;
  },

  _details() {
    if (typeof FeatureDetails !== 'undefined') return Promise.resolve(true);
    if (!window.VexLazy) return Promise.reject(new Error('the lazy loader is missing'));
    return window.VexLazy.ensure('js/feature-details.js');
  },

  // The "Did you know?" questions (js/feature-faq.js): loaded like the long paragraphs, the first time the Library is
  // opened, and for the same reason.
  _faqData() {
    if (typeof FeatureFaq !== 'undefined') return Promise.resolve(true);
    if (!window.VexLazy) return Promise.reject(new Error('the lazy loader is missing'));
    return window.VexLazy.ensure('js/feature-faq.js');
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
    // "Did you know?" stands beside Everything, ahead of the areas: it is the way in for someone who does not yet know
    // what to look for (js/feature-faq.js).
    const faqChip = (typeof FeatureFaq === 'undefined') ? '' : `<button class="flib-chip flib-chip-faq${this._cat === FeatureFaq.ID ? ' on' : ''}" data-cat="${FeatureFaq.ID}" type="button">${typeof VexIcons !== 'undefined' ? VexIcons.svg('bulb', { size: 12 }) : ''}${this._esc(FeatureFaq.NAME)} <span>${FeatureFaq.ENTRIES.length}</span></button>`;
    nav.innerHTML = chip(null, 'Everything', all.length)
      + faqChip
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
    // The questions: their own category, and also the first thing a search finds.
    if (typeof FeatureFaq !== 'undefined' && this._cat === FeatureFaq.ID) {
      const found = this.faqEntries(this._query);
      list.innerHTML = `
        <div class="flib-group">
          <div class="flib-group-name" role="heading" aria-level="2">${this._esc(FeatureFaq.NAME)}</div>
          <div class="flib-group-blurb">${this._esc(FeatureFaq.BLURB)}</div>
        </div>
        ${found.length ? found.map(e => this._faqHtml(this.faqCard(e))).join('') : `<div class="flib-empty">No question here matches that. Try other words, or ask Vex above.</div>`}`;
      this._wireFaq(list);
      return;
    }
    const faqHits = (this._query && !this._cat && typeof FeatureFaq !== 'undefined') ? this.faqEntries(this._query) : [];
    const faqBlock = faqHits.length
      ? `<div class="flib-group"><div class="flib-group-name" role="heading" aria-level="2">${this._esc(FeatureFaq.NAME)}</div></div>${faqHits.map(e => this._faqHtml(this.faqCard(e))).join('')}`
      : '';
    const items = this._items();
    if (!items.length && faqHits.length) {
      list.innerHTML = faqBlock;
      this._wireFaq(list);
      return;
    }
    if (!items.length) {
      list.innerHTML = `<div class="flib-empty">Nothing matches “${this._esc(this._query)}”. Try what you would call it — “stop videos playing”, “two accounts”.</div>`;
      return;
    }
    // A search is a flat list — you already said what you wanted. Everything
    // else is filed: by area, and inside an area on shelves (the catalogue's
    // own GROUPS), because fifty-four things under one heading is not an
    // answer to "where is it".
    if (this._query) {
      list.innerHTML = faqBlock + (faqHits.length ? `<div class="flib-group"><div class="flib-group-name" role="heading" aria-level="2">Everything Vex does</div></div>` : '') + items.map(f => this._cardHtml(this.card(f))).join('');
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
    this._wireFaq(list);
  },

  // ---- Did you know? -------------------------------------------------------
  //
  // A list of questions about features nobody thinks to ask for (js/feature-faq.js). Each is an FAQ item: a button
  // that opens an answer (aria-expanded, aria-controls), what the feature is, how to find it again, and Try it —
  // which is the Library's own Open button (open()) for that catalogue entry, so a switched-off feature is
  // introduced first and a button that cannot work says so instead of doing nothing.

  // Case, Turkish dotted/dotless i and accents folded away, so "Sesli okuma" finds "sesli okuma" and "isik" finds "ışık".
  _fold(s) {
    return String(s == null ? '' : s)
      .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  },

  // The Turkish for an English question or answer, or '' — the same table the rest of the window is translated from.
  _tr(en) {
    const t = (typeof VexI18nUI !== 'undefined' && VexI18nUI.TABLE && VexI18nUI.TABLE.tr) || null;
    return (t && t[en]) || '';
  },

  // The questions that match what was typed. Every word has to be found, in the English question, answer and
  // phrases or in the Turkish question and answer (whichever language is being typed). A word of five letters or more
  // also matches by its stem, because Turkish adds endings ("okuma" is found in "okuyabilir").
  faqEntries(query) {
    if (typeof FeatureFaq === 'undefined') return [];
    const all = FeatureFaq.ENTRIES;
    const words = this._fold(query).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !(VexFeatures.FILLER && VexFeatures.FILLER.has(w)));
    if (!words.length) return String(query || '').trim() ? [] : all.slice();
    return all.filter((e) => {
      const hay = this._fold([e.q, e.a, e.k, this._tr(e.q), this._tr(e.a)].join(' '));
      return words.every(w => hay.includes(w) || (w.length >= 5 && hay.includes(w.slice(0, w.length - 2))));
    });
  },

  // What one question's item says, as data (so a test can read it without a DOM).
  faqCard(e) {
    const f = VexFeatures.get(e.f);
    const actions = f ? VexFeatures.actions(f).filter(a => a.act !== 'show') : [];
    const act = e.act ? actions.find(a => a.act === e.act) : actions[0];
    const cmd = f ? VexFeatures.command(f) : null;
    return {
      id: e.id, q: e.q, a: e.a,
      feature: f, act: act ? act.act : '',
      // Where to find it later: the Ctrl+K words (read from the live command, so a renamed command is not out of date
      // here), else the Settings path written beside the entry.
      label: e.path ? '' : ((cmd && cmd.label) || (f && f.openLabel) || ''),
      path: e.path || '',
      // No record of running it: the command bar's usage counts and the panels' last-opened times, the same record
      // Discover reads. A feature that is only a Settings switch has no such record, so it carries no marker.
      untried: !!(f && (f.cmd || f.panel) && !VexFeatures.used(f)),
    };
  },

  _faqHtml(c) {
    const chev = typeof VexIcons !== 'undefined' ? VexIcons.svg('chevron-right', { size: 14 }) : '';
    const find = c.path
      ? `<div class="flib-faq-find"><span class="flib-faq-lbl">Find it again:</span> <b>${this._esc(c.path)}</b></div>`
      : c.label
        ? `<div class="flib-faq-find"><span class="flib-faq-lbl">Find it again:</span> <kbd>Ctrl+K</kbd> <span>then type</span> <b>${this._esc(c.label)}</b></div>`
        : '';
    return `
      <div class="flib-faq" data-faq="${this._esc(c.id)}">
        <div class="flib-faq-q" role="heading" aria-level="3">
          <button type="button" class="flib-faq-head" id="flib-faq-h-${this._esc(c.id)}" aria-expanded="false" aria-controls="flib-faq-a-${this._esc(c.id)}">
            <span class="flib-name">${this._esc(c.q)}</span>
            ${c.untried ? `<span class="flib-faq-new" title="Vex has no record of you running this. It remembers only your 60 most recent commands.">Not tried yet</span>` : ''}
            <span class="flib-chevron" aria-hidden="true">${chev}</span>
          </button>
        </div>
        <div class="flib-faq-a" id="flib-faq-a-${this._esc(c.id)}" role="region" aria-labelledby="flib-faq-h-${this._esc(c.id)}" hidden>
          <p class="flib-detail">${this._esc(c.a)}</p>
          ${find}
          <div class="flib-acts">
            <button type="button" class="flib-btn primary" data-faq-try="${this._esc(c.id)}"${c.act ? '' : ' disabled'}>Try it</button>
          </div>
        </div>
      </div>`;
  },

  _wireFaq(root) {
    root.querySelectorAll('.flib-faq-head').forEach(b => b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      const region = document.getElementById(b.getAttribute('aria-controls'));
      if (region) region.hidden = !open;
      b.closest('.flib-faq').classList.toggle('open', open);
    }));
    root.querySelectorAll('[data-faq-try]').forEach(b => b.addEventListener('click', () => this.tryFaq(b.dataset.faqTry)));
  },

  // Try it: the same call as the Open button of the feature's own card.
  tryFaq(id) {
    const e = typeof FeatureFaq !== 'undefined' ? FeatureFaq.ENTRIES.find(x => x.id === id) : null;
    const c = e ? this.faqCard(e) : null;
    if (!c || !c.feature || !c.act) { window.showToast?.('That cannot be opened from here', 'error'); return undefined; }
    return this.open(c.feature.id, c.act);
  },

  // Cards behave the same wherever they are drawn: in the list, or in an answer.
  _wireCards(root) {
    root.querySelectorAll('[data-open-card]').forEach(b => b.addEventListener('click', () => {
      b.closest('.flib-card').classList.toggle('open');
    }));
    root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.open(b.dataset.id, b.dataset.act); }));
    root.querySelectorAll('[data-ask]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); this.ask(b.dataset.ask); }));
    root.querySelectorAll('[data-feature-enable]').forEach(b => b.addEventListener('click', () => this.enableFeature(b.dataset.featureEnable, b)));
  },

  async enableFeature(id, button) {
    if (button) button.disabled = true;
    try {
      const f = VexFeatures.get(id), off = VexFeatures.offState(f);
      if (off) {
        // The same introduction as everywhere else; the first way to open it runs once after it is on.
        const first = VexFeatures.actions(f).find(a => a.act === 'panel' || a.act === 'command');
        await VexActivation.offer({ entry: f, requested: first ? VexFeatures.nameOf(f) : '', run: first ? () => this.open(id, first.act, { activated: true }) : null });
      }
      const card = button?.closest('.flib-card');
      if (card) {
        const holder = document.createElement('div'); holder.innerHTML = this._cardHtml(this.card(f));
        const replacement = holder.firstElementChild;
        replacement.classList.toggle('open', card.classList.contains('open'));
        card.replaceWith(replacement); this._wireCards(replacement);
      }
    } catch (err) { window.showToast?.('Could not turn this feature on: ' + err.message, 'error'); }
    finally { if (button?.isConnected) button.disabled = false; }
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
        ${c.off ? `<div class="flib-state">${this._esc(c.off.reason)} <button type="button" class="flib-btn" data-feature-enable="${this._esc(c.id)}">Turn on</button></div>` : ''}
        <div class="flib-more">
          ${c.detail ? `<p class="flib-detail">${this._esc(c.detail)}</p>` : ''}
          ${c.where.length ? `<div class="flib-sub">Where it lives</div><ul>${c.where.map(w => `<li>${this._esc(w)}</li>`).join('')}</ul>` : ''}
          ${c.steps.length ? `<div class="flib-sub">What to do</div><ol>${c.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}</ol>` : ''}
          ${c.how ? `<div class="flib-sub">How it works</div><p class="flib-how">${this._esc(c.how)}</p>` : ''}
          ${c.touches.length ? `<div class="flib-sub">What it touches</div><ul>${c.touches.map(t => `<li>${this._esc(t)}</li>`).join('')}</ul>` : ''}
          ${c.near.length ? `<div class="flib-near">Near it: ${c.near.map(n => this._esc(n)).join(' · ')}</div>` : ''}
          <div class="flib-acts">
            ${c.actions.map((a, i) => `<button data-act="${this._esc(a.act)}" data-id="${this._esc(c.id)}" class="flib-btn${i === 0 ? ' primary' : ''}" type="button">${this._esc(a.label)}</button>`).join('')}
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

  // One button: `act` is one of VexFeatures.actions(). Each does exactly what
  // its label says and says so when it cannot — a button must never do nothing.
  open(id, act, opts) {
    const f = VexFeatures.get(id);
    try {
      if (!f) throw new Error('That feature is not in the list any more');
      // Settings can always be opened. Anything else on a switched-off feature is introduced first and runs
      // once if the person turns it on (VexActivation in js/feature-catalog.js).
      if (act !== 'settings' && !(opts && opts.activated) && typeof VexActivation !== 'undefined' && VexFeatures.offState(f)) {
        return VexActivation.offer({ entry: f, requested: VexFeatures.nameOf(f), run: () => this.open(id, act, { activated: true }) })
          .catch(err => window.showToast?.((err && err.message) || 'That would not open', 'error'));
      }
      if (act === 'panel') {
        if (typeof SidebarManager === 'undefined') throw new Error('The sidebar is not available in this window');
        SidebarManager.openPanel(f.panel);
      } else if (act === 'command') {
        const c = VexFeatures.command(f);
        if (!c) throw new Error('The command for this is not available in this window');
        const result = typeof CommandBar._execute === 'function' ? CommandBar._execute(c) : c.action();
        return Promise.resolve(result).catch(err => window.showToast?.((err && err.message) || 'That would not start', 'error'));
      } else if (act === 'settings') {
        if (typeof SettingsUI === 'undefined') throw new Error('Settings is not available in this window');
        SettingsUI.openSection(f.setting.id || f.setting.section);
      } else if (act === 'show') {
        this.show(id);
      } else {
        throw new Error('Unknown action: ' + act);
      }
    } catch (err) { window.showToast?.((err && err.message) || 'That would not open', 'error'); }
    return undefined;
  },

  show(id) {
    const f = VexFeatures.get(id);
    if (!f) return;
    // Pointing at a control means getting out of its way first.
    try { SidebarManager.hideActivePanel?.(); } catch { /* no sidebar in this window */ }
    // The AI box is only on screen while the AI panel is open.
    if (/^#ai-/.test(f.sel || '') && typeof AIPanel !== 'undefined' && AIPanel.open && !(AIPanel.isOpen && AIPanel.isOpen())) AIPanel.open();
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

  async ask(id) {
    // The question carries the feature's longer paragraph, so have it first.
    try { await this._details(); }
    catch (err) { window.showToast?.('The feature descriptions could not load: ' + ((err && err.message) || err), 'error'); return; }
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
