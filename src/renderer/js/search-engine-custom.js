// === Settings › General › Default search engine › Add your own… ===========
//
// Only the six built-in engines could be chosen. Now one of your own can be
// added: a name and an address with %s where the words go
// (VexTypedAddress.checkCustomEngine says what is accepted). Added, it is the
// default for the address bar, Ctrl+K and the New Tab box, which all search
// through VexTypedAddress. It can be edited, or removed: removing it while it
// is the default goes back to the built-in engine chosen before it, and says
// so. Reset to Defaults clears it (app.js SETTINGS_PREF_KEYS).
//
// The New Tab page keeps its own storage, so it is handed the engine (and
// this one's name and address, for its letter) each time it loads
// (js/webview.js) and whenever the choice changes here (pushStartPages).
const CustomSearchEngineUI = {
  ADD: 'add-custom',

  _select() {
    const sel = document.getElementById('setting-search-engine');
    if (!sel) throw new Error('[CustomSearchEngineUI] #setting-search-engine missing');
    return sel;
  },

  // The list's own engine and its "Add your own…" entry, and the row under
  // it with Edit and Remove.
  render() {
    const TA = VexTypedAddress;
    const sel = this._select();
    sel.querySelectorAll('option[data-own]').forEach(o => o.remove());
    const own = TA.customEngine();
    if (own) {
      const opt = document.createElement('option');
      opt.value = TA.CUSTOM_ID; opt.textContent = own.name; opt.dataset.own = '1';
      sel.appendChild(opt);
    } else {
      const add = document.createElement('option');
      add.value = this.ADD; add.textContent = 'Add your own…'; add.dataset.own = '1';
      sel.appendChild(add);
    }
    sel.value = TA.currentEngine();
    const row = document.getElementById('setting-search-own');
    if (!row) throw new Error('[CustomSearchEngineUI] #setting-search-own missing');
    row.hidden = !own; row.style.display = own ? '' : 'none';   // the row class's display: flex beats [hidden]
    if (own) {
      row.querySelector('[data-own-name]').textContent = own.name;
      row.querySelector('[data-own-url]').textContent = own.q;
      row.querySelector('[data-own-edit]').setAttribute('aria-label', 'Edit the search engine ' + own.name);
      row.querySelector('[data-own-remove]').setAttribute('aria-label', 'Remove the search engine ' + own.name);
    }
  },

  // Asks for the name and the address; asks again, saying why, until they
  // are right or the person cancels. → { name, q } or null.
  async _ask(start) {
    let name = start ? start.name : '';
    let q = start ? start.q : '';
    let why = '';
    const title = start ? 'Edit your search engine' : 'Add your own search engine';
    for (;;) {
      const n = await window.vexPrompt({ title, message: (why ? why + '. ' : '') + 'Its name, as the address bar and the New Tab page show it.', label: 'Name', value: name, placeholder: 'My search', okLabel: 'Next' });
      if (n == null) return null;
      name = n;
      const a = await window.vexPrompt({ title, message: 'Its search address, with %s where the words you type go.', label: 'Address', value: q, placeholder: 'https://example.com/search?q=%s', okLabel: 'Save' });
      if (a == null) return null;
      q = a;
      try { return VexTypedAddress.checkCustomEngine({ name, q }); }
      catch (err) { why = err.message; }
    }
  },

  _store(engine, previous) {
    localStorage.setItem(VexTypedAddress.CUSTOM_KEY, JSON.stringify({ name: engine.name, q: engine.q, previous }));
  },

  // The Settings list's own change event saves the choice (app.js).
  _choose(id) {
    const sel = this._select();
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
  },

  // "Add your own…" chosen in the list. `was` is the engine chosen before.
  async add(was) {
    const TA = VexTypedAddress;
    this._select().value = TA.engineOf(was);
    const engine = await this._ask(null);
    if (!engine) return false;
    const previous = TA.SEARCH_ENGINES[was] ? was : TA.currentEngine();
    this._store(engine, TA.SEARCH_ENGINES[previous] ? previous : 'google');
    this.render();
    this._choose(TA.CUSTOM_ID);
    window.showToast?.('Searching with ' + engine.name + ' — from the address bar, Ctrl+K and the New Tab page');
    return true;
  },

  async edit() {
    const TA = VexTypedAddress;
    const own = TA.customEngine();
    if (!own) throw new Error('There is no search engine of your own to edit');
    const engine = await this._ask(own);
    if (!engine) return false;
    this._store(engine, own.previous);
    this.render();
    this.pushStartPages();
    window.showToast?.('Saved ' + engine.name);
    return true;
  },

  // Removing the default goes back to the built-in engine chosen before it.
  remove() {
    const TA = VexTypedAddress;
    const own = TA.customEngine();
    if (!own) throw new Error('There is no search engine of your own to remove');
    const wasDefault = TA.currentEngine() === TA.CUSTOM_ID;
    localStorage.removeItem(TA.CUSTOM_KEY);
    this.render();
    if (wasDefault) {
      this._choose(own.previous);
      window.showToast?.('Removed ' + own.name + ' — searching with ' + TA.SEARCH_ENGINES[own.previous].name + ' again');
    } else {
      this.pushStartPages();
      window.showToast?.('Removed ' + own.name);
    }
  },

  // Every open New Tab page shows the engine chosen now.
  pushStartPages() {
    if (typeof WebviewManager === 'undefined' || !WebviewManager.webviews) return;
    const js = VexTypedAddress.startPageEngineJs();
    for (const wv of WebviewManager.webviews.values()) {
      let url = '';
      try { url = wv.getURL(); } catch { continue; }   // not attached yet: handed it when it loads
      if (!_isTrustedStartPage(url)) continue;
      wv.executeJavaScript(js).catch(err => console.error('[Search] could not hand a New Tab page the search engine:', err));
    }
  },

  init() {
    const row = document.getElementById('setting-search-own');
    if (!row) throw new Error('[CustomSearchEngineUI] #setting-search-own missing');
    row.querySelector('[data-own-edit]').addEventListener('click', () => {
      this.edit().catch(err => window.showToast?.(err.message, 'error'));
    });
    row.querySelector('[data-own-remove]').addEventListener('click', () => {
      try { this.remove(); } catch (err) { window.showToast?.(err.message, 'error'); }
    });
    this.render();
  },
};

if (typeof window !== 'undefined') window.CustomSearchEngineUI = CustomSearchEngineUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { CustomSearchEngineUI };
