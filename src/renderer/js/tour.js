// === Vex Interactive Tour ===
//
// A spotlight onboarding walkthrough: dims the window, highlights each real UI
// control in turn, and explains it with a tooltip card (Back / Next / Skip,
// arrow keys, Esc). Auto-offered on first run (see app.js) and re-runnable any
// time from the command bar (Ctrl+K → "Tour"). Steps whose target isn't present
// or visible are skipped, so it adapts to layout/feature differences.
// Public API:
//   VexTour.offer(opts)             ask which tour — quick, or a full one
//                                   through the areas you choose
//   VexTour.start()                 the built-in walkthrough (marks it seen)
//   VexTour.full(catIds, opts)      every feature in those catalogue areas
//   VexTour.run(steps, opts)        any step list — Discover drives this to
//                                   tour one category, or spotlight a single
//                                   control ("Show me"). opts.markSeen only
//                                   when it really was the whole tour.
//   VexTour.end()
//
// A step whose `sel` matches nothing (or something invisible) is dropped
// before the run starts, so "Step 2 of 5" always counts steps you can see.

const VexTour = {
  idx: 0,
  active: false,
  _els: null,
  _onResize: null,
  _onKey: null,

  _running: null,
  _pick: null,          // the "which tour?" overlay, while it is open
  _pickMarkSeen: false, // mark the tour seen even if this offer is declined

  steps: [
    { title: 'Welcome to Vex', text: 'A fast, private browser with vertical tabs, workspaces, and a built-in AI agent. Here’s a 60-second tour of everything.' },
    { sel: '#url-input', title: 'Address bar', html: 'Type to search or go to a site. <kbd>Ctrl</kbd>+<kbd>L</kbd> focuses it; the icon on the left shows site info and security.' },
    { sel: '#nav-buttons', title: 'Back, forward & reload', html: 'Move through history. <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> and <kbd>Ctrl</kbd>+<kbd>R</kbd> work too (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> hard-reloads).' },
    { sel: '#tabs-list', title: 'Vertical tabs', html: 'Your tabs live down the side. Drag to reorder, right-click to rename, group, or close — and idle tabs can sleep to save memory.' },
    { sel: '#btn-new-tab', title: 'New tab', html: 'Open a fresh tab (<kbd>Ctrl</kbd>+<kbd>T</kbd>). Reopen a closed one with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>.' },
    { sel: '#workspace-switcher', title: 'Workspaces', html: 'Switch between separate contexts — Work, School, Dev, Personal — each keeping its own set of tabs.' },
    { sel: '#tools-bar', title: 'Sidebar panels', html: 'Quick-access panels: WhatsApp, Claude, Spotify, Notes, Downloads and more. Add your own from the + at the end.' },
    { sel: '#btn-command', title: 'Command bar', html: 'Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to do anything — search, open panels, run actions. (Type “tour” there to replay this.)' },
    { sel: '#btn-toggle-ai', title: 'AI assistant & agent', html: 'Summarize the page, ask about it, translate — or let the agent click and type to finish a task. Pick a persona; use local Ollama or your own cloud worker.' },
    { sel: '#btn-split', title: 'Split screen & extras', html: 'Two tabs side by side (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>), Picture-in-Picture (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>), plus reading mode, screenshots, and page translate.' },
    { title: 'You’re all set!', html: 'Open <b>Settings</b> for themes, end-to-end-encrypted sync, and Chrome extensions. Replay this any time with <kbd>Ctrl</kbd>+<kbd>K</kbd> → “Tour”. Enjoy Vex.' },
  ],

  _build() {
    if (this._els) return;
    const overlay = document.createElement('div');
    overlay.className = 'vex-tour';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="vex-tour-hole"></div>
      <div class="vex-tour-card">
        <div class="vex-tour-step"></div>
        <div class="vex-tour-title"></div>
        <div class="vex-tour-text"></div>
        <div class="vex-tour-btns">
          <button class="vex-tour-skip">Skip</button>
          <span class="vex-tour-spacer"></span>
          <button class="vex-tour-back">Back</button>
          <button class="vex-tour-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    this._els = {
      overlay,
      hole: overlay.querySelector('.vex-tour-hole'),
      card: overlay.querySelector('.vex-tour-card'),
      step: overlay.querySelector('.vex-tour-step'),
      title: overlay.querySelector('.vex-tour-title'),
      text: overlay.querySelector('.vex-tour-text'),
      back: overlay.querySelector('.vex-tour-back'),
      next: overlay.querySelector('.vex-tour-next'),
      skip: overlay.querySelector('.vex-tour-skip'),
    };
    this._els.next.addEventListener('click', () => this.next());
    this._els.back.addEventListener('click', () => this.back());
    this._els.skip.addEventListener('click', () => this.end());
    this._onResize = () => this._render();
  },

  // Is this step's target on screen? A control hidden by the layout editor,
  // a panel switched off, or a look that doesn't draw it, all land here.
  _visible(step) {
    if (!step || !step.sel) return true;           // a card with no target still shows
    const el = document.querySelector(step.sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  },

  start() { this.run(this.steps, { markSeen: true }); },

  // === Take a tour: which one? =============================================
  //
  // "Take a tour" means two different things. Somebody who has just installed
  // Vex wants the minute that names the main controls. Somebody who has used
  // it for a month wants to be shown the things they never found — and that
  // is well over a hundred cards, which nobody finishes. So the button asks,
  // and the long one asks which areas first.
  //
  // The areas are the feature catalogue's own categories (js/feature-catalog),
  // so a feature added there turns up in the tour without being listed twice.

  AREAS_KEY: 'vex.tourAreas',

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  },

  // The control to spotlight for a catalogue entry: its own, else its sidebar
  // icon, else the command-bar button (every command lives behind it). Only a
  // target that is really on screen, so the step is never dropped later.
  _targetFor(f) {
    if (!f || typeof document === 'undefined') return null;
    const tries = [f.sel, f.panel ? `[data-panel="${f.panel}"]` : null, f.cmd ? '#btn-command' : null];
    for (const sel of tries) if (sel && this._visible({ sel })) return sel;
    return null;
  },

  // Areas ticked last time, so a second full tour does not ask the same
  // question again from scratch.
  _lastAreas() {
    try {
      const v = JSON.parse(localStorage.getItem(this.AREAS_KEY) || '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
    } catch { return []; }
  },

  // The step list for a full tour of the chosen areas: each area introduces
  // itself, then one card per feature in it. A feature with a control on
  // screen is spotlighted; the rest are cards in the middle, because "Vex has
  // this, and here is the shortcut" is worth saying either way.
  fullSteps(catIds) {
    const ids = (Array.isArray(catIds) ? catIds : []).filter(Boolean);
    if (typeof VexFeatures === 'undefined' || !ids.length) return [];
    const steps = [];
    for (const cat of VexFeatures.CATS) {
      if (!ids.includes(cat.id)) continue;
      const items = VexFeatures.byCat(cat.id);
      if (!items.length) continue;
      steps.push({
        title: cat.name,
        html: this._esc(cat.blurb) + ` <b>${items.length}</b> thing${items.length === 1 ? '' : 's'} in this area.`,
      });
      for (const f of items) {
        const keys = VexFeatures.keysOf(f);
        steps.push({
          sel: this._targetFor(f) || undefined,
          title: VexFeatures.nameOf(f),
          html: this._esc(f.what) + (keys ? ` <kbd>${this._esc(keys)}</kbd>` : ''),
        });
      }
    }
    if (steps.length) {
      steps.push({
        title: 'That is the tour',
        html: 'All of it is on one screen too — <kbd>Ctrl+K</kbd> → <b>Discover</b>. And you can ask for any of it in your own words from the same box.',
      });
    }
    return steps;
  },

  // Run the full tour of those areas. Returns how many cards it showed.
  full(catIds, opts) {
    const ids = (Array.isArray(catIds) ? catIds : []).filter(Boolean);
    try { localStorage.setItem(this.AREAS_KEY, JSON.stringify(ids)); } catch { /* a remembered choice is a convenience, not the feature */ }
    const shown = this.run(this.fullSteps(ids), { markSeen: true, onDone: opts && opts.onDone });
    if (!shown) window.showToast?.('There is nothing to show for those areas in this window', 'info');
    return shown;
  },

  // Ask which tour. opts.markSeen marks it seen even on "Not now", so an
  // offer Vex made by itself is not made again at every launch.
  offer(opts) {
    if (typeof document === 'undefined') return null;
    this._closePick();
    this._pickMarkSeen = !!(opts && opts.markSeen);
    const overlay = document.createElement('div');
    overlay.className = 'vex-dialog-overlay vex-tour-pick';
    document.body.appendChild(overlay);
    this._pick = overlay;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this._closePick(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this._closePick(); } });
    this._renderPick();
    return overlay;
  },

  _closePick() {
    if (!this._pick) return;
    this._pick.remove();
    this._pick = null;
    if (this._pickMarkSeen) {
      this._pickMarkSeen = false;
      try { localStorage.setItem('vex.tourSeen', '1'); } catch { /* the offer still happened */ }
    }
  },

  _renderPick() {
    const o = this._pick;
    if (!o) return;
    o.innerHTML = `
      <div class="vex-dialog" role="dialog" aria-modal="true" aria-label="Take a tour">
        <div class="vex-dialog-title">Take a tour</div>
        <div class="vex-dialog-msg">Two of them. You can run the other one afterwards.</div>
        <div class="vex-tour-picks">
          <button class="vex-tour-pick-opt" data-pick="quick">
            <span class="vex-tour-pick-name">Quick tour</span>
            <span class="vex-tour-pick-sub">About a minute: the address bar, your tabs, workspaces, the sidebar, Ctrl+K and the AI panel — what you touch every day.</span>
          </button>
          <button class="vex-tour-pick-opt" data-pick="full">
            <span class="vex-tour-pick-name">Full tour</span>
            <span class="vex-tour-pick-sub">Everything Vex has, area by area. You pick the areas first, so it is as long as you want it to be.</span>
          </button>
        </div>
        <div class="vex-dialog-actions"><button class="vex-dialog-btn" data-cancel>Not now</button></div>
      </div>`;
    const quick = o.querySelector('[data-pick="quick"]');
    quick.addEventListener('click', () => { this._pickMarkSeen = false; this._closePick(); this.start(); });
    o.querySelector('[data-pick="full"]').addEventListener('click', () => this._renderAreas());
    o.querySelector('[data-cancel]').addEventListener('click', () => this._closePick());
    quick.focus();
  },

  _renderAreas() {
    const o = this._pick;
    if (!o) return;
    const cats = ((typeof VexFeatures !== 'undefined' && VexFeatures.CATS) || [])
      .map(c => ({ cat: c, n: VexFeatures.byCat(c.id).length }))
      .filter(r => r.n > 0);
    const before = new Set(this._lastAreas());
    const total = cats.reduce((sum, r) => sum + r.n, 0);
    o.innerHTML = `
      <div class="vex-dialog" role="dialog" aria-modal="true" aria-label="Which areas to tour">
        <div class="vex-dialog-title">Which areas?</div>
        <div class="vex-dialog-msg">Tick what you want to be shown. All of it is ${total} features — most people take two or three areas at a time.</div>
        <div class="vex-tour-areas">
          ${cats.map(({ cat, n }) => `
            <label class="vex-tour-area">
              <input type="checkbox" value="${this._esc(cat.id)}"${before.has(cat.id) ? ' checked' : ''}>
              <span class="vex-tour-area-name">${this._esc(cat.name)} <span class="vex-tour-area-n">${n}</span></span>
              <span class="vex-tour-area-blurb">${this._esc(cat.blurb)}</span>
            </label>`).join('')}
        </div>
        <div class="vex-dialog-actions">
          <button class="vex-dialog-btn" data-all style="margin-right:auto">Everything</button>
          <button class="vex-dialog-btn" data-back>Back</button>
          <button class="vex-dialog-btn primary" data-start>Start</button>
        </div>
      </div>`;
    const boxes = [...o.querySelectorAll('.vex-tour-areas input')];
    const startBtn = o.querySelector('[data-start]');
    const chosen = () => boxes.filter(b => b.checked).map(b => b.value);
    const sync = () => {
      const ids = chosen();
      const n = ids.reduce((sum, id) => sum + VexFeatures.byCat(id).length, 0);
      startBtn.disabled = !ids.length;
      startBtn.textContent = ids.length ? `Start — ${n} card${n === 1 ? '' : 's'}` : 'Start';
    };
    boxes.forEach(b => b.addEventListener('change', sync));
    o.querySelector('[data-all]').addEventListener('click', () => { boxes.forEach(b => { b.checked = true; }); sync(); });
    o.querySelector('[data-back]').addEventListener('click', () => this._renderPick());
    startBtn.addEventListener('click', () => {
      const ids = chosen();
      if (!ids.length) return;
      this._pickMarkSeen = false;
      this._closePick();
      this.full(ids);
    });
    sync();
    (boxes[0] || startBtn).focus();
  },

  // Run an arbitrary list of steps. Returns the number actually shown, so a
  // caller can say "nothing to show" instead of opening an empty tour.
  run(steps, opts) {
    const list = (Array.isArray(steps) ? steps : []).filter(step => this._visible(step));
    if (!list.length) return 0;
    this._build();
    this._running = list;
    this._markSeen = !(opts && opts.markSeen === false) && !!(opts && opts.markSeen);
    this._onDone = (opts && opts.onDone) || null;
    this.idx = 0;
    this.active = true;
    this._els.overlay.hidden = false;
    window.addEventListener('resize', this._onResize);
    this._onKey = (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') { e.preventDefault(); this.end(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); this.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.back(); }
    };
    window.addEventListener('keydown', this._onKey, true);
    this._render();
    return list.length;
  },

  // One control, one card — the "Show me" behind every Discover entry.
  spotlight(sel, card) {
    return this.run([Object.assign({ sel }, card || {})], { markSeen: false });
  },

  end() {
    this.active = false;
    if (this._els) this._els.overlay.hidden = true;
    window.removeEventListener('resize', this._onResize);
    if (this._onKey) window.removeEventListener('keydown', this._onKey, true);
    // Only the full walkthrough counts as "seen" — spotlighting one button
    // from Discover must not stop the real tour being offered later.
    if (this._markSeen) {
      try { localStorage.setItem('vex.tourSeen', '1'); } catch (err) { console.warn('[tour] could not record the tour as seen:', err && err.message); }
    }
    this._running = null;
    const done = this._onDone; this._onDone = null;
    if (done) { try { done(); } catch (err) { console.warn('[tour] after-tour callback failed:', err && err.message); } }
  },

  next() { const n = (this._running || this.steps).length; if (this.idx >= n - 1) { this.end(); return; } this.idx++; this._render(); },
  back() { if (this.idx > 0) { this.idx--; this._render(); } },

  _render() {
    const steps = this._running || this.steps;
    const s = steps[this.idx];
    const E = this._els;
    E.step.textContent = steps.length === 1 ? '' : `Step ${this.idx + 1} of ${steps.length}`;
    E.title.textContent = s.title;
    E.text.innerHTML = s.html || s.text || '';
    E.back.style.visibility = this.idx === 0 ? 'hidden' : 'visible';
    E.next.textContent = this.idx === steps.length - 1 ? 'Done' : 'Next';

    let rect = null;
    if (s.sel) {
      const el = document.querySelector(s.sel);
      if (el) { const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) rect = r; }
    }

    if (!rect) {
      E.hole.style.display = 'none';
      const cw = E.card.offsetWidth || 340, ch = E.card.offsetHeight || 180;
      E.card.style.left = Math.round((window.innerWidth - cw) / 2) + 'px';
      E.card.style.top = Math.round((window.innerHeight - ch) / 2) + 'px';
      return;
    }

    const pad = 6;
    E.hole.style.display = 'block';
    E.hole.style.left = (rect.left - pad) + 'px';
    E.hole.style.top = (rect.top - pad) + 'px';
    E.hole.style.width = (rect.width + pad * 2) + 'px';
    E.hole.style.height = (rect.height + pad * 2) + 'px';

    // Place the card near the target: right → below → left → above, clamped.
    const cw = E.card.offsetWidth || 340, ch = E.card.offsetHeight || 180, gap = 16, m = 12;
    let left, top;
    if (rect.right + gap + cw < window.innerWidth) { left = rect.right + gap; top = rect.top; }
    else if (rect.bottom + gap + ch < window.innerHeight) { left = rect.left; top = rect.bottom + gap; }
    else if (rect.left - gap - cw > 0) { left = rect.left - gap - cw; top = rect.top; }
    else { left = rect.left; top = rect.top - gap - ch; }
    left = Math.max(m, Math.min(left, window.innerWidth - cw - m));
    top = Math.max(m, Math.min(top, window.innerHeight - ch - m));
    E.card.style.left = Math.round(left) + 'px';
    E.card.style.top = Math.round(top) + 'px';
  },
};

if (typeof window !== 'undefined') window.VexTour = VexTour;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTour };
