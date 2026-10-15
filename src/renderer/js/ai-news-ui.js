// === AI news: the parts you see =============================================
//
// js/ai-news.js is the engine (what is fetched, kept and told); this file is
// what you touch:
//
//   * the toolbar badge: the number of stories that matched what you follow
//     and that you have not looked at; shown only while there are some
//   * the panel: stories by day, one line per story even when several sources
//     reported it, with Open, Mute source, Mute topic and "Why was I notified?"
//   * Settings › AI news: the master switch (off until you turn it on), the
//     channels, what to follow and mute, quiet hours, caps and the digest
//
// Dialogs are Vex's own (no native confirm / prompt) and icons are VexIcons.
// Every word that came from the feed is put on the page with textContent.
const AINewsUI = {
  _t(s) { try { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(s)) || s; } catch { return s; } },

  // --- the toolbar badge ---------------------------------------------------
  init() {
    this._btn = document.getElementById('btn-ai-news');
    if (this._btn && !this._btn._ainWired) {
      this._btn._ainWired = true;
      this._btn.innerHTML = (window.VexIcons ? VexIcons.svg('newspaper', { size: 16 }) : '') + '<span class="ain-badge" aria-hidden="true"></span>';
      this._btn.addEventListener('click', () => this.openPanel());
    }
    document.addEventListener('vex:ai-news', () => { this.refreshBadge(); if (document.getElementById('ain-panel')) this._drawList(); });
    this._injectStyle();
    this.refreshBadge();
  },

  refreshBadge() {
    const b = this._btn || document.getElementById('btn-ai-news');
    if (!b) return 0;
    const on = typeof AINews !== 'undefined' && AINews.prefs().enabled && AINews.prefs().channels.badge;
    const n = on ? AINews.unseenCount() : 0;
    b.hidden = n === 0;
    const badge = b.querySelector('.ain-badge');
    if (badge) badge.textContent = n > 9 ? '9+' : String(n);
    const label = n === 1 ? '1 new AI story' : n + ' new AI stories';
    b.title = label + ' — open AI news';
    b.setAttribute('aria-label', label);
    return n;
  },

  // --- the panel -----------------------------------------------------------
  _filters: { unreadOnly: false, topic: '', source: '', q: '' },

  _dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((today - day) / 86400000);
    if (diff === 0) return this._t('Today');
    if (diff === 1) return this._t('Yesterday');
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  },

  // Stories grouped by day, then by cluster (one story reported by several
  // sources is one line): [{ label, groups: [{ main, others[] }] }]
  group(items) {
    const days = new Map();
    for (const it of items) {
      const ts = it.publishedAt || it.firstSeenAt;
      const d = new Date(ts); d.setHours(0, 0, 0, 0);
      const key = d.getTime();
      if (!days.has(key)) days.set(key, { key, ts, clusters: new Map() });
      const day = days.get(key);
      const c = it.cluster || it.id;
      if (!day.clusters.has(c)) day.clusters.set(c, []);
      day.clusters.get(c).push(it);
    }
    return [...days.values()].sort((a, b) => b.key - a.key).map(day => ({
      key: day.key,
      ts: day.ts,
      groups: [...day.clusters.values()].map(list => {
        const sorted = list.slice().sort((a, b) => (b.importance - a.importance) || ((b.publishedAt || 0) - (a.publishedAt || 0)));
        return { main: sorted[0], others: sorted.slice(1) };
      }),
    }));
  },

  filterItems(items, f) {
    const q = String(f.q || '').trim().toLowerCase();
    return items.filter(it => {
      if (f.unreadOnly && it.read) return false;
      if (f.topic && !AINews.topicsOf(it).includes(f.topic)) return false;
      if (f.source && it.source !== f.source) return false;
      if (q && !(it.title + ' ' + it.summary + ' ' + it.source).toLowerCase().includes(q)) return false;
      return true;
    });
  },

  openPanel() {
    if (typeof AINews === 'undefined') { window.showToast?.('AI news is not available in this build', 'error'); return null; }
    this._injectStyle();
    document.getElementById('ain-panel')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'ain-panel';
    wrap.className = 'ain-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'ain-title');
    const card = document.createElement('div');
    card.className = 'ain-card';
    const head = document.createElement('div');
    head.className = 'ain-head';
    const title = document.createElement('h2');
    title.id = 'ain-title'; title.className = 'ain-title'; title.textContent = this._t('AI news');
    const status = document.createElement('div');
    status.id = 'ain-status'; status.className = 'ain-muted';
    const actions = document.createElement('div');
    actions.className = 'ain-actions-top';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.addEventListener('click', fn); return b; };
    actions.append(
      mk(this._t('Check now'), 'ain-btn', async () => {
        try {
          const r = await AINews.poll({ force: true });
          if (r.status === 'off') window.showToast?.(this._t('AI news is off. Turn it on in Settings › AI news.'), 'info');
          else if (r.status === 'error') window.showToast?.(r.error, 'error');
        } catch (err) { window.showToast?.((err && err.message) || 'Could not check', 'error'); }
        this._drawList();
      }),
      mk(this._t('Mark all read'), 'ain-btn', () => { AINews.markAllRead(); this._drawList(); }),
      mk(this._t('Settings'), 'ain-btn', () => { close(); this.openSettings(); }),
      mk(this._t('Close'), 'ain-btn ain-primary', () => close()),
    );
    head.append(title, actions);

    const filters = document.createElement('div');
    filters.className = 'ain-filters';
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'ain-input'; search.placeholder = this._t('Search stories'); search.setAttribute('aria-label', this._t('Search stories'));
    search.value = this._filters.q;
    search.addEventListener('input', () => { this._filters.q = search.value; this._drawList(); });
    const topic = document.createElement('select');
    topic.className = 'ain-input'; topic.setAttribute('aria-label', this._t('Topic'));
    topic.append(new Option(this._t('All topics'), ''));
    for (const t of AINews.TOPICS) topic.append(new Option(this._t(t.label), t.id));
    topic.value = this._filters.topic;
    topic.addEventListener('change', () => { this._filters.topic = topic.value; this._drawList(); });
    const source = document.createElement('select');
    source.id = 'ain-source'; source.className = 'ain-input'; source.setAttribute('aria-label', this._t('Source'));
    source.addEventListener('change', () => { this._filters.source = source.value; this._drawList(); });
    const unreadLabel = document.createElement('label');
    unreadLabel.className = 'ain-check';
    const unread = document.createElement('input');
    unread.type = 'checkbox'; unread.checked = this._filters.unreadOnly;
    unread.addEventListener('change', () => { this._filters.unreadOnly = unread.checked; this._drawList(); });
    unreadLabel.append(unread, document.createTextNode(' ' + this._t('Unread only')));
    filters.append(search, topic, source, unreadLabel);

    const list = document.createElement('div');
    list.id = 'ain-list'; list.className = 'ain-list'; list.setAttribute('aria-live', 'polite');
    const langNote = document.createElement('div');
    langNote.id = 'ain-lang-note'; langNote.className = 'ain-muted'; langNote.hidden = true;
    card.append(head, status, langNote, filters, list);
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    const onKey = (e) => {
      if (!wrap.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape' || document.querySelector('.vex-dialog-overlay')) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    const prevFocus = document.activeElement;
    const close = () => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      try { prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); } catch { /* the opener is gone */ }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    this._drawList();
    // Looking at the panel is looking: the badge counts what you have not.
    AINews.markSeen();
    this.refreshBadge();
    search.focus({ preventScroll: true });
    return wrap;
  },

  _drawList() {
    const list = document.getElementById('ain-list');
    if (!list) return;
    const all = AINews.list();
    // The source filter lists the sources that are there.
    const sel = document.getElementById('ain-source');
    if (sel) {
      const sources = [...new Set(all.map(i => i.source))].sort();
      const want = ['', ...sources].join('|');
      if (sel.dataset.have !== want) {
        sel.textContent = '';
        sel.append(new Option(this._t('All sources'), ''));
        for (const s of sources) sel.append(new Option(s, s));
        sel.dataset.have = want;
      }
      if (this._filters.source && !sources.includes(this._filters.source)) this._filters.source = '';
      sel.value = this._filters.source;
    }
    const st = document.getElementById('ain-status');
    if (st) { const s = AINews.status(); st.textContent = s.text; st.dataset.level = s.level; }
    const note = document.getElementById('ain-lang-note');
    if (note) {
      const n = AINews.prefs().enabled ? (AINews.state().filteredLanguage || 0) : 0;
      note.hidden = n === 0;
      note.textContent = n === 0 ? '' : this._t('N stories in other languages were left out (Settings › AI News › Languages)').replace(/^N/, String(n));
    }
    list.textContent = '';
    const shown = this.filterItems(all, this._filters);
    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'ain-muted ain-empty';
      p.textContent = !AINews.prefs().enabled
        ? this._t('AI news is off. Turn it on in Settings › AI news and Vex will tell you about the stories you choose.')
        : (all.length ? this._t('No story matches these filters.') : this._t('Nothing yet. Vex checks the feed every few minutes; stories that were already there when you turned it on are not shown as new.'));
      list.appendChild(p);
      return;
    }
    for (const day of this.group(shown)) {
      const h = document.createElement('h3');
      h.className = 'ain-day'; h.textContent = this._dayLabel(day.ts);
      list.appendChild(h);
      for (const g of day.groups) list.appendChild(this._row(g));
    }
  },

  _row({ main, others }) {
    const row = document.createElement('article');
    row.className = 'ain-row' + (main.read ? '' : ' ain-unread');
    row.dataset.id = main.id;
    const top = document.createElement('div');
    top.className = 'ain-row-top';
    const title = document.createElement('a');
    title.className = 'ain-link';
    title.href = main.url;
    title.textContent = main.title;
    // A plain <a> click would navigate Vex's own window: open it as a tab.
    title.addEventListener('click', (e) => { e.preventDefault(); this._act(() => AINews.openItem(main.id)); });
    top.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'ain-muted';
    const when = main.publishedAt ? new Date(main.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    meta.textContent = [main.source, when, main.importance ? this._t('importance') + ' ' + main.importance : '', main.breaking ? this._t('breaking') : '', main.kind !== 'other' ? main.kind : ''].filter(Boolean).join(' · ');
    row.append(top, meta);
    if (main.summary) {
      const s = document.createElement('p');
      s.className = 'ain-summary'; s.textContent = main.summary;
      row.appendChild(s);
    }
    if (others.length) {
      const o = document.createElement('div');
      o.className = 'ain-muted';
      o.textContent = this._t('Also reported by') + ' ' + [...new Set(others.map(x => x.source))].join(', ');
      row.appendChild(o);
    }
    const btns = document.createElement('div');
    btns.className = 'ain-row-btns';
    const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ain-btn'; b.textContent = label; b.addEventListener('click', fn); btns.appendChild(b); return b; };
    add(this._t('Open'), () => this._act(() => AINews.openItem(main.id)));
    add(main.read ? this._t('Mark unread') : this._t('Mark read'), () => this._act(() => AINews.markRead(main.id, !main.read)));
    add(this._t('Mute source'), () => this._act(() => AINews.muteSource(main.source)));
    const topics = AINews.topicsOf(main).filter(t => AINews.TOPICS.some(x => x.id === t));
    if (topics.length) {
      const sel = document.createElement('select');
      sel.className = 'ain-input'; sel.setAttribute('aria-label', this._t('Mute a topic'));
      sel.append(new Option(this._t('Mute topic…'), ''));
      for (const t of topics) sel.append(new Option(AINews.TOPICS.find(x => x.id === t).label, t));
      sel.addEventListener('change', () => { const v = sel.value; sel.value = ''; if (v) this._act(() => { AINews.muteTopic(v); window.showToast?.(this._t('Muted topic') + ': ' + v); }); });
      btns.appendChild(sel);
    }
    add(this._t('Why was I notified?'), () => {
      Promise.resolve(window.vexAlert({ title: this._t('Why was I notified?'), message: AINews.whyText(main.id) })).catch(err => window.showToast?.(err.message, 'error'));
    });
    row.appendChild(btns);
    return row;
  },

  _act(fn) {
    try { fn(); } catch (err) { window.showToast?.((err && err.message) || String(err), 'error'); }
    this.refreshBadge();
    this._drawList();
  },

  openSettings() {
    if (typeof SettingsUI !== 'undefined' && SettingsUI.openSection) { SettingsUI.openSection('settings-ainews'); return; }
    window.showToast?.('Open Settings › AI news', 'info');
  },

  // --- Settings › AI news --------------------------------------------------
  renderSettings(container) {
    if (!container || typeof AINews === 'undefined') return;
    const t = (s) => this._t(s);
    const p = AINews.prefs();
    const st = AINews.state();
    container.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const save = (patch, quiet) => {
      try { AINews.setPrefs(patch); if (!quiet) window.showToast?.(t('AI news updated')); }
      catch (err) { fail(err); }
      this.refreshBadge();
    };
    const toggleRow = (label, checked, onChange, hint) => {
      const row = el('div', 'setting-toggle-row');
      const span = el('span', '', label);
      if (hint) { const h = el('span', 'ain-muted', ' · ' + hint); span.appendChild(h); }
      const lab = el('label', 'toggle');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = !!checked; input.setAttribute('aria-label', label);
      input.addEventListener('change', () => onChange(input.checked, input));
      lab.append(input, el('span', 'toggle-slider'));
      row.append(span, lab);
      return row;
    };
    const field = (label, control, id) => {
      const row = el('div', 'ain-field');
      const l = el('label', '', label);
      if (id) { l.htmlFor = id; control.id = id; }
      row.append(l, control);
      return row;
    };
    const sectionTitle = (s) => container.appendChild(el('div', 'ain-sub', s));

    container.appendChild(el('p', 'setting-info ain-muted', t('Vex can tell you about new AI stories: model releases, research, policy and more. It asks one web address you can see and change below, sends nothing about you, uses no AI to decide, and stays silent until you turn it on. Stories already there when you turn it on are not shown as new.')));

    container.appendChild(toggleRow(t('Tell me about AI news'), p.enabled, async (on, input) => {
      try {
        let first = null;
        if (on) first = await AINews.enable(); else AINews.disable();
        if (first && first.status === 'error') fail(new Error(first.error));
        else window.showToast?.(on ? t('AI news is on — the first look sets the baseline; nothing is announced from it') : t('AI news is off'));
      } catch (err) { input.checked = !on; fail(err); }
      this.refreshBadge();
      this.renderSettings(container);
    }));

    const status = el('div', 'ain-muted ain-status', AINews.status().text);
    status.id = 'ain-set-status';
    status.setAttribute('role', 'status');
    container.appendChild(status);

    const buttons = el('div', 'ain-row-btns');
    const btn = (label, fn) => { const b = el('button', 'btn-secondary', label); b.type = 'button'; b.addEventListener('click', fn); buttons.appendChild(b); return b; };
    btn(t('Send a test notification'), async () => {
      try {
        const r = await AINews.sendTest();
        window.showToast?.(r.windows ? t('Test sent — look for “AI News test” in your Windows notifications') : r.note);
      } catch (err) { fail(err); }
      status.textContent = AINews.status().text;
    });
    btn(t('Check now'), async () => {
      try {
        const r = await AINews.poll({ force: true });
        if (r.status === 'error') fail(new Error(r.error));
        else window.showToast?.(r.status === 'off' ? t('AI news is off') : t('Checked'));
      } catch (err) { fail(err); }
      status.textContent = AINews.status().text;
      this.refreshBadge();
    });
    btn(t('Open AI news'), () => this.openPanel());
    container.appendChild(buttons);

    // --- where from, how often
    sectionTitle(t('Where from'));
    const url = document.createElement('input');
    url.type = 'url'; url.className = 'set-input'; url.value = p.feedUrl; url.spellcheck = false; url.autocomplete = 'off';
    container.appendChild(field(t('News address'), url, 'ain-set-url'));
    const urlBtns = el('div', 'ain-row-btns');
    const saveUrl = el('button', 'btn-secondary', t('Save address')); saveUrl.type = 'button';
    saveUrl.addEventListener('click', () => { save({ feedUrl: url.value, }); });
    const resetUrl = el('button', 'btn-secondary', t('Use the default address')); resetUrl.type = 'button';
    resetUrl.addEventListener('click', () => { url.value = AINews.DEFAULT_FEED; save({ feedUrl: AINews.DEFAULT_FEED }); });
    urlBtns.append(saveUrl, resetUrl);
    container.appendChild(urlBtns);
    const every = document.createElement('select');
    every.className = 'set-input';
    for (const m of [10, 15, 30, 60, 180, 360]) every.append(new Option(m < 60 ? m + ' ' + t('minutes') : (m / 60) + ' ' + t('hours'), String(m)));
    every.value = String(p.pollMinutes);
    if (!every.value) every.append(new Option(p.pollMinutes + ' ' + t('minutes'), String(p.pollMinutes))), every.value = String(p.pollMinutes);
    every.addEventListener('change', () => save({ pollMinutes: Number(every.value) }));
    container.appendChild(field(t('Check every'), every, 'ain-set-every'));

    // --- how
    sectionTitle(t('How you are told'));
    for (const [id, label] of [['windows', 'Windows notification'], ['toast', 'Pop-up inside Vex'], ['badge', 'Toolbar badge']]) {
      container.appendChild(toggleRow(t(label), p.channels[id], (on) => save({ channels: { [id]: on } })));
    }
    container.appendChild(toggleRow(t('Play the notification sound'), p.sound, (on) => save({ sound: on })));
    const other = document.createElement('select');
    other.className = 'set-input';
    other.append(new Option(t('Only list them in the panel'), 'panel'), new Option(t('List them and count them on the badge'), 'badge'), new Option(t('Do not keep them'), 'drop'));
    other.value = p.defaultAction;
    other.addEventListener('change', () => save({ defaultAction: other.value }));
    container.appendChild(field(t('Stories nothing here matched'), other, 'ain-set-other'));
    const imp = document.createElement('input');
    imp.type = 'range'; imp.min = '0'; imp.max = '100'; imp.step = '5'; imp.value = String(p.minImportance);
    const impOut = el('span', 'ain-muted', String(p.minImportance));
    imp.addEventListener('input', () => { impOut.textContent = imp.value; });
    imp.addEventListener('change', () => save({ minImportance: Number(imp.value) }));
    const impRow = field(t('Minimum importance for a notification or pop-up'), imp, 'ain-set-importance');
    impRow.appendChild(impOut);
    container.appendChild(impRow);
    container.appendChild(toggleRow(t('Notify only for breaking stories'), p.breakingOnly, (on) => save({ breakingOnly: on })));

    // --- languages
    sectionTitle(t('Languages'));
    container.appendChild(el('p', 'ain-muted', t('Only stories in the languages ticked here are kept. Nothing is translated; a story that names no language counts as English.')));
    const langs = el('div', 'ain-chrow');
    const langOptions = AINews.LANGUAGES.map(l => ({ id: l.id, label: l.label })).concat({ id: 'other', label: 'Other languages' });
    for (const l of langOptions) {
      const lab = el('label', 'ain-check');
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.checked = p.languages.includes(l.id);
      inp.addEventListener('change', () => {
        const cur = AINews.prefs().languages.filter(x => x !== l.id);
        const next = inp.checked ? cur.concat(l.id) : cur;
        if (!next.length) { inp.checked = true; fail(new Error(t(AINews.LANGUAGE_REFUSED))); return; }
        save({ languages: next }, true);
        this.renderSettings(container);
      });
      lab.append(inp, document.createTextNode(' ' + t(l.label)));
      langs.appendChild(lab);
    }
    container.appendChild(langs);

    // --- what: follow and mute
    sectionTitle(t('What to follow and what to mute'));
    container.appendChild(el('p', 'ain-muted', t('A story you follow is announced on the channels above. A muted story is never kept. Following and muting the same thing is not possible; the last tick wins.')));
    const matrix = (heading, dim, entries) => {
      const box = el('fieldset', 'ain-matrix');
      box.appendChild(el('legend', '', heading));
      for (const e of entries) {
        const row = el('div', 'ain-mrow');
        row.appendChild(el('span', 'ain-mname', e.label));
        const mk = (kind, label, other) => {
          const lab = el('label', 'ain-check');
          const inp = document.createElement('input');
          inp.type = 'checkbox';
          const cur = AINews.prefs();
          inp.checked = AINews._has(cur[kind][dim], e.id);
          inp.setAttribute('aria-label', label + ': ' + e.label);
          inp.addEventListener('change', () => {
            const c = AINews.prefs();
            const keep = (list) => list.filter(x => AINews._norm(x) !== AINews._norm(e.id));
            const patch = { [kind]: { [dim]: inp.checked ? keep(c[kind][dim]).concat(e.id) : keep(c[kind][dim]) } };
            if (inp.checked) patch[other] = { [dim]: keep(c[other][dim]) };
            save(patch, true);
            this.renderSettings(container);
          });
          lab.append(inp, document.createTextNode(' ' + label));
          return lab;
        };
        row.append(mk('follow', t('Follow'), 'mute'), mk('mute', t('Mute'), 'follow'));
        box.appendChild(row);
      }
      return box;
    };
    container.appendChild(matrix(t('Topics'), 'topics', AINews.TOPICS.map(x => ({ id: x.id, label: t(x.label) }))));
    container.appendChild(matrix(t('Companies'), 'companies', AINews.COMPANIES.map(c => ({ id: c, label: c }))));
    const sources = [...new Set([...Object.values(st.items).map(i => i.source), ...p.follow.sources, ...p.mute.sources])].sort();
    if (sources.length) container.appendChild(matrix(t('Sources'), 'sources', sources.map(s => ({ id: s, label: s }))));
    else container.appendChild(el('p', 'ain-muted', t('Sources appear here once Vex has seen some stories.')));
    const csv = (heading, kind, dim, id) => {
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'set-input'; input.value = p[kind][dim].join(', '); input.spellcheck = false;
      input.addEventListener('change', () => save({ [kind]: { [dim]: input.value.split(',').map(x => x.trim()).filter(Boolean) } }));
      return field(heading, input, id);
    };
    container.appendChild(csv(t('Follow these words (comma-separated)'), 'follow', 'keywords', 'ain-set-follow-kw'));
    container.appendChild(csv(t('Follow these models (comma-separated)'), 'follow', 'models', 'ain-set-follow-models'));
    container.appendChild(csv(t('Mute these words (comma-separated)'), 'mute', 'keywords', 'ain-set-mute-kw'));
    container.appendChild(csv(t('Mute these models (comma-separated)'), 'mute', 'models', 'ain-set-mute-models'));
    const fc = el('div', 'ain-chrow');
    fc.appendChild(el('span', '', t('A story you follow is told by') + ':'));
    for (const c of ['windows', 'toast', 'badge', 'digest']) {
      const lab = el('label', 'ain-check');
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.checked = p.followChannels.includes(c);
      inp.addEventListener('change', () => {
        const cur = AINews.prefs().followChannels.filter(x => x !== c);
        save({ followChannels: inp.checked ? cur.concat(c) : cur }, true);
      });
      lab.append(inp, document.createTextNode(' ' + t(AINews.CHANNEL_LABELS[c])));
      fc.appendChild(lab);
    }
    container.appendChild(fc);

    // --- rules
    sectionTitle(t('Your rules'));
    container.appendChild(el('p', 'ain-muted', t('The first enabled rule that matches decides the channels and the sound. A rule that names several things needs all of them; several values of one thing need any.')));
    this._renderRules(container, p, save);

    // --- quiet hours, caps, digest
    sectionTitle(t('Quiet hours'));
    const q = p.quietHours;
    container.appendChild(toggleRow(t('No pop-ups or notifications during these hours'), q.enabled, (on) => save({ quietHours: { enabled: on } }),
      t('they wait and are told once afterwards')));
    const time = (id, value, onChange) => { const i = document.createElement('input'); i.type = 'time'; i.className = 'set-input'; i.value = value; i.addEventListener('change', () => { if (i.value) onChange(i.value); }); i.id = id; return i; };
    const qRow = el('div', 'ain-field');
    qRow.append(el('label', '', t('From')), time('ain-set-from', q.from, (v) => save({ quietHours: { from: v } })), el('label', '', t('to')), time('ain-set-to', q.to, (v) => save({ quietHours: { to: v } })));
    container.appendChild(qRow);
    container.appendChild(toggleRow(t('Breaking stories may still come through'), q.allowBreaking, (on) => save({ quietHours: { allowBreaking: on } })));

    sectionTitle(t('Not too many'));
    const num = (id, label, value, key, max) => {
      const i = document.createElement('input');
      i.type = 'number'; i.min = '0'; i.max = String(max); i.value = String(value); i.className = 'set-input'; i.style.width = '80px';
      i.addEventListener('change', () => save({ caps: { [key]: Number(i.value) } }));
      return field(label, i, id);
    };
    container.appendChild(num('ain-set-win', t('Windows notifications per hour, at most'), p.caps.windowsPerHour, 'windowsPerHour', 60));
    container.appendChild(num('ain-set-toast', t('In-Vex pop-ups per hour, at most'), p.caps.toastPerHour, 'toastPerHour', 120));
    container.appendChild(num('ain-set-catch', t('Told one by one after being away, at most'), p.caps.catchUpMax, 'catchUpMax', 30));
    container.appendChild(el('p', 'ain-muted', t('The rest of a busy hour arrives as one line: “N new stories”.')));

    sectionTitle(t('Daily digest'));
    container.appendChild(toggleRow(t('Collect stories whose rule says “Daily digest” and tell me once a day'), p.digest.enabled, (on) => save({ digest: { enabled: on } })));
    const dRow = el('div', 'ain-field');
    dRow.append(el('label', '', t('At')), time('ain-set-digest', p.digest.at, (v) => save({ digest: { at: v } })));
    container.appendChild(dRow);

    // --- what is held
    sectionTitle(t('What Vex keeps'));
    container.appendChild(el('p', 'ain-muted', t('On this computer only: your choices, the last 300 stories, which you read, and the address’s version tag. Nothing is synced by default.')));
    const forget = el('button', 'btn-secondary', t('Forget the stories Vex holds')); forget.type = 'button';
    forget.addEventListener('click', async () => {
      try {
        const ok = await window.vexConfirm({ title: t('Forget the stories?'), message: t('Vex deletes the list and what you read. Your choices stay. The next check sets a new baseline.'), okLabel: t('Forget'), cancelLabel: t('Cancel'), danger: true });
        if (!ok) return;
        AINews.resetState();
        this.refreshBadge();
        this.renderSettings(container);
      } catch (err) { fail(err); }
    });
    container.appendChild(forget);
  },

  _renderRules(container, p, save) {
    const t = (s) => this._t(s);
    const list = document.createElement('div');
    list.className = 'ain-rules';
    const redraw = () => this.renderSettings(container);
    for (const r of p.rules) {
      const row = document.createElement('div');
      row.className = 'ain-rule';
      const lab = document.createElement('label');
      lab.className = 'ain-check';
      const on = document.createElement('input');
      on.type = 'checkbox'; on.checked = r.enabled; on.setAttribute('aria-label', t('Rule enabled') + ': ' + r.name);
      on.addEventListener('change', () => { save({ rules: AINews.prefs().rules.map(x => (x.id === r.id ? { ...x, enabled: on.checked } : x)) }, true); });
      const name = document.createElement('strong');
      name.textContent = ' ' + r.name;
      lab.append(on, name);
      const m = r.match;
      const bits = [];
      if (m.kinds.length) bits.push(m.kinds.join('/'));
      if (m.topics.length) bits.push(m.topics.join('/'));
      if (m.companies.length) bits.push(m.companies.join('/'));
      if (m.models.length) bits.push(m.models.join('/'));
      if (m.sources.length) bits.push(m.sources.join('/'));
      if (m.keywords.length) bits.push('“' + m.keywords.join('”, “') + '”');
      if (m.minImportance) bits.push('≥ ' + m.minImportance);
      if (m.breakingOnly) bits.push(t('breaking'));
      const sum = document.createElement('div');
      sum.className = 'ain-muted';
      sum.textContent = (bits.join(' · ') || t('(matches nothing yet)')) + '  →  ' + (r.channels.map(c => t(AINews.CHANNEL_LABELS[c])).join(', ') || t('no channel')) + (r.sound ? '' : ' · ' + t('silent'));
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'btn-secondary'; edit.textContent = t('Edit');
      edit.addEventListener('click', () => this._ruleForm(container, p, r, save));
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn-secondary'; del.textContent = t('Delete');
      del.addEventListener('click', () => { save({ rules: AINews.prefs().rules.filter(x => x.id !== r.id) }, true); redraw(); });
      const btns = document.createElement('div');
      btns.className = 'ain-row-btns';
      btns.append(edit, del);
      row.append(lab, sum, btns);
      list.appendChild(row);
    }
    container.appendChild(list);
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn-secondary'; add.textContent = t('Add a rule…');
    add.addEventListener('click', () => this._ruleForm(container, p, null, save));
    container.appendChild(add);
  },

  // The rule form: below the list, replaced by the list again on save.
  _ruleForm(container, p, rule, save) {
    const t = (s) => this._t(s);
    container.querySelector('.ain-ruleform')?.remove();
    const r = rule || { id: '', name: '', enabled: true, match: { kinds: [], topics: [], companies: [], models: [], sources: [], keywords: [], minImportance: 0, breakingOnly: false }, channels: ['windows', 'toast', 'badge'], sound: true };
    const form = document.createElement('form');
    form.className = 'ain-ruleform';
    form.noValidate = true;
    const row = (label, control, id) => { const d = document.createElement('div'); d.className = 'ain-field'; const l = document.createElement('label'); l.textContent = label; if (id) { l.htmlFor = id; control.id = id; } d.append(l, control); return d; };
    const text = (v) => { const i = document.createElement('input'); i.type = 'text'; i.className = 'set-input'; i.value = v; i.spellcheck = false; return i; };
    const name = text(r.name);
    const topics = text(r.match.topics.join(', '));
    const companies = text(r.match.companies.join(', '));
    const models = text(r.match.models.join(', '));
    const sources = text(r.match.sources.join(', '));
    const words = text(r.match.keywords.join(', '));
    const minImp = document.createElement('input');
    minImp.type = 'number'; minImp.min = '0'; minImp.max = '100'; minImp.value = String(r.match.minImportance || 0); minImp.className = 'set-input'; minImp.style.width = '80px';
    const breaking = document.createElement('input'); breaking.type = 'checkbox'; breaking.checked = !!r.match.breakingOnly;
    const kinds = document.createElement('fieldset'); kinds.className = 'ain-chrow';
    kinds.appendChild(Object.assign(document.createElement('legend'), { textContent: t('Kind of story') }));
    const kindBoxes = AINews.KINDS.filter(k => k !== 'other').map(k => {
      const lab = document.createElement('label'); lab.className = 'ain-check';
      const i = document.createElement('input'); i.type = 'checkbox'; i.checked = r.match.kinds.includes(k); i.value = k;
      lab.append(i, document.createTextNode(' ' + k));
      kinds.appendChild(lab);
      return i;
    });
    const chans = document.createElement('fieldset'); chans.className = 'ain-chrow';
    chans.appendChild(Object.assign(document.createElement('legend'), { textContent: t('Tell me by') }));
    const chanBoxes = AINews.CHANNELS.map(c => {
      const lab = document.createElement('label'); lab.className = 'ain-check';
      const i = document.createElement('input'); i.type = 'checkbox'; i.checked = r.channels.includes(c); i.value = c;
      lab.append(i, document.createTextNode(' ' + t(AINews.CHANNEL_LABELS[c])));
      chans.appendChild(lab);
      return i;
    });
    const sound = document.createElement('input'); sound.type = 'checkbox'; sound.checked = r.sound;
    const err = document.createElement('div'); err.className = 'ain-error'; err.setAttribute('role', 'alert');
    const csv = (i) => i.value.split(',').map(x => x.trim()).filter(Boolean);
    const buttons = document.createElement('div'); buttons.className = 'ain-row-btns';
    const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'btn-primary'; ok.textContent = t('Save rule');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = t('Cancel');
    cancel.addEventListener('click', () => form.remove());
    buttons.append(ok, cancel);
    form.append(
      row(t('Rule name'), name, 'ain-rule-name'), kinds,
      row(t('Topics'), topics, 'ain-rule-topics'), row(t('Companies'), companies, 'ain-rule-companies'),
      row(t('Models'), models, 'ain-rule-models'), row(t('Sources'), sources, 'ain-rule-sources'),
      row(t('Words in the title or summary'), words, 'ain-rule-words'),
      row(t('Importance at least'), minImp, 'ain-rule-imp'), row(t('Breaking stories only'), breaking, 'ain-rule-breaking'),
      chans, row(t('Play the sound'), sound, 'ain-rule-sound'), err, buttons,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const next = AINews.sanitizeRule({
          id: r.id || 'rule-' + Date.now().toString(36), name: name.value, enabled: r.enabled,
          match: { kinds: kindBoxes.filter(i => i.checked).map(i => i.value), topics: csv(topics), companies: csv(companies), models: csv(models), sources: csv(sources), keywords: csv(words), minImportance: Number(minImp.value) || 0, breakingOnly: breaking.checked },
          channels: chanBoxes.filter(i => i.checked).map(i => i.value), sound: sound.checked,
        });
        const m = next.match;
        if (!m.kinds.length && !m.topics.length && !m.companies.length && !m.models.length && !m.sources.length && !m.keywords.length && !m.minImportance && !m.breakingOnly) throw new Error(t('Say what the rule is for: a kind, a topic, a company, a model, a source, a word or an importance'));
        if (!next.channels.length) throw new Error(t('Pick at least one way to be told'));
        const cur = AINews.prefs().rules;
        const rules = cur.some(x => x.id === next.id) ? cur.map(x => (x.id === next.id ? next : x)) : cur.concat(next);
        save({ rules }, true);
        this.renderSettings(container);
      } catch (error) { err.textContent = (error && error.message) || String(error); }
    });
    container.appendChild(form);
    name.focus({ preventScroll: true });
  },

  _injectStyle() {
    if (document.getElementById('ain-styles')) return;
    const st = document.createElement('style');
    st.id = 'ain-styles';
    st.textContent = `
      #btn-ai-news { position: relative; }
      #btn-ai-news .ain-badge { position:absolute; top:-2px; right:-2px; min-width:14px; height:14px; padding:0 3px; border-radius:7px;
        background:var(--primary,#4f8cff); color:var(--on-primary,#fff); font-size:9px; line-height:14px; text-align:center; font-weight:700; box-sizing:border-box; pointer-events:none; }
      .ain-overlay { position:fixed; inset:0; z-index:100050; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; }
      .ain-card { width:720px; max-width:94vw; max-height:88vh; display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border);
        border-radius:14px; box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5)); padding:16px 18px; box-sizing:border-box; }
      .ain-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
      .ain-title { margin:0; font-size:16px; font-weight:600; }
      .ain-actions-top, .ain-row-btns, .ain-filters, .ain-chrow { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
      .ain-filters { margin:10px 0 6px; }
      .ain-muted { color:var(--text-muted); font-size:11.5px; }
      .ain-status { margin:4px 0 8px; }
      .ain-input { background:var(--surface-2,var(--bg)); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:5px 8px; font:inherit; font-size:12.5px; }
      .ain-btn { padding:5px 10px; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font:inherit; font-size:12px; }
      .ain-btn:hover { background:var(--vex-hover-fill,rgba(127,127,127,0.12)); }
      .ain-btn.ain-primary { background:var(--primary); color:var(--on-primary,#fff); border-color:transparent; font-weight:600; }
      .ain-check { display:inline-flex; align-items:center; gap:4px; font-size:12.5px; }
      .ain-list { overflow-y:auto; min-height:120px; }
      .ain-day { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); margin:12px 0 4px; }
      .ain-row { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin-bottom:6px; }
      .ain-row.ain-unread { border-left:3px solid var(--primary,#4f8cff); }
      .ain-link { color:var(--text); font-weight:600; font-size:13.5px; text-decoration:none; }
      .ain-row:not(.ain-unread) .ain-link { font-weight:400; }
      .ain-link:hover { text-decoration:underline; }
      .ain-summary { margin:4px 0; font-size:12.5px; color:var(--text); }
      .ain-row-btns { margin-top:6px; }
      .ain-empty { padding:18px 4px; }
      .ain-sub { margin:16px 0 4px; font-weight:600; font-size:12.5px; }
      .ain-field { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:6px 0; font-size:12.5px; }
      .ain-field input[type=text], .ain-field input[type=url] { flex:1 1 260px; }
      .ain-matrix { border:1px solid var(--border); border-radius:10px; margin:8px 0; padding:6px 10px; }
      .ain-matrix legend { font-size:12px; color:var(--text-muted); padding:0 4px; }
      .ain-mrow { display:flex; gap:12px; align-items:center; padding:2px 0; font-size:12.5px; }
      .ain-mname { flex:1 1 auto; }
      .ain-rule { border:1px solid var(--border); border-radius:10px; padding:8px 10px; margin:6px 0; }
      .ain-ruleform { border:1px dashed var(--border); border-radius:10px; padding:10px; margin:8px 0; }
      .ain-error { color:var(--danger,#e5484d); font-size:12.5px; min-height:16px; }
    `;
    document.head.appendChild(st);
  },
};

if (typeof window !== 'undefined') window.AINewsUI = AINewsUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { AINewsUI };
