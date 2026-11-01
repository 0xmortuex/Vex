// === Help and FAQ: short answers, with a button to the right setting ====================================
//
// The questions people ask most, in plain words (js/faq-data.js, loaded when this opens), grouped by topic and
// searchable. Every answer ends with where the thing lives and a button that goes there: a Settings section
// (SettingsUI.openSection) or a Ctrl+K command (the command bar opens with its name typed in, so one more Enter
// does it; nothing is switched by a button here). Turkish comes from js/i18n-ui.js, looked up per string, so the
// search reads the language on screen.
//
// Opened from Ctrl+K "Help and FAQ", from Settings (the Help and FAQ section, next to About) and from the last
// step of the setup. From the setup the buttons are left out (Settings is behind the wizard then) and the
// "where to find it" line stays, so nothing in it can be pressed by mistake.
//
//   VexFaq.rank(items, query)   pure: items whose every word matches, best first (title beats body)
//   VexFaq.open({ id, query, fromSetup })   the screen; id expands one question
const VexFaq = {
  // Words that carry no meaning in a question ("how do I change the language"): left out unless they are all there is.
  STOP: new Set(['a', 'an', 'the', 'i', 'my', 'me', 'we', 'do', 'does', 'did', 'how', 'what', 'is', 'are', 'can', 'could', 'should',
    'would', 'will', 'to', 'of', 'in', 'on', 'for', 'it', 'its', 'and', 'or', 'with', 'when', 'why', 'where', 'which', 'you', 'your',
    'vex', 'be', 'if', 'so', 'there', 'this', 'that', 'get', 'nasil', 'nedir', 'ne', 'mi', 'mu', 'bir', 've', 'ile', 'icin', 'bu', 'su']),

  // Lower case, no accents, Turkish dotted/dotless i the same, curly quotes plain.
  fold(s) {
    return String(s == null ? '' : s).replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, '\'');
  },

  words(query) {
    const all = this.fold(query).split(/[^a-z0-9%@+._-]+/).map(w => w.replace(/^[._-]+|[._-]+$/g, '')).filter(Boolean);
    const kept = all.filter(w => !this.STOP.has(w));
    return kept.length ? kept : all;
  },

  _stem(w) { return w.length > 4 ? w.replace(/(ing|es|ed|s)$/, '') : w; },
  _has(text, w) { return text.includes(w) || (w.length > 4 && text.includes(this._stem(w))); },

  // items: [{ q, a, kw, cat }] already in the language on screen. Every typed word has to be somewhere; a word in the
  // question counts most (more at the start of a word), then the hidden keywords, the topic name, and last the answer.
  // Equal scores keep the order of the list. An empty search keeps everything, in order.
  rank(items, query) {
    const ws = this.words(query);
    if (!ws.length) return items.slice();
    const scored = [];
    items.forEach((item, i) => {
      const fq = this.fold(item.q), fk = this.fold(item.kw), fa = this.fold(item.a), fc = this.fold(item.cat);
      let score = 0;
      for (const w of ws) {
        let s = 0;
        if (this._has(' ' + fq, ' ' + w)) s = 14;
        else if (this._has(fq, w)) s = 9;
        else if (this._has(fk, w)) s = 6;
        else if (this._has(fc, w)) s = 3;
        else if (this._has(fa, w)) s = 2;
        if (!s) return;
        score += s;
      }
      if (ws.length > 1 && fq.includes(ws.join(' '))) score += 10;
      scored.push({ item, score, i });
    });
    return scored.sort((x, y) => y.score - x.score || x.i - y.i).map(x => x.item);
  },

  _L(s) {
    const hit = typeof VexI18nUI !== 'undefined' && typeof VexI18nUI.lookup === 'function' ? VexI18nUI.lookup(s) : null;
    return hit || s;
  },

  // The entries as they read in the language on screen.
  items() {
    if (typeof VexFaqData === 'undefined') throw new Error('The Help and FAQ questions are not loaded (js/faq-data.js)');
    const cats = new Map(VexFaqData.CATEGORIES.map(c => [c.id, this._L(c.name)]));
    return VexFaqData.ENTRIES.map(e => ({ entry: e, id: e.id, cat: cats.get(e.cat) || e.cat, catId: e.cat, q: this._L(e.q), a: this._L(e.a), kw: e.kw }));
  },

  // "Settings > General", or "Ctrl+K > Import from Another Browser", each word in the language on screen.
  where(entry) {
    const parts = entry.cmd ? ['Ctrl+K', entry.cmd] : (entry.path || []);
    return parts.map(p => this._L(p)).join(' > ');
  },

  go(entry) {
    if (entry.set) {
      if (typeof SettingsUI === 'undefined' || typeof SettingsUI.openSection !== 'function') throw new Error('Settings is not available in this window');
      SettingsUI.openSection(entry.set);
      return;
    }
    if (entry.cmd) {
      if (typeof CommandBar === 'undefined') throw new Error('The command bar is not available in this window');
      CommandBar.open();
      const input = document.getElementById('command-input');
      if (!input) throw new Error('The command bar has no search box');
      input.value = entry.cmd;
      CommandBar.search(entry.cmd);
      return;
    }
    throw new Error('The Help and FAQ entry "' + entry.id + '" has nowhere to go');
  },

  _icon(name, size) { return typeof VexIcons !== 'undefined' ? VexIcons.svg(name, { size }) : ''; },
  _el(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  },

  async open(opts = {}) {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('Settings sections are not loaded, so Help and FAQ cannot open');
    if (typeof VexFaqData === 'undefined') await VexLazy.ensure('js/faq-data.js');
    const L = (s) => this._L(s);
    const items = this.items();
    const fromSetup = !!opts.fromSetup;
    const dlg = VexSettingsGroups.dialog({ id: 'vex-faq', title: L('Help and FAQ'), sub: L('Quick answers to the questions people ask most. Type a few words, or pick a topic.') });
    dlg.overlay.classList.add('faq-ov');
    const body = dlg.body;
    let cat = '';
    let query = String(opts.query || '');
    const openIds = new Set(opts.id ? [opts.id] : []);

    const search = this._el('input', 'vexsr-input faq-search');
    search.type = 'search';
    search.placeholder = L('Search the questions');
    search.setAttribute('aria-label', L('Search the questions'));
    search.spellcheck = false;
    search.autocomplete = 'off';
    search.value = query;
    const chips = this._el('div', 'faq-chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', L('Topics'));
    const count = this._el('div', 'faq-count');
    count.setAttribute('role', 'status');
    count.setAttribute('aria-live', 'polite');
    const list = this._el('div', 'faq-list');
    const foot = this._el('div', 'faq-foot');
    body.append(search, chips, count, list, foot);

    const chip = (id, name) => {
      const b = this._el('button', 'faq-chip', name);
      b.type = 'button';
      b.dataset.cat = id;
      b.setAttribute('aria-pressed', String(cat === id));
      b.addEventListener('click', () => { cat = id; draw(); search.focus(); });
      return b;
    };

    const answer = (it, panelId) => {
      const box = this._el('div', 'faq-a');
      box.id = panelId;
      box.appendChild(this._el('p', 'faq-text', it.a));
      box.appendChild(this._el('p', 'faq-where', L('Where to find it') + ': ' + this.where(it.entry)));
      if (!fromSetup) {
        const label = it.entry.cmd ? L('Find it in Ctrl+K') : L('Take me to this setting');
        const btn = this._el('button', 'btn-primary faq-go', label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          try { this.go(it.entry); dlg.close(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        });
        box.appendChild(btn);
      }
      return box;
    };

    const draw = () => {
      chips.textContent = '';
      chips.appendChild(chip('', L('All topics')));
      for (const c of VexFaqData.CATEGORIES) chips.appendChild(chip(c.id, L(c.name)));
      for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.cat === cat));
      const pool = cat ? items.filter(it => it.catId === cat) : items;
      const hits = this.rank(pool, query);
      const solo = hits.length === 1 && this.words(query).length > 0;
      count.textContent = hits.length + ' ' + L(hits.length === 1 ? 'question' : 'questions');
      list.textContent = '';
      if (!hits.length) list.appendChild(this._el('p', 'faq-empty', L('No question matches that. Try fewer or different words, or ask Vex with Ctrl+K.')));
      for (const it of hits) {
        const row = this._el('div', 'faq-item');
        const panelId = 'faq-a-' + it.id;
        const q = this._el('button', 'faq-q');
        q.type = 'button';
        q.setAttribute('aria-controls', panelId);
        q.innerHTML = this._icon('chevron-right', 14);
        q.appendChild(this._el('span', 'faq-q-text', it.q));
        const panel = answer(it, panelId);
        const show = (on) => { q.setAttribute('aria-expanded', String(on)); panel.hidden = !on; row.classList.toggle('faq-open', on); };
        show(openIds.has(it.id) || solo);
        q.addEventListener('click', () => {
          const on = panel.hidden;
          if (on) openIds.add(it.id); else openIds.delete(it.id);
          show(on);
        });
        row.append(q, panel);
        list.appendChild(row);
      }
    };

    if (!fromSetup) {
      foot.appendChild(this._el('span', 'faq-foot-text', L('Did not find your answer?')));
      const ask = this._el('button', 'btn-secondary', L('Ask Vex with Ctrl+K'));
      ask.type = 'button';
      ask.addEventListener('click', () => {
        try { dlg.close(); if (typeof CommandBar === 'undefined') throw new Error('The command bar is not available in this window'); CommandBar.open(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      const report = this._el('button', 'btn-secondary', L('Report a Problem'));
      report.type = 'button';
      report.addEventListener('click', () => {
        try { this.go({ id: 'report-a-problem', cmd: 'Report a Problem' }); dlg.close(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
      foot.append(ask, report);
    }

    search.addEventListener('input', () => { query = search.value; draw(); });
    draw();
    if (opts.id) {
      const target = list.querySelector('#faq-a-' + opts.id);
      if (target) target.closest('.faq-item').scrollIntoView({ block: 'nearest' });
    }
    search.focus();
    return dlg;
  },

  // The Settings section: a line and one button.
  group(el) {
    el.appendChild(VexSettingsGroups.note(this._L('Short answers to the questions people ask most, with a button that opens the right setting.')));
    el.appendChild(VexSettingsGroups.button(this._L('Open Help and FAQ'), () => this.open().catch(err => window.showToast?.(err.message, 'error')), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexFaq = VexFaq;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'help-faq', title: 'Help and FAQ', keywords: 'help faq questions answers how do i guide support problem contact', before: 'about', build: (el) => VexFaq.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'help-faq', label: 'Help and FAQ', hint: 'Short answers to the questions people ask most, with a button that opens the right setting', keywords: 'faq help questions answers how do i guide support contact', icon: 'book-open', action: () => VexFaq.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexFaq };
