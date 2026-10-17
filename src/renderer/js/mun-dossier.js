// === Delegation dossier builder (Model UN) =======================================
//
// A dossier for one delegation (country, committee, topic) with six sections:
//   Position   Past votes   Allies   Blocs   Resolutions   Speeches
// Every item MUST carry its source (an address, or a citation in words): an item without one
// is refused, so the dossier can be trusted when you are asked "where is that from?". Items
// come from the research board (js/research-board.js: the quotes you pulled keep their
// pages), from the page in front, or typed.
//
// "Make the notes" writes a note per section (with the sources as a list) plus an index note
// and puts them in a project space for the delegation. UN Digital Library links are search
// addresses only; Vex does not fetch them. Local only.
//
//   VexMunDossier.unLinks(country, topic)   pure: search addresses
//   VexMunDossier.sectionMarkdown(d, key)   pure: one section as a note body
const VexMunDossier = {
  KEY: 'vex.mun',
  PREF: 'vex.mun.enabled',
  SECTIONS: [
    ['position', 'Position', 'What the delegation says it wants, in its own words.'],
    ['votes', 'Past votes', 'How it voted on related resolutions.'],
    ['allies', 'Allies', 'States that usually vote or speak with it.'],
    ['blocs', 'Blocs', 'Groups it belongs to (regional, political, economic).'],
    ['resolutions', 'Resolutions', 'Resolutions it sponsored, supported or opposed.'],
    ['speeches', 'Speeches', 'Lines for opening statements and speeches.'],
  ],
  MAX_DOSSIERS: 20,
  MAX_ITEMS: 120,

  enabled() { try { return localStorage.getItem(this.PREF) !== 'off'; } catch { return true; } },
  setEnabled(on) { localStorage.setItem(this.PREF, on ? 'on' : 'off'); },

  // ---- store ---------------------------------------------------------------------
  _read() {
    let raw = null;
    try { raw = localStorage.getItem(this.KEY); } catch (err) { throw new Error('The dossiers could not be read: ' + err.message); }
    if (!raw) return [];
    let a;
    try { a = JSON.parse(raw); } catch (err) { throw new Error('The saved dossiers are damaged: ' + err.message); }
    return (Array.isArray(a) ? a : []).filter(d => d && typeof d.id === 'string' && d.sections && typeof d.sections === 'object');
  },
  _write(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); }
    catch (err) { throw new Error('The dossiers could not be saved: ' + err.message, { cause: err }); }
  },
  list() { return this._read(); },
  get(id) { return this._read().find(d => d.id === id) || null; },

  // ---- pure ------------------------------------------------------------------------
  // A source is an http(s) address, or a citation of at least 8 characters (a document symbol such
  // as "A/RES/78/1" counts). -> { url, title }
  cleanSource(src) {
    const s = typeof src === 'string' ? { url: src, title: '' } : (src || {});
    const url = String(s.url || '').trim();
    const title = String(s.title || '').trim().slice(0, 200);
    if (url) {
      let u;
      try { u = new URL(url); } catch { if (url.length >= 8 && !title) return { url: '', title: url.slice(0, 200) }; throw new Error('The source address is not a web address'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('The source address must start with http:// or https://');
      return { url: u.href, title };
    }
    if (title.length >= 8) return { url: '', title };
    throw new Error('Every item needs a source: an address, or a citation of at least 8 characters');
  },
  unLinks(country, topic) {
    const q = (s) => encodeURIComponent(String(s || '').trim());
    const c = String(country || '').trim(), t = String(topic || '').trim();
    const out = [];
    if (c && t) out.push({ label: 'UN Digital Library: ' + t + ' (' + c + ')', url: 'https://digitallibrary.un.org/search?ln=en&p=' + q(t + ' ' + c) });
    if (t) out.push({ label: 'UN Digital Library: resolutions on ' + t, url: 'https://digitallibrary.un.org/search?ln=en&cc=Resolutions+and+Decisions&p=' + q(t) });
    if (c) out.push({ label: 'UN Digital Library: voting data, ' + c, url: 'https://digitallibrary.un.org/search?ln=en&cc=Voting+Data&p=' + q(c) });
    return out;
  },
  sectionMarkdown(d, key) {
    const def = this.SECTIONS.find(s => s[0] === key);
    if (!def) throw new Error('Unknown section ' + key);
    const items = d.sections[key] || [];
    const L = ['# ' + d.country + ': ' + def[1], '', (d.committee ? d.committee + ' | ' : '') + (d.topic || ''), ''];
    if (!items.length) L.push('_Nothing here yet._');
    items.forEach((it, i) => L.push('- ' + it.text + ' [' + (i + 1) + ']'));
    L.push('', '## Sources', '');
    items.forEach((it, i) => L.push('[' + (i + 1) + '] ' + (it.source.title || it.source.url) + (it.source.url && it.source.title ? ' - ' + it.source.url : '')));
    return L.join('\n') + '\n';
  },
  completeness(d) {
    return this.SECTIONS.map(([k, label]) => ({ key: k, label, count: (d.sections[k] || []).length }));
  },

  // ---- changes ------------------------------------------------------------------------
  create({ country, committee, topic }) {
    const c = String(country || '').trim();
    if (!c) throw new Error('Which country or delegation?');
    const list = this._read();
    if (list.length >= this.MAX_DOSSIERS) throw new Error('At most ' + this.MAX_DOSSIERS + ' dossiers');
    const d = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), country: c.slice(0, 80), committee: String(committee || '').trim().slice(0, 100), topic: String(topic || '').trim().slice(0, 200), sections: Object.fromEntries(this.SECTIONS.map(s => [s[0], []])), at: Date.now() };
    list.push(d);
    this._write(list);
    return d;
  },
  remove(id) { this._write(this._read().filter(d => d.id !== id)); },
  addItem(id, key, { text, source }) {
    if (!this.SECTIONS.some(s => s[0] === key)) throw new Error('Unknown section ' + key);
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) throw new Error('Write the item first');
    const src = this.cleanSource(source);
    const list = this._read();
    const d = list.find(x => x.id === id);
    if (!d) throw new Error('That dossier is gone');
    const sec = d.sections[key] || (d.sections[key] = []);
    if (sec.length >= this.MAX_ITEMS) throw new Error('That section is full');
    if (sec.some(i => i.text === t && i.source.url === src.url && i.source.title === src.title)) return { added: false };
    sec.push({ id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), text: t.slice(0, 2000), source: src, at: Date.now() });
    this._write(list);
    return { added: true };
  },
  removeItem(id, key, itemId) {
    const list = this._read();
    const d = list.find(x => x.id === id);
    if (!d) throw new Error('That dossier is gone');
    d.sections[key] = (d.sections[key] || []).filter(i => i.id !== itemId);
    this._write(list);
  },
  // Quotes pulled onto the research board, each with the page it came from.
  importBoard(id, key) {
    if (typeof ResearchBoard === 'undefined') throw new Error('The research board is not available');
    let n = 0;
    for (const q of ResearchBoard.list()) {
      if (!q.url && !q.title) continue;
      if (this.addItem(id, key, { text: q.text, source: { url: q.url, title: q.title } }).added) n++;
    }
    return n;
  },
  async addFromPage(id, key) {
    if (typeof ResearchBoard === 'undefined') throw new Error('The research board is not available');
    const r = await ResearchBoard.addFromActive();     // refuses private/Tor pages and an empty selection
    return this.addItem(id, key, { text: r.item.text, source: { url: r.item.url, title: r.item.title } });
  },

  // Six notes and an index, in one project space.
  async makeNotes(id) {
    if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
    const d = this.get(id);
    if (!d) throw new Error('That dossier is gone');
    const made = [];
    for (const [k, label] of this.SECTIONS) made.push({ key: k, label, note: AgentTools.saveNote(d.country + ': ' + label, this.sectionMarkdown(d, k), undefined, { origin: 'mun' }) });
    const links = this.unLinks(d.country, d.topic);
    const index = AgentTools.saveNote(d.country + ': dossier', ['# ' + d.country + ' dossier', '', (d.committee || '') + (d.topic ? ' | ' + d.topic : ''), '', '## Sections', '', ...made.map(m => '- ' + d.country + ': ' + m.label + ' (' + (d.sections[m.key] || []).length + ' items)'), '', '## UN Digital Library searches', '', ...links.map(l => '- ' + l.label + ': ' + l.url)].join('\n'), undefined, { origin: 'mun' });
    if (typeof ProjectSpaces !== 'undefined') {
      let space = ProjectSpaces.list().find(s => s.name === 'MUN: ' + d.country);
      if (!space) space = await ProjectSpaces.create('MUN: ' + d.country);
      for (const n of [index, ...made.map(m => m.note)]) ProjectSpaces.addNote(space.id, n.id);
    }
    return made.length + 1;
  },

  // ---- screen ---------------------------------------------------------------------------------
  open() {
    if (typeof VexUsage !== 'undefined') VexUsage.touch('mun-dossier');
    const G = VexSettingsGroups;
    const { body } = G.dialog({ id: 'vex-mun', title: 'Delegation dossier', sub: 'Every item keeps its source. Items from the research board or the page in front bring theirs.' });
    const fail = (e) => window.showToast?.(e.message, 'error');
    let sel = null;
    const draw = () => {
      body.textContent = '';
      const all = this.list();
      body.appendChild(G.button('New dossier', async () => {
        try {
          const country = await window.vexPrompt({ title: 'Delegation', label: 'Country', okLabel: 'Next' }); if (country == null) return;
          const committee = await window.vexPrompt({ title: 'Committee', label: 'Committee', placeholder: 'UNSC', okLabel: 'Next' }); if (committee == null) return;
          const topic = await window.vexPrompt({ title: 'Topic', label: 'Topic', okLabel: 'Create' }); if (topic == null) return;
          sel = this.create({ country, committee, topic }).id; draw();
        } catch (e) { fail(e); }
      }, { primary: true }));
      if (!all.length) { body.appendChild(G.note('No dossiers yet.')); return; }
      const pick = document.createElement('select');
      pick.setAttribute('aria-label', 'Dossier');
      for (const d of all) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.country + (d.committee ? ' / ' + d.committee : ''); pick.appendChild(o); }
      if (!sel || !all.some(d => d.id === sel)) sel = all[0].id;
      pick.value = sel;
      pick.addEventListener('change', () => { sel = pick.value; draw(); });
      body.appendChild(pick);
      const d = all.find(x => x.id === sel);
      body.appendChild(G.note(d.topic || 'No topic set'));
      for (const l of this.unLinks(d.country, d.topic)) {
        const a = document.createElement('a'); a.href = l.url; a.textContent = l.label; a.style.cssText = 'display:block;margin:2px 0';
        a.addEventListener('click', (e) => { e.preventDefault(); if (typeof TabManager !== 'undefined') TabManager.createTab(l.url, true); });
        body.appendChild(a);
      }
      for (const [k, label, hint] of this.SECTIONS) {
        const box = document.createElement('div'); box.className = 'vexsr-rule'; box.style.cssText = 'display:block;margin:10px 0';
        const h = document.createElement('div'); h.textContent = label + ' (' + (d.sections[k] || []).length + ')'; h.style.fontWeight = '600';
        box.append(h, G.note(hint));
        for (const it of d.sections[k] || []) {
          const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin:4px 0';
          const t = document.createElement('div'); t.style.flex = '1';
          t.textContent = it.text + '  [' + (it.source.title || it.source.url) + ']';
          row.append(t, G.button('Remove', () => { try { this.removeItem(d.id, k, it.id); draw(); } catch (e) { fail(e); } }, { danger: true }));
          box.appendChild(row);
        }
        const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px';
        bar.append(
          G.button('Add', async () => {
            try {
              const text = await window.vexPrompt({ title: label, label: 'Item', multiline: true, okLabel: 'Next' }); if (text == null) return;
              const source = await window.vexPrompt({ title: 'Source', message: 'A web address, or a citation (for example "A/RES/78/1").', label: 'Source', okLabel: 'Add' }); if (source == null) return;
              this.addItem(d.id, k, { text, source }); draw();
            } catch (e) { fail(e); }
          }),
          G.button('From the page', async () => { try { await this.addFromPage(d.id, k); draw(); } catch (e) { fail(e); } }),
          G.button('From the research board', () => { try { const n = this.importBoard(d.id, k); window.showToast?.(n + ' quote(s) added'); draw(); } catch (e) { fail(e); } }),
        );
        box.appendChild(bar);
        body.appendChild(box);
      }
      const foot = document.createElement('div'); foot.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';
      foot.append(
        G.button('Make the notes', async () => { try { const n = await this.makeNotes(d.id); window.showToast?.(n + ' notes made in the space "MUN: ' + d.country + '"'); } catch (e) { fail(e); } }, { primary: true }),
        G.button('Delete the dossier', async () => { if (await window.vexConfirm({ title: 'Delete this dossier?', message: d.country, okLabel: 'Delete', danger: true })) { this.remove(d.id); draw(); } }, { danger: true }),
      );
      body.appendChild(foot);
    };
    draw();
  },

  group(el) {
    const G = VexSettingsGroups;
    el.appendChild(G.note('A Model UN dossier with position, past votes, allies, blocs, resolutions and speeches. Every item keeps its source; the notes it writes list them.'));
    el.appendChild(G.button('Open dossiers', () => this.open(), { primary: true }));
  },
};

if (typeof window !== 'undefined') {
  window.VexMunDossier = VexMunDossier;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'mun-dossier', title: 'Model UN dossier', keywords: 'model un mun delegation dossier country position allies resolutions speeches', build: (el) => VexMunDossier.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'mun-dossier', label: 'Delegation Dossier (Model UN)', hint: 'Position, votes, allies and resolutions, each with its source', icon: 'users', action: () => VexMunDossier.open() });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexMunDossier };
