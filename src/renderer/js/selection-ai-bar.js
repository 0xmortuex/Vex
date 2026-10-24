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

  // ---- which actions make sense for this text ----------------------------------------------------------------------------------------
  // Every action used to show for every selection ("Debug" on a sentence, "Summarize" on one word). suggest() looks at the text, in a few
  // microseconds and only its first 2,000 characters, so the bar still appears at the same moment. It errs towards showing: Explain is
  // always there, and a text it cannot read is offered Translate.
  SUGGEST_CHARS: 2000,
  _STOP: {
    en: new Set('the and of to is are was were in on for with that this it as at by be from or an not have has had but you your they their which will would can'.split(' ')),
    tr: new Set('ve bir bu için ile da de çok daha gibi ama olarak olan ne kadar var yok her ben sen biz siz onlar mi mı mu mü değil sonra önce ise'.split(' ')),
  },
  _ERROR_RE: /\b(error|exception|traceback|stack ?trace|fatal|failed|failure|cannot|can't|could not|unable to|denied|refused|timed? ?out|not found|undefined|null ?pointer|segmentation fault|panic|hata|başarısız|bulunamadı|erişim engellendi)\b|\b(TypeError|ReferenceError|SyntaxError|RangeError|ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|Uncaught)\b|^\s*at\s+\S+.*:\d+(:\d+)?\)?\s*$|\b0x[0-9a-f]{6,}\b|\b(HTTP|status|code)\s*[:=]?\s*[45]\d\d\b/im,
  _CODE_RE: /(=>|[{};]\s*$|^\s*(function|const|let|var|def|class|import|from|return|public|private|#include|SELECT|INSERT|UPDATE)\b|\w\(.*\)\s*[{;:]|<\/?[a-z][a-z0-9]*[ >\/]|^\s*[.#]?[\w-]+\s*\{[^}]*:)/m,

  // 'tr' | 'en' | 'other' (a script that is not Latin) | 'none' (no letters at all) | 'unknown'.
  guessLanguage(text) {
    const t = String(text || '').slice(0, this.SUGGEST_CHARS);
    const letters = t.match(/\p{L}/gu);
    if (!letters) return 'none';
    const foreign = letters.filter(c => !/\p{Script=Latin}/u.test(c)).length;
    if (foreign / letters.length > 0.3) return 'other';
    const words = t.toLowerCase().match(/[\p{L}'’]+/gu) || [];
    if (words.length < 4) return 'unknown';
    const hits = (set) => words.filter(w => set.has(w)).length / words.length;
    const en = hits(this._STOP.en), tr = hits(this._STOP.tr);
    const turkishLetters = (t.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length / letters.length;
    if (tr >= 0.1 && tr > en) return 'tr';
    if (turkishLetters > 0.03 && en < 0.1) return 'tr';
    if (en >= 0.15 && en > tr) return 'en';
    return 'unknown';
  },

  // The set of data-act names to show. opts: { editable, localOn, lang } with lang the language Vex is in ('en' or 'tr').
  suggest(text, opts = {}) {
    const t = String(text || '').slice(0, this.SUGGEST_CHARS);
    const lang = opts.lang === 'tr' ? 'tr' : 'en';
    const words = (t.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    const chars = t.trim().length;
    const looksError = this._ERROR_RE.test(t);
    const looksCode = !looksError && this._CODE_RE.test(t) && /[\n;{}()=<>]/.test(t) && words >= 2;
    const said = this.guessLanguage(t);
    const looksLink = /^\s*(https?:\/\/|www\.)\S+\s*$|^\s*\S+@\S+\.\S+\s*$/i.test(t);
    const out = new Set(['explain']);
    if (opts.localOn) out.add('explain-local');
    if (looksError) out.add('debug');
    // Said in a language that is not yours: worth translating. Code, errors, numbers and your own language are not.
    if (!looksCode && !looksError && !looksLink && said !== 'none' && said !== lang) out.add('translate');
    if (looksError && said !== 'none' && said !== 'en' && said !== lang) out.add('translate');
    // A summary of a line or two is no shorter than the line.
    if (!looksCode && !looksError && (words >= 40 || chars >= 250)) out.add('summarize');
    if (opts.editable) {
      out.add('rewrite');
      out.add('fix');
      if (words >= 12) out.add('shorten');
    }
    return out;
  },

  // Registered through the webview's lifecycle so destroyWebview can take it
  // off again. A handler left on the element captures `webview` in its closure,
  // and that keeps the whole element alive for the life of the window — one
  // leaked webview per closed tab.
  attach(webview) {
    const on = (webview && webview._lifecycle)
      ? (ev, fn) => webview._lifecycle.listen(webview, ev, fn)
      : (ev, fn) => webview.addEventListener(ev, fn);
    on('ipc-message', (e) => {
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
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--vex-radius-lg, 10px);
        box-shadow: 0 8px 24px var(--vex-shadow-color, color-mix(in srgb, var(--text) 25%, transparent));
        font-family: var(--vex-font-base);
        animation: vexSelBarIn .12s ease;
      }
      @keyframes vexSelBarIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
      #vex-selection-ai button {
        display: inline-flex; align-items: center; gap: 5px;
        height: 30px; padding: 0 10px;
        border: none; border-radius: var(--vex-radius-md, 6px); background: transparent;
        color: var(--text); font: inherit; font-size: 12.5px; cursor: pointer;
        white-space: nowrap;
      }
      #vex-selection-ai button:hover { background: var(--vex-hover-fill, var(--bg-2)); }
      #vex-selection-ai button:disabled { cursor: default; }
      #vex-selection-ai .vex-sel-div { width: 1px; align-self: stretch; margin: 4px 3px; background: var(--border); }
    `;
    document.head.appendChild(s);
  },

  _build() {
    if (this._el) return;
    this._injectStyle();
    const el = document.createElement('div');
    el.id = 'vex-selection-ai';
    const ico = (n) => (window.VexIcons ? VexIcons.svg(n, { size: 14 }) : '');
    el.innerHTML = `
      <button type="button" data-act="explain">${ico('bulb')}<span>Explain</span></button>
      <button type="button" data-act="explain-local" title="Plain English, from the model on this computer only">${ico('bulb')}<span>Explain (local)</span></button>
      <button type="button" data-act="debug" title="An error message: what it means, the likely cause, and the fix">${ico('warning')}<span>Debug</span></button>
      <button type="button" data-act="summarize">${ico('note')}<span>Summarize</span></button>
      <button type="button" data-act="translate">${ico('globe')}<span>Translate</span></button>
      <span class="vex-sel-div" data-edit></span>
      <button type="button" data-act="rewrite" data-edit>${ico('marker')}<span>Rewrite</span></button>
      <button type="button" data-act="fix" data-edit>${ico('check')}<span>Fix</span></button>
      <button type="button" data-act="shorten" data-edit>${ico('scissors')}<span>Shorten</span></button>`;
    // Don't let clicks on the bar count as an "outside" dismiss.
    el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
    el.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => this._run(b.dataset.act)));
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'panel', id: 'selection-ai-bar', keep: true });
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
    // Only the actions that make sense for this text (suggest(), above).
    const want = this.suggest(text, {
      editable: !!editable,
      localOn: typeof ExplainPage !== 'undefined' && ExplainPage.barEnabled(),
      lang: typeof VexI18nUI !== 'undefined' && typeof VexI18nUI.locale === 'function' ? VexI18nUI.locale() : 'en',
    });
    this._el.querySelectorAll('button[data-act]').forEach(b => { b.style.display = want.has(b.dataset.act) ? '' : 'none'; });
    const divider = this._el.querySelector('.vex-sel-div');
    if (divider) divider.style.display = editable && [...want].some(a => !['rewrite', 'fix', 'shorten'].includes(a)) ? '' : 'none';
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
    if (act === 'explain-local') {
      if (typeof ExplainPage !== 'undefined') ExplainPage.explainSelection(this._webview, text).catch((err) => window.showToast?.(err.message, 'error'));
      return;
    }
    if (typeof AIPanel === 'undefined') return;
    AIPanel.open();
    if (act === 'explain') AIPanel.sendMessage('explain', { selectedText: text });
    else if (act === 'debug') AIPanel.sendMessage('chat', { message: `Debug this. Say what the error means, the most likely cause, and how to fix it, with the fix as code if it is code:\n\n"""${text}"""` });
    else if (act === 'translate') AIPanel.sendMessage('translate', { selectedText: text, targetLanguage: AIPanel.translateTarget() });
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
      const out = this._extractText(res);
      if (!out) { window.showToast?.('The AI returned nothing to write back', 'error'); return; }
      if (!wv || typeof wv.send !== 'function') { window.showToast?.('That page is no longer available', 'error'); return; }
      // A failed send must not be reported as a successful edit.
      wv.send('vex-replace-selection', { text: out });
      window.showToast?.((act === 'fix' ? 'Fixed' : act === 'shorten' ? 'Shortened' : 'Rewritten') + (typeof VexProvenance !== 'undefined' && res && res.backend ? ' by ' + VexProvenance.label(VexProvenance.fromResult(res, { read: 'the text you selected' })) : ''));
    } catch (err) {
      console.error('[SelectionAIBar] edit failed:', err);
      window.showToast?.('AI edit failed: ' + (err?.message || 'unknown error'), 'error');
    } finally {
      this._busy = false;
      this.hide();
    }
  },

  // The local (Ollama) chat prompt asks for {"reply": "..."} and the on-device
  // path can wrap its answer the same way, so the raw `result` was being typed
  // STRAIGHT INTO the user's text field as JSON. Unwrap it, then strip fences
  // and surrounding quotes.
  _extractText(res) {
    let out = (res && (res.result ?? res.text ?? res.message)) || '';
    out = String(out).trim();
    if (!out) return '';
    if (typeof AIPanel !== 'undefined' && typeof AIPanel._parseResponse === 'function') {
      const parsed = AIPanel._parseResponse(out);
      if (parsed && typeof parsed.reply === 'string' && parsed.reply.trim()) out = parsed.reply;
    }
    return String(out).trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
  },

  _setBusy(on) {
    if (!this._el) return;
    this._el.querySelectorAll('button').forEach(b => { b.disabled = on; b.style.opacity = on ? '0.5' : ''; });
  },

  hide() { if (this._el) this._el.style.display = 'none'; },
};

if (typeof window !== 'undefined') window.SelectionAIBar = SelectionAIBar;
if (typeof module !== 'undefined' && module.exports) module.exports = { SelectionAIBar };
