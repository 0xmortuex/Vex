// === The Attention Inbox: one quiet list instead of toasts =====================
//
// Suggestions that are not urgent used to arrive as toasts, banners and cards:
// "back up your notes", "tidy these tabs", "you open these sites every
// morning", "an update is out". They now wait here, in one list behind a bell
// in the toolbar (T0-022). The bell only appears while there is something in
// the list, and its dot means "this needs you", never "something happened".
//
// Every row has the same three ways out:
//   Dismiss          this one is dealt with
//   Show less        this feature may add at most one row a day from now on
//   Never for this   this feature adds nothing here again (Settings › Attention
//                    lists what was muted, with a way back)
//
// Rows are kept in localStorage (vex.attention.inbox), so they survive a restart.
// A row's button is stored as { label, key }: the feature that wrote it registers
// what the key does with AttentionInbox.handle(feature, fn) when it loads.
//
// At most THREE dots: Vex's own dots (the panel unread badges, "new" dots, this
// bell) are counted together. The bell's dot is the first to give way: with three
// others showing, the bell shows its list but no dot.
const AttentionInbox = {
  KEY: 'vex.attention.inbox',
  ENABLED_KEY: 'vex.attention.inboxOn',
  MAX_ROWS: 50,
  MAX_DOTS: 3,
  _handlers: new Map(),
  _ui: null,

  _now() { return Date.now(); },

  // ---- on / off --------------------------------------------------------------
  enabled() { try { return localStorage.getItem(this.ENABLED_KEY) !== '0'; } catch { return true; } },
  setEnabled(on) {
    localStorage.setItem(this.ENABLED_KEY, on ? '1' : '0');
    this.refresh();
  },

  // ---- rows --------------------------------------------------------------------
  _read() {
    const raw = localStorage.getItem(this.KEY);
    if (raw === null) return [];
    let v;
    try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved inbox is not readable', { cause: err }); }
    return Array.isArray(v) ? v.filter(r => r && typeof r.id === 'string' && typeof r.title === 'string') : [];
  },
  _save(rows) { localStorage.setItem(this.KEY, JSON.stringify(rows)); },

  list() { return this._read(); },
  count() { return this._read().length; },

  // { feature, id?, title, body?, action?: { label, key }, label? } -> true when added or refreshed.
  add(row) {
    if (!row || typeof row.feature !== 'string' || !row.feature) throw new Error('An inbox row needs a feature');
    const title = String(row.title || '').trim();
    if (!title) throw new Error('An inbox row needs a title');
    if (!this.enabled()) return false;
    const rows = this._read();
    const sub = String(row.id == null ? '' : row.id);
    const same = rows.find(r => r.feature === row.feature && r.sub === sub);
    const action = row.action && typeof row.action.key === 'string' && row.action.label
      ? { label: String(row.action.label).slice(0, 30), key: String(row.action.key).slice(0, 40) } : null;
    if (same) {
      Object.assign(same, { title: title.slice(0, 140), body: String(row.body || '').slice(0, 300), action, ts: this._now() });
    } else {
      rows.unshift({
        id: 'a' + this._now().toString(36) + Math.random().toString(36).slice(2, 6),
        feature: row.feature, sub, label: String(row.label || row.feature).slice(0, 60),
        title: title.slice(0, 140), body: String(row.body || '').slice(0, 300), action, ts: this._now(),
      });
    }
    while (rows.length > this.MAX_ROWS) rows.pop();
    this._save(rows);
    this.refresh();
    return true;
  },

  remove(id) {
    const rows = this._read();
    const next = rows.filter(r => r.id !== id);
    if (next.length === rows.length) return false;
    this._save(next);
    this.refresh();
    return true;
  },

  // ---- the three verbs --------------------------------------------------------------
  dismiss(id) { return this.remove(id); },
  showLess(id) {
    const row = this._read().find(r => r.id === id);
    if (!row) return false;
    VexAttention.less(row.feature);
    this.remove(id);
    return true;
  },
  never(id) {
    const row = this._read().find(r => r.id === id);
    if (!row) return false;
    VexAttention.mute(row.feature, row.label);
    this._save(this._read().filter(r => r.feature !== row.feature));
    this.refresh();
    return true;
  },

  // ---- the row's own button ------------------------------------------------------------
  handle(feature, fn) {
    if (typeof fn !== 'function') throw new Error('An inbox handler must be a function');
    this._handlers.set(feature, fn);
  },
  run(id) {
    const row = this._read().find(r => r.id === id);
    if (!row || !row.action) return false;
    const fn = this._handlers.get(row.feature);
    if (!fn) throw new Error('"' + row.label + '" is not loaded, so its button cannot run');
    this.remove(id);
    return fn(row.action.key, row);
  },

  // ---- the dots ---------------------------------------------------------------------------
  // Other dots are marked data-vex-dot (the panel badges are).
  otherDots() { return typeof document === 'undefined' ? 0 : document.querySelectorAll('[data-vex-dot]:not([data-vex-dot="inbox"]):not([hidden])').length; },
  dotVisible() { return this.enabled() && this.count() > 0 && this.otherDots() < this.MAX_DOTS; },

  // ---- the bell ---------------------------------------------------------------------------
  refresh() {
    if (typeof document === 'undefined') return;
    const btn = document.getElementById('btn-attention');
    if (!btn) return;
    const n = this.enabled() ? this.count() : 0;
    if (!btn.querySelector('svg') && typeof VexIcons !== 'undefined') btn.insertAdjacentHTML('afterbegin', VexIcons.svg('bell', { size: 16 }));
    btn.hidden = n === 0;
    btn.setAttribute('aria-label', n ? 'Inbox, ' + n + (n === 1 ? ' suggestion' : ' suggestions') : 'Inbox');
    btn.title = n ? 'Inbox: ' + n + (n === 1 ? ' suggestion' : ' suggestions') + ' waiting' : 'Inbox';
    let dot = btn.querySelector('.attention-dot');
    if (this.dotVisible()) {
      if (!dot) { dot = document.createElement('span'); dot.className = 'attention-dot'; dot.setAttribute('data-vex-dot', 'inbox'); dot.setAttribute('aria-hidden', 'true'); btn.appendChild(dot); }
    } else if (dot) dot.remove();
    if (this._ui && n === 0) this.close();
    else if (this._ui) this._renderList();
  },

  _style() {
    if (document.getElementById('attention-inbox-style')) return;
    const st = document.createElement('style');
    st.id = 'attention-inbox-style';
    st.textContent = `
      #btn-attention { position: relative; }
      #btn-attention .attention-dot { position:absolute; top:3px; right:3px; width:8px; height:8px; border-radius:50%; background: var(--primary, #4f8cff); box-shadow: 0 0 0 2px var(--bg, #fff); }
      #attention-inbox-pop { position:fixed; z-index:9000; width:min(360px,92vw); max-height:min(70vh,520px); overflow:auto; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:12px; box-shadow:0 14px 40px rgba(0,0,0,.28); padding:10px; }
      #attention-inbox-pop h2 { margin:0 0 6px; font-size:13px; font-weight:650; }
      #attention-inbox-pop .ai-row { padding:8px 4px; border-top:1px solid var(--border); }
      #attention-inbox-pop .ai-row:first-of-type { border-top:none; }
      #attention-inbox-pop .ai-title { font-size:12.5px; font-weight:600; }
      #attention-inbox-pop .ai-body { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
      #attention-inbox-pop .ai-btns { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
      #attention-inbox-pop button { font-size:11.5px; color:var(--text); background:none; border:1px solid var(--border); border-radius:6px; padding:3px 9px; cursor:pointer; }
      #attention-inbox-pop button.ai-primary { background: var(--primary, #4f8cff); color:#fff; border-color: transparent; }
      #attention-inbox-pop .ai-foot { font-size:11px; color:var(--text-muted); margin-top:6px; }
    `;
    document.head.appendChild(st);
  },

  open() {
    if (typeof document === 'undefined') return null;
    if (this._ui) return this._ui;
    this._style();
    const pop = document.createElement('div');
    pop.id = 'attention-inbox-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Inbox');
    const btn = document.getElementById('btn-attention');
    if (btn) {
      const r = btn.getBoundingClientRect();
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      pop.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    } else { pop.style.top = '48px'; pop.style.right = '12px'; }
    document.body.appendChild(pop);
    this._ui = pop;
    this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { this.close(); btn?.focus(); } };
    this._onDoc = (e) => { if (!pop.contains(e.target) && !(btn && btn.contains(e.target))) this.close(); };
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('mousedown', this._onDoc, true);
    this._renderList();
    return pop;
  },
  close() {
    if (!this._ui) return;
    this._ui.remove();
    this._ui = null;
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('mousedown', this._onDoc, true);
  },
  toggle() { return this._ui ? (this.close(), null) : this.open(); },

  _renderList() {
    const pop = this._ui;
    if (!pop) return;
    const rows = this._read();
    pop.textContent = '';
    const h = document.createElement('h2');
    h.textContent = rows.length ? 'Waiting for you' : 'Nothing is waiting';
    pop.appendChild(h);
    const guard = (fn) => { try { const r = fn(); if (r && typeof r.catch === 'function') r.catch(e => window.showToast?.((e && e.message) || String(e), 'error')); } catch (e) { window.showToast?.((e && e.message) || String(e), 'error'); } };
    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'ai-row';
      const t = document.createElement('div'); t.className = 'ai-title'; t.textContent = row.title;
      el.appendChild(t);
      if (row.body) { const b = document.createElement('div'); b.className = 'ai-body'; b.textContent = row.body; el.appendChild(b); }
      const btns = document.createElement('div'); btns.className = 'ai-btns';
      const mk = (label, title, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; if (cls) b.className = cls; b.addEventListener('click', () => guard(fn)); btns.appendChild(b); };
      if (row.action) mk(row.action.label, 'Do it', () => this.run(row.id), 'ai-primary');
      mk('Dismiss', 'Remove this one', () => this.dismiss(row.id));
      mk('Show less', 'This feature will add at most one a day', () => { this.showLess(row.id); window.showToast?.('Shown less: at most one a day. Settings › Attention changes it back.'); });
      mk('Never for this feature', 'Stop all of this feature\'s suggestions', () => { this.never(row.id); window.showToast?.('Muted. Settings › Attention changes it back.'); });
      el.appendChild(btns);
      pop.appendChild(el);
    }
    const foot = document.createElement('div'); foot.className = 'ai-foot';
    foot.textContent = 'Nothing here interrupts you. Muted features are listed in Settings › Attention.';
    pop.appendChild(foot);
  },
};

if (typeof window !== 'undefined') {
  window.AttentionInbox = AttentionInbox;
  if (typeof document !== 'undefined') {
    const wire = () => {
      document.getElementById('btn-attention')?.addEventListener('click', () => AttentionInbox.toggle());
      document.addEventListener('vex:attention-changed', () => AttentionInbox.refresh());
      AttentionInbox.refresh();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AttentionInbox };
