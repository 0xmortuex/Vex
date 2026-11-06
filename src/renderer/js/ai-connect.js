// === Settings > AI > Connect an AI ===============================================
//
// One calm section with three ways to give Vex an AI to think with:
//   (a) On this computer (Ollama): free, private, works offline;
//   (b) Your own key: Claude, OpenAI, Gemini, OpenRouter or any OpenAI-compatible server;
//   (c) Your own Worker (Advanced): the Cloudflare Worker from SELF_HOSTING.md.
// An overview line at the top says which one answers what right now. The key is typed
// once into a password field, goes to the main process in one call and is never shown
// again (js/ai-keys.js, src/main/ai-byok.js); this page only ever sees "ends in ...abcd".
//
//   AIConnect.openCard('key', providerId)    used by the AI panel's buttons: open Settings on a card
//   AIConnect.group(el)                      the section builder (Settings registers it below)
const AIConnect = {
  // The rows of the overview, and what each means for the router.
  OVERVIEW: [['chat', 'Chat'], ['agent', 'Agent'], ['summarize', 'Summaries'], ['historyIndex', 'Background tasks']],
  _selected: 'anthropic',
  _results: new Map(),            // provider id -> the last test result / error line
  _flash: new Map(),              // provider id -> a message shown once (saved, removed ...)

  T(text, ...a) { return AIKeys.T(text, ...a); },
  _toast(m, kind) { if (typeof window.showToast === 'function') window.showToast(m, kind); },
  _fail(err) { console.error('[AIConnect]', err); this._toast((err && err.message) || String(err), 'error'); },

  // ---- small builders ------------------------------------------------------------------------------
  _el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; },
  _btn(text, onClick, { primary = false, danger = false, label } = {}) {
    const b = this._el('button', primary ? 'btn-primary' : (danger ? 'btn-danger' : 'btn-secondary'), text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await onClick(b); } catch (err) { this._fail(err); } finally { b.disabled = false; }
    });
    return b;
  },
  _status(text, kind) { const s = this._el('span', 'aic-badge aic-badge--' + (kind || 'idle'), text); return s; },

  // ---- the overview: which one answers what, right now ----------------------------------------------
  _planText(feature) {
    const p = AIRouter.planFor(feature);
    const T = (t, ...a) => this.T(t, ...a);
    if (p.backend === 'none') return T('nothing is connected');
    if (p.backend === 'ondevice') return T('on-device AI');
    if (p.backend === 'local') return 'Ollama' + (AIRouter.getModel() ? ' (' + (AIRouter.modelFor ? AIRouter.modelFor(feature) : AIRouter.getModel()) + ')' : '');
    if (p.via === 'worker') return T('your AI Worker');
    const prov = AIKeys.provider(p.provider);
    const model = AIKeys.modelFor(p.provider, feature);
    return (model ? AIKeys.prettyModel(p.provider, model) : (prov ? prov.short : '')) + ' ' + T('with your key');
  },
  _overview(root) {
    const box = this._el('div', 'aic-overview');
    box.setAttribute('role', 'status');
    box.appendChild(this._el('div', 'aic-overview-title', 'Right now'));
    for (const [feature, label] of this.OVERVIEW) {
      const row = this._el('div', 'aic-plan');
      row.appendChild(this._el('span', 'aic-plan-k', label));
      row.appendChild(this._el('span', 'aic-plan-v', this._planText(feature)));
      box.appendChild(row);
    }
    root.appendChild(box);
  },

  // ---- (a) Ollama ------------------------------------------------------------------------------------------
  _ollamaCard(root, redraw) {
    const card = this._el('section', 'aic-card');
    card.dataset.card = 'ollama';
    card.appendChild(this._el('h3', 'aic-card-title', 'On this computer (Ollama)'));
    const s = AIRouter.getOllamaStatus();
    const row = this._el('div', 'aic-row');
    row.appendChild(this._status(s.available ? 'Running' : 'Not running', s.available ? 'ok' : 'off'));
    if (s.available && s.model) row.appendChild(this._el('span', 'aic-muted', s.model));
    card.appendChild(row);
    card.appendChild(this._el('p', 'setting-info muted', 'Free, private and works offline: the model runs on your own computer and nothing you ask leaves it. Answers are slower and simpler than a big cloud model.'));
    const actions = this._el('div', 'aic-row');
    actions.appendChild(this._btn('Check again', async () => { await AIRouter.ollamaUp(); await AISettings.refreshStatus(); redraw(); }));
    actions.appendChild(this._btn('My local models', () => { const t = document.getElementById('model-manager'); if (t) t.scrollIntoView({ block: 'start' }); else this._toast(this.T('Open Settings > AI Backend to see your local models'), 'info'); }));
    actions.appendChild(this._btn('Install guide', () => { const b = document.getElementById('btn-install-ollama'); if (b) b.click(); }));
    card.appendChild(actions);
    root.appendChild(card);
  },

  // ---- (b) your own key --------------------------------------------------------------------------------------
  _openLink(url) {
    if (typeof TabManager === 'undefined') throw new Error('The browser tabs are not ready yet');
    TabManager.createTab(url, true);
  },

  _usedFor(id) {
    const labels = [['chat', 'Chat'], ['agent', 'Agent'], ['summarize', 'Summaries'], ['translate', 'Translate'], ['explain', 'Explain'], ['multiTab', 'Multi-tab AI'], ['groupTabs', 'Group tabs'], ['historySearch', 'History search'], ['historyIndex', 'History indexing'], ['digest', 'Reading digest']];
    return labels.filter(([f]) => { const p = AIRouter.planFor(f); return p.backend === 'cloud' && p.via === 'key' && p.provider === id; }).map(([, l]) => this.T(l));
  },

  _providerTabs(card, redraw) {
    const tabs = this._el('div', 'aic-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', this.T('Provider'));
    for (const p of AIKeys.providers()) {
      const b = this._el('button', 'aic-tab' + (p.id === this._selected ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', p.id === this._selected ? 'true' : 'false');
      b.appendChild(this._el('span', 'aic-tab-name', p.id === 'custom' ? this.T('Custom') : p.short));
      if (p.saved) b.appendChild(this._el('span', 'aic-dot', '')).setAttribute('title', this.T('A key is saved'));
      b.addEventListener('click', () => { this._selected = p.id; redraw(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const list = AIKeys.providers();
        const i = list.findIndex(x => x.id === this._selected);
        this._selected = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length].id;
        redraw();
        const next = card.querySelector('.aic-tab.is-on');
        if (next) next.focus();
      });
      tabs.appendChild(b);
    }
    card.appendChild(tabs);
  },

  _keyForm(card, p, redraw) {
    const T = (t, ...a) => this.T(t, ...a);
    const form = this._el('div', 'aic-form');
    if (p.needsBaseUrl) {
      const l = this._el('label', 'aic-label', 'Server address');
      l.htmlFor = 'aic-base-url';
      const inp = this._el('input', 'set-input');
      inp.id = 'aic-base-url'; inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.placeholder = 'https://api.groq.com/openai/v1';
      inp.value = p.baseUrl || '';
      form.append(l, inp);
      form.appendChild(this._el('p', 'setting-info muted', 'Any server that speaks the OpenAI chat format works: Groq, Together, Mistral, LM Studio, vLLM and more. Write its address up to /v1 (http:// is accepted only for a server on this computer).'));
    }
    const l = this._el('label', 'aic-label', p.needsBaseUrl ? 'API key (leave empty if the server needs none)' : 'API key');
    l.htmlFor = 'aic-key-input';
    const row = this._el('div', 'aic-row aic-row--grow');
    const input = this._el('input', 'set-input');
    input.id = 'aic-key-input'; input.type = 'password'; input.autocomplete = 'new-password'; input.spellcheck = false;
    input.placeholder = p.keyHint;
    input.setAttribute('aria-describedby', 'aic-key-help');
    const paste = this._btn('Paste', async () => {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') throw new Error(T('Pasting from the clipboard is not available here. Press Ctrl+V in the box.'));
      const text = await navigator.clipboard.readText();
      input.value = String(text || '').trim();
      input.focus();
    });
    row.append(input, paste);
    form.append(l, row);
    const help = this._el('p', 'setting-info muted', p.needsBaseUrl
      ? T('Your key is stored only on this computer, sealed by Windows. Vex never shows it again and never sends it anywhere except to the server you named.')
      : T('Your key is stored only on this computer, sealed by Windows. Vex never shows it again and never sends it anywhere except to {1}.', p.short));
    help.id = 'aic-key-help';
    form.appendChild(help);
    const err = this._el('div', 'aic-error');
    err.setAttribute('role', 'alert');
    err.hidden = true;
    form.appendChild(err);
    const actions = this._el('div', 'aic-row');
    actions.appendChild(this._btn('Save key', async () => {
      err.hidden = true;
      const baseUrl = p.needsBaseUrl ? document.getElementById('aic-base-url').value : undefined;
      let res;
      try { res = await window.vex.aiKeySet({ provider: p.id, key: input.value, baseUrl }); }
      catch (e) { err.textContent = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ''); err.hidden = false; return; }
      input.value = '';
      await AIKeys.refresh();
      if (!AIKeys.provider(p.id).saved) throw new Error(T('The key was not saved'));
      await this._afterSave(p.id);
      redraw();
    }, { primary: true }));
    if (p.keyUrl) actions.appendChild(this._btn('Get a key', () => this._openLink(p.keyUrl), { label: T('Open the page where {1} issues API keys', p.short) }));
    form.appendChild(actions);
    card.appendChild(form);
  },

  // A key was just saved: test it, load the provider's own model list, and pick the recommended models for any slot still empty.
  async _afterSave(id) {
    const t = await window.vex.aiKeyTest(id);
    this._results.set(id, t);
    const list = await AIKeys.models(id, false);
    const p = AIKeys.provider(id);
    if (t.ok) {
      const rec = list.recommended || {};
      const next = { default: p.models.default || rec.default || '', fast: p.models.fast || rec.fast || '', best: p.models.best || rec.best || '' };
      await window.vex.aiKeySetModels({ provider: id, models: next });
      this._flash.set(id, 'saved');
    }
    await AIKeys.refresh();
    if (typeof AISettings !== 'undefined' && AISettings.refreshStatus) await AISettings.refreshStatus();
  },

  _errorLine(card, info) {
    const x = AIKeys.explain(info);
    const e = this._el('div', 'aic-error', x.text);
    e.setAttribute('role', 'alert');
    card.appendChild(e);
  },

  _priceText(model) {
    if (!model) return '';
    const rate = typeof VexAIMoney !== 'undefined' ? VexAIMoney.rateFor(model) : AIKeys.builtinRate(model);
    if (!rate || (rate.model === '*')) return this.T('cost unknown');
    return this.T('about {1} in / {2} out per million tokens (an estimate)', rate.inPerM, rate.outPerM);
  },

  _models(card, p, redraw) {
    const T = (t, ...a) => this.T(t, ...a);
    const cached = AIKeys.cachedModels(p.id);
    const box = this._el('div', 'aic-models');
    box.appendChild(this._el('h4', 'aic-sub', 'Models'));
    if (!cached) { box.appendChild(this._el('p', 'aic-muted', 'Loading the model list...')); card.appendChild(box); return; }
    if (cached.source === 'fallback') {
      const n = this._el('p', 'aic-warn', cached.note || 'list unavailable, showing known models');
      n.setAttribute('role', 'status');
      box.appendChild(n);
    } else {
      box.appendChild(this._el('p', 'aic-muted', T('{1} models from {2}, newest first', cached.models.length, p.short)));
    }
    const dl = this._el('datalist');
    dl.id = 'aic-models-' + p.id;
    for (const m of cached.models) { const o = document.createElement('option'); o.value = m.id; o.label = m.name; dl.appendChild(o); }
    box.appendChild(dl);
    const slots = [['best', 'Best (the agent, many tabs at once)'], ['default', 'Balanced (chat and everyday jobs)'], ['fast', 'Fast (background jobs)']];
    const price = (model) => this._priceText(model);
    for (const [slot, label] of slots) {
      const row = this._el('div', 'aic-model-row');
      const l = this._el('label', 'aic-label', label);
      const id = 'aic-model-' + p.id + '-' + slot;
      l.htmlFor = id;
      const inp = this._el('input', 'set-input');
      inp.id = id; inp.type = 'text'; inp.setAttribute('list', dl.id); inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.value = p.models[slot] || '';
      inp.placeholder = (cached.recommended && cached.recommended[slot]) || T('type a model id');
      const pr = this._el('span', 'aic-price', price(inp.value || inp.placeholder));
      inp.addEventListener('input', () => { pr.textContent = price(inp.value || (cached.recommended || {})[slot] || ''); });
      inp.addEventListener('change', async () => {
        try {
          const models = { default: p.models.default, fast: p.models.fast, best: p.models.best, [slot]: inp.value.trim() };
          await window.vex.aiKeySetModels({ provider: p.id, models });
          await AIKeys.refresh();
          this._toast(T('Model saved'), 'success');
          this._redrawOverview();
        } catch (e) { this._fail(e); }
      });
      row.append(l, inp, pr);
      box.appendChild(row);
    }
    box.appendChild(this._el('p', 'setting-info muted', 'Prices are estimates from public price lists and may be out of date; a price you write under "AI spend cap" in Settings wins. The real bill is always the provider\'s.'));
    const actions = this._el('div', 'aic-row');
    actions.appendChild(this._btn('Refresh the list', async () => { await AIKeys.models(p.id, true); redraw(); }));
    box.appendChild(actions);
    card.appendChild(box);
  },

  _cap(card, p) {
    const T = (t, ...a) => this.T(t, ...a);
    if (typeof VexAIMoney === 'undefined') return;
    const box = this._el('div', 'aic-cap');
    box.appendChild(this._el('h4', 'aic-sub', 'Monthly limit'));
    const row = this._el('div', 'aic-row');
    const l = this._el('label', 'aic-label', T('Stop using the cloud after about ({1} a month, 0 for no limit)', VexAIMoney.currency()));
    l.htmlFor = 'aic-cap-input';
    const inp = this._el('input', 'set-input');
    inp.id = 'aic-cap-input'; inp.type = 'number'; inp.min = '0'; inp.step = '0.5';
    inp.value = String(VexAIMoney.moneyCap());
    row.append(l, inp, this._btn('Save limit', () => { VexAIMoney.setMoneyCap(inp.value); this._toast(VexAIMoney.moneyCap() ? T('Monthly limit saved') : T('No monthly limit'), 'success'); this._redrawOverview(); }));
    box.appendChild(row);
    box.appendChild(this._el('p', 'aic-muted', VexAIMoney.line()));
    card.appendChild(box);
  },

  _keyCard(root, redraw) {
    const T = (t, ...a) => this.T(t, ...a);
    const card = this._el('section', 'aic-card');
    card.dataset.card = 'key';
    card.id = 'aic-card-key';
    card.appendChild(this._el('h3', 'aic-card-title', 'Your own key'));
    card.appendChild(this._el('p', 'setting-info muted', 'Use an AI company\'s service with a key from your own account: you pay the provider directly, for what you use. Pick a provider, paste its key once, and Vex does the rest.'));
    if (AIKeys.testMode()) {
      const b = this._el('div', 'aic-warn', 'Test mode: requests go to a stand-in server on this computer, not to the provider.');
      b.setAttribute('role', 'status');
      card.appendChild(b);
    }
    this._providerTabs(card, redraw);
    const p = AIKeys.provider(this._selected);
    const panel = this._el('div', 'aic-panel');
    panel.setAttribute('role', 'tabpanel');
    card.appendChild(panel);
    if (!p.saved) {
      panel.appendChild(this._el('p', 'aic-muted', p.needsBaseUrl ? T('Not set up yet.') : T('No key saved for {1} yet.', p.short)));
      this._keyForm(panel, p, redraw);
      root.appendChild(card);
      return;
    }
    // Saved.
    const head = this._el('div', 'aic-row');
    head.appendChild(this._status('Key saved', 'ok'));
    if (p.hasKey) head.appendChild(this._el('span', 'aic-muted', T('ends in ...{1}', p.last4 || '')));
    if (p.baseUrl) head.appendChild(this._el('span', 'aic-muted', p.baseUrl));
    panel.appendChild(head);
    if (this._flash.get(p.id) === 'saved') { this._flash.delete(p.id); const f = this._el('p', 'aic-ok', 'Saved. Vex tested the key and chose recommended models.'); f.setAttribute('role', 'status'); panel.appendChild(f); }
    const res = this._results.get(p.id);
    if (res) {
      if (res.ok) { const r = this._el('p', 'aic-ok', T('The key works: {1} models, answered in {2} ms', res.count, res.ms)); r.setAttribute('role', 'status'); panel.appendChild(r); }
      else this._errorLine(panel, res.error);
    }
    const actions = this._el('div', 'aic-row');
    actions.appendChild(this._btn('Test key', async () => {
      const t = await window.vex.aiKeyTest(p.id);
      this._results.set(p.id, t);
      if (t.ok) await AIKeys.models(p.id, false);
      redraw();
    }));
    actions.appendChild(this._btn('Replace key', async () => {
      await window.vex.aiKeyClear(p.id);
      await AIKeys.refresh();
      this._results.delete(p.id);
      redraw();
      const i = document.getElementById('aic-key-input'); if (i) i.focus();
    }));
    actions.appendChild(this._btn('Remove key', async () => {
      const ok = await window.vexConfirm({ title: T('Remove this key?'), message: T('Vex forgets the key on this computer. The key itself stays valid at {1} until you delete it there.', p.short), okLabel: T('Remove key'), danger: true });
      if (!ok) return;
      await window.vex.aiKeyClear(p.id);
      this._results.delete(p.id);
      await AIKeys.refresh();
      this._toast(T('Key removed'), 'success');
      redraw();
    }, { danger: true }));
    panel.appendChild(actions);
    if (AIKeys.saved().length > 1 || AIKeys.active() !== p.id) {
      const use = this._el('label', 'setting-toggle-row');
      const radio = this._el('input'); radio.type = 'radio'; radio.name = 'aic-active'; radio.checked = AIKeys.active() === p.id;
      radio.addEventListener('change', () => { if (radio.checked) { AIKeys.setActive(p.id); this._redrawOverview(); this._toast(T('{1} answers chat and the agent', p.short), 'success'); } });
      use.append(radio, document.createTextNode(' '), this._el('span', null, 'Use this one for chat and the agent'));
      panel.appendChild(use);
    }
    this._models(panel, p, redraw);
    if (!AIKeys.cachedModels(p.id)) AIKeys.models(p.id, false).then(() => redraw()).catch(e => this._fail(e));
    const used = this._usedFor(p.id);
    panel.appendChild(this._el('p', 'aic-muted', used.length ? T('Used for:') + ' ' + used.join(', ') : T('Not used for anything right now. Pick this key in the routing table, or make it the cloud source.')));
    this._cap(panel, p);
    root.appendChild(card);
  },

  // ---- where cloud requests go -------------------------------------------------------------------------------
  _sourceRow(root) {
    const T = (t, ...a) => this.T(t, ...a);
    const row = this._el('div', 'aic-row aic-source');
    const l = this._el('label', 'aic-label', 'When a request goes to the cloud, use');
    l.htmlFor = 'aic-source';
    const sel = this._el('select', 'set-input');
    sel.id = 'aic-source';
    for (const [v, t] of [['auto', 'My key if I have one, otherwise my Worker'], ['key', 'My key only'], ['worker', 'My Worker only']]) {
      const o = this._el('option', null, T(t)); o.value = v; sel.appendChild(o);
    }
    sel.value = AIKeys.source();
    sel.addEventListener('change', () => { try { AIKeys.setSource(sel.value); this._redrawOverview(); this._toast(T('Saved'), 'success'); } catch (e) { this._fail(e); } });
    row.append(l, sel);
    root.appendChild(row);
  },

  // ---- (c) your own Worker -------------------------------------------------------------------------------------
  _workerCard(root) {
    const T = (t, ...a) => this.T(t, ...a);
    const card = this._el('details', 'aic-card aic-card--adv');
    card.dataset.card = 'worker';
    const sum = this._el('summary', 'aic-card-title', 'Advanced: your own Worker');
    card.appendChild(sum);
    const set = !!(AIRouter.cloudWorkerUrl && AIRouter.cloudWorkerUrl());
    const row = this._el('div', 'aic-row');
    row.appendChild(this._status(set ? 'Set up' : 'Not set up', set ? 'ok' : 'off'));
    card.appendChild(row);
    card.appendChild(this._el('p', 'setting-info muted', 'A small program you put on your own free Cloudflare account (see SELF_HOSTING.md). It keeps the AI company\'s key on your server instead of on this computer, and can serve more than one device. The address and access token are in Settings under "Cloud Services (self-hosted)"; nothing about them changed.'));
    card.appendChild(this._btn('Open the Worker fields', () => { if (typeof SettingsUI !== 'undefined') SettingsUI.openSection('setting-ai-worker-url'); }));
    root.appendChild(card);
  },

  // ---- the section ------------------------------------------------------------------------------------------------
  _redrawOverview() {
    const old = document.querySelector('#vex-sg-ai-connect .aic-overview');
    if (!old) return;
    const holder = document.createElement('div');
    this._overview(holder);
    old.replaceWith(holder.firstChild);
  },

  group(el) {
    const root = this._el('div', 'aic');
    el.appendChild(root);
    const draw = () => {
      root.textContent = '';
      if (!AIKeys.available()) { root.appendChild(this._el('p', 'aic-warn', 'Your own AI key is not available in this build.')); return; }
      if (!AIKeys.status()) { root.appendChild(this._el('p', 'aic-muted', 'Loading...')); return; }
      root.appendChild(this._el('p', 'setting-info muted', 'Vex needs an AI to think with. Pick one of the three ways below. You can use more than one: Vex sends each kind of request where you tell it to.'));
      this._overview(root);
      this._ollamaCard(root, draw);
      this._keyCard(root, draw);
      this._sourceRow(root);
      this._workerCard(root);
    };
    draw();
    if (AIKeys.available() && !AIKeys.status()) AIKeys.refresh().then(draw).catch(e => this._fail(e));
    VexSettingsGroups.follow('ai-connect', 'vex:ai-keys', () => { if (el.isConnected && !el.contains(document.activeElement)) draw(); });
    VexSettingsGroups.follow('ai-connect-route', 'vex:ai-route-changed', () => { if (el.isConnected) this._redrawOverview(); });
    this._draw = draw;
  },

  // The setup wizard's Cloud AI step: the same key entry in a compact form (provider, key, test). The key goes to main in one call.
  wizardBlock(host) {
    if (!AIKeys.available()) return;
    const T = (t, ...a) => this.T(t, ...a);
    host.textContent = '';
    const box = this._el('div', 'aic-card');
    box.appendChild(this._el('h3', 'aic-card-title', 'Your own API key'));
    const draw = () => {
      box.querySelectorAll('.aic-wiz').forEach(n => n.remove());
      const wrap = this._el('div', 'aic-form aic-wiz');
      const saved = AIKeys.saved();
      if (saved.length) {
        const ok = this._el('p', 'aic-ok', T('Key saved for {1} (ends in ...{2}). You can continue.', saved[0].short, saved[0].last4));
        ok.setAttribute('role', 'status');
        wrap.appendChild(ok);
        wrap.appendChild(this._btn('Change it in Settings', () => this.openCard('key', saved[0].id)));
        box.appendChild(wrap);
        return;
      }
      const sel = this._el('select', 'set-input');
      sel.setAttribute('aria-label', T('Provider'));
      for (const p of AIKeys.providers().filter(x => !x.needsBaseUrl)) { const o = this._el('option', null, p.name); o.value = p.id; sel.appendChild(o); }
      const input = this._el('input', 'set-input');
      input.type = 'password'; input.autocomplete = 'new-password'; input.spellcheck = false; input.placeholder = T('paste your key');
      input.setAttribute('aria-label', T('API key'));
      const err = this._el('div', 'aic-error'); err.setAttribute('role', 'alert'); err.hidden = true;
      const row = this._el('div', 'aic-row');
      row.appendChild(this._btn('Get a key', () => { const p = AIKeys.provider(sel.value); if (p && p.keyUrl) this._openLink(p.keyUrl); }));
      row.appendChild(this._btn('Save and test', async () => {
        err.hidden = true;
        try { await window.vex.aiKeySet({ provider: sel.value, key: input.value }); }
        catch (e) { err.textContent = String((e && e.message) || e).replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, ''); err.hidden = false; return; }
        input.value = '';
        await AIKeys.refresh();
        await this._afterSave(sel.value);
        const r = this._results.get(sel.value);
        if (r && !r.ok) { err.textContent = AIKeys.explain(r.error).text; err.hidden = false; }
        draw();
      }, { primary: true }));
      wrap.append(sel, input, row, err);
      box.appendChild(wrap);
    };
    draw();
    host.appendChild(box);
  },

  // The AI panel's "Connect an AI" buttons: open Settings on the card.
  openCard(card, providerId) {
    if (providerId) this._selected = providerId;
    if (typeof SettingsUI === 'undefined') throw new Error('Settings is not ready yet');
    SettingsUI.openSection('vex-sg-ai-connect');
    if (this._draw) this._draw();
    setTimeout(() => { const c = document.querySelector('#vex-sg-ai-connect [data-card="' + card + '"]'); if (c) { c.scrollIntoView({ block: 'start' }); if (c.tagName === 'DETAILS') c.open = true; } }, 120);
  },
};

if (typeof window !== 'undefined') {
  window.AIConnect = AIConnect;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({
      id: 'ai-connect', title: 'Connect an AI',
      keywords: 'ai api key claude anthropic openai gemini openrouter groq custom ollama worker provider model connect token bring your own byok',
      before: 'ai backend',
      build: (el) => AIConnect.group(el),
    });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { AIConnect };
