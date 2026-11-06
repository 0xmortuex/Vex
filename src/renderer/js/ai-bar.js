// === The AI panel's connection bar ================================================
//
// Under the panel's header: which AI answers chat right now (Ollama, your Claude key,
// your Worker ...) with a quick switcher, and this session's tokens and estimated
// cost when your own key is in use. When nothing is connected, the empty chat says so
// and has the three buttons that open the right Settings card.
//
//   AIBar.draw()      redraw the bar (it listens for key, route, spend and usage changes itself)
//
// Choosing in the switcher pins CHAT and the multi-tab question (not the agent, not the
// background jobs) to what you picked; Settings > AI shows and changes every pin.
const AIBar = {
  _menu: null,

  T(text, ...a) { return typeof AIKeys !== 'undefined' ? AIKeys.T(text, ...a) : text.replace(/\{(\d)\}/g, (_m, i) => a[Number(i) - 1]); },

  // What chat uses right now, as words: { text, kind }.
  current() {
    const p = AIRouter.planFor('chat');
    if (p.backend === 'none') return { text: this.T('No AI connected'), kind: 'none' };
    if (p.backend === 'ondevice') return { text: this.T('On-device AI'), kind: 'ondevice' };
    if (p.backend === 'local') return { text: 'Ollama ' + (AIRouter.modelFor('chat') || ''), kind: 'local' };
    if (p.via === 'worker') return { text: this.T('Your AI Worker'), kind: 'worker' };
    const model = AIKeys.modelFor(p.provider, 'chat');
    const prov = AIKeys.provider(p.provider);
    return { text: model ? AIKeys.prettyModel(p.provider, model) : (prov ? prov.short : ''), kind: 'key', provider: p.provider };
  },

  meterText() {
    if (typeof AIKeys === 'undefined' || !AIKeys.status()) return '';
    const s = AIKeys.session();
    if (!s.calls) return '';
    const tokens = s.tokensIn + s.tokensOut;
    let cost;
    if (s.unknown && !s.money) cost = this.T('cost unknown');
    else {
      const cur = typeof VexAIMoney !== 'undefined' ? VexAIMoney.currency() : 'USD';
      cost = this.T('about {1} (an estimate)', (s.money > 0 && s.money < 0.01 ? s.money.toPrecision(2) : (Math.round(s.money * 100) / 100)) + ' ' + cur) + (s.unknown ? ', ' + this.T('some answers have no price') : '');
    }
    let cap = '';
    if (typeof VexAIMoney !== 'undefined' && VexAIMoney.moneyCap() > 0) cap = ' · ' + this.T('month {1} of {2}', VexAIMoney._fmt(VexAIMoney.spent()), VexAIMoney._fmt(VexAIMoney.moneyCap()));
    return this.T('{1} tokens', tokens.toLocaleString()) + ' · ' + cost + cap;
  },

  _ensureBar() {
    let bar = document.getElementById('ai-bar');
    if (bar) return bar;
    const head = document.querySelector('#ai-panel .ai-header');
    if (!head) return null;
    bar = document.createElement('div');
    bar.id = 'ai-bar';
    bar.className = 'ai-bar';
    bar.innerHTML = '<button type="button" class="ai-bar-btn" id="ai-bar-btn" aria-haspopup="menu" aria-expanded="false"></button><span class="ai-bar-meter" id="ai-bar-meter" aria-live="polite"></span>';
    head.after(bar);
    bar.querySelector('#ai-bar-btn').addEventListener('click', () => this.toggleMenu());
    bar.querySelector('#ai-bar-btn').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); this.openMenu(); } });
    return bar;
  },

  draw() {
    const bar = this._ensureBar();
    if (!bar) return;
    const cur = this.current();
    const btn = bar.querySelector('#ai-bar-btn');
    btn.textContent = '';
    const name = document.createElement('span');
    name.className = 'ai-bar-name';
    name.textContent = cur.text;
    btn.appendChild(name);
    if (window.VexIcons) { const c = document.createElement('span'); c.innerHTML = VexIcons.svg('chevron-down', { size: 12 }); btn.appendChild(c); }
    btn.title = this.T('Which AI answers your chat. Click to switch.');
    btn.setAttribute('aria-label', this.T('Which AI answers your chat: {1}. Open the switcher.', cur.text));
    bar.dataset.kind = cur.kind;
    bar.querySelector('#ai-bar-meter').textContent = this.meterText();
    this.drawEmpty();
  },

  // ---- the switcher ----------------------------------------------------------------------------------------
  closeMenu() {
    if (this._menu) { this._menu.remove(); this._menu = null; }
    const btn = document.getElementById('ai-bar-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', this._outside, true);
    document.removeEventListener('keydown', this._key, true);
  },
  toggleMenu() { if (this._menu) this.closeMenu(); else this.openMenu(); },

  _pin(value) {
    AIRouter.setRoutingPrefs({ chat: value, multiTab: value === 'auto' ? 'cloud' : value });
    document.dispatchEvent(new CustomEvent('vex:ai-route-changed'));
  },

  openMenu() {
    this.closeMenu();
    const bar = this._ensureBar();
    if (!bar) return;
    const menu = document.createElement('div');
    menu.className = 'ai-bar-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', this.T('Switch AI'));
    const item = (label, checked, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ai-bar-item'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', checked ? 'true' : 'false');
      b.textContent = label;
      b.addEventListener('click', async () => { this.closeMenu(); try { await fn(); } catch (err) { console.error('[AIBar]', err); window.showToast?.(err.message || String(err), 'error'); } });
      menu.appendChild(b);
    };
    const head = (t) => { const h = document.createElement('h4'); h.textContent = t; menu.appendChild(h); };
    const pin = (AIRouter.getRoutingPrefs().chat) || 'auto';
    item(this.T('Automatic (Vex chooses)'), pin === 'auto', () => this._pin('auto'));
    head(this.T('On this computer'));
    item('Ollama ' + (AIRouter.getModel() || ''), pin === 'local', () => this._pin('local'));
    for (const p of AIKeys.saved()) {
      head(this.T('Your {1} key', p.short));
      const cached = AIKeys.cachedModels(p.id);
      const ids = [];
      for (const m of [p.models.default, p.models.best, p.models.fast, ...(cached ? cached.models.slice(0, 6).map(x => x.id) : [])]) if (m && !ids.includes(m)) ids.push(m);
      if (!ids.length) item(this.T('Choose a model in Settings'), false, () => AIConnect.openCard('key', p.id));
      for (const m of ids) item(AIKeys.prettyModel(p.id, m), pin === 'key:' + p.id && (p.models.default || '') === m, async () => {
        await window.vex.aiKeySetModels({ provider: p.id, models: { ...p.models, default: m } });
        await AIKeys.refresh();
        this._pin('key:' + p.id);
      });
    }
    if (AIRouter.cloudWorkerUrl()) { head(this.T('Your own Worker')); item(this.T('Your AI Worker'), pin === 'worker', () => this._pin('worker')); }
    menu.appendChild(document.createElement('hr'));
    item(this.T('Connect another AI...'), false, () => AIConnect.openCard('key'));
    const rect = bar.getBoundingClientRect();
    menu.style.left = (rect.left + 8) + 'px';
    menu.style.top = (rect.bottom + 2) + 'px';
    document.body.appendChild(menu);
    this._menu = menu;
    document.getElementById('ai-bar-btn').setAttribute('aria-expanded', 'true');
    this._outside = (e) => { if (!menu.contains(e.target) && e.target.id !== 'ai-bar-btn') this.closeMenu(); };
    this._key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closeMenu(); document.getElementById('ai-bar-btn').focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...menu.querySelectorAll('.ai-bar-item')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    };
    document.addEventListener('mousedown', this._outside, true);
    document.addEventListener('keydown', this._key, true);
    const first = menu.querySelector('.ai-bar-item[aria-checked="true"]') || menu.querySelector('.ai-bar-item');
    if (first) first.focus();
  },

  // ---- nothing connected: the empty chat says so ----------------------------------------------------------------------
  drawEmpty() {
    const empty = document.querySelector('#ai-messages .ai-empty');
    const none = this.current().kind === 'none';
    const old = document.getElementById('ai-connect-empty');
    if (!empty || !none) { if (old) old.remove(); return; }
    if (old) return;
    const box = document.createElement('div');
    box.id = 'ai-connect-empty';
    box.className = 'ai-connect-empty';
    const h = document.createElement('h4'); h.textContent = this.T('Connect an AI');
    const p = document.createElement('p'); p.textContent = this.T('Vex has nothing to think with yet. Pick one: it takes a minute.');
    const row = document.createElement('div'); row.className = 'ai-error-actions';
    const b = (label, card) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn-secondary'; x.textContent = label; x.addEventListener('click', () => AIConnect.openCard(card)); row.appendChild(x); };
    b(this.T('Ollama on this computer'), 'ollama');
    b(this.T('My own API key'), 'key');
    b(this.T('My own Worker'), 'worker');
    box.append(h, p, row);
    empty.appendChild(box);
  },

  init() {
    if (this._wired) return;
    this._wired = true;
    if (typeof AIKeys === 'undefined' || typeof AIRouter === 'undefined') throw new Error('The AI bar needs the AI router and the key module');
    for (const ev of ['vex:ai-keys', 'vex:ai-route-changed', 'vex:ai-spend', 'vex:ai-keys-usage', 'vex:ai-answered']) document.addEventListener(ev, () => this.draw());
    const messages = document.getElementById('ai-messages');
    if (messages) new MutationObserver(() => this.drawEmpty()).observe(messages, { childList: true });
    this.draw();
    // Whether Ollama is up changes without an event: look again now and then.
    if (typeof VexJobs !== 'undefined') VexJobs.every('AI bar', 15000, () => this.draw());
  },
};

if (typeof window !== 'undefined') {
  window.AIBar = AIBar;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AIBar.init(), { once: true });
  else AIBar.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AIBar };
