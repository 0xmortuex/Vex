// === Explain this part of the page — on the model on this machine ==========
//
// Select a paragraph you do not follow and get it back in plain English, with a
// "Show the source sentence" link that puts the exact sentence it came from
// next to the explanation, so you can see what the explanation is about.
//
// It never leaves this machine: the question goes to AIRouter.callOn('local',
// …) and nowhere else. There is no cloud fallback and no on-device fallback —
// if Ollama is not running, it says so, in those words, and stops. The
// selection bar's older "Explain" button still uses the AI panel and whatever
// backend that picks; this one is the private one.
//
// What it reads from the page is only the selection and the sentence around
// it, and only from a tab Vex is allowed to read (not a private/Tor one).

const ExplainPage = {
  SETTING: 'vex.explainPage.bar',   // 'off' hides the selection-bar button
  MAX_SELECTION: 3000,
  MAX_SENTENCE: 600,

  barEnabled() { try { return localStorage.getItem(this.SETTING) !== 'off'; } catch { return true; } },
  setBarEnabled(on) { try { localStorage.setItem(this.SETTING, on ? 'on' : 'off'); } catch {} return !!on; },

  // Runs in the page: the selection and the sentence it sits in.
  sentenceScript() {
    return `(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
      const text = String(sel).replace(/\\s+/g, ' ').trim();
      if (!text) return null;
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      let block = node.nodeType === 1 ? node : node.parentElement;
      const SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, td, figcaption, div';
      const b = block && block.closest ? block.closest(SEL) : null;
      const full = String((b || block || document.body).innerText || '').replace(/\\s+/g, ' ').trim();
      const at = full.indexOf(text.slice(0, 60));
      let sentence = '';
      if (at >= 0) {
        const re = /[^.!?\\u3002]+[.!?\\u3002]+["')\\]]*\\s*|[^.!?\\u3002]+$/g;
        let m; 
        while ((m = re.exec(full))) {
          const s = m.index, e = s + m[0].length;
          if (at >= s && at < e) { sentence = m[0].trim(); break; }
        }
      }
      return { text: text.slice(0, ${this.MAX_SELECTION}), sentence: sentence.slice(0, ${this.MAX_SENTENCE}), title: String(document.title || '').slice(0, 160) };
    })()`;
  },

  // The prompt, kept apart so a test can read exactly what is asked.
  buildPrompt({ text, sentence, title }) {
    return [
      'Explain the passage below in plain English, as if to a smart friend who has not met the topic.',
      'Use two to four short sentences. Say what it means; do not repeat it back. If a term needs defining, define it in a few words.',
      'Use only what the passage and its sentence imply. If it cannot be understood from this much, say what is missing instead of guessing.',
      'Reply with the explanation only, no preface.',
      title ? 'Page title: ' + title : '',
      sentence && sentence !== text ? 'The sentence it sits in: """' + sentence + '"""' : '',
      'Passage: """' + text + '"""',
    ].filter(Boolean).join('\n\n');
  },

  // The local chat reply may arrive in the panel's JSON envelope.
  reply(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return '';
    if (typeof AIPanel !== 'undefined' && typeof AIPanel._parseResponse === 'function') {
      try {
        const p = AIPanel._parseResponse(text);
        if (p && typeof p.reply === 'string' && p.reply.trim()) return p.reply.trim();
      } catch { /* the raw text is the answer */ }
    }
    return text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  },

  // Local model only. Throws a plain message; never reaches for another backend.
  async ask(ctx) {
    if (typeof AIRouter === 'undefined' || typeof AIRouter.callOn !== 'function') {
      throw new Error('The local AI is not part of this build');
    }
    let out;
    try {
      out = await AIRouter.callOn('local', 'chat', {
        message: this.buildPrompt(ctx),
        pageContext: null,
        conversationHistory: [],
        persona: null,
      });
    } catch (err) {
      const why = (err && err.message) ? err.message : String(err);
      throw new Error('Explain uses only the model on this machine, and Ollama did not answer (' + why + '). Start Ollama and try again — nothing was sent anywhere else.');
    }
    const text = this.reply(out && out.result != null ? out.result : '');
    if (!text) throw new Error('The local model answered with nothing. Try selecting a little more text.');
    return { text, model: (out && out.model) || '' };
  },

  _tab() {
    const wv = (typeof WebviewManager !== 'undefined' && WebviewManager.getActiveWebview) ? WebviewManager.getActiveWebview() : null;
    if (!wv) throw new Error('Open a web page and select some text first');
    if (window.VexTabPolicy && !window.VexTabPolicy.canReadWebview(wv)) {
      throw new Error('Private and Tor tabs are never read, so there is nothing to explain here');
    }
    return wv;
  },

  // Entry point: the selection in the front tab.
  async explainSelection(wv, hint) {
    const target = wv || this._tab();
    let ctx = null;
    try { ctx = await window.vexGuestEval(target, this.sentenceScript(), false, 6000); } catch { ctx = null; }
    if ((!ctx || !ctx.text) && hint) ctx = { text: String(hint).slice(0, this.MAX_SELECTION), sentence: '', title: '' };
    if (!ctx || !ctx.text) throw new Error('Select some text on the page first');
    const card = this._card(ctx);
    try {
      const res = await this.ask(ctx);
      card.done(res);
    } catch (err) {
      card.fail(err.message);
      throw err;
    }
    return card;
  },

  async run() {
    try { return await this.explainSelection(); }
    catch (err) { window.showToast?.(err.message, 'error'); return null; }
  },

  // --- the card ----------------------------------------------------------
  _card(ctx) {
    document.querySelector('.vex-explain-card')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const ico = (n, s = 14) => (window.VexIcons ? VexIcons.svg(n, { size: s }) : '');
    const el = document.createElement('div');
    el.className = 'vex-explain-card';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Explanation');
    el.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:96000;width:min(420px,92vw);max-height:70vh;overflow:auto;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 40px var(--vex-shadow-color,rgba(0,0,0,0.4));padding:12px 14px;font-size:13px;line-height:1.5';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:var(--primary,var(--accent))">${ico('bulb', 16)}</span>
        <strong style="flex:1;font-size:13px">Explained on this machine</strong>
        <button type="button" data-x aria-label="Close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;display:inline-flex;padding:2px">${ico('x', 14)}</button>
      </div>
      <div data-body style="color:var(--text-muted)">Asking the local model…</div>
      <div data-src-wrap style="margin-top:10px" hidden>
        <a href="#" data-src-link style="font-size:12px;color:var(--primary,var(--accent))">Show the source sentence</a>
        <blockquote data-src hidden style="margin:6px 0 0;padding:6px 10px;border-left:2px solid var(--primary,var(--accent));color:var(--text-muted);font-size:12px"></blockquote>
      </div>
      <div data-meta style="margin-top:8px;font-size:10.5px;color:var(--text-muted)"></div>`;
    const body = el.querySelector('[data-body]');
    const wrap = el.querySelector('[data-src-wrap]');
    const link = el.querySelector('[data-src-link]');
    const src = el.querySelector('[data-src]');
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    el.querySelector('[data-x]').addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    // The source: the sentence if the page gave one, else the selection itself.
    const source = ctx.sentence || ctx.text;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const open = src.hidden;
      src.hidden = !open;
      link.textContent = open ? 'Hide the source sentence' : 'Show the source sentence';
    });
    src.textContent = source;
    document.body.appendChild(el);
    if (typeof VexLayer !== 'undefined') VexLayer.track(el, { tier: 'panel', id: 'explain-page', keep: true });
    return {
      el,
      done: (res) => {
        body.style.color = 'var(--text)';
        body.textContent = res.text;
        wrap.hidden = false;
        const meta = el.querySelector('[data-meta]');
        meta.textContent = res.model ? 'Model: ' + res.model + ' · nothing left this machine' : 'Nothing left this machine';
        if (typeof VexProvenance !== 'undefined') meta.append(' ', VexProvenance.chip({ kind: 'local', model: res.model, read: 'the sentence you selected' }));
      },
      fail: (msg) => { body.style.color = 'var(--danger,#e5484d)'; body.textContent = msg; },
      close,
      source,
    };
  },

  // --- Settings: a group this module owns, added at run time --------------
  injectSettings() {
    if (typeof document === 'undefined') return null;
    const root = document.querySelector('.settings-content');
    if (!root || root.querySelector('[data-vex-mod="explain-page"]')) return null;
    const g = document.createElement('div');
    g.className = 'setting-group';
    g.setAttribute('data-vex-mod', 'explain-page');
    g.innerHTML = `
      <label class="setting-label">Explain this page (local model)</label>
      <p class="setting-info muted" style="margin-bottom:8px">Select text on a page and choose Explain (local) for a plain-English explanation from the model on this computer, with a link to the source sentence. It never uses the cloud: if Ollama is not running it tells you so.</p>
      <div class="setting-toggle-row">
        <span>Show “Explain (local)” in the selection bar</span>
        <label class="toggle"><input type="checkbox" data-explain-bar aria-label="Show Explain (local) in the selection bar"><span class="toggle-slider"></span></label>
      </div>`;
    const cb = g.querySelector('[data-explain-bar]');
    cb.checked = this.barEnabled();
    cb.addEventListener('change', () => this.setBarEnabled(cb.checked));
    root.appendChild(g);
    return g;
  },

  // --- Command bar --------------------------------------------------------
  registerCommands() {
    if (typeof CommandBar === 'undefined' || !Array.isArray(CommandBar.commands)) return;
    if (CommandBar.commands.some(c => c.id === 'explain-local')) return;
    CommandBar.commands.push({
      id: 'explain-local',
      label: 'Explain Selection (Local)',
      hint: 'Plain-English explanation from the model on this machine, with the source sentence',
      icon: 'bulb',
      action: () => { this.run(); },
    });
  },

  init() {
    this.registerCommands();
    this.injectSettings();
  },
};

if (typeof window !== 'undefined') {
  window.ExplainPage = ExplainPage;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => ExplainPage.init());
    else ExplainPage.init();
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { ExplainPage };
