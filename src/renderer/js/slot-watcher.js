// === Appointment slot watcher (T3-092) ==============================================
//
// For a public booking page (a passport office, a driving test, a clinic list) that you
// check again and again: you list the page, and tell Vex which words mean "a slot is open"
// (for example "müsait", "available") and, if the page says so when there is nothing, which
// words mean "none" (for example "no appointments", "dolu"). Each page is an ordinary page
// watch (js/page-watch.js: polite polling, history, backoff, a conditional request when
// nothing changed). When the lines that are NEW on the page contain an "open" word, or the
// "none" message that was on the page has gone, you are told once (through the Attention
// Budget, with a Windows notification), and the page is opened for you only when you press the button.
//
// What it never does: sign in, hold cookies for the site, fill or click anything, solve a
// captcha, or book. Public pages only. A page that needs a login cannot be watched (it
// would only see its sign-in page). It will not ask a page more often than every 15 minutes, and
// the default is every 30. Some sites forbid automated checking in their terms: that is
// your call to make for each page you add (docs/security-tier3-threat-notes.md).
const VexSlotWatcher = {
  KEY: 'vex.slotWatcher',
  SOURCE: 'slot-watcher',
  FEATURE: 'slot-watcher',
  MIN_EVERY: 15 * 60000,
  DEFAULT_EVERY: 30 * 60000,
  TOLD_AGAIN_MS: 30 * 60000,
  MAX_PAGES: 10,
  MAX_WORDS: 8,
  EVERY: [
    { ms: 15 * 60000, label: 'every 15 minutes' },
    { ms: 30 * 60000, label: 'every 30 minutes' },
    { ms: 60 * 60000, label: 'every hour' },
  ],

  // ---- state ------------------------------------------------------------------------------
  state() {
    const raw = localStorage.getItem(this.KEY);
    const fresh = { on: false, pages: {} };
    if (raw === null) return fresh;
    let v;
    try { v = JSON.parse(raw); }
    catch (err) { throw new Error('The saved slot watcher list is not readable, so it was not changed (' + err.message + ')'); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('The saved slot watcher list is not readable, so it was not changed');
    return { on: v.on === true, pages: v.pages && typeof v.pages === 'object' && !Array.isArray(v.pages) ? v.pages : {} };
  },
  _save(st) { localStorage.setItem(this.KEY, JSON.stringify(st)); },
  enabled() { try { return this.state().on; } catch (err) { console.error('[SlotWatcher]', err.message); return false; } },
  // Off, the pages are paused (only the ones that were running), and put back when it is switched on.
  setEnabled(on) {
    const st = this.state();
    st.on = !!on;
    if (typeof PageWatch !== 'undefined') {
      for (const w of PageWatch.list().filter(x => x.source === this.SOURCE)) {
        const entry = st.pages[w.id] || (st.pages[w.id] = { label: w.title, available: [], none: [] });
        if (!on && !w.paused) { PageWatch.setPaused(w.id, true); entry.pausedBy = true; }
        else if (on && entry.pausedBy) { PageWatch.setPaused(w.id, false); entry.pausedBy = false; }
      }
    }
    this._save(st);
    this.registerCommands();
  },

  // ---- pure --------------------------------------------------------------------------------------
  checkUrl(text) {
    let u;
    try { u = new URL(String(text || '').trim()); } catch { throw new Error('Paste the full address of the page, starting with https://'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only a web page (http or https) can be watched');
    if (u.username || u.password) throw new Error('The slot watcher reads public pages only: leave the user name and password out of the address');
    return u.href;
  },
  cleanWords(text) {
    const words = String(text || '').split(/[,;\n]/).map(w => w.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return Array.from(new Set(words)).slice(0, this.MAX_WORDS).map(w => w.slice(0, 60));
  },
  fold(s) {
    const tr = globalThis.VexTr || (typeof require === 'function' ? require('./vex-tr.js').VexTr : null);
    if (!tr) throw new Error('The text folding helper is not loaded');
    return tr.fold(s);
  },
  matchWords(lines, words) {
    const hay = this.fold(lines.join('\n'));
    return words.filter(w => hay.includes(this.fold(w)));
  },
  // added / removed: the lines that appeared on and vanished from the page since the look before.
  // -> { open: boolean, why } . "Open" when an open-word is in the new lines, or the "none" message that was
  // there has gone and does not come back in the new lines.
  judge(entry, added, removed) {
    const hit = entry.available && entry.available.length ? this.matchWords(added, entry.available) : [];
    if (hit.length) return { open: true, why: 'the page now says "' + hit[0] + '"', line: added.find(l => this.matchWords([l], [hit[0]]).length) || '' };
    if (entry.none && entry.none.length) {
      const was = this.matchWords(removed, entry.none);
      const still = this.matchWords(added, entry.none);
      if (was.length && !still.length) return { open: true, why: 'the "' + was[0] + '" message is gone', line: '' };
    }
    return { open: false, why: '', line: '' };
  },

  // ---- the pages -----------------------------------------------------------------------------------------
  pages() {
    if (typeof PageWatch === 'undefined') throw new Error('Page watching is not loaded');
    const st = this.state();
    return PageWatch.list().filter(w => w.source === this.SOURCE).map(w => ({ watch: w, entry: st.pages[w.id] || { label: w.title, available: [], none: [] } }));
  },
  add({ label, url, available, none = '', every = this.DEFAULT_EVERY }) {
    if (!this.enabled()) throw new Error('The slot watcher is switched off in Settings');
    const href = this.checkUrl(url);
    const name = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) throw new Error('Give the page a name');
    const words = this.cleanWords(available);
    if (!words.length) throw new Error('Give at least one word that means a slot is open');
    if (Number(every) < this.MIN_EVERY) throw new Error('A page is not checked more often than every ' + (this.MIN_EVERY / 60000) + ' minutes');
    if (this.pages().length >= this.MAX_PAGES) throw new Error('The watcher holds ' + this.MAX_PAGES + ' pages. Remove one first.');
    const watch = PageWatch.add({ url: href, title: name, kind: 'text', every: Number(every), source: this.SOURCE, byUser: false });
    const st = this.state();
    st.pages[watch.id] = { label: name, available: words, none: this.cleanWords(none), toldAt: 0 };
    this._save(st);
    if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE);
    return watch;
  },
  remove(id) {
    PageWatch.remove(id);
    const st = this.state();
    delete st.pages[id];
    this._save(st);
  },

  // The lines that came and went since the look before (PageWatch keeps the history).
  changes(watchId) {
    const snaps = PageWatch.history(watchId);
    if (snaps.length < 2) return { added: [], removed: [] };
    const D = PageWatch._diff();
    const c = D.change(snaps[snaps.length - 2].text.split('\n'), snaps[snaps.length - 1].text.split('\n'), { sensitivity: 'high' });
    return { added: c.added || [], removed: c.removed || [] };
  },

  // PageWatch.announce hands this watcher's pages here.
  announce(watch) {
    const st = this.state();
    const entry = st.pages[watch.id];
    if (!entry || !st.on) return false;
    const { added, removed } = this.changes(watch.id);
    const v = this.judge(entry, added, removed);
    if (!v.open) return false;
    const now = Date.now();
    if (entry.toldAt && now - entry.toldAt < this.TOLD_AGAIN_MS) return false;
    entry.toldAt = now;
    this._save(st);
    const title = (entry.label || watch.title) + ': a slot may be open';
    const open = () => { TabManager.createTab(watch.url, true); };
    if (typeof VexAttention !== 'undefined') {
      // The person set this watch up to be told, so it is "asked": it is never held back for a quiet moment.
      VexAttention.request({ feature: this.FEATURE, urgency: 'asked', id: watch.id + ':' + now });
      VexAttention.osNotify({ feature: this.FEATURE, urgency: 'asked', id: watch.id + ':' + now, title: 'Vex: ' + title, body: v.why + (v.line ? ' - ' + String(v.line).slice(0, 120) : '') })
        .catch((err) => console.error('[SlotWatcher] the Windows notification failed:', err));
    }
    window.showToast?.(title + ' (' + v.why + ')', 'info', 30000, { action: { label: 'Open the page', run: open } });
    return true;
  },

  // ---- screens ---------------------------------------------------------------------------------------------
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  open() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog helpers are not loaded');
    if (!this.enabled()) throw new Error('The slot watcher is switched off in Settings');
    const { body } = VexSettingsGroups.dialog({ id: 'slot-watcher', title: 'Appointment slot watcher', sub: 'Public booking pages only. It never signs in, clicks or books: it tells you, you do the rest.' });
    this._draw(body);
  },
  _draw(body) {
    body.textContent = '';
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    const redraw = () => this._draw(body);
    const pages = this.pages();
    if (!pages.length) body.appendChild(this._el('p', 'setting-info', 'No pages yet. Add a public booking page below.'));
    for (const { watch, entry } of pages) {
      const card = this._el('div', 'ad-page');
      const head = this._el('div', 'ad-head');
      head.append(this._el('strong', '', entry.label || watch.title), this._el('span', 'ad-state', watch.paused ? 'paused' : (watch.lastCheckedAt ? 'checked ' + new Date(watch.lastCheckedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'not checked yet')));
      card.appendChild(head);
      card.appendChild(this._el('div', 'ad-url', watch.url));
      card.appendChild(this._el('div', 'ad-result', 'Open words: ' + (entry.available || []).join(', ') + ((entry.none || []).length ? ' · "none" words: ' + entry.none.join(', ') : '')));
      const row = this._el('div', 'ad-actions');
      const btn = (text, run) => { const b = this._el('button', 'btn-secondary', text); b.type = 'button'; b.addEventListener('click', () => { try { const r = run(); if (r && typeof r.then === 'function') r.then(redraw).catch(fail); else redraw(); } catch (err) { fail(err); } }); row.appendChild(b); };
      btn('Open the page', () => { TabManager.createTab(watch.url, true); document.getElementById('slot-watcher')?.remove(); });
      btn('Check now', () => PageWatch.checkOne(watch.id));
      btn(watch.paused ? 'Resume' : 'Pause', () => PageWatch.setPaused(watch.id, !watch.paused));
      btn('Remove', () => this.remove(watch.id));
      card.appendChild(row);
      body.appendChild(card);
    }
    body.appendChild(this._form(redraw, fail));
  },
  _form(redraw, fail) {
    const form = this._el('div', 'ad-form');
    form.appendChild(this._el('div', 'setting-label', 'Add a page'));
    const field = (label, ph) => {
      const wrap = this._el('label', 'ad-field');
      wrap.appendChild(this._el('span', '', label));
      const i = document.createElement('input'); i.type = 'text'; i.className = 'set-input'; i.placeholder = ph || ''; i.autocomplete = 'off';
      wrap.appendChild(i); form.appendChild(wrap); return i;
    };
    const name = field('Name', 'e.g. Passport appointments');
    const url = field('Address (public page)', 'https://');
    const avail = field('Words that mean a slot is open', 'müsait, available, boş');
    const none = field('Words of the "nothing" message (optional)', 'no appointments, dolu');
    const sel = document.createElement('select'); sel.className = 'set-input'; sel.setAttribute('aria-label', 'How often');
    for (const o of this.EVERY) { const op = document.createElement('option'); op.value = String(o.ms); op.textContent = o.label; if (o.ms === this.DEFAULT_EVERY) op.selected = true; sel.appendChild(op); }
    form.appendChild(sel);
    form.appendChild(this._el('p', 'setting-info', 'Check the site\'s terms: some forbid automated checking. This reads the public page only, as often as you pick, never faster than every 15 minutes.'));
    const go = this._el('button', 'btn-primary', 'Watch this page'); go.type = 'button';
    go.addEventListener('click', () => { try { this.add({ label: name.value, url: url.value, available: avail.value, none: none.value, every: Number(sel.value) }); redraw(); } catch (err) { fail(err); } });
    form.appendChild(go);
    return form;
  },

  registerCommands() {
    if (typeof VexModuleCommands === 'undefined') return false;
    VexModuleCommands.set('slotwatch:', this.enabled() ? [
      { id: 'slotwatch:open', label: 'Appointment slot watcher', icon: 'calendar', hint: 'Be told when a public booking page shows an open slot', action: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } } },
    ] : []);
    return true;
  },

  settingsRows(body) {
    const S = VexSettingsGroup;
    body.appendChild(S.note('Watch public booking pages and be told when a slot looks open. It never signs in, clicks, solves a captcha or books anything, and it asks each page no more than every 15 minutes. Pages that need a login cannot be watched.'));
    body.appendChild(S.toggle('Appointment slot watcher', this.enabled(), (on) => { this.setEnabled(on); if (typeof VexUsage !== 'undefined') VexUsage.touch(this.FEATURE); }, 'Ctrl+K > Appointment slot watcher'));
    if (this.enabled()) body.appendChild(S.button('Open the watcher...', () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } }));
  },
};

if (typeof window !== 'undefined') {
  window.VexSlotWatcher = VexSlotWatcher;
  VexSlotWatcher.registerCommands();
  document.addEventListener('DOMContentLoaded', () => VexSlotWatcher.registerCommands());
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'slot-watcher', title: 'Appointment slot watcher', keywords: 'appointment slot booking randevu passport watch available', before: 'about', render: (body) => VexSlotWatcher.settingsRows(body) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSlotWatcher };
