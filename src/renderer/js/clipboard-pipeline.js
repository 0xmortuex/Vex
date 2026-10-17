// === Clipboard pipeline ===
//
// Chain small text transforms — strip tracking parameters, convert to
// markdown, title-case, trim, remove duplicate lines — and save a chain as a
// named preset. Used from Ctrl+K › "Clipboard pipeline" or by running a preset
// on the text selected in the open page.
//
// What it will and will not touch:
//   - It acts only when you ask: you paste into its box, press "Use the page
//     selection", or run a preset from Ctrl+K. Nothing runs in the background.
//   - It NEVER reads the system clipboard on its own. The text you paste into
//     its box arrives by your own Ctrl+V; the result goes back with a button.
//   - The page selection is not read from private, Tor or routed tabs.
//   - Transforms are fixed, pure string functions: no network, no scripts.
//
// Presets are stored under 'vex.clipPipeline' (names and step lists only,
// never any text that went through them).

const ClipboardPipeline = {
  KEY: 'vex.clipPipeline',
  MAX_PRESETS: 30,
  MAX_TEXT: 200000,

  // Query parameters that only track where a click came from.
  TRACKING: [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^gclsrc$/i, /^dclid$/i, /^msclkid$/i, /^yclid$/i, /^mc_eid$/i, /^mc_cid$/i,
    /^igshid$/i, /^igsh$/i, /^ref_src$/i, /^ref_url$/i, /^_hsenc$/i, /^_hsmi$/i, /^mkt_tok$/i, /^vero_id$/i, /^oly_enc_id$/i, /^oly_anon_id$/i,
    /^s_cid$/i, /^cmpid$/i, /^spm$/i, /^scid$/i, /^trk$/i, /^trkid$/i, /^si$/i],

  _stripUrl(raw) {
    let u;
    try { u = new URL(raw); } catch { return raw; }
    if (!/^https?:$/.test(u.protocol)) return raw;
    let changed = false;
    for (const key of [...u.searchParams.keys()]) {
      if (this.TRACKING.some(re => re.test(key))) { u.searchParams.delete(key); changed = true; }
    }
    if (!changed) return raw;
    return u.toString();
  },

  // id → { name, hint, run(text) }
  TRANSFORMS: {
    'strip-tracking': {
      name: 'Strip tracking parameters', hint: 'Removes utm_*, fbclid, gclid and similar from every web address',
      run(text) {
        return text.replace(/https?:\/\/[^\s<>"')\]]+/gi, (m) => {
          // Trailing sentence punctuation is not part of the address.
          const tail = /[.,;:!?]+$/.exec(m);
          const core = tail ? m.slice(0, -tail[0].length) : m;
          return ClipboardPipeline._stripUrl(core) + (tail ? tail[0] : '');
        });
      },
    },
    'to-markdown': {
      name: 'Convert to markdown', hint: 'Bullets and numbering become markdown lists; bare addresses become links',
      run(text) {
        return text.split(/\r?\n/).map(line => {
          let l = line.replace(/^(\s*)[•◦–—·*]\s+/, '$1- ');
          l = l.replace(/^(\s*)(\d{1,3})[).]\s+/, '$1$2. ');
          return l;
        }).join('\n')
          .replace(/(^|[^(<\[])(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g, '$1<$2>')
          .replace(/\n{3,}/g, '\n\n');
      },
    },
    'title-case': {
      name: 'Title Case', hint: 'Capitalises each word, leaving small joining words lower-case',
      run(text) {
        const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'vs', 'via']);
        return text.replace(/[^\s]+/g, (w, offset) => {
          if (/^https?:\/\//i.test(w) || /^\S+@\S+$/.test(w)) return w;
          const lower = w.toLowerCase();
          const bare = lower.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
          if (offset > 0 && small.has(bare)) return lower;
          return lower.replace(/[a-zÀ-ɏ]/, (c) => c.toUpperCase());
        });
      },
    },
    'trim': {
      name: 'Trim', hint: 'Removes spaces at the ends of every line and blank lines at the ends of the text',
      run(text) { return text.split(/\r?\n/).map(l => l.replace(/[ \t ]+$/g, '').replace(/^[ \t ]+/, '')).join('\n').replace(/^\n+|\n+$/g, ''); },
    },
    'dedupe-lines': {
      name: 'Remove duplicate lines', hint: 'Keeps the first copy of every line, in order',
      run(text) { const seen = new Set(); return text.split(/\r?\n/).filter(l => (seen.has(l) ? false : (seen.add(l), true))).join('\n'); },
    },
    'remove-empty-lines': {
      name: 'Remove empty lines', hint: 'Deletes lines that are blank',
      run(text) { return text.split(/\r?\n/).filter(l => l.trim() !== '').join('\n'); },
    },
    'collapse-spaces': {
      name: 'Collapse spaces', hint: 'Turns runs of spaces and tabs inside a line into one space',
      run(text) { return text.split(/\r?\n/).map(l => l.replace(/[ \t ]{2,}/g, ' ')).join('\n'); },
    },
    'lowercase': { name: 'lowercase', hint: 'Lower-cases everything', run(text) { return text.toLowerCase(); } },
    'uppercase': { name: 'UPPERCASE', hint: 'Upper-cases everything', run(text) { return text.toUpperCase(); } },
  },

  BUILTIN: [
    { id: 'builtin-clean-link', name: 'Clean link', steps: ['strip-tracking', 'trim'], builtin: true },
    { id: 'builtin-tidy-list', name: 'Tidy list', steps: ['trim', 'remove-empty-lines', 'dedupe-lines'], builtin: true },
    { id: 'builtin-markdown', name: 'Notes to markdown', steps: ['trim', 'to-markdown'], builtin: true },
  ],

  // Runs the steps in order. An unknown step is an error, not a skip.
  run(text, steps) {
    let out = String(text == null ? '' : text);
    if (out.length > this.MAX_TEXT) throw new Error('That text is longer than ' + this.MAX_TEXT + ' characters');
    if (!Array.isArray(steps)) throw new Error('A pipeline is a list of steps');
    for (const id of steps) {
      const t = Object.hasOwn(this.TRANSFORMS, id) ? this.TRANSFORMS[id] : null;
      if (!t) throw new Error('Unknown step: ' + String(id).slice(0, 40));
      out = t.run(out);
    }
    return out;
  },

  // --- presets -------------------------------------------------------------
  presets() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { raw = []; }
    const mine = (Array.isArray(raw) ? raw : []).filter(p => p && typeof p === 'object'
      && typeof p.id === 'string' && /^cp_[a-z0-9]{3,24}$/.test(p.id)
      && typeof p.name === 'string' && p.name.trim()
      && Array.isArray(p.steps) && p.steps.length && p.steps.length <= 12 && p.steps.every(s => Object.hasOwn(this.TRANSFORMS, s)))
      .map(p => ({ id: p.id, name: p.name.trim().slice(0, 60), steps: p.steps.slice() }))
      .slice(0, this.MAX_PRESETS);
    return [...this.BUILTIN, ...mine];
  },
  _mine() { return this.presets().filter(p => !p.builtin); },
  _save(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list.map(p => ({ id: p.id, name: p.name, steps: p.steps })))); }
    catch (err) { throw new Error('The preset could not be saved: ' + ((err && err.message) || err)); }
  },
  savePreset(name, steps, id) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('Give the preset a name');
    if (!Array.isArray(steps) || !steps.length) throw new Error('Pick at least one step');
    if (!steps.every(s => Object.hasOwn(this.TRANSFORMS, s))) throw new Error('A preset holds known steps only');
    if (this.BUILTIN.some(b => b.name.toLowerCase() === n.toLowerCase())) throw new Error('That name belongs to a built-in preset');
    const list = this._mine();
    const existing = id ? list.find(p => p.id === id) : list.find(p => p.name.toLowerCase() === n.toLowerCase());
    if (existing) { existing.name = n; existing.steps = steps.slice(); this._save(list); this._registerCommands(); return existing.id; }
    if (list.length >= this.MAX_PRESETS) throw new Error('That is the most presets Vex keeps (' + this.MAX_PRESETS + ')');
    const nid = 'cp_' + Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 5);
    list.push({ id: nid, name: n, steps: steps.slice() });
    this._save(list);
    this._registerCommands();
    return nid;
  },
  deletePreset(id) {
    this._save(this._mine().filter(p => p.id !== id));
    this._registerCommands();
  },

  // --- the page selection (only when asked) --------------------------------
  async pageSelection() {
    const tab = typeof TabManager !== 'undefined' && TabManager.getActiveTab ? TabManager.getActiveTab() : null;
    const wv = tab && typeof WebviewManager !== 'undefined' && WebviewManager.webviews ? WebviewManager.webviews.get(tab.id) : null;
    if (!wv) throw new Error('Open a page and select some text first');
    const p = window.VexTabPolicy;
    if (!p || typeof p.canReadWebview !== 'function' || !p.canReadWebview(wv)) throw new Error('The selection of a private, Tor or routed tab is not read');
    const text = await wv.executeJavaScript('String(window.getSelection ? window.getSelection().toString() : "").slice(0,' + this.MAX_TEXT + ')');
    if (!text || !String(text).trim()) throw new Error('Select some text on the page first');
    return String(text);
  },

  async _copy(text) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('The clipboard is not available');
    await navigator.clipboard.writeText(text);
  },

  // Ctrl+K › a preset: the page selection through it, onto the clipboard.
  async runPresetOnSelection(id) {
    const preset = this.presets().find(p => p.id === id);
    if (!preset) throw new Error('That preset no longer exists');
    const out = this.run(await this.pageSelection(), preset.steps);
    await this._copy(out);
    window.showToast?.(preset.name + ': copied ' + out.length + ' characters');
    return out;
  },

  // --- the dialog ---------------------------------------------------------
  open() {
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    document.getElementById('vex-clip-pipeline')?.remove();
    const m = document.createElement('div');
    m.id = 'vex-clip-pipeline';
    m.style.cssText = 'position:fixed;inset:0;z-index:100052;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
    const ids = Object.keys(this.TRANSFORMS);
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Clipboard pipeline" style="width:640px;max-width:95vw;max-height:90vh;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,0.5))">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:15px;font-weight:700;color:var(--text);flex:1">Clipboard pipeline</span>
        <button id="cp-close" type="button" aria-label="Close" title="Close" style="padding:6px 10px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:7px;cursor:pointer;line-height:0">${VexIcons.svg('x', { size: 14 })}</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Paste text (Ctrl+V) or take the page selection, pick steps, copy the result. Nothing is read from your clipboard unless you paste it here.</div>
      <div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
        <label for="cp-in" style="font-size:12px;color:var(--text-muted);flex:1">Text</label>
        <button id="cp-sel" type="button" class="btn-secondary-sm">Use the page selection</button>
      </div>
      <textarea id="cp-in" spellcheck="false" rows="6" style="width:100%;font-family:'JetBrains Mono',monospace;font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin:10px 0 6px;flex-wrap:wrap">
        <label for="cp-preset" style="font-size:12px;color:var(--text-muted)">Preset</label>
        <select id="cp-preset" class="set-input" style="min-width:160px"></select>
        <button id="cp-del" type="button" class="btn-secondary-sm">Delete preset</button>
      </div>
      <fieldset style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin:0 0 8px">
        <legend style="font-size:11.5px;color:var(--text-muted);padding:0 4px">Steps, in this order</legend>
        <div id="cp-steps" style="display:flex;flex-wrap:wrap;gap:6px 14px">
          ${ids.map(id => `<label style="font-size:12.5px;display:inline-flex;gap:5px;align-items:center" title="${esc(this.TRANSFORMS[id].hint)}"><input type="checkbox" data-step="${id}"><span>${esc(this.TRANSFORMS[id].name)}</span></label>`).join('')}
        </div>
      </fieldset>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input id="cp-name" class="set-input" type="text" maxlength="60" placeholder="Name this chain to keep it" style="flex:1">
        <button id="cp-save" type="button" class="btn-secondary-sm">Save preset</button>
      </div>
      <label for="cp-out" style="font-size:12px;color:var(--text-muted)">Result</label>
      <textarea id="cp-out" readonly spellcheck="false" rows="6" style="width:100%;margin-top:4px;font-family:'JetBrains Mono',monospace;font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical"></textarea>
      <div id="cp-msg" role="status" style="font-size:11.5px;color:var(--danger,#ef4444);min-height:16px;margin:4px 0"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="cp-copy" type="button" class="btn-primary" style="padding:8px 14px;background:var(--primary,var(--accent));color:var(--on-primary,#fff);border:none;border-radius:8px;cursor:pointer;font-weight:600">Copy result</button>
      </div>
    </div>`;
    document.body.appendChild(m);
    if (typeof VexLayer !== 'undefined') VexLayer.track(m, { tier: 'dialog', id: 'clipboard-pipeline' });
    const q = (s) => m.querySelector(s);
    const stepBoxes = () => [...m.querySelectorAll('[data-step]')];
    const chosen = () => stepBoxes().filter(b => b.checked).map(b => b.dataset.step);
    const note = (t) => { q('#cp-msg').textContent = t || ''; };
    const recompute = () => {
      note('');
      const steps = chosen();
      try { q('#cp-out').value = steps.length ? this.run(q('#cp-in').value, steps) : q('#cp-in').value; }
      catch (err) { q('#cp-out').value = ''; note(err.message); }
    };
    const fillPresets = (selectId) => {
      const sel = q('#cp-preset');
      const list = this.presets();
      sel.innerHTML = '<option value="">Custom</option>' + list.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
      sel.value = selectId || '';
    };
    const setSteps = (steps) => stepBoxes().forEach(b => { b.checked = steps.includes(b.dataset.step); });
    fillPresets('');
    q('#cp-preset').addEventListener('change', (e) => {
      const p = this.presets().find(x => x.id === e.target.value);
      if (p) { setSteps(p.steps); q('#cp-name').value = p.builtin ? '' : p.name; }
      recompute();
    });
    stepBoxes().forEach(b => b.addEventListener('change', () => { q('#cp-preset').value = ''; recompute(); }));
    q('#cp-in').addEventListener('input', recompute);
    q('#cp-sel').addEventListener('click', async () => {
      try { q('#cp-in').value = await this.pageSelection(); recompute(); } catch (err) { note(err.message); }
    });
    q('#cp-save').addEventListener('click', () => {
      try {
        const id = this.savePreset(q('#cp-name').value, chosen());
        fillPresets(id);
        window.showToast?.('Preset saved');
      } catch (err) { note(err.message); }
    });
    q('#cp-del').addEventListener('click', async () => {
      const p = this.presets().find(x => x.id === q('#cp-preset').value);
      if (!p || p.builtin) { note('Pick one of your own presets to delete'); return; }
      if (!(await vexConfirm({ title: 'Delete preset?', message: 'Delete "' + p.name + '"?', okLabel: 'Delete', danger: true }))) return;
      try { this.deletePreset(p.id); fillPresets(''); } catch (err) { note(err.message); }
    });
    q('#cp-copy').addEventListener('click', async () => {
      try { await this._copy(q('#cp-out').value); window.showToast?.('Copied'); }
      catch (err) { note('Could not copy: ' + ((err && err.message) || err)); }
    });
    const onKey = (e) => {
      if (!m.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key === 'Escape' && !document.querySelector('.vex-dialog-overlay')) { e.preventDefault(); close(); }
    };
    const close = () => { document.removeEventListener('keydown', onKey, true); m.remove(); };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    q('#cp-close').addEventListener('click', close);
    setTimeout(() => q('#cp-in').focus(), 30);
    return m;
  },

  _registerCommands() {
    if (typeof window === 'undefined' || !window.VexModuleCommands) return;
    const list = [{
      id: 'clippipe:open', label: 'Clipboard pipeline', hint: 'Chain text transforms (strip tracking, markdown, title case, trim, dedupe) and save presets',
      icon: 'clipboard', action: () => { try { this.open(); } catch (err) { window.showToast?.(err.message, 'error'); } },
    }];
    for (const p of this.presets()) {
      list.push({
        id: 'clippipe:run:' + p.id, label: 'Clipboard pipeline: ' + p.name + ' (page selection)', hint: p.steps.map(s => this.TRANSFORMS[s].name).join(' → '),
        icon: 'clipboard', action: async () => { try { await this.runPresetOnSelection(p.id); } catch (err) { window.showToast?.(err.message, 'error'); } },
      });
    }
    VexModuleCommands.set('clippipe:', list);
  },

  init() {
    if (typeof document === 'undefined') return;
    this._registerCommands();
  },
};

if (typeof window !== 'undefined') { window.ClipboardPipeline = ClipboardPipeline; ClipboardPipeline.init(); }
if (typeof module !== 'undefined' && module.exports) module.exports = { ClipboardPipeline };
