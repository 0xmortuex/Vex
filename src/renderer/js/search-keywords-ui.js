// === Settings › General › Search keywords ====================================
//
// Keywords could only be added by editing vex.searchKeywords by hand, and the
// built-in ones were listed nowhere (found 2026-10-10). Here you see both, add
// a site of your own ("jira" -> https://my.jira/browse?q=%s) and take one off.
const SearchKeywordsUI = {
  render() {
    const list = document.getElementById('setting-search-keywords');
    if (!list) throw new Error('[SearchKeywordsUI] #setting-search-keywords missing');
    list.textContent = '';
    const mine = SearchShortcuts.userKeywords();
    const row = (kw, text, removable) => {
      const el = document.createElement('div');
      el.className = 'setting-toggle-row search-keyword-row';
      const label = document.createElement('span');
      const code = document.createElement('code');
      code.textContent = kw;
      label.append(code, ' ' + text);
      el.appendChild(label);
      if (removable) {
        const btn = document.createElement('button');
        btn.className = 'btn-secondary';
        btn.type = 'button';
        btn.textContent = 'Remove';
        btn.setAttribute('aria-label', 'Remove the keyword ' + kw);
        btn.addEventListener('click', () => {
          try { SearchShortcuts.removeUserKeyword(kw); this.render(); window.showToast?.('Removed ' + kw); }
          catch (err) { window.showToast?.(err.message, 'error'); }
        });
        el.appendChild(btn);
      }
      list.appendChild(el);
    };
    for (const kw of Object.keys(mine).sort()) row(kw, '→ ' + mine[kw], true);
    const builtIn = Object.keys(SearchShortcuts.BUILTINS).filter(kw => !(kw in mine))
      .map(kw => (SearchShortcuts.BARE.has(kw) ? kw : '@' + kw) + ' ' + (SearchShortcuts.NAMES[kw] || kw));
    const note = document.createElement('div');
    note.className = 'search-keyword-builtins';
    note.style.cssText = 'color:var(--text-muted);font-size:11px;margin-top:6px';
    note.textContent = 'Built in: ' + builtIn.join(' · ');
    list.appendChild(note);
  },

  async add() {
    const kw = await window.vexPrompt({ title: 'Add a search keyword', message: 'One short word, typed before what you search for.', label: 'Keyword', placeholder: 'jira' });
    if (kw == null) return;
    const url = await window.vexPrompt({ title: 'Where "' + kw.trim() + '" searches', message: 'The site’s search address, with %s where your words go.', label: 'Address', placeholder: 'https://example.com/search?q=%s' });
    if (url == null) return;
    try {
      const saved = SearchShortcuts.setUserKeyword(kw, url);
      this.render();
      window.showToast?.('Type "' + saved + ' something" in the address bar to search there');
    } catch (err) { window.showToast?.(err.message, 'error'); }
  },

  init() {
    const add = document.getElementById('setting-search-keyword-add');
    if (!add) throw new Error('[SearchKeywordsUI] #setting-search-keyword-add missing');
    add.addEventListener('click', () => { this.add().catch(err => window.showToast?.(err.message, 'error')); });
    this.render();
  },
};

if (typeof window !== 'undefined') window.SearchKeywordsUI = SearchKeywordsUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SearchKeywordsUI };
