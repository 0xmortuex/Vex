// === What can I press right now? ===========================================
//
// Vex has more than sixty keyboard shortcuts and gained eleven in one release.
// They were all listed in Settings, which is a page you have to decide to go
// and read — and nobody decides to go and read a list of keys. So the keys
// existed and went unused, which is the same as not having them.
//
// This is the other way round: one key, and the list appears over whatever you
// are doing, with the ones that work HERE first. A shortcut you meet at the
// moment you could have used it is a shortcut you learn.
//
// Deliberately not a settings page: nothing here can be changed, because a
// reference you can break is a reference you open carefully. Editing has its
// own screen and there is a way through to it.
const KeysSheet = {
  // Where you are decides which keys are worth showing first. These are
  // judgements about relevance, not about what works: everything in Vex works
  // everywhere, and the sheet shows all of it either way.
  WHERE: [
    { id: 'ai', name: 'The AI panel is open', cats: ['AI'], when: () => !!document.querySelector('#ai-panel.open') },
    { id: 'panel', name: 'A panel is open', cats: ['Panels'], when: () => !!(typeof SidebarManager !== 'undefined' && SidebarManager.activePanel) },
    { id: 'page', name: 'On a web page', cats: ['Navigation', 'Tabs'], when: () => {
      try { const t = TabManager.getActiveTab(); return !!(t && /^https?:/i.test(t.url || '')); } catch { return false; }
    } },
  ],

  here() {
    const hits = [];
    for (const w of this.WHERE) {
      try { if (w.when()) hits.push(w); } catch { /* a place that cannot be asked is not here */ }
    }
    return hits;
  },

  // Every bound key, grouped by category, with the relevant categories first
  // and anything unbound or unhandled left out — a list of keys that do
  // nothing is worse than no list.
  rows() {
    if (typeof ShortcutsRegistry === 'undefined') return [];
    let all = {};
    try { all = ShortcutsRegistry.getAllShortcuts() || {}; }
    catch (err) { console.warn('[KeysSheet] could not read the shortcuts:', err.message); return []; }
    const relevant = new Set(this.here().flatMap(w => w.cats));
    const groups = new Map();
    for (const [id, d] of Object.entries(all)) {
      if (!d || !d.current || d.hasHandler === false) continue;
      const cat = d.category || 'Other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({ id, keys: d.current, label: d.label || id, isCustom: !!d.isCustom });
    }
    return [...groups.entries()]
      .map(([name, keys]) => ({ name, here: relevant.has(name), keys: keys.sort((a, b) => a.label.localeCompare(b.label)) }))
      .sort((a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || a.name.localeCompare(b.name));
  },

  // Ctrl+Shift+K shows it; the same key, Escape, or clicking away hides it.
  toggle() { return document.getElementById('vex-keys') ? this.close() : this.open(); },
  close() { document.getElementById('vex-keys')?.remove(); return null; },

  open() {
    if (typeof document === 'undefined') return null;
    this.close();
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    const groups = this.rows();
    const where = this.here().map(w => w.name);
    const el = document.createElement('div');
    el.id = 'vex-keys';
    el.className = 'vexkeys-ov';
    el.innerHTML = '<div class="vexkeys" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">'
      + '<div class="vexkeys-head">'
      + '<div><h2>What you can press</h2><p>'
      + (where.length ? esc(where[0]) + ' — those keys are first.' : 'Every key Vex answers to.')
      + '</p></div>'
      + '<button class="vexkeys-x" aria-label="Close">×</button></div>'
      + '<div class="vexkeys-body">'
      + (groups.length
        ? groups.map(g => '<div class="vexkeys-group' + (g.here ? ' here' : '') + '">'
            + '<div class="vexkeys-cat">' + esc(g.name) + (g.here ? '<span>here</span>' : '') + '</div>'
            + g.keys.map(k => '<div class="vexkeys-row"><span class="vexkeys-label">' + esc(k.label)
                + (k.isCustom ? '<i>yours</i>' : '') + '</span>' + this._keys(k.keys) + '</div>').join('')
            + '</div>').join('')
        : '<div class="vexkeys-empty">No shortcuts are bound.</div>')
      + '</div>'
      + '<div class="vexkeys-foot"><span>Nothing here can be changed by accident.</span>'
      + '<button class="vexkeys-edit" type="button">Change these keys…</button></div>'
      + '</div>';
    document.body.appendChild(el);

    el.querySelector('.vexkeys-x').addEventListener('click', () => this.close());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
    el.querySelector('.vexkeys-edit').addEventListener('click', () => {
      this.close();
      try { SettingsUI.openSection('shortcuts-editor-content'); }
      catch { try { SidebarManager.openPanel('settings'); } catch (err) { window.showToast?.(err.message, 'error'); } }
    });
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.close(); } };
    window.addEventListener('keydown', this._onKey, true);
    return el;
  },

  // "Ctrl+Shift+K" as three keycaps, because a keycap is read as a key and a
  // string of text is read as text.
  _keys(combo) {
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v)) : String(v));
    return '<span class="vexkeys-combo">'
      + String(combo).split('+').map(k => '<kbd>' + esc(k.trim()) + '</kbd>').join('')
      + '</span>';
  },
};

if (typeof window !== 'undefined') {
  window.KeysSheet = KeysSheet;
  // Cleaning up the Escape listener belongs with the close, not with the page.
  const realClose = KeysSheet.close.bind(KeysSheet);
  KeysSheet.close = function close() {
    if (this._onKey) { window.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    return realClose();
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { KeysSheet };
