// === Research projects — everything about one topic, in one place ==========
//
// Looking into something takes days and touches everything: eleven tabs, four
// bookmarks you will never find again, a note, two AI conversations that are
// each attached to a tab that no longer exists. A week later the question comes
// back and none of it is together.
//
// A project is a folder for one topic. Pages go in it, notes go in it, and the
// AI conversation you had about it goes in it — the conversation being the part
// every browser loses, because it belongs to a tab and tabs close.
//
// One project is "the one I am working on", so adding something is a single
// command rather than a decision. And the whole thing exports as Markdown,
// because research that cannot leave the tool it was done in is a trap.
//
// Private and Tor tabs are not collected, here as everywhere.

const ResearchProjects = {
  KEY: 'vex.projects',
  ACTIVE_KEY: 'vex.projects.active',
  MAX: 60,
  MAX_ITEMS: 500,
  projects: [],

  init() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      this.projects = Array.isArray(a) ? a.filter(p => p && typeof p.name === 'string' && Array.isArray(p.items)) : [];
    } catch { this.projects = []; }
    return this;
  },

  save() {
    this.projects = this.projects.slice(0, this.MAX);
    try { localStorage.setItem(this.KEY, JSON.stringify(this.projects)); } catch {}
  },

  list() { return this.projects.slice(); },
  get(id) { return this.projects.find(p => p.id === id) || null; },

  // --- which one am I working on ----------------------------------------
  activeId() { try { return localStorage.getItem(this.ACTIVE_KEY) || null; } catch { return null; } },
  active() { return this.get(this.activeId()); },
  setActive(id) {
    if (id && !this.get(id)) throw new Error('That project is gone');
    try { id ? localStorage.setItem(this.ACTIVE_KEY, id) : localStorage.removeItem(this.ACTIVE_KEY); } catch {}
    return this.active();
  },

  create(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) throw new Error('Give the project a name');
    if (n.length > 120) throw new Error('That name is too long');
    if (this.projects.some(p => p.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a project called “' + n + '”');
    const p = { id: window.vexId ? window.vexId('proj') : 'proj-' + Date.now(), name: n, at: Date.now(), items: [] };
    this.projects.unshift(p);
    this.save();
    this.setActive(p.id);          // a project you just made is the one you meant
    return p;
  },

  rename(id, name) {
    const p = this.get(id);
    if (!p) throw new Error('That project is gone');
    const n = String(name == null ? '' : name).trim();
    if (!n) throw new Error('Give the project a name');
    if (this.projects.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error('There is already a project called “' + n + '”');
    p.name = n;
    this.save();
    return p;
  },

  remove(id) {
    this.projects = this.projects.filter(p => p.id !== id);
    if (this.activeId() === id) { try { localStorage.removeItem(this.ACTIVE_KEY); } catch {} }
    this.save();
  },

  // --- putting things in -------------------------------------------------
  _add(projectId, item) {
    const p = this.get(projectId) || this.active();
    if (!p) throw new Error('Make a project first, or choose one to add to');
    p.items.unshift({ id: window.vexId ? window.vexId('item') : 'item-' + Date.now() + Math.random().toString(36).slice(2, 6), at: Date.now(), ...item });
    if (p.items.length > this.MAX_ITEMS) p.items.length = this.MAX_ITEMS;
    this.save();
    return p;
  },

  addPage(url, title, projectId, meta = null) {
    const u = String(url || '');
    if (!/^https?:/i.test(u)) throw new Error('Only a real web page can go in a project');
    const p = this.get(projectId) || this.active();
    if (!p) throw new Error('Make a project first, or choose one to add to');
    if (p.items.some(i => i.kind === 'page' && i.url === u)) throw new Error('That page is already in “' + p.name + '”');
    let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
    this._add(p.id, { kind: 'page', url: u, title: String(title || u).slice(0, 200), host, meta });
    return p;
  },

  // A passage you highlighted, with the page it came from and what the page
  // says about itself (authors, date, site, DOI), so the export can cite it.
  addQuote(text, { url, title, meta = null } = {}, projectId) {
    const t = String(text == null ? '' : text).replace(/\s+\n/g, '\n').trim();
    if (!t) throw new Error('Select some text on the page first');
    if (!/^https?:/i.test(String(url || ''))) throw new Error('Only a passage from a real web page can go in a project');
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    return this._add(projectId, { kind: 'quote', text: t.slice(0, 5000), url: String(url), title: String(title || url).slice(0, 200), host, meta });
  },

  addNote(text, projectId) {
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('There is nothing to write down');
    return this._add(projectId, { kind: 'note', text: t.slice(0, 20000) });
  },

  // The conversation is the part every browser loses, because it belongs to a
  // tab and tabs close.
  addChat(messages, title, projectId) {
    const msgs = (Array.isArray(messages) ? messages : [])
      .filter(m => m && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 20000) }));
    if (!msgs.length) throw new Error('There is no conversation to save');
    return this._add(projectId, { kind: 'chat', title: String(title || 'Conversation').slice(0, 160), messages: msgs });
  },

  removeItem(projectId, itemId) {
    const p = this.get(projectId);
    if (!p) throw new Error('That project is gone');
    p.items = p.items.filter(i => i.id !== itemId);
    this.save();
    return p;
  },

  // --- getting it back out ----------------------------------------------
  // Research that cannot leave the tool it was done in is a trap.
  // A cited document: highlights as quotes, pages as a list, each marked with
  // the number of its entry under References (APA unless `style` says
  // otherwise — any style PageExport.cite knows).
  toMarkdown(id, { style = 'apa' } = {}) {
    const p = this.get(id);
    if (!p) throw new Error('That project is gone');
    const when = (t) => { try { return new Date(t).toLocaleDateString(); } catch { return ''; } };
    const out = ['# ' + p.name, '', '_Started ' + when(p.at) + ' · ' + p.items.length + ' item' + (p.items.length === 1 ? '' : 's') + '_', ''];

    // One number per source, in the order it first appears, so a highlight
    // and the page it came from share an entry.
    const sources = [];
    const ref = (i) => {
      const meta = { title: i.title, url: i.url, site: i.host, ...(i.meta || {}) };
      let n = sources.findIndex(s => s.url === i.url);
      if (n < 0) { sources.push({ url: i.url, meta }); n = sources.length - 1; }
      else if (i.meta && !sources[n].metaFromPage) sources[n].meta = meta;
      if (i.meta) sources[n].metaFromPage = true;
      return '[' + (n + 1) + ']';
    };

    const quotes = p.items.filter(i => i.kind === 'quote').slice().reverse();     // oldest first, as read
    if (quotes.length) {
      out.push('## Highlights', '');
      for (const q of quotes) out.push('> ' + q.text.replace(/\n/g, '\n> '), '', '— ' + q.title + ' ' + ref(q), '');
    }
    const pages = p.items.filter(i => i.kind === 'page');
    if (pages.length) {
      out.push('## Pages', '');
      for (const i of pages) out.push('- [' + i.title.replace(/[\[\]]/g, '') + '](' + i.url + ') — ' + (i.host || '') + ' ' + ref(i));
      out.push('');
    }
    const notes = p.items.filter(i => i.kind === 'note');
    if (notes.length) {
      out.push('## Notes', '');
      for (const i of notes) out.push('- ' + i.text.replace(/\n/g, '\n  '), '');
    }
    const chats = p.items.filter(i => i.kind === 'chat');
    for (const c of chats) {
      out.push('## ' + c.title, '');
      for (const m of c.messages) out.push('**' + (m.role === 'user' ? 'You' : 'Vex') + ':** ' + m.content, '');
    }
    if (sources.length) {
      out.push('## References', '');
      sources.forEach((s, n) => out.push((n + 1) + '. ' + PageExport.cite(s.meta, style)));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  },

  // --- the view ----------------------------------------------------------
  open(id) {
    const project = id ? this.get(id) : null;
    document.querySelector('.vex-proj-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-proj-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div class="vex-proj-box" role="dialog" aria-modal="true" aria-label="Research projects"
           style="width:min(660px,93vw);max-height:78vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div data-head style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)"></div>
        <div data-body style="overflow-y:auto;padding:6px"></div>
        <div data-foot style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)"></div>
      </div>`;

    const head = overlay.querySelector('[data-head]');
    const body = overlay.querySelector('[data-body]');
    const foot = overlay.querySelector('[data-foot]');
    const btn = (label, attr) => `<button ${attr} type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">${label}</button>`;
    const row = () => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:8px;cursor:pointer';
      r.addEventListener('mouseenter', () => { r.style.background = 'var(--vex-hover-fill,var(--surface))'; });
      r.addEventListener('mouseleave', () => { r.style.background = ''; });
      return r;
    };

    let viewing = project;

    const drawList = () => {
      head.innerHTML = `<div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Research projects</div>${btn('New project', 'data-new')}`;
      foot.textContent = 'The one in bold is where Ctrl+K → “Add This Page to Project” puts things.';
      const items = this.list();
      if (!items.length) {
        body.innerHTML = window.VexUI
          ? VexUI.emptyState('folder', 'No projects yet', 'Make one for the thing you are looking into')
          : '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">No projects yet.</div>';
      } else {
        body.innerHTML = '';
        const activeId = this.activeId();
        for (const p of items) {
          const r = row();
          const counts = {
            page: p.items.filter(i => i.kind === 'page').length,
            note: p.items.filter(i => i.kind === 'note').length,
            chat: p.items.filter(i => i.kind === 'chat').length,
            quote: p.items.filter(i => i.kind === 'quote').length,
          };
          const parts = [counts.page + ' page' + (counts.page === 1 ? '' : 's')];
          if (counts.quote) parts.push(counts.quote + ' highlight' + (counts.quote === 1 ? '' : 's'));
          if (counts.note) parts.push(counts.note + ' note' + (counts.note === 1 ? '' : 's'));
          if (counts.chat) parts.push(counts.chat + ' chat' + (counts.chat === 1 ? '' : 's'));
          r.innerHTML = `
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;color:var(--text);font-weight:${p.id === activeId ? '650' : '400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
              <div style="font-size:10.5px;color:var(--text-muted)">${esc(parts.join(' · '))}</div>
            </div>
            ${p.id === activeId ? '' : btn('Work on this', 'data-use')}
            <button data-del type="button" title="Delete" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : ''}</button>`;
          r.addEventListener('click', async (e) => {
            if (e.target.closest('[data-use]')) { this.setActive(p.id); drawList(); return; }
            if (e.target.closest('[data-del]')) {
              if (await vexConfirm({ title: 'Delete “' + p.name + '”?', message: 'Its ' + p.items.length + ' saved item' + (p.items.length === 1 ? '' : 's') + ' go with it. The pages themselves are untouched.', okLabel: 'Delete', danger: true })) { this.remove(p.id); drawList(); }
              return;
            }
            viewing = p; drawOne();
          });
          body.appendChild(r);
        }
      }
      head.querySelector('[data-new]').addEventListener('click', async () => {
        const name = await vexPrompt({ title: 'New project', message: 'What are you looking into?', label: 'Name', placeholder: 'Replacing the boiler', okLabel: 'Create' });
        if (name == null) return;
        try { viewing = this.create(name); drawOne(); }
        catch (err) { window.showToast?.(err.message, 'error'); }
      });
    };

    const drawOne = () => {
      const p = this.get(viewing && viewing.id);
      if (!p) { drawList(); return; }
      head.innerHTML = `${btn('&larr;', 'data-back')}<div style="flex:1;min-width:0;font-size:13.5px;font-weight:650;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>${btn('Open all', 'data-openall')}${btn('Copy as Markdown', 'data-export')}${btn('Save with references', 'data-save')}`;
      foot.textContent = p.items.length + ' item' + (p.items.length === 1 ? '' : 's') + (this.activeId() === p.id ? ' · this is the one you are working on' : '');

      if (!p.items.length) {
        body.innerHTML = window.VexUI
          ? VexUI.emptyState('folder-open', 'Nothing in here yet', 'Ctrl+K → “Add This Page to Project” on anything you find')
          : '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">Nothing in here yet.</div>';
      } else {
        body.innerHTML = '';
        for (const item of p.items) {
          const r = row();
          if (item.kind === 'page') {
            r.innerHTML = `
              <span style="flex:0 0 auto;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('globe', { size: 15 }) : ''}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.title)}</div>
                <div style="font-size:10.5px;color:var(--text-muted)">${esc(item.host)}</div>
              </div>`;
          } else if (item.kind === 'quote') {
            const oneLine = item.text.replace(/\s+/g, ' ').trim();
            r.innerHTML = `
              <span style="flex:0 0 auto;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('marker', { size: 15 }) : ''}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">“${esc(oneLine.length > 90 ? oneLine.slice(0, 89) + '…' : oneLine)}”</div>
                <div style="font-size:10.5px;color:var(--text-muted)">${esc(item.host)}</div>
              </div>`;
          } else if (item.kind === 'note') {
            const oneLine = item.text.replace(/\s+/g, ' ').trim();
            r.innerHTML = `
              <span style="flex:0 0 auto;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('note', { size: 15 }) : ''}</span>
              <div style="flex:1;min-width:0;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(oneLine.length > 90 ? oneLine.slice(0, 89) + '…' : oneLine)}</div>`;
          } else {
            r.innerHTML = `
              <span style="flex:0 0 auto;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('sparkles', { size: 15 }) : ''}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.title)}</div>
                <div style="font-size:10.5px;color:var(--text-muted)">${item.messages.length} message${item.messages.length === 1 ? '' : 's'}</div>
              </div>`;
          }
          const del = document.createElement('button');
          del.type = 'button'; del.setAttribute('data-del', ''); del.title = 'Remove';
          del.style.cssText = 'background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)';
          del.innerHTML = window.VexIcons ? VexIcons.svg('x', { size: 14 }) : '';
          r.appendChild(del);
          r.addEventListener('click', (e) => {
            if (e.target.closest('[data-del]')) { this.removeItem(p.id, item.id); drawOne(); return; }
            if (item.kind === 'page' || item.kind === 'quote') { try { TabManager.createTab(item.url, true); close(); } catch {} }
          });
          body.appendChild(r);
        }
      }

      head.querySelector('[data-back]').addEventListener('click', drawList);
      head.querySelector('[data-openall]').addEventListener('click', async () => {
        const pages = p.items.filter(i => i.kind === 'page');
        if (!pages.length) { window.showToast?.('There are no pages in this project'); return; }
        // Opening twenty tabs because a button was there once is a bad
        // afternoon, so say how many first.
        if (pages.length > 5 && !(await vexConfirm({ title: 'Open ' + pages.length + ' tabs?', message: 'Every page in “' + p.name + '” opens in its own tab.', okLabel: 'Open them' }))) return;
        close();
        for (const i of pages) { try { TabManager.createTab(i.url, false); } catch {} }
        window.showToast?.('Opened ' + pages.length + ' page' + (pages.length === 1 ? '' : 's'));
      });
      head.querySelector('[data-export]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.toMarkdown(p.id));
          window.showToast?.('“' + p.name + '” copied as Markdown');
        } catch (err) { window.showToast?.('Could not copy that', 'error'); }
      });
      // The cited document, as a file: highlights, pages, notes and chats,
      // with a References list in the style you pick.
      head.querySelector('[data-save]').addEventListener('click', async () => {
        const styles = [['apa', 'APA'], ['mla', 'MLA'], ['harvard', 'Harvard'], ['chicago', 'Chicago']];
        const pick = await vexPrompt({ title: 'Reference style', message: styles.map((s, i) => (i + 1) + '. ' + s[1]).join('\n'), value: '1', okLabel: 'Save' });
        if (pick == null) return;
        const style = (styles[parseInt(pick, 10) - 1] || styles[0])[0];
        try {
          const r = await window.vex.saveTextFile(p.name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 100) + '.md', this.toMarkdown(p.id, { style }), 'md');
          if (r && r.ok) window.showToast?.('Saved “' + p.name + '” with its references');
          else if (r && !r.cancelled) throw new Error(r.error || 'The file was not saved');
        } catch (err) { window.showToast?.((err && err.message) || 'Could not save it', 'error'); }
      });
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); close(); }
    };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    project ? drawOne() : drawList();
    document.body.appendChild(overlay);
    return overlay;
  },

  // --- what the commands call -------------------------------------------
  // Adding is one keystroke because there is an active project; choosing one
  // every time would mean nobody ever adds anything.
  async addCurrentPage() {
    const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    if (!tab || !tab.url) throw new Error('There is no page to add');
    if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) throw new Error('A private tab is not collected, here as everywhere');
    if (!this.active()) {
      const name = await vexPrompt({ title: 'New project', message: 'Nothing is being worked on yet. What are you looking into?', label: 'Name', placeholder: 'Replacing the boiler', okLabel: 'Create' });
      if (name == null) return null;
      this.create(name);
    }
    const p = this.addPage(tab.url, tab.title, null, await this._meta());
    window.showToast?.('Added to “' + p.name + '”');
    return p;
  },

  // What the page says about itself, for the references. A page that cannot
  // be read still goes in — cited by its title and address — and the reason
  // is recorded.
  async _meta() {
    try { return await PageExport.pageMeta(); }
    catch (err) { window.VexProblems?.note('Research projects', 'Could not read the page\'s citation details', err); return null; }
  },

  // The text selected on the page, as a highlight in the project.
  async addSelection() {
    const tab = (typeof TabManager !== 'undefined') ? TabManager.getActiveTab() : null;
    if (!tab || !tab.url) throw new Error('There is no page open');
    if (window.VexTabPolicy && !window.VexTabPolicy.canPersist(tab)) throw new Error('A private tab is not collected, here as everywhere');
    const text = await PageContext.extractSelectedText(WebviewManager.getActiveWebview());
    if (!text || !text.trim()) throw new Error('Select some text on the page first');
    if (!this.active()) throw new Error('Make a project first — Ctrl+K › Add This Page to Project starts one');
    const p = this.addQuote(text, { url: tab.url, title: tab.title, meta: await this._meta() });
    window.showToast?.('Highlight saved to “' + p.name + '”');
    return p;
  },

  async addCurrentChat() {
    // AIPanel is a top-level const, not window.AIPanel — reaching for the
    // window property alone finds nothing and the command quietly does nothing.
    const panel = (typeof AIPanel !== 'undefined' && AIPanel) || window.AIPanel;
    if (!panel || typeof panel._getConv !== 'function') throw new Error('The AI panel is not available');
    const id = panel._viewingId || (typeof TabManager !== 'undefined' ? TabManager.activeTabId : null);
    if (panel._convPrivate && panel._convPrivate[id]) throw new Error('A chat from a private tab is not collected');
    const msgs = panel._getConv(id) || [];
    if (!this.active()) throw new Error('Make a project first, or choose one to add to');
    const first = msgs.find(m => m.role === 'user');
    const p = this.addChat(msgs, first ? first.content.replace(/\s+/g, ' ').slice(0, 60) : 'Conversation');
    window.showToast?.('Conversation saved to “' + p.name + '”');
    return p;
  },
};

if (typeof window !== 'undefined') window.ResearchProjects = ResearchProjects;
if (typeof module !== 'undefined' && module.exports) module.exports = { ResearchProjects };
