// === Snippets — stop retyping the same paragraph ===
//
// Your address. Your bank details for an invoice. The three-line reply you send
// to the same kind of email every week. The support template with the ticket
// format in it. Everyone retypes something, and the usual answer is a notes app
// you copy out of, which is two context switches for four words.
//
// A snippet is an abbreviation and the text it becomes. Type the abbreviation
// in any box on any page, press Tab, and it is the text.
//
// WHERE THE WORK HAPPENS: the expansion is done by the guest preload
// (preload-webview.js), because the caret is in the page and nowhere else. This
// module owns the list and pushes it down to every tab. The page never asks for
// the list and never sees one it was not given.
//
// Tab, and only when the word right before the caret is one of yours. Nothing
// fires while you type: an expander that goes off inside a word you were
// halfway through is worse than retyping.

const Snippets = {
  KEY: 'vex.snippets',
  MAX: 200,
  MAX_TEXT: 8000,
  items: [],

  init() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      this.items = Array.isArray(a) ? a.filter(s => s && typeof s.abbr === 'string' && typeof s.text === 'string') : [];
    } catch { this.items = []; }
    return this;
  },

  save() {
    this.items = this.items.slice(0, this.MAX);
    try { localStorage.setItem(this.KEY, JSON.stringify(this.items)); } catch {}
    this.pushToTabs();
  },

  list() { return this.items.slice(); },

  // An abbreviation has to be typeable and has to not be a word you use, or it
  // will fire when you did not mean it to. The guest matches on the token
  // before the caret, so whitespace in one could never be reached.
  normalise(abbr) {
    const a = String(abbr == null ? '' : abbr).trim();
    if (!a) throw new Error('Give the snippet an abbreviation');
    if (/\s/.test(a)) throw new Error('An abbreviation cannot contain spaces');
    if (a.length > 40) throw new Error('That abbreviation is too long to be worth typing');
    if (!/^[A-Za-z0-9_;:@\-\/\\.]+$/.test(a)) throw new Error('Use letters, digits, or . - _ ; : @ / in an abbreviation');
    return a;
  },

  add(abbr, text, name) {
    const a = this.normalise(abbr);
    const body = String(text == null ? '' : text);
    if (!body) throw new Error('Give the snippet some text to expand into');
    if (body.length > this.MAX_TEXT) throw new Error('That snippet is too long');
    if (this.items.some(s => s.abbr === a)) throw new Error('“' + a + '” is already a snippet');
    const item = { id: window.vexId ? window.vexId('snip') : 'snip-' + Date.now(), abbr: a, text: body, name: String(name || '').slice(0, 80), at: Date.now() };
    this.items.unshift(item);
    this.save();
    return item;
  },

  update(id, { abbr, text, name }) {
    const item = this.items.find(s => s.id === id);
    if (!item) throw new Error('That snippet is gone');
    if (abbr != null) {
      const a = this.normalise(abbr);
      if (this.items.some(s => s.abbr === a && s.id !== id)) throw new Error('“' + a + '” is already a snippet');
      item.abbr = a;
    }
    if (text != null) {
      const body = String(text);
      if (!body) throw new Error('Give the snippet some text to expand into');
      if (body.length > this.MAX_TEXT) throw new Error('That snippet is too long');
      item.text = body;
    }
    if (name != null) item.name = String(name).slice(0, 80);
    this.save();
    return item;
  },

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(s => s.id !== id);
    if (this.items.length !== before) this.save();
  },

  // What the guest needs, and nothing else: no ids, no names, no timestamps.
  forGuest() { return this.items.map(s => ({ abbr: s.abbr, text: s.text })); },

  // Every open tab gets the current list. Sending to a webview that is still
  // loading throws, so each send stands alone.
  pushToTabs() {
    const list = this.forGuest();
    let sent = 0;
    for (const wv of document.querySelectorAll('webview')) {
      try { wv.send('vex-snippets', list); sent++; } catch { /* not ready yet; dom-ready will */ }
    }
    return sent;
  },

  // A new or reloaded page starts with no list, so it is given one.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('dom-ready', () => {
      try { webview.send('vex-snippets', this.forGuest()); } catch { /* gone */ }
    });
  },

  // --- The list you manage them in --------------------------------------
  openManager() {
    document.querySelector('.vex-snip-overlay')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const overlay = document.createElement('div');
    overlay.className = 'vex-snip-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.38);display:grid;place-items:start center;padding-top:8vh';
    overlay.innerHTML = `
      <div class="vex-snip-box" role="dialog" aria-modal="true" aria-label="Snippets"
           style="width:min(640px,92vw);max-height:76vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45));overflow:hidden">
        <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)">
          <div style="flex:1;font-size:13.5px;font-weight:650;color:var(--text)">Snippets</div>
          <button data-add type="button" style="font-size:11.5px;color:var(--text);background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer">New snippet</button>
        </div>
        <div data-list style="overflow-y:auto;padding:6px"></div>
        <div style="padding:8px 14px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
          Type the abbreviation in any box on any page and press <b>Tab</b>. Nothing expands while you type.
        </div>
      </div>`;

    const listEl = overlay.querySelector('[data-list]');
    const draw = () => {
      const items = this.list();
      if (!items.length) {
        listEl.innerHTML = window.VexUI
          ? VexUI.emptyState('type', 'No snippets yet', 'Make one for the thing you retype most')
          : '<div style="padding:26px;text-align:center;font-size:12.5px;color:var(--text-muted)">No snippets yet.</div>';
        return;
      }
      listEl.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:8px;cursor:pointer';
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--vex-hover-fill,var(--surface))'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        const oneLine = item.text.replace(/\s+/g, ' ').trim();
        row.innerHTML = `
          <code style="flex:0 0 auto;font-size:11.5px;background:var(--surface);border:1px solid var(--border);border-radius:5px;padding:2px 6px;color:var(--primary)">${esc(item.abbr)}</code>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(oneLine.length > 70 ? oneLine.slice(0, 69) + '…' : oneLine)}</div>
            ${item.name ? `<div style="font-size:10.5px;color:var(--text-muted)">${esc(item.name)}</div>` : ''}
          </div>
          <button data-edit type="button" title="Edit" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('edit', { size: 14 }) : ''}</button>
          <button data-del type="button" title="Delete" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--text-muted)">${window.VexIcons ? VexIcons.svg('x', { size: 14 }) : ''}</button>`;
        row.addEventListener('click', async (e) => {
          if (e.target.closest('[data-del]')) {
            if (await vexConfirm({ title: 'Delete “' + item.abbr + '”?', message: 'The snippet is removed from every tab.', okLabel: 'Delete', danger: true })) { this.remove(item.id); draw(); }
            return;
          }
          await this._edit(item);
          draw();
        });
        listEl.appendChild(row);
      }
    };

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== 'Escape') return;
      // The editor sits on top. Escape closes that first and leaves the list
      // open — closing both at once would throw away what was being typed.
      if (document.querySelector('.vex-snip-editor')) return;
      e.preventDefault();
      close();
    };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-add]').addEventListener('click', async () => { await this._edit(null); draw(); });
    document.addEventListener('keydown', onKey, true);
    draw();
    document.body.appendChild(overlay);
    return overlay;
  },

  // Its own editor rather than vexPrompt, because the text is the point and
  // vexPrompt is one line: "the three-line reply I send every week" is exactly
  // the thing worth having a snippet for.
  _edit(item) {
    return new Promise((resolve) => {
      const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
      const form = document.createElement('div');
      form.className = 'vex-snip-editor';
      form.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.42);display:grid;place-items:center';
      form.innerHTML = `
        <div role="dialog" aria-modal="true" aria-label="${item ? 'Edit snippet' : 'New snippet'}"
             style="width:min(560px,92vw);background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 18px 50px var(--vex-shadow-color,rgba(0,0,0,0.45))">
          <div style="font-size:13.5px;font-weight:650;color:var(--text)">${item ? 'Edit ' + esc(item.abbr) : 'New snippet'}</div>
          <label style="font-size:11.5px;color:var(--text-muted)" for="snip-abbr">Abbreviation — what you type, then Tab</label>
          <input id="snip-abbr" type="text" placeholder=";addr" value="${esc(item ? item.abbr : '')}"
                 style="font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <label style="font-size:11.5px;color:var(--text-muted)" for="snip-text">What it becomes</label>
          <textarea id="snip-text" rows="6" placeholder="12 Bridge Street&#10;Manchester M1 2AB"
                    style="font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text);resize:vertical">${esc(item ? item.text : '')}</textarea>
          <label style="font-size:11.5px;color:var(--text-muted)" for="snip-name">A name for it, if the text alone isn't obvious (optional)</label>
          <input id="snip-name" type="text" placeholder="Home address" value="${esc(item ? item.name : '')}"
                 style="font:inherit;font-size:13px;padding:7px 9px;border-radius:7px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
          <div data-err role="alert" style="display:none;font-size:11.5px;color:var(--danger,#e5534b)"></div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:2px">
            <button data-cancel type="button" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:1px solid var(--border);background:none;color:var(--text);cursor:pointer">Cancel</button>
            <button data-save type="button" style="font:inherit;font-size:12px;padding:6px 12px;border-radius:7px;border:none;background:var(--primary);color:#fff;cursor:pointer">Save</button>
          </div>
        </div>`;

      const errEl = form.querySelector('[data-err]');
      const close = (result) => { form.remove(); document.removeEventListener('keydown', onKey, true); resolve(result); };
      // A handler whose form is no longer on the page must not swallow the key
      // — it would stop the editor that IS open from ever seeing Escape.
      const onKey = (e) => {
        if (!form.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close(null);
      };
      form.querySelector('[data-cancel]').addEventListener('click', () => close(null));
      form.addEventListener('mousedown', (e) => { if (e.target === form) close(null); });
      form.querySelector('[data-save]').addEventListener('click', () => {
        const abbr = form.querySelector('#snip-abbr').value;
        const text = form.querySelector('#snip-text').value;
        const name = form.querySelector('#snip-name').value;
        try {
          const saved = item ? this.update(item.id, { abbr, text, name }) : this.add(abbr, text, name);
          window.showToast?.('Type ' + saved.abbr + ' then Tab, in any box on any page');
          close(saved);
        } catch (err) {
          // Said here, next to the field, rather than in a toast that covers it.
          errEl.textContent = err.message;
          errEl.style.display = '';
        }
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(form);
      form.querySelector('#snip-abbr').focus();
    });
  },
};

if (typeof window !== 'undefined') window.Snippets = Snippets;
if (typeof module !== 'undefined' && module.exports) module.exports = { Snippets };
