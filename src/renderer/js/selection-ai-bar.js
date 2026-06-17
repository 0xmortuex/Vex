// === Vex Selection AI bar — floating Explain / Summarize / Translate ===
//
// When you select text on a page, the guest preload (preload-webview.js) reports
// the selection text + its on-screen rect to the host via sendToHost. We show a
// small floating bar just above the selection; clicking an action opens the AI
// panel and runs it on the selected text. The right-click menu still offers the
// same actions; this is the one-gesture surface.
//
// The selection lives inside a <webview>, so its rect is relative to the guest
// viewport — we offset by the <webview>'s own position to place the bar in host
// window coordinates. SelectionAIBar.attach(webview) is wired per webview in
// webview.js, next to PasswordVault/MouseGestures.

const SelectionAIBar = {
  _el: null,
  _text: '',
  _styled: false,
  _globalsWired: false,

  attach(webview) {
    webview.addEventListener('ipc-message', (e) => {
      if (e.channel === 'vex-selection') {
        const d = e.args && e.args[0];
        if (d && d.text) this._show(webview, d.text, d.rect);
      } else if (e.channel === 'vex-selection-clear') {
        this.hide();
      }
    });
    this._wireGlobals();
  },

  _wireGlobals() {
    if (this._globalsWired) return;
    this._globalsWired = true;
    // Esc or a click anywhere in the host chrome dismisses the bar. (Clicks/
    // scrolls inside the page already send vex-selection-clear from the guest.)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); }, true);
    document.addEventListener('mousedown', (e) => {
      if (this._el && this._el.style.display !== 'none' && !this._el.contains(e.target)) this.hide();
    }, true);
  },

  _injectStyle() {
    if (this._styled) return;
    this._styled = true;
    const s = document.createElement('style');
    s.id = 'vex-selection-ai-style';
    s.textContent = `
      #vex-selection-ai {
        position: fixed; z-index: 95000; display: none;
        gap: 2px; padding: 4px;
        background: var(--surface, #151921);
        border: 1px solid var(--border, #1f2530);
        border-radius: 10px;
        box-shadow: 0 8px 28px rgba(0,0,0,0.45);
        font-family: 'Segoe UI', system-ui, sans-serif;
        animation: vexSelBarIn .12s ease;
      }
      @keyframes vexSelBarIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
      #vex-selection-ai button {
        display: inline-flex; align-items: center; gap: 5px;
        height: 30px; padding: 0 10px;
        border: none; border-radius: 7px; background: transparent;
        color: var(--text, #e5e9f0); font: inherit; font-size: 12.5px; cursor: pointer;
        white-space: nowrap;
      }
      #vex-selection-ai button:hover { background: var(--primary, #6366f1); color: #fff; }
    `;
    document.head.appendChild(s);
  },

  _build() {
    if (this._el) return;
    this._injectStyle();
    const el = document.createElement('div');
    el.id = 'vex-selection-ai';
    el.innerHTML = `
      <button data-act="explain">✨ Explain</button>
      <button data-act="summarize">📝 Summarize</button>
      <button data-act="translate">🌐 Translate</button>`;
    // Don't let clicks on the bar count as an "outside" dismiss.
    el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    el.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => this._run(b.dataset.act)));
    document.body.appendChild(el);
    this._el = el;
  },

  _show(webview, text, rect) {
    this._text = text;
    this._build();
    // Guest-viewport coords → host window coords via the webview's position.
    let host = { left: 0, top: 0 };
    try { host = webview.getBoundingClientRect(); } catch {}
    const gx = (rect && rect.x) || 0, gy = (rect && rect.y) || 0, gw = (rect && rect.w) || 0;
    const centerX = host.left + gx + gw / 2;
    const selTop = host.top + gy;
    const el = this._el;
    el.style.display = 'flex';
    el.style.visibility = 'hidden';
    // Measure then clamp on-screen, preferring just above the selection.
    requestAnimationFrame(() => {
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = Math.max(8, Math.min(centerX - w / 2, window.innerWidth - w - 8));
      let top = selTop - h - 8;
      if (top < 8) top = selTop + 22; // no room above → drop below the selection
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
      el.style.visibility = 'visible';
    });
  },

  _run(act) {
    const text = this._text;
    this.hide();
    if (!text || typeof AIPanel === 'undefined') return;
    AIPanel.open();
    if (act === 'explain') AIPanel.sendMessage('explain', { selectedText: text });
    else if (act === 'translate') AIPanel.sendMessage('translate', { selectedText: text, targetLanguage: 'English' });
    else if (act === 'summarize') {
      // The 'summarize' feature renders only a structured {summary,...} card and
      // comes back blank for a plain-prose summary of a snippet. Route through
      // chat (free-form reply) so a selection summary always renders.
      AIPanel.sendMessage('chat', { message: `Summarize the following text clearly and concisely:\n\n"""${text}"""` });
    }
  },

  hide() { if (this._el) this._el.style.display = 'none'; },
};

if (typeof window !== 'undefined') window.SelectionAIBar = SelectionAIBar;
if (typeof module !== 'undefined' && module.exports) module.exports = { SelectionAIBar };
