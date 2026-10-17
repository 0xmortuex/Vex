// === Course / subject spaces ====================================================
//
// A course is a project space (js/project-spaces.js: its own workspace of tabs, its notes)
// with the study things tied to it:
//
//   term + name          "Autumn 2026" / "Calculus II"
//   exam dates           the exams of js/exam-planner.js whose course is this name
//   FlashMind deck       the deck's name (and an optional address) in your FlashMind
//   study allowlist      the sites a strict study block (js/study-block.js) keeps open
//
// Switching to a course switches the space (tabs, notes, AI thread as before). "Study now"
// starts a study block with the course's list. The course shown is the one whose space is
// active, so other features can ask `VexCourseSpaces.current()` for the subject.
//
// Suggest-only: nothing is switched by itself, and nothing is tagged unless you tag it or switch
// clip pre-tagging on.
//
// Subject filter (T2-040): a note, a download, a read-later page or a clip can carry a course (and a unit of
// it). The tags live in ONE map of their own (vex.courses.tags), so the notes, downloads and read-later
// stores are not changed and nothing about them is synced differently. "Subject view" lists them by course.
// Term > course > unit: a course has a term and a list of units (Week 1, Midterm ...); the Courses screen
// groups by term and counts by unit. Clip pre-tagging (off until you switch it on): a clip that lands in the
// clips inbox while a course is current is tagged with it, written to the ledger, with Undo. Last page: while
// a course is current, the page you were on in a normal tab is remembered for that course (address and
// title only, never from a private, Tor or routed tab), and Resume opens it.
//
//   VexCourseSpaces.clean(fields) / .nextExam(courseName, exams, now)    pure
const VexCourseSpaces = {
  KEY: 'vex.courses',
  PREF: 'vex.courses.enabled',
  TAGS_KEY: 'vex.courses.tags',        // { v: 1, items: { 'kind:key': { c, u } }, last: { courseId: { url, title, at } }, seen: [clipId] }
  PRETAG_KEY: 'vex.courses.pretag',    // 'on': a clip that arrives while a course is current is tagged with it
  KINDS: ['note', 'download', 'readLater', 'clip'],
  KIND_LABEL: { note: 'Notes', download: 'Downloads', readLater: 'Read later', clip: 'Clips' },
  MAX: 40,
  MAX_UNITS: 30,
  MAX_TAGS: 2000,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The courses could not be read: ' + err.message); }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('The saved courses are damaged: ' + err.message); }
    return (Array.isArray(a) ? a : []).filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
  },
  _write(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list.slice(0, this.MAX))); }
    catch (err) { throw new Error('The courses could not be saved: ' + err.message, { cause: err }); }
    try { document.dispatchEvent(new CustomEvent('vex:courses-changed')); } catch (err) { console.error('[Courses] event failed:', err); }
  },
  list() { return this._read(); },
  get(id) { return this._read().find(c => c.id === id) || null; },

  // ---- pure ------------------------------------------------------------------------
  clean(f) {
    const name = String((f && f.name) || '').trim();
    if (!name) throw new Error('Give the course a name');
    if (name.length > 80) throw new Error('Keep the name under 80 characters');
    let deckUrl = String((f && f.deckUrl) || '').trim();
    if (deckUrl) { let u; try { u = new URL(deckUrl); } catch { throw new Error('The deck address is not a web address'); } if (!/^https?:$/.test(u.protocol)) throw new Error('The deck address must start with http:// or https://'); deckUrl = u.href; }
    const allow = typeof VexStudyBlock !== 'undefined' ? VexStudyBlock.cleanAllow((f && f.allow) || []) : String((f && f.allow) || '').split(/[\s,;]+/).filter(Boolean);
    const rawUnits = Array.isArray(f && f.units) ? f.units : String((f && f.units) || '').split(/[,;\n]+/);
    const units = [...new Set(rawUnits.map(u => String(u).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
    return { name, term: String((f && f.term) || '').trim().slice(0, 40), deck: String((f && f.deck) || '').trim().slice(0, 100), deckUrl, allow, units };
  },

  // Term > course > unit, with how many tagged things each holds. -> [{ term, courses: [{ course, count, units: [{ name, count }] }] }]
  tree(courses = this.list(), tags = this._tags()) {
    const counts = new Map();
    for (const t of Object.values(tags.items)) { const k = t.c + '\u0000' + (t.u || ''); counts.set(k, (counts.get(k) || 0) + 1); }
    const terms = new Map();
    for (const c of courses) {
      const term = c.term || '(no term)';
      if (!terms.has(term)) terms.set(term, []);
      const units = (c.units || []).map(name => ({ name, count: counts.get(c.id + '\u0000' + name) || 0 }));
      const total = [...counts].filter(([k]) => k.startsWith(c.id + '\u0000')).reduce((n, [, v]) => n + v, 0);
      terms.get(term).push({ course: c, count: total, units });
    }
    return [...terms].map(([term, list]) => ({ term, courses: list.sort((a, b) => a.course.name.localeCompare(b.course.name)) })).sort((a, b) => a.term.localeCompare(b.term));
  },
  nextExam(courseName, exams, now = Date.now()) {
    const n = String(courseName || '').trim().toLowerCase();
    return (exams || []).filter(e => e.date >= now - 3600e3 && String(e.course || '').trim().toLowerCase() === n).sort((a, b) => a.date - b.date)[0] || null;
  },

  // ---- changes -----------------------------------------------------------------------
  // Makes the course and a project space for it. spaceId: an existing space to use instead.
  async add(fields, { spaceId = '', fromCurrentTabs = false } = {}) {
    if (typeof ProjectSpaces === 'undefined') throw new Error('Project spaces are not available');
    const f = this.clean(fields);
    const list = this._read();
    if (list.length >= this.MAX) throw new Error('At most ' + this.MAX + ' courses');
    if (list.some(c => c.name.toLowerCase() === f.name.toLowerCase())) throw new Error('There is already a course called "' + f.name + '"');
    let space = spaceId ? ProjectSpaces.get(spaceId) : null;
    if (spaceId && !space) throw new Error('That space is gone');
    if (!space) space = await ProjectSpaces.create(f.name, { fromCurrentTabs });
    const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), ...f, spaceId: space.id, at: Date.now() };
    list.push(c);
    this._write(list);
    return c;
  },
  update(id, fields) {
    const list = this._read();
    const c = list.find(x => x.id === id);
    if (!c) throw new Error('That course is gone');
    const f = this.clean({ ...c, ...fields });
    if (list.some(x => x.id !== id && x.name.toLowerCase() === f.name.toLowerCase())) throw new Error('There is already a course called "' + f.name + '"');
    Object.assign(c, f);
    this._write(list);
    return c;
  },
  // The course goes; its space (tabs and notes) stays, as it may hold work.
  remove(id) { this._write(this._read().filter(c => c.id !== id)); },

  // ---- subject tags (T2-040) -------------------------------------------------------------------------------------
  _tags() {
    let raw = null;
    try { raw = localStorage.getItem(this.TAGS_KEY); } catch (err) { throw new Error('The subject tags could not be read: ' + err.message); }
    if (!raw) return { v: 1, items: {}, last: {}, seen: [] };
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved subject tags are damaged: ' + err.message); }
    if (!v || v.v !== 1 || typeof v.items !== 'object' || !v.items) throw new Error('The saved subject tags are in a shape this version does not know');
    return { v: 1, items: v.items, last: v.last && typeof v.last === 'object' ? v.last : {}, seen: Array.isArray(v.seen) ? v.seen : [] };
  },
  _saveTags(t) {
    try { localStorage.setItem(this.TAGS_KEY, JSON.stringify(t)); }
    catch (err) { throw new Error('The subject tags could not be saved: ' + err.message, { cause: err }); }
  },
  tagOf(kind, key) { return this._tags().items[kind + ':' + key] || null; },
  tag(kind, key, courseId, unit = '') {
    if (!this.KINDS.includes(kind)) throw new Error('Unknown kind of item: ' + kind);
    if (!key) throw new Error('That item has no id to tag');
    const c = this.get(courseId);
    if (!c) throw new Error('That course is gone');
    const u = String(unit || '');
    if (u && !(c.units || []).includes(u)) throw new Error('"' + c.name + '" has no unit called "' + u + '"');
    const t = this._tags();
    if (Object.keys(t.items).length >= this.MAX_TAGS && !t.items[kind + ':' + key]) throw new Error('That is ' + this.MAX_TAGS + ' tagged items; untag some first');
    t.items[kind + ':' + key] = u ? { c: c.id, u } : { c: c.id };
    this._saveTags(t);
    return t.items[kind + ':' + key];
  },
  untag(kind, key) {
    const t = this._tags();
    const had = delete t.items[kind + ':' + key];
    this._saveTags(t);
    return had;
  },
  // What each store holds, as { key, title, url, at } -- read only.
  sourceItems(kind) {
    const arr = (k) => { const raw = localStorage.getItem(k); if (!raw) return []; let v; try { v = JSON.parse(raw); } catch (err) { throw new Error('Your ' + k + ' could not be read: ' + err.message); } return Array.isArray(v) ? v : []; };
    if (kind === 'note') return arr('vex.notes').filter(n => n && n.id).map(n => ({ key: String(n.id), title: String(n.title || 'Untitled note'), url: String(n.sourceUrl || ''), at: Date.parse(n.updatedAt || n.createdAt || '') || 0 }));
    if (kind === 'readLater') return arr('vex.readLater').filter(r => r && r.id).map(r => ({ key: String(r.id), title: String(r.title || r.url || ''), url: String(r.url || ''), at: Number(r.at) || 0 }));
    if (kind === 'download') return arr('vex.downloads').filter(d => d && d.id && !d.ephemeral).map(d => ({ key: String(d.id), title: String(d.filename || 'download'), url: String(d.url || ''), at: Date.parse(d.startedAt || '') || 0 }));
    throw new Error('Unknown kind of item: ' + kind);
  },
  async clipItems() {
    if (!window.vex || typeof window.vex.clipsInboxList !== 'function') throw new Error('The clips inbox is not available');
    const r = await window.vex.clipsInboxList();
    if (!r || !r.ok) throw new Error('Could not read the clips inbox');
    return (r.items || []).map(i => ({ key: String(i.id), title: String(i.text).slice(0, 80), url: '', at: Number(i.at) || 0 }));
  },
  // The items of one kind that belong to a course ('untagged' for the ones with no course). A note counts as
  // belonging when its course's project space holds it too.
  filterBy(items, kind, courseId, tags = this._tags()) {
    const inSpace = new Set();
    if (kind === 'note' && courseId !== 'untagged' && courseId !== 'all') {
      const c = this.get(courseId);
      const sp = c && typeof ProjectSpaces !== 'undefined' ? ProjectSpaces.get(c.spaceId) : null;
      for (const id of (sp && sp.noteIds) || []) inSpace.add(String(id));
    }
    return items.filter(it => {
      const t = tags.items[kind + ':' + it.key];
      if (courseId === 'all') return true;
      if (courseId === 'untagged') return !t;
      return (t && t.c === courseId) || inSpace.has(it.key);
    });
  },
  // How many of each kind a course holds (clips are counted from the tags only).
  counts(courseId) {
    const tags = this._tags();
    const out = {};
    for (const kind of this.KINDS) {
      out[kind] = kind === 'clip' ? Object.entries(tags.items).filter(([k, v]) => k.startsWith('clip:') && v.c === courseId).length : this.filterBy(this.sourceItems(kind), kind, courseId, tags).length;
    }
    return out;
  },

  // ---- clip pre-tagging --------------------------------------------------------------------------------------------
  pretagging() { try { return localStorage.getItem(this.PRETAG_KEY) === 'on'; } catch { return false; } },
  async setPretag(on) {
    if (on) {
      // The clips already there are not the new ones: they are marked seen and left as they are.
      const t = this._tags();
      for (const c of await this.clipItems()) if (!t.seen.includes(c.key)) t.seen.push(c.key);
      t.seen = t.seen.slice(-500);
      this._saveTags(t);
    }
    try { localStorage.setItem(this.PRETAG_KEY, on ? 'on' : 'off'); }
    catch (err) { throw new Error('Could not save that setting: ' + err.message); }
    return !!on;
  },
  async pretagClips() {
    if (!this.enabled() || !this.pretagging()) return 0;
    const cur = this.current();
    if (!cur) return 0;
    const t = this._tags();
    const fresh = (await this.clipItems()).filter(c => !t.seen.includes(c.key));
    if (!fresh.length) return 0;
    const keys = [];
    for (const c of fresh) { t.seen.push(c.key); if (!t.items['clip:' + c.key]) { t.items['clip:' + c.key] = { c: cur.id }; keys.push(c.key); } }
    t.seen = t.seen.slice(-500);
    this._saveTags(t);
    if (keys.length && typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'course-spaces', what: 'Tagged ' + keys.length + ' clip' + VexPlural.s(keys.length) + ' as ' + cur.name, why: 'Clip pre-tagging is on and ' + cur.name + ' is the current course', undo: { kind: 'course-untag-clips', keys: keys.slice(0, 50) } });
    return keys.length;
  },

  // ---- last page of a course --------------------------------------------------------------------------------------
  lastPage(courseId) { return this._tags().last[courseId] || null; },
  noteLastPage(tabId, url) {
    if (!this.enabled()) return false;
    const cur = this.current();
    if (!cur || typeof TabManager === 'undefined') return false;
    if (TabManager.activeTabId !== tabId) return false;
    const tab = TabManager.tabs.find(x => x.id === tabId);
    if (!tab || (window.VexTabPolicy && !window.VexTabPolicy.canRestore(tab))) return false;
    if (!/^https?:\/\//i.test(String(url || ''))) return false;
    const t = this._tags();
    const prev = t.last[cur.id];
    if (prev && prev.url === url) return false;
    t.last[cur.id] = { url: String(url).slice(0, 2000), title: String(tab.title || url).slice(0, 200), at: Date.now() };
    this._saveTags(t);
    return true;
  },
  resume(courseId) {
    const p = this.lastPage(courseId);
    if (!p) throw new Error('No page has been remembered for this course yet');
    if (typeof TabManager === 'undefined') throw new Error('Tabs are not available');
    TabManager.createTab(p.url, true);
    return p;
  },

  current() {
    if (typeof ProjectSpaces === 'undefined') return null;
    const sp = ProjectSpaces.active();
    return sp ? this._read().find(c => c.spaceId === sp.id) || null : null;
  },
  async open(id) {
    const c = this.get(id);
    if (!c) throw new Error('That course is gone');
    if (typeof ProjectSpaces === 'undefined') throw new Error('Project spaces are not available');
    await ProjectSpaces.switchTo(c.spaceId);
    const last = this.lastPage(c.id);
    if (last) window.showToast?.('Where you left off in ' + c.name + ': ' + String(last.title).slice(0, 60), 'info', 9000, { action: { label: 'Resume', run: () => { try { this.resume(c.id); } catch (err) { window.showToast?.(err.message, 'error'); } } } });
    return c;
  },
  exams(id) {
    const c = this.get(id);
    if (!c || typeof VexExamPlanner === 'undefined') return [];
    const n = c.name.toLowerCase();
    return VexExamPlanner.list().filter(e => String(e.course || '').trim().toLowerCase() === n);
  },
  openDeck(id) {
    const c = this.get(id);
    if (!c) throw new Error('That course is gone');
    if (c.deckUrl && typeof TabManager !== 'undefined') { TabManager.createTab(c.deckUrl, true); return 'tab'; }
    if (typeof FlashMindBridge === 'undefined') throw new Error('The FlashMind bridge is not available');
    FlashMindBridge.openPanel();
    if (c.deck) window.showToast?.('FlashMind: open the deck "' + c.deck + '"');
    return 'panel';
  },
  studyNow(id, minutes = 50) {
    const c = this.get(id);
    if (!c) throw new Error('That course is gone');
    if (typeof VexStudyBlock === 'undefined') throw new Error('The study block is not available');
    if (!c.allow.length) throw new Error('Add the sites that may stay open for this course first');
    return VexStudyBlock.start({ name: c.name, allow: c.allow, minutes });
  },
  addNote(id, noteId) {
    const c = this.get(id);
    if (!c) throw new Error('That course is gone');
    return ProjectSpaces.addNote(c.spaceId, noteId);
  },

  // ---- screen --------------------------------------------------------------------------------
  openScreen() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('course-spaces');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-courses', title: 'Courses', sub: 'A course is a project space with its exams, FlashMind deck and study sites.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    const draw = () => {
      body.textContent = '';
      body.appendChild(G.button('Add a course', async () => { try { await this._addDialog(); draw(); } catch (e) { fail(e); } }, { primary: true }));
      const cur = this.current();
      const list = this.list();
      if (!list.length) body.appendChild(G.note('No courses yet.'));
      const order = new Map();
      let tree = [];
      try { tree = this.tree(list); } catch (err) { body.appendChild(G.note(err.message)); }
      tree.forEach((t, ti) => t.courses.forEach((x, ci) => order.set(x.course.id, { ti, ci, term: t.term, units: x.units })));
      let lastTerm = null;
      for (const c of list.slice().sort((a, b) => ((order.get(a.id) || {}).ti - (order.get(b.id) || {}).ti) || ((order.get(a.id) || {}).ci - (order.get(b.id) || {}).ci))) {
        const pos = order.get(c.id);
        if (pos && pos.term !== lastTerm) { lastTerm = pos.term; const h = document.createElement('div'); h.style.cssText = 'font-weight:600;margin:14px 0 2px'; h.textContent = pos.term; body.appendChild(h); }
        const ex = this.nextExam(c.name, typeof VexExamPlanner !== 'undefined' ? VexExamPlanner.list() : []);
        const box = document.createElement('div');
        box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:10px 0';
        const nNotes = typeof ProjectSpaces !== 'undefined' ? (ProjectSpaces.get(c.spaceId)?.noteIds || []).length : 0;
        box.appendChild(G.note((cur && cur.id === c.id ? '[current] ' : '') + c.name + (c.term ? ' (' + c.term + ')' : '') + ' | ' + nNotes + ' notes' + (ex ? ' | next exam ' + new Date(ex.date).toLocaleDateString() + ' ' + ex.title : '') + (c.deck ? ' | deck ' + c.deck : '')));
        if (pos && pos.units.length) box.appendChild(G.note('Units: ' + pos.units.map(u => u.name + ' (' + u.count + ')').join(', ')));
        const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        r.append(
          G.button('Subject view', () => { try { this.openSubject(c.id); } catch (e) { fail(e); } }),
          ...(this.lastPage(c.id) ? [G.button('Resume', () => { try { this.resume(c.id); } catch (e) { fail(e); } }, { label: 'Resume where you left off in ' + c.name })] : []),
          G.button('Open', async () => { try { await this.open(c.id); draw(); } catch (e) { fail(e); } }, { primary: true }),
          G.button('Study now', () => { try { this.studyNow(c.id); window.showToast?.('Study block started'); } catch (e) { fail(e); } }),
          G.button('FlashMind deck', () => { try { this.openDeck(c.id); } catch (e) { fail(e); } }),
          G.button('Edit', async () => { try { await this._editDialog(c); draw(); } catch (e) { fail(e); } }),
          G.button('Remove', async () => { if (await window.vexConfirm({ title: 'Remove the course?', message: 'Its space with the tabs and notes stays.', okLabel: 'Remove', danger: true })) { this.remove(c.id); draw(); } }, { danger: true }),
        );
        box.appendChild(r);
        body.appendChild(box);
      }
    };
    draw();
  },
  // ---- the Subject view: notes, downloads, read-later pages and clips by course --------------------------------------
  async openSubject(courseId = 'all') {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('course-spaces');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-subject', title: 'Subject view', sub: 'Notes, downloads, read-later pages and clips by course. The tags are kept here; the lists themselves are not changed.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    let clips = [];
    try { clips = await this.clipItems(); } catch (err) { body.appendChild(G.note(err.message)); }
    let which = courseId;
    const draw = () => {
      body.textContent = '';
      const courses = this.list();
      const sel = document.createElement('select'); sel.className = 'vexsr-input'; sel.setAttribute('aria-label', 'Course');
      for (const [v, l] of [['all', 'Everything'], ['untagged', 'Not tagged'], ...courses.map(c => [c.id, c.name + (c.term ? ' (' + c.term + ')' : '')])]) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = v === which; sel.appendChild(o); }
      sel.addEventListener('change', () => { which = sel.value; draw(); });
      body.appendChild(sel);
      let tags;
      try { tags = this._tags(); } catch (err) { body.appendChild(G.note(err.message)); return; }
      for (const kind of this.KINDS) {
        let items;
        try { items = kind === 'clip' ? clips : this.sourceItems(kind); } catch (err) { body.appendChild(G.note(err.message)); continue; }
        const shown = this.filterBy(items, kind, which, tags).slice(0, 80);
        const h = document.createElement('div'); h.style.cssText = 'font-weight:600;margin:12px 0 4px'; h.textContent = this.KIND_LABEL[kind] + ' (' + shown.length + ')'; body.appendChild(h);
        for (const it of shown) {
          const row = document.createElement('div'); row.className = 'vexsr-rule';
          const t = document.createElement('span'); t.className = 'vexsr-host'; t.style.wordBreak = 'normal'; t.textContent = it.title;
          const pick = document.createElement('select'); pick.className = 'vexsr-input'; pick.setAttribute('aria-label', 'Course of ' + it.title);
          const cur = tags.items[kind + ':' + it.key];
          const opts = [['', '(no course)']];
          for (const c of courses) { opts.push([c.id + '|', c.name]); for (const u of c.units || []) opts.push([c.id + '|' + u, c.name + ' / ' + u]); }
          for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; o.selected = v === (cur ? cur.c + '|' + (cur.u || '') : ''); pick.appendChild(o); }
          pick.addEventListener('change', () => { try { if (!pick.value) this.untag(kind, it.key); else { const [c, u] = pick.value.split('|'); this.tag(kind, it.key, c, u); } draw(); } catch (e) { fail(e); } });
          row.append(t, pick);
          body.appendChild(row);
        }
      }
    };
    draw();
  },
  async _addDialog() {
    const P = (o) => window.vexPrompt(o);
    const name = await P({ title: 'Course name', label: 'Name', placeholder: 'Calculus II', okLabel: 'Next' });
    if (name == null) return;
    const term = await P({ title: 'Term', label: 'Term (optional)', placeholder: 'Autumn 2026', okLabel: 'Next' });
    if (term == null) return;
    const allow = await P({ title: 'Sites for studying', message: 'Sites a study block keeps open for this course, separated by spaces.', label: 'Sites', okLabel: 'Next' });
    if (allow == null) return;
    const deck = await P({ title: 'FlashMind deck', message: 'The deck\'s name in FlashMind (optional).', label: 'Deck', okLabel: 'Create' });
    if (deck == null) return;
    const fromTabs = await window.vexConfirm({ title: 'Start with the tabs open now?', message: 'They move into the course\'s space.', okLabel: 'Use them', cancelLabel: 'Start empty' });
    await this.add({ name, term, allow, deck }, { fromCurrentTabs: fromTabs });
  },
  async _editDialog(c) {
    const allow = await window.vexPrompt({ title: c.name + ': sites for studying', label: 'Sites', value: c.allow.join(' '), okLabel: 'Next' });
    if (allow == null) return;
    const deck = await window.vexPrompt({ title: c.name + ': FlashMind deck', label: 'Deck name', value: c.deck, okLabel: 'Next' });
    if (deck == null) return;
    const deckUrl = await window.vexPrompt({ title: 'Deck address (optional)', message: 'A web address that opens the deck, if you have one.', label: 'Address', value: c.deckUrl, okLabel: 'Next' });
    if (deckUrl == null) return;
    const units = await window.vexPrompt({ title: c.name + ': units', message: 'The parts of the course, separated by commas (Week 1, Week 2, Midterm). Items can be tagged with one.', label: 'Units', value: (c.units || []).join(', '), okLabel: 'Save' });
    if (units == null) return;
    this.update(c.id, { allow, deck, deckUrl, units });
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A course ties a project space (tabs, notes) to its exams, FlashMind deck and study sites. Switching is always your choice.'));
    el.appendChild(G.button('Courses', () => this.openScreen(), { primary: true }));
    const cur = this.current();
    if (cur) el.appendChild(G.note('Current course: ' + cur.name));
    el.appendChild(G.button('Subject view', () => { this.openSubject().catch(e => window.showToast?.(e.message, 'error')); }));
    const row = document.createElement('label'); row.className = 'vexsr-rule';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = this.pretagging();
    cb.addEventListener('change', async () => { try { await this.setPretag(cb.checked); } catch (e) { cb.checked = !cb.checked; window.showToast?.(e.message, 'error'); } });
    row.append(cb, document.createTextNode(' Tag new clips with the current course (you can undo it from Why did that happen?)'));
    el.appendChild(row);
  },

  init() {
    if (this._wired) return true;
    this._wired = true;
    if (typeof VexLedger !== 'undefined') {
      VexLedger.registerUndo('course-untag-clips', async (token) => { for (const k of (token && token.keys) || []) this.untag('clip', k); });
    }
    document.addEventListener('vex:tab-navigated', (e) => {
      const d = e.detail || {};
      if (d.failed) return;
      try { this.noteLastPage(d.tabId, d.url); } catch (err) { window.VexProblems?.note('Courses', 'Could not remember the last page', err); }
    });
    if (window.vex && typeof window.vex.onClipsInboxChanged === 'function') {
      window.vex.onClipsInboxChanged(() => { this.pretagClips().catch(err => window.VexProblems?.note('Courses', 'Could not tag the new clips', err)); });
    }
    return true;
  },
};

if (typeof window !== 'undefined') {
  window.VexCourseSpaces = VexCourseSpaces;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'course-spaces', title: 'Courses', keywords: 'course subject space term exam deck flashmind study', build: (el) => VexCourseSpaces.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'subject-view', label: 'Subject view', hint: 'Notes, downloads, read-later pages and clips by course', icon: 'book', action: () => { VexCourseSpaces.openSubject().catch(e => window.showToast?.(e.message, 'error')); } });
    VexExtras.registerCommand({ id: 'courses', label: 'Courses', hint: 'A space per subject with exams, deck and study sites', icon: 'book', action: () => VexCourseSpaces.openScreen() });
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexCourseSpaces.init(), { once: true });
  else VexCourseSpaces.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCourseSpaces };
