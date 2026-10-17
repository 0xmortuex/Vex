// === Text clips ============================================================
//
// What you kept with Ctrl+Enter in the quick-capture box (the global hotkey,
// set in Settings; off until you set it). Main holds the list
// (src/main/capture-inbox.js), so a clip lands while Vex is hidden or behind
// a game. This is the window onto it: copy one, turn one into a note, delete
// one. Universal search reads the same list.
//
// Stamping: a clip kept with the capture box's hotkey has no page of its own, because it was typed
// into a box. Right after it lands, the page that was in front in Vex becomes its source (address and
// title, not the page's text) and, as for a clipped selection or a screenshot, it is kept under that
// page's source in Sources and citations. It follows the same switch ("Also keep a clipped selection
// and a screenshot under their page's source": Sources autoStamp), so it is off until that is ticked.
// Never from a private, Tor or routed tab or a bank, mail or sign-in page, and only while Vex is in view
// (a clip typed over a game says nothing about the tab behind it). The course is tagged by Courses
// (js/course-spaces.js), not here.
const TextClips = {
  _items: [],

  stampEnabled() {
    if (typeof VexSources === 'undefined' || typeof VexSources.prefs !== 'function') return false;
    try { const p = VexSources.prefs(); return p.enabled === true && p.autoStamp === true; }
    catch (err) { window.VexProblems?.note('Clips inbox', 'The sources setting could not be read', err); return false; }
  },

  // payload: what main sent with clips-inbox:changed. Stamps a clip that was just kept; returns the stamp or null.
  async stampNew(payload) {
    if (!payload || payload.source !== 'capture' || typeof payload.id !== 'string') return null;
    if (!this.stampEnabled()) return null;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
    const tab = await VexSources.sourceTab();
    if (!tab.url) return null;
    if (!window.vex || typeof window.vex.clipsInboxStamp !== 'function') throw new Error('The clips inbox cannot be stamped here');
    const meta = { url: tab.url, title: tab.title || '' };
    const r = await window.vex.clipsInboxStamp(payload.id, meta);
    if (!r || !r.ok) throw new Error('Could not stamp the clip');
    if (!r.stamped) return null;
    const item = (await this.list()).find(i => i.id === payload.id);
    if (item) await VexSources.keepPassage({ text: item.text, kind: 'clip' });
    return meta;
  },

  async list() {
    if (!window.vex || typeof window.vex.clipsInboxList !== 'function') throw new Error('The clips inbox is not available');
    const r = await window.vex.clipsInboxList();
    if (!r || !r.ok) throw new Error('Could not read the clips inbox');
    this._items = r.items || [];
    return this._items;
  },

  describe(item, now = Date.now()) {
    const mins = Math.round((now - item.at) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + ' h ago';
    return new Date(item.at).toLocaleDateString();
  },

  // Data hook: what is waiting, newest first, for a surface that wants to
  // show "3 clips" without owning the list.
  snapshot() {
    return { count: this._items.length, newest: this._items.slice(0, 5).map(i => ({ id: i.id, text: i.text.slice(0, 120), at: i.at })) };
  },

  async open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const { head, body, close } = window.PageExport._sheet('Clips inbox', 'vex-textclips-overlay');
    const btn = 'font-size:11px;color:var(--text-muted);background:none;border:1px solid var(--border);border-radius:6px;padding:2px 7px;cursor:pointer';
    head.insertAdjacentHTML('beforeend', `<button data-clear type="button" style="${btn}">Clear all</button>`);

    const draw = async () => {
      let items;
      try { items = await this.list(); }
      catch (err) { body.textContent = err.message; return; }
      if (!items.length) {
        body.innerHTML = window.VexUI.emptyState('clipboard', 'No clips yet', 'Open the capture box with its hotkey, type a line and press Ctrl+Enter.');
        return;
      }
      body.innerHTML = '<div data-rows style="padding:6px"></div>';
      const rows = body.querySelector('[data-rows]');
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:flex-start;gap:9px;padding:8px 9px;border-radius:8px';
        row.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);white-space:pre-wrap;word-break:break-word">${esc(item.text)}</div>
            <div style="font-size:10.5px;color:var(--text-muted)">${esc(this.describe(item))}${item.from ? ' · from ' + esc(item.from.title || item.from.url) : ''}</div>
          </div>
          <button data-copy type="button" style="${btn}">Copy</button>
          <button data-note type="button" style="${btn}">To a note</button>
          <button data-del type="button" aria-label="Delete this clip" style="${btn};display:inline-flex">${window.VexIcons.svg('trash', { size: 12 })}</button>`;
        row.querySelector('[data-copy]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(item.text); window.showToast?.('Copied'); }
          catch (err) { window.showToast?.('Could not copy that: ' + err.message, 'error'); }
        });
        row.querySelector('[data-note]').addEventListener('click', () => {
          try {
            if (typeof AgentTools === 'undefined') throw new Error('Notes are not available');
            const words = item.text.split(/\s+/);
            AgentTools.saveNote(words.slice(0, 7).join(' ').slice(0, 60) + (words.length > 7 ? '…' : ''), item.text, undefined, { origin: 'clips' });
            window.showToast?.('Saved to Notes');
          } catch (err) { window.showToast?.(err.message, 'error'); }
        });
        row.querySelector('[data-del]').addEventListener('click', async () => {
          try { await window.vex.clipsInboxRemove(item.id); await draw(); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        });
        rows.appendChild(row);
      }
    };

    head.querySelector('[data-clear]').addEventListener('click', async () => {
      if (!this._items.length) return;
      const ok = await vexConfirm({ title: 'Clear the clips inbox?', message: 'All ' + this._items.length + ' clips are deleted. This cannot be undone.', okLabel: 'Clear all', danger: true });
      if (!ok) return;
      try { await window.vex.clipsInboxClear(); await draw(); }
      catch (err) { window.showToast?.(err.message, 'error'); }
    });
    await draw();
    return close;
  },

  init() {
    if (!window.vex || typeof window.vex.onClipsInboxChanged !== 'function') return false;
    window.vex.onClipsInboxChanged((payload) => {
      this.stampNew(payload).catch(err => window.VexProblems?.note('Clips inbox', 'Could not stamp the clip with its page', err));
      this.list().catch(err => window.VexProblems?.note('Clips inbox', 'Could not refresh', err));
      if (window.UniversalSearch) window.UniversalSearch.refreshClips().catch(err => window.VexProblems?.note('Search', 'Could not refresh the clips', err));
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.TextClips = TextClips;
if (typeof module !== 'undefined' && module.exports) module.exports = { TextClips };
