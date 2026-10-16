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
// Suggest-only: nothing is filed, tagged or switched by itself. Not built here: a Subject
// filter across downloads and read-later, and per-course last-page memory (needs those
// stores to carry a subject first).
//
//   VexCourseSpaces.clean(fields) / .nextExam(courseName, exams, now)    pure
const VexCourseSpaces = {
  KEY: 'vex.courses',
  PREF: 'vex.courses.enabled',
  MAX: 40,

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
    return { name, term: String((f && f.term) || '').trim().slice(0, 40), deck: String((f && f.deck) || '').trim().slice(0, 100), deckUrl, allow };
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
      for (const c of list) {
        const ex = this.nextExam(c.name, typeof VexExamPlanner !== 'undefined' ? VexExamPlanner.list() : []);
        const box = document.createElement('div');
        box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:10px 0';
        const nNotes = typeof ProjectSpaces !== 'undefined' ? (ProjectSpaces.get(c.spaceId)?.noteIds || []).length : 0;
        box.appendChild(G.note((cur && cur.id === c.id ? '[current] ' : '') + c.name + (c.term ? ' (' + c.term + ')' : '') + ' | ' + nNotes + ' notes' + (ex ? ' | next exam ' + new Date(ex.date).toLocaleDateString() + ' ' + ex.title : '') + (c.deck ? ' | deck ' + c.deck : '')));
        const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
        r.append(
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
    const deckUrl = await window.vexPrompt({ title: 'Deck address (optional)', message: 'A web address that opens the deck, if you have one.', label: 'Address', value: c.deckUrl, okLabel: 'Save' });
    if (deckUrl == null) return;
    this.update(c.id, { allow, deck, deckUrl });
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A course ties a project space (tabs, notes) to its exams, FlashMind deck and study sites. Switching is always your choice.'));
    el.appendChild(G.button('Courses', () => this.openScreen(), { primary: true }));
    const cur = this.current();
    if (cur) el.appendChild(G.note('Current course: ' + cur.name));
  },
};

if (typeof window !== 'undefined') {
  window.VexCourseSpaces = VexCourseSpaces;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'course-spaces', title: 'Courses', keywords: 'course subject space term exam deck flashmind study', build: (el) => VexCourseSpaces.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'courses', label: 'Courses', hint: 'A space per subject with exams, deck and study sites', icon: 'book', action: () => VexCourseSpaces.openScreen() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexCourseSpaces };
