// === Vex Interactive Tour ===
//
// A spotlight onboarding walkthrough: dims the window, highlights each real UI
// control in turn, and explains it with a tooltip card (Back / Next / Skip,
// arrow keys, Esc). Auto-offered on first run (see app.js) and re-runnable any
// time from the command bar (Ctrl+K → "Tour"). Steps whose target isn't present
// or visible are skipped, so it adapts to layout/feature differences.
// Public API: VexTour.start() / .end(). Persists 'vex.tourSeen'.

const VexTour = {
  idx: 0,
  active: false,
  _els: null,
  _onResize: null,
  _onKey: null,

  steps: [
    { title: 'Welcome to Vex ✦', text: 'A fast, private browser with vertical tabs, workspaces, and a built-in AI agent. Here’s a 60-second tour of everything.' },
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

  start() {
    this._build();
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
  },

  end() {
    this.active = false;
    if (this._els) this._els.overlay.hidden = true;
    window.removeEventListener('resize', this._onResize);
    if (this._onKey) window.removeEventListener('keydown', this._onKey, true);
    try { localStorage.setItem('vex.tourSeen', '1'); } catch (e) {}
  },

  next() { if (this.idx >= this.steps.length - 1) { this.end(); return; } this.idx++; this._render(); },
  back() { if (this.idx > 0) { this.idx--; this._render(); } },

  _render() {
    const s = this.steps[this.idx];
    const E = this._els;
    E.step.textContent = `Step ${this.idx + 1} of ${this.steps.length}`;
    E.title.textContent = s.title;
    E.text.innerHTML = s.html || s.text || '';
    E.back.style.visibility = this.idx === 0 ? 'hidden' : 'visible';
    E.next.textContent = this.idx === this.steps.length - 1 ? 'Done' : 'Next';

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
