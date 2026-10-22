// === A money budget for cloud AI, with prices you edit, and the quality history (T3-093) ====
//
// js/ai-spend-cap.js limits CALLS (a day and a month). A call to a small model and a call that
// sends a whole page to a large one cost very different amounts, so this adds a limit in MONEY:
//
//   prices        a table the person edits: the model's name (or a part of it, or * for any other),
//                 the price of a million tokens going in, and of a million coming out, in the
//                 currency they write (a label only: Vex does not convert).
//   spent         after each cloud answer Vex adds up an ESTIMATE: tokens are counted as one per four
//                 characters of what was sent and what came back (a picture counts as 1500), times the
//                 price of the model that answered (the answer's own model name when it gives one, else
//                 the * row). A model with no row is counted as a call with no price and said so; it is
//                 never guessed.
//   budget        a monthly limit in that currency. When the estimate reaches it the cloud is not used
//                 any more that month, exactly like the call limits: the local model answers instead, or
//                 an error says so. Nothing is sent to the cloud because the budget was reached.
//
// The Worker's own bill is the truth about money; this is a seatbelt, and says "about" everywhere.
// Stored on this device only: vex.aiMoney. 0 for the budget means none. A new month starts at zero.
//
// The quality history (what each feature got back from the cloud and the local model, kept by
// VexAISpend.recordOutcome and used by the spend routing) is shown here as a table, with a reset.
const VexAIMoney = {
  KEY: 'vex.aiMoney',
  MAX_RATES: 30,
  MAX_PRICE: 100000,
  MAX_BUDGET: 1000000,
  IMAGE_TOKENS: 1500,

  _now() { return new Date(); },
  _month(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    let v = null;
    if (raw != null) {
      try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved AI money budget is not readable: ' + err.message, { cause: err }); }
    }
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const month = this._month(this._now());
    const num = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : 0);
    const rates = (Array.isArray(s.rates) ? s.rates : []).filter(r => r && typeof r.model === 'string' && r.model.trim()).slice(0, this.MAX_RATES)
      .map(r => ({ model: r.model.trim().slice(0, 60), inPerM: num(r.inPerM, this.MAX_PRICE), outPerM: num(r.outPerM, this.MAX_PRICE) }));
    const base = { currency: typeof s.currency === 'string' && s.currency.trim() ? s.currency.trim().slice(0, 6) : 'USD', rates, cap: num(s.cap, this.MAX_BUDGET), month };
    if (s.month !== month) return { ...base, spent: 0, calls: 0, unpriced: 0, tokensIn: 0, tokensOut: 0, byModel: {}, noted: '' };
    return { ...base, spent: num(s.spent, 1e12), calls: Math.floor(num(s.calls, 1e9)), unpriced: Math.floor(num(s.unpriced, 1e9)), tokensIn: Math.floor(num(s.tokensIn, 1e15)), tokensOut: Math.floor(num(s.tokensOut, 1e15)),
      byModel: s.byModel && typeof s.byModel === 'object' && !Array.isArray(s.byModel) ? s.byModel : {}, noted: typeof s.noted === 'string' ? s.noted : '' };
  },
  _write(s) {
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); }
    catch (err) { throw new Error('Could not save the AI money budget: ' + err.message, { cause: err }); }
    try { document.dispatchEvent(new CustomEvent('vex:ai-spend')); } catch (err) { console.error('[AIMoney] event failed:', err); }
  },

  // ---- the settings -------------------------------------------------------------------------------
  currency() { return this._read().currency; },
  setCurrency(text) {
    const c = String(text == null ? '' : text).trim();
    if (!c || c.length > 6) throw new Error('Write the currency as a short label such as USD, EUR or TL');
    const s = this._read(); s.currency = c; this._write(s);
    return c;
  },
  rates() { return this._read().rates; },
  // list: [{ model, inPerM, outPerM }]. Replaces the table; refuses a bad row and says which.
  setRates(list) {
    if (!Array.isArray(list)) throw new Error('The prices are a list of rows');
    if (list.length > this.MAX_RATES) throw new Error('At most ' + this.MAX_RATES + ' prices');
    const seen = new Set();
    const clean = list.map((r, i) => {
      const row = i + 1;
      const model = String(r && r.model != null ? r.model : '').trim();
      if (!model) throw new Error('Row ' + row + ' needs a model name (or * for any other model)');
      if (model.length > 60) throw new Error('Row ' + row + ': the model name is up to 60 characters');
      if (seen.has(model.toLowerCase())) throw new Error('Row ' + row + ': "' + model + '" is listed twice');
      seen.add(model.toLowerCase());
      const price = (x, what) => {
        const n = Number(x);
        if (x === '' || x == null || !Number.isFinite(n) || n < 0 || n > this.MAX_PRICE) throw new Error('Row ' + row + ': the price for a million ' + what + ' tokens is a number from 0 to ' + this.MAX_PRICE);
        return n;
      };
      return { model, inPerM: price(r.inPerM, 'incoming'), outPerM: price(r.outPerM, 'outgoing') };
    });
    const s = this._read(); s.rates = clean; this._write(s);
    return clean;
  },
  moneyCap() { return this._read().cap; },
  setMoneyCap(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0 || v > this.MAX_BUDGET) throw new Error('The money budget is a number from 0 (none) to ' + this.MAX_BUDGET);
    const s = this._read(); s.cap = v; this._write(s);
    return v;
  },

  // ---- pricing (pure) -----------------------------------------------------------------------------
  // The row for a model name: exact (any case), else the longest row name contained in it, else *. null when none.
  rateFor(model, rates = this.rates()) {
    const name = String(model == null ? '' : model).trim().toLowerCase();
    const list = rates.filter(r => r.model !== '*');
    const exact = list.find(r => r.model.toLowerCase() === name);
    if (exact) return exact;
    const part = list.filter(r => name && name.includes(r.model.toLowerCase())).sort((a, b) => b.model.length - a.model.length)[0];
    return part || rates.find(r => r.model === '*') || null;
  },
  estimateTokens(chars) { return Math.ceil(Math.max(0, Number(chars) || 0) / 4); },
  // The characters a request carries to the cloud, without the picture bytes (a picture counts IMAGE_TOKENS).
  requestSize(request) {
    const r = request || {};
    let chars = 0, images = 0;
    const add = (t) => { if (typeof t === 'string') chars += t.length; };
    add(r.message); add(r.selectedText);
    if (r.pageContext) { add(r.pageContext.text); add(r.pageContext.title); }
    for (const m of Array.isArray(r.conversationHistory) ? r.conversationHistory : []) add(m && m.content);
    if (r.persona) add(r.persona.systemPrompt);
    if (r.image || r.images) images += Array.isArray(r.images) ? r.images.length : 1;
    return { chars, images };
  },
  answerText(answer) {
    const a = answer && typeof answer === 'object' ? answer : {};
    const res = a.result;
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object') return String(res.reply || res.text || res.summary || JSON.stringify(res));
    return typeof answer === 'string' ? answer : '';
  },
  // -> money for this many tokens at this model's price, or null when the model has no price.
  cost(model, tokensIn, tokensOut, rates) {
    const rate = this.rateFor(model, rates);
    return rate ? (tokensIn * rate.inPerM + tokensOut * rate.outPerM) / 1e6 : null;
  },

  // ---- keeping the figure -------------------------------------------------------------------------
  // After a cloud answer (js/ai-router.js). A problem is reported, never thrown into the answer.
  record(feature, request, answer) {
    try {
      const s = this._read();
      const size = this.requestSize(request);
      const tin = this.estimateTokens(size.chars) + size.images * this.IMAGE_TOKENS;
      const tout = this.estimateTokens(this.answerText(answer).length);
      const model = (answer && typeof answer === 'object' && typeof answer.model === 'string' && answer.model) || '';
      const c = this.cost(model, tin, tout, s.rates);
      s.calls++; s.tokensIn += tin; s.tokensOut += tout;
      const key = (model || 'unnamed model').slice(0, 60);
      const m = s.byModel[key] && typeof s.byModel[key] === 'object' ? s.byModel[key] : { calls: 0, money: 0 };
      m.calls++;
      if (c === null) s.unpriced++; else { s.spent += c; m.money += c; }
      s.byModel[key] = m;
      this._write(s);
      return c;
    } catch (err) {
      console.error('[AIMoney] could not add up a cloud call:', err);
      if (typeof VexProblems !== 'undefined' && VexProblems && typeof VexProblems.note === 'function') VexProblems.note('AI spend', 'The cost of a cloud call could not be added up', err);
      return null;
    }
  },
  spent() { return this._read().spent; },
  reached() { const s = this._read(); return s.cap > 0 && s.spent >= s.cap; },
  limitText() {
    const s = this._read();
    return "This month's money budget of " + this._fmt(s.cap) + ' ' + s.currency + ' for cloud AI is used up (about ' + this._fmt(s.spent) + ' ' + s.currency + ' by Vex\'s estimate)';
  },
  // Two decimals; a small amount keeps two significant digits (0.0045), so a cheap month does not read as 0.
  _fmt(n) { return n > 0 && n < 0.01 ? String(Number(n.toPrecision(2))) : String(Math.round(n * 100) / 100); },
  line() {
    const s = this._read();
    const part = 'About ' + this._fmt(s.spent) + ' ' + s.currency + ' spent on the cloud AI this month (an estimate: ' + s.calls + ' call' + VexPlural.s(s.calls) + ', ' + s.tokensIn + ' tokens in and ' + s.tokensOut + ' out, counted as one per four characters)';
    const unpriced = s.unpriced ? '; ' + s.unpriced + ' call' + (s.unpriced === 1 ? ' had' : 's had') + ' no price in the table, so they cost 0 here' : '';
    const cap = s.cap > 0 ? '. Budget ' + this._fmt(s.cap) + ' ' + s.currency + (s.spent >= s.cap ? ': reached, the cloud is not used until next month.' : ': ' + this._fmt(Math.max(0, s.cap - s.spent)) + ' left.') : '. No money budget.';
    return part + unpriced + cap;
  },
  // The router kept a request off the cloud because the money budget was reached: said once a month.
  noteDowngrade(feature) {
    const s = this._read();
    const text = this.limitText() + ', so "' + feature + '" ran on your local model.';
    if (s.noted !== s.month) {
      s.noted = s.month;
      this._write(s);
      if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'ai-spend-cap', what: 'Kept AI requests off the cloud for the rest of the month', why: this.limitText() + '; your local model answers instead' });
    }
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'ai-spend-cap', urgency: 'asked', id: s.month + ':money' }, () => window.showToast?.(text, 'info', 7000));
    else if (typeof window !== 'undefined') window.showToast?.(text, 'info', 7000);
    return text;
  },
  forgetMonth() { const s = this._read(); s.spent = 0; s.calls = 0; s.unpriced = 0; s.tokensIn = 0; s.tokensOut = 0; s.byModel = {}; this._write(s); },

  // ---- the quality history as a table ----------------------------------------------------------------
  // -> [{ feature, backend, ok, fail, rate (0..1 or null), ms }] worst first (VexAISpend keeps the numbers)
  qualityTable() {
    if (typeof VexAISpend === 'undefined' || typeof VexAISpend.qualityRows !== 'function') throw new Error('The AI spend module is not loaded');
    return VexAISpend.qualityRows().map(r => {
      const n = r.ok + r.fail;
      return { ...r, rate: n ? r.fail / n : null };
    });
  },
  resetQuality() {
    if (typeof VexAISpend === 'undefined') throw new Error('The AI spend module is not loaded');
    localStorage.removeItem(VexAISpend.QUALITY_KEY);
    try { document.dispatchEvent(new CustomEvent('vex:ai-spend')); } catch (err) { console.error('[AIMoney] event failed:', err); }
  },
  openQuality() {
    if (typeof VexSettingsGroups === 'undefined') throw new Error('The dialog helpers are not loaded');
    const S = VexSettingsGroups;
    const { body } = S.dialog({ id: 'vex-ai-quality', title: 'AI quality history', sub: 'What each feature got back from the cloud and from your local model. The spend routing uses it to pass over a backend that keeps failing a kind of task.' });
    const draw = () => {
      body.textContent = '';
      const rows = this.qualityTable();
      if (!rows.length) body.appendChild(S.note('Nothing recorded yet. It fills as you use AI.'));
      else {
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
        const head = table.createTHead().insertRow();
        for (const h of ['Feature', 'Backend', 'Answered', 'Failed', 'Failure rate', 'Typical time']) { const th = document.createElement('th'); th.textContent = h; th.style.cssText = 'text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)'; head.appendChild(th); }
        const tb = table.createTBody();
        for (const r of rows) {
          const tr = tb.insertRow();
          const cells = [r.feature, r.backend === 'cloud' ? 'cloud' : r.backend === 'local' ? 'local model' : r.backend, String(r.ok), String(r.fail), r.rate === null ? '-' : Math.round(r.rate * 100) + '%', r.ms ? (Math.round(r.ms / 100) / 10) + ' s' : '-'];
          for (const c of cells) { const td = tr.insertCell(); td.textContent = c; td.style.cssText = 'padding:4px 8px;border-bottom:1px solid var(--border)'; }
          if (r.rate !== null && r.rate >= 0.5 && r.ok + r.fail >= 4) tr.style.fontWeight = '650';
        }
        body.appendChild(table);
        body.appendChild(S.note('Counts fade: they are halved once they pass 40, so a backend that got better is forgiven. A row in bold failed at least half of the time.'));
        body.appendChild(S.button('Reset the history', async () => {
          if (!await window.vexConfirm({ title: 'Reset the AI quality history?', message: 'The routing starts from nothing and learns again.', okLabel: 'Reset', danger: true })) return;
          try { this.resetQuality(); } catch (err) { window.showToast?.(err.message, 'error'); }
          draw();
        }, { danger: true }));
      }
    };
    draw();
    return body;
  },

  // ---- Settings ------------------------------------------------------------------------------------------
  group(el) {
    const S = VexSettingsGroups;
    const draw = () => {
      el.textContent = '';
      const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
      el.appendChild(S.note('A limit in money for the cloud AI, next to the limit in calls. Write what each model costs for a million tokens in and out; Vex adds up an estimate after every cloud answer (one token per four characters) and stops using the cloud for the month when the estimate reaches your budget. The Worker\'s own bill is the truth: this is a seatbelt.'));
      el.appendChild(S.note(this.line()));
      const s = this._read();
      const field = (label, value, attrs = {}) => {
        const wrap = document.createElement('label');
        wrap.className = 'setting-toggle-row';
        wrap.append(document.createTextNode(label + ' '));
        const input = document.createElement('input');
        input.value = value; input.setAttribute('aria-label', label);
        Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
        wrap.appendChild(input);
        el.appendChild(wrap);
        return input;
      };
      const cur = field('Currency', s.currency, { size: '6', maxlength: '6' });
      const cap = field('Cloud AI budget per month (0 for none)', String(s.cap), { type: 'number', min: '0', step: '0.01' });
      el.appendChild(S.button('Save currency and budget', () => { try { this.setCurrency(cur.value); this.setMoneyCap(cap.value); window.showToast?.(this.moneyCap() ? 'Budget set to ' + this._fmt(this.moneyCap()) + ' ' + this.currency() + ' a month' : 'No money budget'); } catch (err) { fail(err); } draw(); }, { primary: true }));

      el.appendChild(S.note('Prices for a million tokens. A row\'s name is a model name, a part of one (claude-sonnet matches claude-sonnet-4), or * for any other model.'));
      const rows = s.rates.map(r => ({ ...r }));
      const grid = document.createElement('div');
      el.appendChild(grid);
      const paint = () => {
        grid.textContent = '';
        rows.forEach((r, i) => {
          const line = document.createElement('div');
          line.className = 'vexsr-rule';
          const cell = (key, ph, w) => {
            const input = document.createElement('input');
            input.value = String(r[key]); input.placeholder = ph; input.setAttribute('aria-label', ph + ' (row ' + (i + 1) + ')'); input.style.width = w;
            if (key !== 'model') { input.type = 'number'; input.min = '0'; input.step = '0.01'; }
            input.addEventListener('input', () => { r[key] = input.value; });
            line.appendChild(input);
          };
          cell('model', 'Model name or *', '180px'); cell('inPerM', 'In per million', '110px'); cell('outPerM', 'Out per million', '110px');
          line.appendChild(S.button('Remove', () => { rows.splice(i, 1); paint(); }, { danger: true, label: 'Remove the price in row ' + (i + 1) }));
          grid.appendChild(line);
        });
      };
      paint();
      el.appendChild(S.button('Add a price', () => { rows.push({ model: '', inPerM: '0', outPerM: '0' }); paint(); }));
      el.appendChild(S.button('Save the prices', () => { try { this.setRates(rows); window.showToast?.('Prices saved'); } catch (err) { fail(err); } draw(); }, { primary: true }));
      const by = Object.entries(s.byModel).sort((a, b) => b[1].money - a[1].money).slice(0, 6).map(([m, v]) => m + ': ' + v.calls + ' call' + VexPlural.s(v.calls) + ', about ' + this._fmt(v.money) + ' ' + s.currency);
      if (by.length) el.appendChild(S.note('This month by model: ' + by.join('; ')));
      el.appendChild(S.button('Start this month\'s count again', async () => {
        if (!await window.vexConfirm({ title: 'Start the count again?', message: 'The estimate for this month goes back to 0. The call limits are not touched.', okLabel: 'Start again' })) return;
        try { this.forgetMonth(); } catch (err) { fail(err); }
        draw();
      }));
      el.appendChild(S.button('Quality history...', () => { try { this.openQuality(); } catch (err) { fail(err); } }));
    };
    draw();
    VexSettingsGroups.follow('ai-money', 'vex:ai-spend', () => { if (el.isConnected && !el.contains(document.activeElement)) draw(); });
  },
};

if (typeof window !== 'undefined') {
  window.VexAIMoney = VexAIMoney;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'ai-money', title: 'AI spend cap: money budget and prices', keywords: 'ai cloud money budget price cost per token model currency monthly quality history', before: 'about', build: (el) => VexAIMoney.group(el) });
  }
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'ai-quality-history', label: 'AI quality history', hint: 'What each feature got back from the cloud and your local model', icon: 'chart-bar', action: () => { try { VexAIMoney.openQuality(); } catch (err) { window.showToast?.(err.message, 'error'); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAIMoney };
