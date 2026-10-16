// === Content calendar and publish checklist (T3-061) ==========================
//
// A small board for things you make and publish (a video, an article, a post): each
// card moves Idea, Draft, Edit, Ready, Published; has a due date that shows up in the
// calendar (js/calendar.js); carries the sources you gathered; and has a checklist per
// platform to go through before you press Publish.
//
//   Checklist   a platform adds its own list (YouTube, Article, Social post), which
//               you can add to. Each line can be ticked by hand.
//   Check page  "Check the open page" reads the fields of the page in front (the upload
//               form) and ticks the lines whose field is filled in: a line named
//               "Title" is ticked when a field called title has text. It only READS the
//               page, once, when you press the button; it never types into it, never
//               presses anything, and never reads a private or Tor tab.
//   Sources     "Add this page as a source" keeps the address and title on the card;
//               the writing desk (js/writing-desk.js) opens a card's sources next to
//               its draft.
//
// Everything is kept on this computer (vex.contentBoard). Nothing is published for you.
const VexContentBoard = {
  KEYS: { on: 'vex.contentBoard.enabled', data: 'vex.contentBoard' },
  FEATURE: 'content-board',
  STAGES: ['Idea', 'Draft', 'Edit', 'Ready', 'Published'],
  MAX_CARDS: 200,
  MAX_SOURCES: 30,
  // Starting checklists. `words` are what a form field is called on the upload page.
  TEMPLATES: {
    'YouTube': [['Title', 'title'], ['Description', 'description'], ['Thumbnail', 'thumbnail'], ['Tags', 'tags'], ['Visibility chosen', 'visibility'], ['Captions or subtitles', 'caption|subtitle']],
    'Article': [['Title', 'title|headline'], ['Summary or description', 'description|summary|excerpt'], ['Image with alt text', 'alt'], ['Links checked', ''], ['Tags or category', 'tags?|categor']],
    'Social post': [['Text', 'text|post|caption'], ['Image or link', 'image|link'], ['Hashtags', 'hashtag']],
  },
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, true); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

  // ---- the data ---------------------------------------------------------------------------
  cards() {
    const v = VexMediaKit.read(this.KEYS.data, []);
    if (!Array.isArray(v)) throw new Error('The saved content board is not readable');
    return v;
  },
  _save(list) { VexMediaKit.write(this.KEYS.data, list); },
  _card(id) {
    const list = this.cards();
    const i = list.findIndex(c => c.id === id);
    if (i < 0) throw new Error('That card is not on the board any more');
    return { list, i, card: list[i] };
  },
  add({ title, stage = 'Idea', due = 0 }) {
    const t = String(title == null ? '' : title).trim();
    if (!t) throw new Error('Give the card a title');
    if (t.length > 120) throw new Error('The title is up to 120 characters');
    if (!this.STAGES.includes(stage)) throw new Error('Unknown stage: ' + stage);
    const list = this.cards();
    if (list.length >= this.MAX_CARDS) throw new Error('The board holds ' + this.MAX_CARDS + ' cards. Delete some published ones first.');
    const card = { id: VexMediaKit.uid('cb'), title: t, stage, due: Number(due) || 0, platforms: [], sources: [], at: this._now() };
    list.push(card);
    this._save(list);
    return card;
  },
  update(id, patch) {
    const { list, i, card } = this._card(id);
    const next = { ...card };
    if ('title' in patch) { const t = String(patch.title).trim(); if (!t || t.length > 120) throw new Error('The title is 1 to 120 characters'); next.title = t; }
    if ('stage' in patch) { if (!this.STAGES.includes(patch.stage)) throw new Error('Unknown stage: ' + patch.stage); next.stage = patch.stage; }
    if ('due' in patch) { const d = Number(patch.due); if (!Number.isFinite(d) || d < 0) throw new Error('That is not a real due date'); next.due = d; }
    list[i] = next;
    this._save(list);
    return next;
  },
  remove(id) { this._card(id); this._save(this.cards().filter(c => c.id !== id)); },
  addPlatform(id, name) {
    const { list, card } = this._card(id);
    const tpl = this.TEMPLATES[name];
    if (!tpl) throw new Error('Choose YouTube, Article or Social post');
    if (card.platforms.some(p => p.name === name)) throw new Error(name + ' is already on this card');
    card.platforms.push({ name, items: tpl.map(([label, words]) => ({ label, words, done: false })) });
    this._save(list);
    return card;
  },
  addCheck(id, platform, label) {
    const { list, card } = this._card(id);
    const p = card.platforms.find(x => x.name === platform);
    if (!p) throw new Error('That platform is not on this card');
    const t = String(label).trim();
    if (!t || t.length > 80) throw new Error('A checklist line is 1 to 80 characters');
    if (p.items.length >= 30) throw new Error('A checklist holds 30 lines');
    p.items.push({ label: t, words: '', done: false });
    this._save(list);
  },
  tick(id, platform, index, done) {
    const { list, card } = this._card(id);
    const p = card.platforms.find(x => x.name === platform);
    if (!p || !p.items[index]) throw new Error('That checklist line is not there any more');
    p.items[index].done = !!done;
    this._save(list);
  },
  addSource(id, url, title) {
    const { list, card } = this._card(id);
    const u = VexMediaKit.webUrl(url);
    if (card.sources.some(s => s.url === u)) throw new Error('That page is already a source of this card');
    if (card.sources.length >= this.MAX_SOURCES) throw new Error('A card holds ' + this.MAX_SOURCES + ' sources');
    card.sources.push({ url: u, title: String(title || u).slice(0, 160) });
    this._save(list);
  },

  // ---- pure: ticking from a page -----------------------------------------------------------------
  // fields: [{ label, filled }] read from the page. → indexes of the items to tick.
  autoTick(items, fields) {
    const ticks = [];
    items.forEach((it, i) => {
      if (it.done || !it.words) return;
      let re;
      try { re = new RegExp(it.words, 'i'); } catch (err) { throw new Error('The checklist line "' + it.label + '" has a bad match pattern', { cause: err }); }
      if (fields.some(f => f.filled && re.test(f.label))) ticks.push(i);
    });
    return ticks;
  },
  script() {
    return `(() => {
      const out = [];
      const nodes = document.querySelectorAll('input:not([type=hidden]):not([type=password]), textarea, [contenteditable=true], select');
      for (const n of nodes) {
        if (out.length >= 80) break;
        const lab = (n.getAttribute('aria-label') || n.getAttribute('placeholder') || n.name || n.id || (n.labels && n.labels[0] && n.labels[0].textContent) || '').trim().slice(0, 80);
        if (!lab) continue;
        const value = n.matches('[contenteditable=true]') ? n.textContent : (n.type === 'checkbox' || n.type === 'radio' ? (n.checked ? 'on' : '') : n.value);
        out.push({ label: lab, filled: !!String(value || '').trim() });
      }
      for (const img of document.querySelectorAll('img[alt]')) if (/thumbnail/i.test(img.alt) && out.length < 90) out.push({ label: 'thumbnail', filled: !!img.src });
      return out;
    })()`;
  },
  async checkPage(id, platform) {
    const K = VexMediaKit;
    const page = K.activePage();
    if (!page.wv) throw new Error('Open the upload page first');
    const policy = window.VexTabPolicy;
    if (!policy || typeof policy.canReadWebview !== 'function' || policy.isPrivateWindow || !policy.canReadWebview(page.wv)) throw new Error('This page cannot be read (a private or protected tab)');
    const { list, card } = this._card(id);
    const p = card.platforms.find(x => x.name === platform);
    if (!p) throw new Error('That platform is not on this card');
    const fields = await window.vexGuestEval(page.wv, this.script(), false, 6000);
    if (!Array.isArray(fields)) throw new Error('The page gave no fields to read');
    const ticks = this.autoTick(p.items, fields);
    for (const i of ticks) p.items[i].done = true;
    this._save(list);
    return ticks.length;
  },

  // ---- the calendar ---------------------------------------------------------------------------------
  calendarEvents(from, to) {
    if (!this.enabled()) return [];
    return this.cards().filter(c => c.due >= from && c.due < to && c.stage !== 'Published')
      .map(c => ({ start: c.due, end: c.due + 3600000, summary: c.title + ' (' + c.stage + ')', allDay: false, location: '', calendar: 'Content' }));
  },

  // ---- drawing -----------------------------------------------------------------------------------------
  open() {
    const K = VexMediaKit;
    const { body } = K.dialog({ id: 'content-board', title: 'Content board', sub: 'Idea to published, with due dates in the calendar and a checklist per platform.' });
    const draw = () => {
      body.textContent = '';
      if (!this.enabled()) { body.appendChild(K.info('The content board is switched off in Settings.')); return; }
      const guard = (fn) => () => { fn(); draw(); };
      const title = K.input('New card title', { placeholder: 'Video: weekly recap', max: 120 });
      const due = K.input('Due (YYYY-MM-DD or YYYY-MM-DD HH:MM)', { placeholder: '2026-11-02 18:00', max: 16 });
      body.appendChild(K.row('New card', title, due, K.button('Add', guard(() => { this.add({ title: title.value, due: due.value.trim() ? K.parseLocal(due.value) : 0 }); }))));
      for (const stage of this.STAGES) {
        const cards = this.cards().filter(c => c.stage === stage).sort((a, b) => (a.due || 1e15) - (b.due || 1e15));
        if (!cards.length) continue;
        body.appendChild(K.el('div', 'setting-label-text', stage + ' (' + cards.length + ')'));
        for (const c of cards) body.appendChild(this._cardEl(c, draw, K));
      }
      if (!this.cards().length) body.appendChild(K.info('No cards yet.'));
    };
    draw();
  },
  _cardEl(c, draw, K) {
    const box = K.el('div', 'vex-platform-note');
    const head = K.el('div', 'setting-row');
    head.appendChild(K.el('strong', '', c.title));
    head.appendChild(K.el('span', '', c.due ? 'due ' + K.fmtLocal(c.due) : 'no due date'));
    const stage = document.createElement('select'); stage.setAttribute('aria-label', 'Stage of ' + c.title);
    for (const s of this.STAGES) stage.appendChild(new Option(s, s, false, s === c.stage));
    stage.addEventListener('change', () => { try { this.update(c.id, { stage: stage.value }); draw(); } catch (err) { K.fail(err); } });
    head.appendChild(stage);
    head.appendChild(K.button('Delete', async () => {
      if (typeof window.vexConfirm === 'function' && !(await window.vexConfirm({ title: 'Delete this card?', message: c.title, okLabel: 'Delete', danger: true }))) return;
      this.remove(c.id); draw();
    }, { danger: true, label: 'Delete ' + c.title }));
    box.appendChild(head);
    for (const p of c.platforms) {
      box.appendChild(K.el('div', 'setting-label-text', p.name + ' checklist'));
      p.items.forEach((it, i) => box.appendChild(K.switchRow(it.label, it.done, (on) => this.tick(c.id, p.name, i, on))));
      const more = K.input('Add a line to the ' + p.name + ' checklist', { max: 80 });
      box.appendChild(K.row('', more, K.button('Add line', () => { this.addCheck(c.id, p.name, more.value); draw(); }),
        K.button('Check the open page', async () => { const n = await this.checkPage(c.id, p.name); K.toast(n ? 'Ticked ' + n + ' from the page' : 'Nothing new to tick on this page'); draw(); })));
    }
    const plat = document.createElement('select'); plat.setAttribute('aria-label', 'Add a checklist to ' + c.title);
    plat.appendChild(new Option('Add a checklist...', ''));
    for (const n of Object.keys(this.TEMPLATES)) if (!c.platforms.some(p => p.name === n)) plat.appendChild(new Option(n, n));
    plat.addEventListener('change', () => { if (!plat.value) return; try { this.addPlatform(c.id, plat.value); draw(); } catch (err) { K.fail(err); } });
    box.appendChild(plat);
    box.appendChild(K.button('Add this page as a source', () => { const pg = K.activePage(); this.addSource(c.id, pg.url, pg.title); draw(); }));
    for (const s of c.sources) box.appendChild(K.row(s.title, K.button('Open', () => TabManager.createTab(s.url, true), { label: 'Open ' + s.title })));
    if (typeof VexWritingDesk !== 'undefined') box.appendChild(K.button('Write it in the writing desk', () => VexWritingDesk.fromCard(c)));
    return box;
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('A board for what you publish: stages, due dates in the calendar, sources, and a checklist per platform that can tick itself from the upload page you have open (read only, when you press the button).'));
    body.appendChild(K.switchRow('Content board', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.button('Open the board', () => this.open()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    if (typeof Calendar !== 'undefined' && typeof Calendar.addProvider === 'function') Calendar.addProvider(this.FEATURE, (from, to) => this.calendarEvents(from, to));
    VexMediaKit.register({
      id: 'content-board', title: 'Content board', keywords: 'content calendar publish checklist youtube article post schedule',
      render: (b) => this.render(b),
      commands: [{ id: 'content-board', label: 'Content board', hint: 'Idea to published, with a checklist per platform', icon: 'calendar', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexContentBoard = VexContentBoard;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexContentBoard };
