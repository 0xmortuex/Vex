// === Writing workspace, reference boards and asset shelf (T3-094) ==============
//
// A place to write with your sources in view:
//
//   Draft | Sources   the draft on the left, with a word count and "Save as Markdown";
//                     on the right the pages you gathered for it, one click from open
//   Boards            visual reference boards: colours (swatches), image addresses and
//                     links, grouped by board
//   Shelf             things you paste again and again (rule text, a banner's address, a
//                     role icon's address, a sticker): Copy puts one on the clipboard, and
//                     a text line can be dragged into a page or the Discord panel
//
// All of it is kept on this computer (vex.writing) and is not part of Notes, so the notes
// panel and its sync are untouched. Images are kept as ADDRESSES and shown as links: the
// window never loads a picture from the web by itself (that would be a request to a
// stranger's server each time the board opens), "Open" shows it in a tab.
//
// Honest limits: dragging a shelf line into a web page works where that page accepts a text
// drop; if it does not, Copy always does. Nothing is sent anywhere.
const VexWritingDesk = {
  KEYS: { on: 'vex.writing.enabled', data: 'vex.writing' },
  FEATURE: 'writing-desk',
  MAX_DRAFTS: 30, MAX_TEXT: 200000, MAX_SOURCES: 40,
  MAX_BOARDS: 12, MAX_BOARD_ITEMS: 60, MAX_SHELF: 60,
  BOARD_KINDS: ['color', 'image', 'link'],
  SHELF_KINDS: ['text', 'image', 'link'],
  _now() { return Date.now(); },

  enabled() { return VexMediaKit.flag(this.KEYS.on, true); },
  setEnabled(on) { VexMediaKit.setFlag(this.KEYS.on, !!on); },

  // ---- pure ----------------------------------------------------------------------------
  wordCount(text) { const m = String(text == null ? '' : text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu); return m ? m.length : 0; },
  // The draft as one Markdown file: its text, then its sources as a list.
  markdown(d) {
    const out = ['# ' + d.title, '', String(d.text || '').trimEnd(), ''];
    if (d.sources.length) { out.push('## Sources', ''); for (const s of d.sources) out.push('- [' + s.title.replace(/[\[\]]/g, '') + '](' + s.url + ')'); out.push(''); }
    return out.join('\n');
  },
  // A board item cleaned for its kind, or throws.
  cleanItem(kind, value, label = '') {
    const v = String(value == null ? '' : value).trim();
    if (!v) throw new Error('Give it a value');
    const out = { id: VexMediaKit.uid('wi'), kind, label: String(label).trim().slice(0, 60) };
    if (kind === 'color') {
      const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
      if (!hex) throw new Error('A colour is written like #3366ff');
      out.value = '#' + hex[1].toLowerCase();
    } else if (kind === 'image' || kind === 'link') {
      out.value = VexMediaKit.webUrl(v);
    } else if (kind === 'text') {
      if (v.length > 2000) throw new Error('A text line is up to 2000 characters');
      out.value = v;
    } else throw new Error('Unknown kind: ' + kind);
    return out;
  },

  // ---- data ------------------------------------------------------------------------------
  data() {
    const v = VexMediaKit.read(this.KEYS.data, null);
    if (v == null) return { drafts: [], boards: [], shelf: [] };
    if (typeof v !== 'object' || !Array.isArray(v.drafts) || !Array.isArray(v.boards) || !Array.isArray(v.shelf)) throw new Error('The saved writing desk is not readable');
    return v;
  },
  _save(d) { VexMediaKit.write(this.KEYS.data, d); },
  newDraft(title = 'Untitled draft', sources = []) {
    const d = this.data();
    if (d.drafts.length >= this.MAX_DRAFTS) throw new Error('The desk holds ' + this.MAX_DRAFTS + ' drafts. Delete one first.');
    const draft = { id: VexMediaKit.uid('wd'), title: String(title).trim().slice(0, 120) || 'Untitled draft', text: '', sources: sources.slice(0, this.MAX_SOURCES), updatedAt: this._now() };
    d.drafts.unshift(draft);
    this._save(d);
    return draft;
  },
  saveDraft(id, patch) {
    const d = this.data();
    const draft = d.drafts.find(x => x.id === id);
    if (!draft) throw new Error('That draft is not on the desk any more');
    if ('title' in patch) draft.title = String(patch.title).trim().slice(0, 120) || 'Untitled draft';
    if ('text' in patch) {
      if (String(patch.text).length > this.MAX_TEXT) throw new Error('A draft is up to ' + this.MAX_TEXT + ' characters');
      draft.text = String(patch.text);
    }
    draft.updatedAt = this._now();
    this._save(d);
    return draft;
  },
  deleteDraft(id) { const d = this.data(); d.drafts = d.drafts.filter(x => x.id !== id); this._save(d); },
  addSource(id, url, title) {
    const d = this.data();
    const draft = d.drafts.find(x => x.id === id);
    if (!draft) throw new Error('That draft is not on the desk any more');
    const u = VexMediaKit.webUrl(url);
    if (draft.sources.some(s => s.url === u)) throw new Error('That page is already a source');
    if (draft.sources.length >= this.MAX_SOURCES) throw new Error('A draft holds ' + this.MAX_SOURCES + ' sources');
    draft.sources.push({ url: u, title: String(title || u).slice(0, 160) });
    this._save(d);
  },
  removeSource(id, url) { const d = this.data(); const x = d.drafts.find(y => y.id === id); if (x) { x.sources = x.sources.filter(s => s.url !== url); this._save(d); } },
  addBoard(name) {
    const d = this.data();
    const n = String(name == null ? '' : name).trim().slice(0, 60);
    if (!n) throw new Error('Name the board');
    if (d.boards.length >= this.MAX_BOARDS) throw new Error('At most ' + this.MAX_BOARDS + ' boards');
    const b = { id: VexMediaKit.uid('wb'), name: n, items: [] };
    d.boards.push(b);
    this._save(d);
    return b;
  },
  addBoardItem(boardId, kind, value, label) {
    if (!this.BOARD_KINDS.includes(kind)) throw new Error('A board holds colours, images and links');
    const d = this.data();
    const b = d.boards.find(x => x.id === boardId);
    if (!b) throw new Error('That board is not there any more');
    if (b.items.length >= this.MAX_BOARD_ITEMS) throw new Error('A board holds ' + this.MAX_BOARD_ITEMS + ' things');
    b.items.push(this.cleanItem(kind, value, label));
    this._save(d);
  },
  removeBoard(id) { const d = this.data(); d.boards = d.boards.filter(b => b.id !== id); this._save(d); },
  removeBoardItem(boardId, itemId) { const d = this.data(); const b = d.boards.find(x => x.id === boardId); if (b) { b.items = b.items.filter(i => i.id !== itemId); this._save(d); } },
  addShelf(kind, value, label) {
    if (!this.SHELF_KINDS.includes(kind)) throw new Error('The shelf holds text, image addresses and links');
    const d = this.data();
    if (d.shelf.length >= this.MAX_SHELF) throw new Error('The shelf holds ' + this.MAX_SHELF + ' things');
    d.shelf.push(this.cleanItem(kind, value, label));
    this._save(d);
  },
  removeShelf(id) { const d = this.data(); d.shelf = d.shelf.filter(i => i.id !== id); this._save(d); },

  // From a content-board card (js/content-board.js): a draft with the card's sources beside it.
  fromCard(card) {
    const draft = this.newDraft(card.title, (card.sources || []).map(s => ({ url: s.url, title: s.title })));
    this.open(draft.id);
    return draft;
  },

  // ---- drawing ----------------------------------------------------------------------------------
  async copy(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('The clipboard is not available here');
    await navigator.clipboard.writeText(text);
    VexMediaKit.toast('Copied');
  },
  _itemRow(K, it, onRemove) {
    const r = K.el('div', 'setting-row');
    if (it.kind === 'color') { const sw = K.el('span', ''); sw.style.cssText = 'display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid var(--border);background:' + it.value; sw.setAttribute('aria-hidden', 'true'); r.appendChild(sw); }
    const label = K.el('span', '', (it.label ? it.label + ': ' : '') + (it.kind === 'text' ? it.value.slice(0, 120) : it.value));
    if (it.kind === 'text') { label.draggable = true; label.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.value); e.dataTransfer.effectAllowed = 'copy'; }); }
    r.appendChild(label);
    r.appendChild(K.button('Copy', () => this.copy(it.value), { label: 'Copy ' + (it.label || it.value.slice(0, 20)) }));
    if (it.kind === 'image' || it.kind === 'link') r.appendChild(K.button('Open', () => TabManager.createTab(it.value, true), { label: 'Open ' + (it.label || it.value.slice(0, 20)) }));
    r.appendChild(K.button('Remove', onRemove, { danger: true, label: 'Remove ' + (it.label || it.value.slice(0, 20)) }));
    return r;
  },
  open(draftId = '') {
    const K = VexMediaKit;
    const { overlay, body } = K.dialog({ id: 'writing-desk', title: 'Writing desk', sub: 'Your draft with your sources beside it. Kept on this computer.' });
    const card = overlay.querySelector('.vexsr-card');
    if (card) card.style.width = 'min(1100px, 96vw)';
    let current = draftId;
    const draw = () => {
      body.textContent = '';
      if (!this.enabled()) { body.appendChild(K.info('The writing desk is switched off in Settings.')); return; }
      const d = this.data();
      if (!d.drafts.find(x => x.id === current)) current = d.drafts[0] ? d.drafts[0].id : '';
      const pick = document.createElement('select'); pick.setAttribute('aria-label', 'Draft');
      for (const x of d.drafts) pick.appendChild(new Option(x.title, x.id, false, x.id === current));
      pick.addEventListener('change', () => { current = pick.value; draw(); });
      const bar = K.el('div', 'setting-row');
      bar.append(pick, K.button('New draft', () => { current = this.newDraft().id; draw(); }));
      body.appendChild(bar);
      const draft = d.drafts.find(x => x.id === current);
      const grid = K.el('div');
      grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:14px;align-items:start';
      if (draft) {
        const left = K.el('div');
        const title = K.input('Draft title', { value: draft.title, max: 120 });
        const text = document.createElement('textarea'); text.className = 'set-input'; text.value = draft.text; text.rows = 18; text.style.cssText = 'width:100%;resize:vertical';
        text.setAttribute('aria-label', 'Draft text');
        const count = K.el('div', 'setting-info', this.wordCount(draft.text) + ' words');
        title.addEventListener('change', () => { try { this.saveDraft(draft.id, { title: title.value }); } catch (err) { K.fail(err); } });
        text.addEventListener('input', () => {
          count.textContent = this.wordCount(text.value) + ' words';
          try { this.saveDraft(draft.id, { text: text.value }); } catch (err) { K.fail(err); }
        });
        left.append(title, text, count,
          K.button('Save as Markdown', async () => {
            const r = await window.vex.saveTextFile((draft.title || 'draft').replace(/[^\w -]+/g, '') + '.md', this.markdown(this.data().drafts.find(x => x.id === draft.id)), 'md');
            if (r && r.ok === false && !r.cancelled) throw new Error(r.error || 'Could not save the file');
          }),
          K.button('Delete this draft', async () => {
            if (typeof window.vexConfirm === 'function' && !(await window.vexConfirm({ title: 'Delete this draft?', message: draft.title, okLabel: 'Delete', danger: true }))) return;
            this.deleteDraft(draft.id); draw();
          }, { danger: true }));
        const right = K.el('div');
        right.appendChild(K.el('div', 'setting-label-text', 'Sources'));
        for (const s of draft.sources) right.appendChild(K.row(s.title, K.button('Open', () => TabManager.createTab(s.url, true), { label: 'Open ' + s.title }), K.button('Remove', () => { this.removeSource(draft.id, s.url); draw(); }, { danger: true, label: 'Remove ' + s.title })));
        right.appendChild(K.button('Add this page as a source', () => { const pg = K.activePage(); this.addSource(draft.id, pg.url, pg.title); draw(); }));
        grid.append(left, right);
      } else grid.appendChild(K.info('No draft yet. Press New draft.'));
      body.appendChild(grid);

      body.appendChild(K.el('div', 'setting-label-text', 'Reference boards'));
      for (const b of d.boards) {
        body.appendChild(K.row(b.name, K.button('Delete board', () => { this.removeBoard(b.id); draw(); }, { danger: true, label: 'Delete board ' + b.name })));
        for (const it of b.items) body.appendChild(this._itemRow(K, it, () => { this.removeBoardItem(b.id, it.id); draw(); }));
        const kind = document.createElement('select'); kind.setAttribute('aria-label', 'What to add to ' + b.name);
        for (const k of this.BOARD_KINDS) kind.appendChild(new Option(k, k));
        const val = K.input('Colour, image address or link for ' + b.name, { placeholder: '#3366ff or https://...', max: 300 });
        body.appendChild(K.row('Add', kind, val, K.button('Add', () => { this.addBoardItem(b.id, kind.value, val.value, ''); draw(); })));
      }
      const bn = K.input('New board name', { placeholder: 'Colour palette', max: 60 });
      body.appendChild(K.row('New board', bn, K.button('Add board', () => { this.addBoard(bn.value); draw(); })));

      body.appendChild(K.el('div', 'setting-label-text', 'Asset shelf'));
      for (const it of d.shelf) body.appendChild(this._itemRow(K, it, () => { this.removeShelf(it.id); draw(); }));
      const sk = document.createElement('select'); sk.setAttribute('aria-label', 'What to put on the shelf');
      for (const k of this.SHELF_KINDS) sk.appendChild(new Option(k, k));
      const sl = K.input('Name of the shelf item', { placeholder: 'Rules text', max: 60 });
      const sv = K.input('Text, image address or link', { max: 2000 });
      body.appendChild(K.row('Add to the shelf', sk, sl, sv, K.button('Add', () => { this.addShelf(sk.value, sv.value, sl.value); draw(); })));
    };
    draw();
  },
  render(body) {
    const K = VexMediaKit;
    body.textContent = '';
    body.appendChild(K.info('Write with your sources beside the draft, keep reference boards (colours, image addresses, links) and a shelf of things you paste again and again, like rules text or a banner\'s address. Kept on this computer; pictures are shown as addresses, never loaded by themselves.'));
    body.appendChild(K.switchRow('Writing desk', this.enabled(), (on) => this.setEnabled(on)));
    body.appendChild(K.button('Open the writing desk', () => this.open()));
  },
  init() {
    if (this._wired) return false;
    this._wired = true;
    VexMediaKit.register({
      id: 'writing-desk', title: 'Writing desk', keywords: 'writing draft sources reference board asset shelf markdown discord banner',
      render: (b) => this.render(b),
      commands: [{ id: 'writing-desk', label: 'Writing desk', hint: 'Draft and sources side by side, reference boards, asset shelf', icon: 'edit', action: () => { try { this.open(); } catch (err) { VexMediaKit.fail(err); } } }],
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexWritingDesk = VexWritingDesk;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexWritingDesk };
