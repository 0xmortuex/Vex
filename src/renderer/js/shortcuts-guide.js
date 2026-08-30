// === Vex Shortcuts & Gestures cheat-sheet ===
// Surfaces the *hidden* stuff: every keyboard shortcut (including the ones that
// aren't in the rebindable editor — Ctrl+1-9, the boss key, command-chain slots,
// zoom, nav), all six mouse gestures, and the full right-click menu. Searchable.
// Ctrl+K → "Shortcuts & Gestures".
const ShortcutsGuide = {
  KEYS: [
    ['Command bar', 'Ctrl+K'], ['New / close tab', 'Ctrl+T / Ctrl+W'], ['Reopen closed tab', 'Ctrl+Shift+T'],
    ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'], ['Jump to tab 1–9', 'Ctrl+1 … Ctrl+9'],
    ['Focus address bar', 'Ctrl+L'], ['Toggle tabs sidebar', 'Ctrl+B'], ['Find in page', 'Ctrl+F'],
    ['Back / forward', 'Alt+← / Alt+→'], ['Reload / hard reload', 'Ctrl+R / Ctrl+Shift+R'],
    ['Zoom in / out / reset', 'Ctrl++ / Ctrl+- / Ctrl+0'], ['Bookmark page', 'Ctrl+D'],
    ['Split screen', 'Ctrl+Shift+S'], ['Picture-in-Picture', 'Ctrl+Shift+P'], ['Sleep tab', 'Ctrl+Shift+Z'],
    ['Mute tab', 'Ctrl+M'], ['AI panel', 'Ctrl+Shift+A'], ['Quick ask AI', 'Ctrl+J'],
    ['Organize tabs with AI', 'Ctrl+Shift+G'], ['Remember / index page', 'Ctrl+Shift+H'],
    ['History', 'Ctrl+H'], ['Memory panel', 'Ctrl+Shift+M'], ['Notes', 'Ctrl+Shift+N'],
    ['Schedules', 'Ctrl+Shift+L'], ['Save / load session', 'Ctrl+Shift+O'], ['Reading mode', 'Ctrl+Alt+R'],
    ['Screenshot', 'Ctrl+Alt+S'], ['Theme picker', 'Ctrl+Shift+Y'], ['Private window', 'Ctrl+Alt+N'],
    ['Run command-chain 1 / 2 / 3', 'Ctrl+Alt+1 / 2 / 3'],
    ['Boss key — hide/show all windows', 'Ctrl+Alt+H'],
    ['Fullscreen', 'F11'], ['DevTools', 'F12'], ['Close overlays / popups', 'Esc'],
  ],
  GESTURES: [
    ['Back', '← drag left'], ['Forward', '→ drag right'], ['Scroll to top', '↑ drag up'],
    ['Reload', '↓ drag down'], ['Close tab', '↓ then → (down-right)'], ['Reopen last closed tab', '↓ then ← (down-left)'],
    ['New tab', '↑ then → (up-right)'], ['Duplicate tab', '↑ then ← (up-left)'],
    ['Next tab', '→ then ↓ (right-down)'], ['Previous tab', '← then ↓ (left-down)'],
  ],
  MENU: [
    ['Selection → Explain / Summarize / Translate with AI', 'right-click selected text'],
    ['Selection → Highlight', 'right-click selected text'],
    ['Selection → Search the web', 'right-click selected text'],
    ['Link → Open archived (Wayback) version', 'right-click a link'],
    ['Image → Search with Google Lens', 'right-click an image'],
    ['Image → Save / copy / zoom', 'right-click an image'],
    ['Page → Dark mode for this site (+ reset site settings)', 'right-click the page'],
    ['Spelling → replace a misspelled word', 'right-click a red-underlined word'],
    ['Tab → Duplicate · per-tab volume · keep awake · move to group', 'right-click a tab'],
    ['Group → rename · recolor · convert to a stack', 'right-click a tab-group header'],
    ['Sidebar icon → switch service (Netflix⇄Prime/Disney+ · Claude⇄Gemini/ChatGPT)', 'right-click a sidebar icon'],
  ],

  open() {
    document.getElementById('vex-shortcutsguide')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-shortcutsguide';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center';
    m.innerHTML = `<div style="width:620px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.5)">
      <div style="display:flex;align-items:center;gap:8px;padding:16px 20px 10px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">⌨️ Shortcuts &amp; Gestures</span>
        <input id="sg-filter" placeholder="Filter…" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:'Outfit',sans-serif;width:150px">
        <button id="sg-close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif">✕</button>
      </div>
      <div id="sg-body" style="overflow-y:auto;padding:4px 20px 20px;font-size:12.5px;color:var(--text)"></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    m.querySelector('#sg-close').addEventListener('click', () => m.remove());
    const filter = m.querySelector('#sg-filter');
    filter.addEventListener('input', () => this._render(m, filter.value.trim().toLowerCase()));
    filter.focus();
    this._render(m, '');
  },

  _section(title, rows, q, keycol) {
    const esc = (s) => window.escapeHtml ? window.escapeHtml(String(s)) : String(s);
    const hits = rows.filter(([a, b]) => !q || (a + ' ' + b).toLowerCase().includes(q));
    if (!hits.length) return '';
    return `<div style="font-weight:700;margin:14px 0 6px">${title}</div>` + hits.map(([a, b]) =>
      `<div style="display:flex;align-items:center;gap:10px;padding:5px 2px;border-bottom:1px solid var(--border)">
        <span style="flex:1">${esc(a)}</span>
        <span style="flex-shrink:0;font-family:monospace;font-size:11.5px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:2px 7px">${esc(b)}</span>
      </div>`).join('');
  },

  _render(m, q) {
    const body = m.querySelector('#sg-body'); if (!body) return;
    let html = this._section('⌨️ Keyboard', this.KEYS, q) +
               this._section('🖱️ Mouse gestures (hold right button + drag)', this.GESTURES, q) +
               this._section('📋 Right-click menu', this.MENU, q);
    if (!html) html = '<div style="color:var(--text-muted);padding:16px 0">No matches.</div>';
    else html += '<div style="font-size:11px;color:var(--text-muted);margin-top:14px">Rebind keyboard shortcuts in Settings → Keyboard Shortcuts. Gestures toggle in Settings → Browsing extras.</div>';
    body.innerHTML = html;
  },
};

if (typeof window !== 'undefined') window.ShortcutsGuide = ShortcutsGuide;
