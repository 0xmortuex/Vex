// === Announcement desk and result-day watcher (T1-028) ========================
//
// A handful of school, university and exam pages that you check again and again,
// as one list: what is new on each since you last looked, with the new lines
// picked out. Each is an ordinary page watch (js/page-watch.js: polite polling,
// history, backoff, a conditional request when nothing changed), made by this
// desk and listed here. Nothing else is read: public pages only, no sign-in, no
// cookies, nothing typed into a page.
//
// A page can also be a RESULT page. Give it the words that mean the result is out
// ("sonuç açıklandı", "results announced") and, if you know it, the day. On that
// day the desk reminds you in the morning and checks every 15 minutes instead of
// every hour; the first time one of the words appears in what is NEW on the page,
// you are told once, and the watch is paused, so you stop pressing F5.
//
// ÖSYM, MEB and YÖK are offered as starting points for the address box. They are
// never added by themselves.
const AnnounceDesk = {
  KEY: 'vex.announceDesk',
  SOURCE: 'announce-desk',
  FEATURE: 'announce-desk',
  POLITE_EVERY: 60 * 60000,
  RESULT_DAY_EVERY: 15 * 60000,
  MAX_PAGES: 15,
  MAX_WORDS: 8,
  MAX_NEW_LINES: 8,

  // Addresses to start from. Home pages of the institutions: the announcement
  // page itself is for you to paste, because those addresses move.
  SUGGESTIONS: [
    { label: 'ÖSYM', url: 'https://www.osym.gov.tr/' },
    { label: 'MEB', url: 'https://www.meb.gov.tr/' },
    { label: 'YÖK', url: 'https://www.yok.gov.tr/' },
  ],

  _now() { return new Date(); },

  // ---- state ------------------------------------------------------------------------
  state() {
    const raw = localStorage.getItem(this.KEY);
    const fresh = { on: true, pages: {} };
    if (raw === null) return fresh;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { console.error('[AnnounceDesk] the saved desk is damaged and starts again:', err); return fresh; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fresh;
    return { on: v.on !== false, pages: v.pages && typeof v.pages === 'object' && !Array.isArray(v.pages) ? v.pages : {} };
  },
  _save(st) { localStorage.setItem(this.KEY, JSON.stringify(st)); },
  enabled() { return this.state().on; },
  // Off, the desk's pages are not asked either: the ones that were running are paused, and
  // put back running (only those) when it is switched on again.
  setEnabled(on) {
    const st = this.state();
    st.on = !!on;
    if (typeof PageWatch !== 'undefined') {
      for (const w of PageWatch.list().filter(x => x.source === this.SOURCE)) {
        const entry = st.pages[w.id] || (st.pages[w.id] = { label: w.title, resultWords: [] });
        if (!on && !w.paused) { PageWatch.setPaused(w.id, true); entry.pausedByDesk = true; }
        else if (on && entry.pausedByDesk) { PageWatch.setPaused(w.id, false); entry.pausedByDesk = false; }
      }
    }
    this._save(st);
  },

  // ---- pure helpers --------------------------------------------------------------------
  // → the cleaned address, or throws why it will not do.
  checkUrl(text) {
    let u;
    try { u = new URL(String(text || '').trim()); } catch { throw new Error('Paste the full address of the page, starting with https://'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web page (http or https) can be watched');
    if (u.username || u.password) throw new Error('The desk reads public pages only: leave the user name and password out of the address');
    return u.href;
  },
  cleanWords(text) {
    const words = String(text || '').split(/[,;\n]/).map(w => w.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return Array.from(new Set(words)).slice(0, this.MAX_WORDS).map(w => w.slice(0, 60));
  },
  // The result words (folded: "SONUÇ" finds "sonuc") found in these lines, in the order given.
  matchWords(lines, words) {
    const tr = globalThis.VexTr || require('./vex-tr.js').VexTr;
    const hay = tr.fold(lines.join('\n'));
    return words.filter(w => hay.includes(tr.fold(w)));
  },
  isResultDay(entry, now = this._now()) {
    if (!entry || !entry.resultDate) return false;
    const d = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return entry.resultDate === d && !entry.resultToldAt;
  },
  // How often this page should be asked.
  wantedEvery(entry, now = this._now()) {
    return this.isResultDay(entry, now) ? this.RESULT_DAY_EVERY : this.POLITE_EVERY;
  },

  // ---- the pages ------------------------------------------------------------------------
  // The page watches this desk made, with the desk's own notes on each.
  pages() {
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not loaded');
    const st = this.state();
    return PageWatch.list().filter(w => w.source === this.SOURCE).map(w => ({ watch: w, entry: st.pages[w.id] || { label: w.title, resultWords: [] } }));
  },

  add({ label, url, resultWords = '', resultDate = '' }) {
    if (!this.enabled()) throw new Error('The announcement desk is switched off in Settings');
    const href = this.checkUrl(url);
    const name = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new Error('Give the page a name');
    if (this.pages().length >= this.MAX_PAGES) throw new Error('The desk holds ' + this.MAX_PAGES + ' pages. Remove one first.');
    if (resultDate && !/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) throw new Error('The result day is a date, like 2026-07-24');
    const words = this.cleanWords(resultWords);
    const entry = { label: name, resultWords: words, resultDate: resultDate || '', resultToldAt: 0 };
    const every = this.wantedEvery(entry);
    const watch = PageWatch.add({ url: href, title: name, kind: 'text', every, source: this.SOURCE, byUser: false });
    const st = this.state();
    st.pages[watch.id] = entry;
    this._save(st);
    return watch;
  },

  remove(id) {
    PageWatch.remove(id);
    const st = this.state();
    delete st.pages[id];
    this._save(st);
  },

  setResult(id, { resultWords, resultDate }) {
    if (resultDate && !/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) throw new Error('The result day is a date, like 2026-07-24');
    const st = this.state();
    const entry = st.pages[id] || { label: (PageWatch.list().find(w => w.id === id) || {}).title || '', resultWords: [] };
    entry.resultWords = this.cleanWords(resultWords);
    entry.resultDate = resultDate || '';
    entry.resultToldAt = 0;
    st.pages[id] = entry;
    this._save(st);
    this.tick();
  },

  // The lines that are new on a page since the look before (highlighted in the desk).
  newLines(watchId) {
    const snaps = PageWatch.history(watchId);
    if (snaps.length < 2) return [];
    const D = PageWatch._diff();
    return D.change(snaps[snaps.length - 2].text.split('\n'), snaps[snaps.length - 1].text.split('\n'), { sensitivity: 'high' }).added;
  },

  // ---- what happens when a watched page changes ---------------------------------------------
  // PageWatch.announce hands desk pages here instead of its own toast.
  announce(watch) {
    const st = this.state();
    const entry = st.pages[watch.id];
    const lines = this.newLines(watch.id);
    const hits = entry && entry.resultWords && entry.resultWords.length ? this.matchWords(lines, entry.resultWords) : [];
    if (hits.length && !entry.resultToldAt) {
      entry.resultToldAt = Date.now();
      this._save(st);
      // Found: tell once, then stop asking the page.
      PageWatch.setPaused(watch.id, true);
      this._tell('result', watch.id, (entry.label || watch.title) + ': the page now says "' + hits[0] + '"', lines.find(l => this.matchWords([l], [hits[0]]).length) || '', 'critical');
      return;
    }
    if (typeof VexAttention !== 'undefined') {
      VexAttention.notify({ feature: this.FEATURE, urgency: 'useful', id: watch.id, title: (entry ? entry.label : watch.title) + ' has something new', body: lines[0] || '', label: 'Announcement desk', action: { label: 'Open the desk', key: 'open' } },
        () => window.showToast?.((entry ? entry.label : watch.title) + ' has something new', 'info', 8000, { action: { label: 'Open the desk', run: () => this.open() } }));
    }
  },

  _tell(kind, id, title, body, urgency) {
    if (typeof VexAttention !== 'undefined' && VexAttention.isMuted(this.FEATURE) && urgency !== 'critical') return;
    if (typeof VexAttention !== 'undefined') VexAttention.request({ feature: this.FEATURE, urgency, id: kind + ':' + id });
    window.showToast?.(title, 'info', 20000, { action: { label: 'Open the desk', run: () => this.open() } });
    if (typeof VexAttention !== 'undefined') VexAttention.osNotify({ feature: this.FEATURE, urgency, id: kind + ':' + id, title: 'Vex: ' + title, body: body || '' })
      .catch(err => console.error('[AnnounceDesk] the Windows notification failed:', err));
  },

  // ---- the daily tick ------------------------------------------------------------------------
  // Keeps each page's pace right (15 minutes on its result day, an hour otherwise)
  // and gives the morning reminder once on the result day. → the pages touched.
  tick(now = this._now()) {
    if (!this.enabled() || typeof PageWatch === 'undefined') return [];
    const st = this.state();
    const touched = [];
    for (const { watch } of this.pages()) {
      const entry = st.pages[watch.id];
      if (!entry) continue;
      const want = this.wantedEvery(entry, now);
      if (watch.every !== want) {
        const list = PageWatch.list();
        const w = list.find(x => x.id === watch.id);
        if (w) { w.every = want; PageWatch._save(list); touched.push(watch.id); }
      }
      if (this.isResultDay(entry, now) && now.getHours() >= 8 && entry.dayToldFor !== entry.resultDate) {
        entry.dayToldFor = entry.resultDate;
        this._save(st);
        this._tell('day', watch.id, 'Result day for ' + entry.label + '. Vex is checking the page every 15 minutes and will tell you once.', '', 'asked');
      }
    }
    return touched;
  },

  // ---- the desk ----------------------------------------------------------------------------------
  open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog helpers are not loaded');
    const { body } = VexSettingsGroups.dialog({ id: 'announce-desk', title: 'Announcement desk', sub: 'What is new on the pages you follow. Public pages only: no sign-in, nothing typed.' });
    this._draw(body);
  },

  _draw(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const redraw = () => this._draw(body);
    const pages = this.pages();
    if (!pages.length) body.appendChild(el('p', 'setting-info', 'No pages yet. Paste an address below, or start from one of the suggestions.'));
    for (const { watch, entry } of pages) {
      const fresh = PageWatch.isUnseen(watch);
      const card = el('div', 'ad-page' + (fresh ? ' fresh' : ''));
      const head = el('div', 'ad-head');
      head.append(el('strong', '', entry.label || watch.title), el('span', 'ad-state', watch.paused ? 'paused' : (fresh ? 'new' : (watch.lastCheckedAt ? 'checked ' + new Date(watch.lastCheckedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not checked yet'))));
      card.appendChild(head);
      card.appendChild(el('div', 'ad-url', watch.url));
      if (entry.resultWords && entry.resultWords.length) card.appendChild(el('div', 'ad-result', 'Result words: ' + entry.resultWords.join(', ') + (entry.resultDate ? ' · expected ' + entry.resultDate : '') + (entry.resultToldAt ? ' · found' : '')));
      if (fresh) {
        const lines = this.newLines(watch.id).slice(0, this.MAX_NEW_LINES);
        const ul = el('ul', 'ad-new');
        if (lines.length) for (const l of lines) ul.appendChild(el('li', '', l));
        else ul.appendChild(el('li', '', 'The page changed (see it in the page watcher for the detail)'));
        card.appendChild(ul);
      }
      const row = el('div', 'ad-actions');
      const btn = (text, run) => { const b = el('button', 'btn-secondary', text); b.type = 'button'; b.addEventListener('click', () => { try { const r = run(); if (r && typeof r.then === 'function') r.then(redraw).catch(fail); else redraw(); } catch (err) { fail(err); } }); row.appendChild(b); };
      btn('Open the page', () => { PageWatch.markSeen(watch.id); TabManager.createTab(watch.url, true); document.getElementById('announce-desk')?.remove(); });
      if (fresh) btn('Mark as seen', () => PageWatch.markSeen(watch.id));
      btn('Check now', () => PageWatch.checkOne(watch.id));
      btn(watch.paused ? 'Resume' : 'Pause', () => PageWatch.setPaused(watch.id, !watch.paused));
      btn('Result words…', () => this._editResult(watch, entry).then(redraw));
      btn('Remove', () => this.remove(watch.id));
      card.appendChild(row);
      body.appendChild(card);
    }
    body.appendChild(this._form(redraw, fail));
  },

  async _editResult(watch, entry) {
    const words = await window.vexPrompt({ title: 'Result words', label: 'Words that mean the result is out, separated by commas', value: (entry.resultWords || []).join(', '), okLabel: 'Save' });
    if (words === null) return;
    const day = await window.vexPrompt({ title: 'Result day', label: 'The day it is expected (YYYY-MM-DD), or empty', value: entry.resultDate || '', okLabel: 'Save' });
    if (day === null) return;
    this.setResult(watch.id, { resultWords: words, resultDate: String(day).trim() });
  },

  _form(redraw, fail) {
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const form = el('div', 'ad-form');
    form.appendChild(el('div', 'setting-label', 'Add a page'));
    const field = (label, ph, type = 'text') => {
      const wrap = el('label', 'ad-field');
      wrap.appendChild(el('span', '', label));
      const i = document.createElement('input'); i.type = type; i.className = 'set-input'; i.placeholder = ph || ''; i.autocomplete = 'off';
      wrap.appendChild(i); form.appendChild(wrap); return i;
    };
    const name = field('Name', 'e.g. University announcements');
    const url = field('Address', 'https://');
    const words = field('Result words (optional)', 'sonuç açıklandı, results');
    const day = field('Result day (optional)', '', 'date');
    const chips = el('div', 'ad-chips');
    chips.appendChild(el('span', 'ad-chips-label', 'Start from: '));
    for (const s of this.SUGGESTIONS) {
      const c = el('button', 'btn-secondary', s.label); c.type = 'button';
      // Fills the boxes; adds nothing.
      c.addEventListener('click', () => { name.value = name.value || s.label + ' announcements'; url.value = s.url; url.focus(); });
      chips.appendChild(c);
    }
    form.appendChild(chips);
    const go = el('button', 'btn-primary', 'Add to the desk'); go.type = 'button';
    go.addEventListener('click', () => { try { this.add({ label: name.value, url: url.value, resultWords: words.value, resultDate: day.value }); redraw(); } catch (err) { fail(err); } });
    form.appendChild(go);
    return form;
  },

  render(body) {
    body.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    body.appendChild(el('p', 'setting-info', 'Follow school, university and exam announcement pages in one list, and be told once when a result appears. Public pages only; the pages are checked politely (hourly, every 15 minutes on a result day).'));
    const row = el('div', 'setting-toggle-row');
    const lab = el('label', 'toggle');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.checked = this.enabled(); input.setAttribute('aria-label', 'Announcement desk');
    input.addEventListener('change', () => { try { this.setEnabled(input.checked); } catch (err) { input.checked = !input.checked; window.showToast?.(err.message, 'error'); } });
    lab.append(input, el('span', 'toggle-slider'));
    row.append(el('span', 'setting-label-text', 'Announcement desk'), lab);
    body.appendChild(row);
    const open = el('button', 'btn-secondary', 'Open the desk'); open.type = 'button';
    open.addEventListener('click', () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } });
    body.appendChild(open);
  },

  init() {
    if (typeof VexJobs === 'undefined') throw new Error('VexJobs is not loaded: js/jobs.js must come before js/announce-desk.js');
    VexJobs.every('Announcement desk', 10 * 60000, () => this.tick(), { when: 'background', feature: 'announce-desk' });
    if (typeof AttentionInbox !== 'undefined') AttentionInbox.handle(this.FEATURE, (key) => { if (key === 'open') this.open(); });
    if (typeof VexSettingsGroups !== 'undefined') {
      VexSettingsGroups.register({ id: 'announce-desk', title: 'Announcement desk', keywords: 'school university exam result osym meb yok duyuru sonuc', render: (body) => this.render(body) });
    }
    if (typeof CommandBar !== 'undefined' && Array.isArray(CommandBar.commands)) {
      CommandBar.commands.push({ id: 'announce-desk', label: 'Announcement desk', hint: 'What is new on the school, university and exam pages you follow, and result-day watching', icon: 'newspaper', action: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
    }
  },
};

if (typeof window !== 'undefined') window.AnnounceDesk = AnnounceDesk;
if (typeof module !== 'undefined' && module.exports) module.exports = { AnnounceDesk };
