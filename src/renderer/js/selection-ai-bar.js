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

  _webview: null,
  _editable: false,
  _busy: false,

  attach(webview) {
    webview.addEventListener('ipc-message', (e) => {
      if (e.channel === 'vex-selection') {
        const d = e.args && e.args[0];
        if (d && d.text) this._show(webview, d.text, d.rect, !!d.editable);
      } else if (e.channel === 'vex-selection-clear') {
        if (!this._busy) this.hide();
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
      #vex-selection-ai button:disabled { cursor: default; }
      #vex-selection-ai .vex-sel-div { width: 1px; align-self: stretch; margin: 4px 3px; background: var(--border, #1f2530); }
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
      <button data-act="translate">🌐 Translate</button>
      <span class="vex-sel-div" data-edit></span>
      <button data-act="rewrite" data-edit>✍️ Rewrite</button>
      <button data-act="fix" data-edit>✓ Fix</button>
      <button data-act="shorten" data-edit>✂️ Shorten</button>`;
    // Don't let clicks on the bar count as an "outside" dismiss.
    el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    el.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => this._run(b.dataset.act)));
    document.body.appendChild(el);
    this._el = el;
  },

  _show(webview, text, rect, editable) {
    this._text = text;
    this._webview = webview;
    this._editable = !!editable;
    this._busy = false;
    this._build();
    // In-place edit actions (Rewrite/Fix/Shorten) only make sense when the
    // selection sits in an editable field we can write back into.
    this._el.querySelectorAll('[data-edit]').forEach(n => { n.style.display = editable ? '' : 'none'; });
    this._el.querySelectorAll('button').forEach(b => { b.disabled = false; b.style.opacity = ''; });
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

  // In-place edit prompts — each returns ONLY the transformed text.
  _EDIT_PROMPTS: {
    rewrite: 'Rewrite the following text to be clearer and read more naturally. Keep the original language and meaning. Return ONLY the rewritten text with no quotes, labels, or commentary:\n\n',
    fix: 'Correct the spelling, grammar, and punctuation in the following text. Keep the wording and language otherwise unchanged. Return ONLY the corrected text with no quotes or commentary:\n\n',
    shorten: 'Make the following text more concise while preserving its meaning and language. Return ONLY the shortened text with no quotes or commentary:\n\n',
  },

  _run(act) {
    const text = this._text;
    if (!text) return;

    // In-place edits: transform with the AI and write the result back into the
    // field via the guest preload (vex-replace-selection).
    if (this._EDIT_PROMPTS[act]) { this._runEdit(act, text); return; }

    this.hide();
    if (typeof AIPanel === 'undefined') return;
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

  async _runEdit(act, text) {
    if (this._busy) return;
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callAI !== 'function') {
      window.showToast?.('AI not available', 'error'); this.hide(); return;
    }
    const wv = this._webview;
    this._busy = true;
    this._setBusy(true);
    try {
      const res = await AIRouter.callAI('chat', { message: this._EDIT_PROMPTS[act] + '"""' + text + '"""' });
      let out = (res && (res.result || res.text || res.message)) || '';
      out = String(out).trim()
        .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '')
        .replace(/^["'""]+|["'""]+$/g, '')
        .trim();
      if (!out) { window.showToast?.('AI returned nothing', 'error'); return; }
      try { wv?.send('vex-replace-selection', { text: out }); } catch {}
      window.showToast?.(act === 'fix' ? 'Fixed' : act === 'shorten' ? 'Shortened' : 'Rewritten');
    } catch (err) {
      console.error('[SelectionAIBar] edit failed:', err);
      window.showToast?.('AI edit failed', 'error');
    } finally {
      this._busy = false;
      this.hide();
    }
  },

  _setBusy(on) {
    if (!this._el) return;
    this._el.querySelectorAll('button').forEach(b => { b.disabled = on; b.style.opacity = on ? '0.5' : ''; });
  },

  hide() { if (this._el) this._el.style.display = 'none'; },
};

if (typeof window !== 'undefined') window.SelectionAIBar = SelectionAIBar;
if (typeof module !== 'undefined' && module.exports) module.exports = { SelectionAIBar };
