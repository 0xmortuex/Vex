// === Ask across my tabs ====================================================
//
// One question, answered from the text of the tabs that are open, with the
// answer's numbers linking back to the tab each came from.
//
// The reading of several tabs and the AI panel's multi-tab chat already exist
// (js/multi-tab-context.js, AIPanel._sendMultiTab). This is the strict version
// of it, for when what is in the tabs should not leave the computer:
//
//   Local only   asked of the local Ollama model and nothing else — never the
//                cloud, never "falling back" to it. With no local model the
//                answer is "it is not running", not a quiet upload.
//   Opt-in       off until the person says yes (Settings › Workflow, or the
//                first time the command is used).
//   Left out     private, Tor and routed tabs (VexTabPolicy.canShareTab), a
//                tab that looks like a bank or payment site, anything on the
//                person's own exclude list, and tabs not loaded (a sleeping
//                tab has no text to read). The window says how many and why.
//
// The tabs' text is read only when a question is asked, and nothing of it is
// kept after the window closes.
const VexAskTabs = {
  MAX_TABS: 12,
  PER_TAB_CHARS: 3500,
  _last: null,   // { at, asked, used, left } — counts only, never text

  enabled() { return VexWorkflow.pref('askTabs', false) === true; },
  userExcluded() {
    const a = VexWorkflow.pref('askTabsExclude', []);
    return Array.isArray(a) ? a.map(s => String(s).trim().toLowerCase()).filter(Boolean) : [];
  },

  // Banks and payment sites, by name — a floor, not a promise; the exclude
  // list is the person's own.
  BANKING: /bank|(^|[.-])(paypal|chase|wellsfargo|bankofamerica|citibank|hsbc|barclays|santander|natwest|lloyds|revolut|monzo|wise|stripe|venmo|schwab|fidelity|vanguard|etrade|robinhood|coinbase|binance|kraken|americanexpress|capitalone|discover|ing|abnamro|rabobank|sparkasse|postbank)([.-]|$)/i,

  hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } },

  // Why a tab is not read, or '' when it may be. Pure but for VexTabPolicy.
  leftOutBecause(tab, excluded = this.userExcluded()) {
    if (!tab || !tab.url) return 'no address';
    if (/^(about:|vex:|chrome|file:|devtools:)/i.test(tab.url)) return 'a Vex or local page';
    if (window.VexTabPolicy && !window.VexTabPolicy.canShareTab(tab)) return 'private, Tor or routed';
    const host = this.hostOf(tab.url);
    if (host && this.BANKING.test(host)) return 'looks like a bank or payment site';
    if (host && excluded.some(x => host === x || host.endsWith('.' + x))) return 'on your exclude list';
    if (tab.sleeping || tab._lazy) return 'not loaded';
    return '';
  },

  // → { use: tab[], left: [{ tab, why }] }
  plan(tabs = (typeof TabManager !== 'undefined' ? TabManager.tabs : [])) {
    const excluded = this.userExcluded();
    const use = [], left = [];
    for (const t of tabs) {
      const why = this.leftOutBecause(t, excluded);
      if (why) left.push({ tab: t, why }); else use.push(t);
    }
    if (use.length > this.MAX_TABS) {
      for (const t of use.splice(this.MAX_TABS)) left.push({ tab: t, why: 'over the ' + this.MAX_TABS + '-tab limit' });
    }
    return { use, left };
  },

  _prompt(question, contexts) {
    return 'Answer the question using ONLY the open tabs below. After each fact put the number of the tab it came from in square brackets, like [2]. '
      + 'If the tabs do not contain the answer, say so plainly and do not guess.\n\n'
      + contexts.map((c, i) => '--- TAB ' + (i + 1) + ': ' + c.title + ' ---\n' + c.text).join('\n\n')
      + '\n\nQuestion: ' + question;
  },

  // → { answer, sources: [{ n, tab }], used, left }
  async ask(question, { signal } = {}) {
    const q = String(question || '').trim();
    if (!q) throw new Error('Type a question first');
    if (!this.enabled()) throw new Error('Ask across my tabs is off — turn it on in Settings › Workflow');
    if (window.VexTabPolicy && window.VexTabPolicy.isPrivateWindow) throw new Error('This is a private window: its tabs are never read');
    if (typeof AIRouter === 'undefined' || typeof MultiTabContext === 'undefined') throw new Error('The AI is not available in this window');
    // Local or nothing: say so before reading a single tab.
    let up = false;
    try { up = await AIRouter.ollamaUp(); } catch { up = false; }
    if (!up) throw new Error('The local AI (Ollama) is not running, and this question is never sent to the cloud. Start Ollama and ask again.');
    const plan = this.plan();
    if (!plan.use.length) throw new Error('No open tab can be read: ' + (plan.left.length ? plan.left.length + ' left out (private, bank, not loaded, or on your exclude list).' : 'there are no tabs.'));
    const contexts = await MultiTabContext.extractContextFromTabs(plan.use, { maxCharsPerTab: this.PER_TAB_CHARS });
    if (signal && signal.aborted) throw new Error('Stopped');
    const readable = contexts.filter(c => c && !c.error && !c.unloaded && !c.sleeping && c.text);
    if (!readable.length) throw new Error('The tabs had no readable text');
    const res = await AIRouter.callOn('local', 'multiTab', { message: this._prompt(q, readable), tabContexts: readable, signal, conversationHistory: [] });
    let text = res && res.result != null ? String(res.result) : '';
    try { const j = JSON.parse(text); if (j && typeof j === 'object') text = String(j.reply != null ? j.reply : (j.answer != null ? j.answer : text)); } catch { /* plain text */ }
    if (!text.trim()) throw new Error('The local model returned an empty answer');
    const byId = new Map(plan.use.map(t => [String(t.id), t]));
    const sources = readable.map((c, i) => ({ n: i + 1, tab: byId.get(String(c.tabId)) || null, title: c.title, url: c.url })).filter(s => s.tab);
    this._last = { at: Date.now(), asked: q.length, used: readable.length, left: plan.left.length };
    return { answer: text.trim(), sources, used: readable.length, left: plan.left };
  },

  // The answer as DOM: [n] becomes a button that goes to that tab.
  answerNode(answer, sources, onGo) {
    const box = document.createElement('div');
    box.style.cssText = 'white-space:pre-wrap;line-height:1.5';
    const byN = new Map(sources.map(s => [s.n, s]));
    String(answer).split(/(\[\d{1,2}\])/).forEach((part) => {
      const m = /^\[(\d{1,2})\]$/.exec(part);
      const s = m ? byN.get(+m[1]) : null;
      if (!s) { box.appendChild(document.createTextNode(part)); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = part;
      b.title = 'Go to: ' + (s.title || s.url);
      b.setAttribute('aria-label', 'Go to tab ' + s.n + ': ' + (s.title || s.url));
      b.style.cssText = 'border:1px solid var(--border);background:var(--bg);color:var(--primary,var(--text));border-radius:5px;padding:0 5px;margin:0 1px;cursor:pointer;font-size:11px';
      b.addEventListener('click', () => onGo(s));
      box.appendChild(b);
    });
    return box;
  },

  async open() {
    if (!this.enabled()) {
      const ok = await window.vexConfirm({
        title: 'Turn on Ask across my tabs?',
        message: 'Questions are answered by your local Ollama model from the text of your open tabs. Nothing is sent to the cloud. Private and Tor tabs, bank and payment sites and anything on your exclude list are never read.',
        okLabel: 'Turn on',
      });
      if (!ok) return;
      if (!VexWorkflow.setPref('askTabs', true)) { window.showToast?.('The choice could not be saved', 'error'); return; }
    }
    document.getElementById('vex-asktabs')?.remove();
    const esc = (s) => window.escapeHtml(String(s == null ? '' : s));
    const plan = this.plan();
    const m = document.createElement('div');
    m.id = 'vex-asktabs';
    m.style.cssText = 'position:fixed;inset:0;z-index:100050;background:rgba(0,0,0,0.55);display:flex;align-items:flex-start;justify-content:center;padding-top:9vh';
    m.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Ask across my tabs" style="width:600px;max-width:94vw;max-height:78vh;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px var(--vex-shadow-color,rgba(0,0,0,.5));color:var(--text);font-size:12.5px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border)">
        <span style="display:inline-flex;align-items:center;gap:7px;font-size:15px;font-weight:700;flex:1">${VexIcons.svg('search', { size: 16 })}Ask across my tabs</span>
        <button type="button" id="at-close" class="btn-secondary" aria-label="Close">${VexIcons.svg('x', { size: 13 })}</button>
      </div>
      <div style="padding:12px 16px;display:flex;gap:8px">
        <input id="at-q" class="set-input" style="flex:1" placeholder="What do my open tabs say about…" spellcheck="false">
        <button type="button" id="at-go" class="btn-primary">Ask</button>
      </div>
      <div style="padding:0 16px 8px;color:var(--text-muted);font-size:11.5px" id="at-scope">${esc(plan.use.length)} tab${plan.use.length === 1 ? '' : 's'} will be read on this computer by your local model · ${esc(plan.left.length)} left out</div>
      <div id="at-out" style="padding:4px 16px 16px;overflow-y:auto"></div></div>`;
    document.body.appendChild(m);
    const out = m.querySelector('#at-out');
    const q = m.querySelector('#at-q');
    const abort = { c: null };
    const close = () => { try { if (abort.c) abort.c.abort(); } catch { /* gone */ } m.remove(); };
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    m.querySelector('#at-close').addEventListener('click', close);
    const go = async () => {
      const text = q.value.trim();
      if (!text) return;
      out.textContent = 'Reading the tabs and asking your local model…';
      const btn = m.querySelector('#at-go'); btn.disabled = true;
      abort.c = new AbortController();
      try {
        const r = await this.ask(text, { signal: abort.c.signal });
        out.textContent = '';
        out.appendChild(this.answerNode(r.answer, r.sources, (s) => {
          try { TabManager.switchTab(s.tab.id); close(); } catch (err) { window.showToast?.('That tab is closed', 'warn'); }
        }));
        const srcs = document.createElement('div');
        srcs.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:8px;color:var(--text-muted);font-size:11.5px';
        srcs.innerHTML = '<div style="font-weight:600;margin-bottom:4px">Read</div>' + r.sources.map(s => `<div>[${s.n}] ${esc(s.title || s.url)}</div>`).join('')
          + (r.left.length ? '<div style="margin-top:6px;font-weight:600">Left out</div>' + r.left.map(l => `<div>${esc(l.tab.title || l.tab.url)} — ${esc(l.why)}</div>`).join('') : '');
        out.appendChild(srcs);
      } catch (err) {
        out.textContent = '';
        const e = document.createElement('div');
        e.style.color = 'var(--danger,#e5484d)';
        e.textContent = (err && err.message) || String(err);
        out.appendChild(e);
      } finally { btn.disabled = false; abort.c = null; }
    };
    m.querySelector('#at-go').addEventListener('click', go);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    q.focus({ preventScroll: true });
  },

  snapshot() {
    return { enabled: this.enabled(), excluded: this.userExcluded(), last: this._last ? { ...this._last } : null };
  },

  render(box) {
    box.appendChild(VexWorkflow.toggleRow('Ask across my tabs', 'local model only, off until you turn it on', this.enabled(), (on) => {
      if (!VexWorkflow.setPref('askTabs', on)) window.showToast?.('The choice could not be saved', 'error');
    }));
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin:4px 0 6px';
    wrap.innerHTML = '<div class="setting-info muted" style="font-size:11.5px;margin-bottom:4px">Never read: private, Tor and routed tabs, bank and payment sites, tabs not loaded. Also never read, one site per line:</div>';
    const ta = document.createElement('textarea');
    ta.className = 'set-input';
    ta.rows = 3; ta.spellcheck = false; ta.style.cssText = 'width:100%;box-sizing:border-box;font-family:monospace';
    ta.setAttribute('aria-label', 'Sites Ask across my tabs never reads, one per line');
    ta.value = this.userExcluded().join('\n');
    ta.addEventListener('change', () => {
      const list = ta.value.split('\n').map(s => s.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()).filter(Boolean);
      if (!VexWorkflow.setPref('askTabsExclude', list)) window.showToast?.('The list could not be saved', 'error');
    });
    wrap.appendChild(ta);
    box.appendChild(wrap);
  },

  init() {
    VexWorkflow.addCommand({ id: 'ask-tabs', label: 'Ask across my tabs', hint: 'Answer a question from the text of your open tabs, locally, with links back', icon: 'search', action: () => this.open() });
  },
};

VexWorkflow.register({
  id: 'askTabs', title: 'Ask across my tabs', icon: 'search',
  render: (box) => VexAskTabs.render(box),
  snapshot: () => VexAskTabs.snapshot(),
});

if (typeof window !== 'undefined') window.VexAskTabs = VexAskTabs;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAskTabs };
