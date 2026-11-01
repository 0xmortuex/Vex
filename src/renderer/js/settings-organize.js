// === Short Settings sections ================================================
//
// Settings had grown to some 250 sections whose rows each carry a sentence or
// two of explanation. This file makes every section short without removing a
// word of it (the owner, 2026-11-01: "each setting is too long"):
//
//   * a long explanation is folded behind a small ? button next to its row;
//     the text stays in the page (so the search still reads it) and opens with
//     the button.
//   * a section with many rows shows the first few and keeps the rest behind a
//     "More options" button that starts closed.
//   * a group of three or more radio buttons is shown as ONE drop-down; the
//     radio buttons stay in the page, hidden, and still do the work.
//   * the importance of every section (critical, high, mid, low): critical ones
//     are in Settings for everyone, the others are Developer mode's
//     (js/simple-mode.js, SettingsUI.BASIC_SECTIONS).
//
// It only rearranges what is already there: no id, listener or value changes.
// SettingsUI.enhance() calls apply() on every open, and a watcher repeats it
// for a section a module draws again afterwards.
const SettingsOrganize = {
  // Longer than this, a description is folded (shorter ones are already short).
  INFO_MIN: 60,
  // The same for the grey explanation written inside a toggle's own label.
  INLINE_MIN: 40,
  // A section shows this many rows before "More options"…
  MORE_AFTER: 8,
  // …but only when at least this many rows would be folded away.
  MORE_MIN: 3,

  INFO_SELECTOR: '.setting-info, .setting-hint, [style*="text-muted"]',

  // ---- importance ----------------------------------------------------------
  // critical: in Settings for everyone. high / mid / low: Developer mode.
  // By the old category (SettingsUI.CATS) unless the heading is named below.
  CAT_IMPORTANCE: {
    'General': 'critical', 'Browser': 'mid', 'Appearance': 'mid', 'Layout': 'mid', 'Sidebar': 'mid', 'Privacy': 'high',
    'Autofill': 'high', 'Performance': 'high', 'Sessions': 'high', 'Downloads': 'high', 'Workspaces': 'mid', 'Location': 'mid',
    'Sync': 'high', 'AI': 'high', 'Personalization': 'high', 'Profiles': 'high', 'Personas': 'mid', 'AI Memory': 'mid',
    'On-Device': 'low', 'MCP': 'low', 'Skills': 'mid', 'AI History': 'low', 'Developer': 'low', 'Boosts': 'mid',
    'Passwords': 'high', 'Passkeys': 'high', 'Focus OS': 'low', 'Focus': 'mid', 'Knowledge': 'low', 'Library': 'mid',
    'Reading': 'low', 'Recall': 'mid', 'Chains': 'low', 'Shortcuts': 'mid', 'Tab Groups': 'mid', 'History': 'mid',
    'Play': 'low', 'Vex health': 'low', 'Extras': 'low', 'Extensions': 'high', 'Permissions': 'high', 'Cloud': 'mid',
    'Data': 'high', 'About': 'high',
  },
  // Headings (English, start of the text) that differ from their category.
  HEADING_IMPORTANCE: [
    ['text snippets', 'low'], ['unfinished forms', 'low'], ['download desk', 'mid'], ['on battery', 'mid'],
    ['loadout cards', 'low'], ['game audio scenes', 'low'], ['game control center', 'low'], ['game mode', 'low'],
    ['discord hotkeys', 'low'], ['when a game is running', 'low'], ['held while you played', 'low'], ['bypass check', 'low'],
    ['guide on a second screen', 'low'], ['mouse cursor', 'low'], ['click effect', 'low'], ['sounds', 'low'],
    ['vex packs', 'mid'], ['route all of vex', 'high'], ['encrypted profile lock', 'high'], ['ai backend', 'high'],
    ['chrome extensions', 'high'], ['keyboard shortcuts', 'mid'], ['cloud services', 'mid'], ['userscripts', 'mid'],
    ['reset', 'high'], ['sign-in: why you were signed out', 'low'], ['meeting transcript', 'low'],
    ['terms of service', 'low'], ['permission hygiene', 'mid'], ['storage', 'mid'],
  ],

  // The importance of one section, by its English heading.
  importanceOf(heading) {
    if (typeof SettingsUI === 'undefined') throw new Error('[SettingsOrganize] SettingsUI is not loaded');
    const t = String(heading || '').trim().toLowerCase();
    if (SettingsUI.tierOf(t) === 'basic') return 'critical';
    const hit = this.HEADING_IMPORTANCE.find(([prefix]) => t.startsWith(prefix));
    if (hit) return hit[1];
    const fromCat = this.CAT_IMPORTANCE[SettingsUI._matchCat(t).name] || 'low';
    return fromCat === 'critical' ? 'high' : fromCat;
  },

  // ---- the ? button ---------------------------------------------------------
  _seq: 0,
  _isFoldable(el) {
    if (el.dataset.infoFolded || el.id || el.closest('.set-info-btn, [role="alert"], [role="status"], [aria-live]')) return false;
    if (el.hasAttribute('aria-live') || el.hasAttribute('role')) return false;
    if (el.querySelector('input, button, select, textarea, a[href], [contenteditable]')) return false;
    if (el.closest('label.toggle')) return false;
    // What a script writes into (a result, an error, a status) is not an explanation: it stays where it is.
    if (/err|warn|status|result|state|progress|msg|toast|live|count|empty/i.test(el.className || '')) return false;
    const style = el.getAttribute('style') || '';
    // A grey inline style only counts when it really is the small grey note.
    if (el.matches('[style*="text-muted"]') && !el.matches('.setting-info, .setting-hint')) {
      if (!/color:\s*var\(--text-muted\)/.test(style) || !/font-size:\s*1[0-2]px/.test(style)) return false;
    }
    const inline = el.tagName === 'SPAN' && !!el.closest('.setting-toggle-row');
    const len = (el.textContent || '').trim().length;
    return len >= (inline ? this.INLINE_MIN : this.INFO_MIN);
  },

  _infoButton() {
    if (typeof VexIcons === 'undefined') throw new Error('[SettingsOrganize] VexIcons is not loaded');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-info-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'About this setting');
    btn.title = 'About this setting';
    btn.innerHTML = VexIcons.svg('info', { size: 14 });
    return btn;
  },

  // Fold every long description under `root`.
  fold(root) {
    let n = 0;
    for (const el of root.querySelectorAll(this.INFO_SELECTOR)) {
      if (!this._isFoldable(el)) continue;
      const btn = this._infoButton();
      el.id = 'set-info-' + (++this._seq);
      btn.setAttribute('aria-controls', el.id);
      // Where the button goes: beside the row the text explains.
      const row = el.closest('.setting-toggle-row');
      const prev = el.previousElementSibling;
      if (row) {
        const first = row.querySelector(':scope > span');
        if (first) first.after(btn); else row.prepend(btn);
        btn.classList.add('set-info-btn--row');
      } else if (prev && prev.matches('.setting-toggle-row, .setting-row') && !prev.querySelector(':scope > .set-info-btn')) {
        const first = prev.querySelector(':scope > span');
        if (first && prev.matches('.setting-toggle-row')) first.after(btn); else prev.append(btn);
        btn.classList.add('set-info-btn--row');
      } else if (prev && prev.matches('label.setting-label') && prev.parentElement && prev.parentElement.matches('.setting-group')) {
        prev.after(btn);
        btn.classList.add('set-info-btn--corner');
      } else {
        el.before(btn);
        btn.classList.add('set-info-btn--line');
      }
      el.dataset.infoFolded = '1';
      el.classList.add('set-info-folded');
      btn.addEventListener('click', () => {
        const open = el.classList.toggle('set-info-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      n++;
    }
    return n;
  },

  // ---- More options ---------------------------------------------------------
  _isRow(el) {
    return el.nodeType === 1 && !el.matches('label.setting-label, .set-info-btn, .set-more-btn, .set-more-body, .set-subnav');
  },
  _makeMore(count) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'set-more-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = VexIcons.svg('chevron-down', { size: 14 }) + '<span class="set-more-label">More options</span><span class="set-more-count"></span>';
    btn.querySelector('.set-more-count').textContent = '(' + count + ')';
    const body = document.createElement('div');
    body.className = 'set-more-body';
    btn.addEventListener('click', () => {
      const open = !body.hasAttribute('data-open');
      if (open) body.setAttribute('data-open', ''); else body.removeAttribute('data-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    return { btn, body };
  },
  more(root) {
    if (typeof VexIcons === 'undefined') throw new Error('[SettingsOrganize] VexIcons is not loaded');
    let n = 0;
    for (const g of root.querySelectorAll(':scope > .setting-group')) {
      if (g.querySelector(':scope > .set-more-body, :scope > [data-group-body] > .set-more-body, :scope > .vex-module-group-body > .set-more-body')) continue;
      let box = g;
      const only = Array.from(g.children).filter(c => this._isRow(c));
      if (only.length === 1 && only[0].matches('[data-group-body], .vex-module-group-body')) box = only[0];
      // A section inside a section (Game mode in Privacy hardening) is "more" by nature.
      for (const nested of Array.from(box.children).filter(c => c.matches('.setting-group'))) {
        const { btn, body } = this._makeMore(1);
        nested.before(btn, body);
        body.appendChild(nested);
        n++;
      }
      const rows = Array.from(box.children).filter(c => this._isRow(c));
      if (rows.length - this.MORE_AFTER < this.MORE_MIN) continue;
      const cut = rows[this.MORE_AFTER];
      const tail = [];
      for (let node = cut; node; node = node.nextSibling) tail.push(node);
      const { btn, body } = this._makeMore(rows.length - this.MORE_AFTER);
      cut.before(btn, body);
      for (const node of tail) body.appendChild(node);
      n++;
    }
    return n;
  },

  // ---- radio buttons as a drop-down ----------------------------------------
  radios(root) {
    const byName = new Map();
    for (const r of root.querySelectorAll('input[type="radio"][name]')) {
      if (r.dataset.selectDone) continue;
      if (!byName.has(r.name)) byName.set(r.name, []);
      byName.get(r.name).push(r);
    }
    let n = 0;
    for (const [name, list] of byName) {
      if (list.length < 3) continue;
      const labels = list.map(r => r.closest('label'));
      // Only a group whose choices all have a label, in one place.
      if (labels.some(l => !l) || new Set(labels.map(l => l.parentElement)).size !== 1) continue;
      const sel = document.createElement('select');
      sel.className = 'set-radio-select';
      const heading = labels[0].parentElement.querySelector(':scope > .setting-row-label, :scope > .setting-label');
      sel.setAttribute('aria-label', (heading && heading.textContent.trim()) || name);
      list.forEach((r, i) => {
        const o = document.createElement('option');
        o.value = r.value;
        o.textContent = labels[i].textContent.replace(/\s+/g, ' ').trim();
        sel.appendChild(o);
      });
      const sync = () => { const on = list.find(r => r.checked); if (on) sel.value = on.value; };
      sel.addEventListener('change', () => {
        const r = list.find(x => x.value === sel.value);
        if (r && !r.checked) r.click();
      });
      sel.addEventListener('mousedown', sync);
      sel.addEventListener('focus', sync);
      sync();
      labels[0].before(sel);
      labels.forEach(l => l.classList.add('set-radio-folded'));
      list.forEach(r => { r.dataset.selectDone = '1'; r.addEventListener('change', sync); });
      n++;
    }
    return n;
  },

  // ---- a search that reaches Developer mode's sections -----------------------
  devNote(root, advancedHits) {
    let note = root.querySelector(':scope > .set-dev-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'set-dev-note';
      note.setAttribute('role', 'status');
      const text = document.createElement('span');
      text.className = 'set-dev-note-text';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-dev-note-btn btn-secondary';
      btn.textContent = 'Turn on Developer mode';
      btn.addEventListener('click', () => {
        if (typeof VexSimpleMode === 'undefined') throw new Error('[Settings] Developer mode is not loaded');
        VexSimpleMode.set('full');
        window.showToast?.('Developer mode is on. Settings › General › Developer mode turns it off again.', 'info', 6000);
      });
      note.append(text, btn);
      root.prepend(note);
    }
    const show = advancedHits > 0 && document.body.dataset.uiMode === 'simple';
    note.hidden = !show;
    note.querySelector('.set-dev-note-text').textContent = show
      ? 'Some results are in Developer mode (advanced settings). They are shown here; turn Developer mode on to keep them in Settings.'
      : '';
    return show;
  },

  // Open whatever hides `el`: a closed More options, a folded explanation.
  open(el) {
    if (!el || !el.closest) return;
    for (let body = el.closest('.set-more-body'); body; body = body.parentElement && body.parentElement.closest('.set-more-body')) {
      body.setAttribute('data-open', '');
      const btn = body.previousElementSibling;
      if (btn && btn.classList.contains('set-more-btn')) btn.setAttribute('aria-expanded', 'true');
    }
    const info = el.closest('.set-info-folded');
    if (info) {
      info.classList.add('set-info-open');
      const btn = document.querySelector('[aria-controls="' + info.id + '"]');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
  },

  // ---- all of it ----------------------------------------------------------------
  apply(root) {
    if (!root) return null;
    // Our own changes must not wake the watcher.
    if (this._watcher) this._watcher.disconnect();
    const out = { folded: this.fold(root), radios: this.radios(root), more: this.more(root) };
    this._watch(root);
    return out;
  },

  // A module that draws its section again after Settings opened (a refresh)
  // brings the long text back: fold it again, once the burst of changes settles.
  _watch(root) {
    if (typeof MutationObserver === 'undefined') return;
    if (!this._watcher) {
      this._watcher = new MutationObserver(() => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.apply(root), 150);
      });
    }
    this._watcher.observe(root, { childList: true, subtree: true });
  },
};

if (typeof window !== 'undefined') window.SettingsOrganize = SettingsOrganize;
if (typeof module !== 'undefined' && module.exports) module.exports = { SettingsOrganize };
