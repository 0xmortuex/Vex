// === A daily cap on cloud AI calls (T3-093) ====================================
//
// The cloud AI Worker is paid for by the person who deployed it. Everything that reaches it passes
// AIRouter.callBackend (the same place the sensitivity gate sits), which asks this file two things:
// "is today's cap used up?" and, after a cloud answer, "count one". Once the cap is reached the cloud
// is not used any more that day: a request goes to the local model if one is running, and otherwise
// fails with a plain sentence (AIRouter throws it). Nothing is ever sent to the cloud because the
// cap was reached, and nothing is "quietly" dropped: every downgrade is written to the ledger once
// a day and shown as a notice.
//
//   cap 0 (the default) = no cap. A cap is a number of cloud calls per local day.
//   VexAISpend.cap() / setCap(n)        the limit; 0 means none
//   VexAISpend.used()                   cloud calls so far today
//   VexAISpend.reached()                true when a cap is set and used() has reached it
//   VexAISpend.reserve(feature)         take a slot BEFORE a cloud call: a token, or null when the cap is reached
//   VexAISpend.release(token)           give the slot back when that call failed
//   VexAISpend.count(feature)           one cloud call was made
//   VexAISpend.noteDowngrade(feature)   a request was kept off the cloud (the router calls this)
//   VexAISpend.byFeature()              today's calls per feature, for the Settings line
//
// Stored on this device only: vex.aiSpend = { cap, day, used, features, monthCap, month, monthUsed, perCall }.
// A new day starts at zero, and so does a new month. The cap is a count of calls, not a price: the
// Worker's own bill is the truth about money. An optional "about this much per call" turns the
// monthly count into an estimate on the Settings line, nothing more.
//
// Monthly budget (T3-093, Wave 5): the same slot rule as the daily cap, over a calendar month.
//   VexAISpend.monthCap() / setMonthCap(n)   calls per month; 0 means none
//   VexAISpend.monthUsed()                   cloud calls so far this month
//   VexAISpend.reachedWhich()                'day', 'month' or null: which limit stopped the cloud
//
// Spend routing (T3-093, Wave 5, OFF until vex.aiSpendRouting is 'true'): when a feature is left on
// Auto, an easy task (a short summary, a tab group, a short translation) goes to the local model
// when one is running, and a hard one (the agent, a long page, a picture) to the cloud. The history
// in vex.aiQuality (answers and failures per feature and backend) moves a task away from a backend
// that keeps failing it. Pins in the per-feature table and the Fast cloud / Private local choice are
// never overridden. Every routed answer carries the reason (the answer says "because ...").
//   VexAISpend.routing()                         is spend routing on
//   VexAISpend.difficulty(feature, request)      'easy' | 'normal' | 'hard'
//   VexAISpend.advise(feature, request, avail)   { backend, because } or null
//   VexAISpend.recordOutcome(feature, backend, ok, ms)   the quality history

const VexAISpend = {
  KEY: 'vex.aiSpend',
  MAX_CAP: 100000,
  QUALITY_KEY: 'vex.aiQuality',
  ROUTING_KEY: 'vex.aiSpendRouting',

  _now() { return new Date(); },
  _day(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _month(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    let v = null;
    if (raw != null) {
      try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved AI spend cap is not readable: ' + err.message); }
    }
    const now = this._now();
    const day = this._day(now);
    const month = this._month(now);
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const cap = Number.isInteger(s.cap) && s.cap >= 0 && s.cap <= this.MAX_CAP ? s.cap : 0;
    const monthCap = Number.isInteger(s.monthCap) && s.monthCap >= 0 && s.monthCap <= this.MAX_CAP * 31 ? s.monthCap : 0;
    const perCall = typeof s.perCall === 'number' && s.perCall >= 0 && s.perCall <= 1000 ? s.perCall : 0;
    const sameMonth = s.month === month;
    const base = { cap, monthCap, perCall, month, monthUsed: sameMonth && Number.isInteger(s.monthUsed) && s.monthUsed >= 0 ? s.monthUsed : 0 };
    if (s.day !== day) return { ...base, day, used: 0, features: {}, noted: '' };
    return { ...base, day, used: Number.isInteger(s.used) && s.used >= 0 ? s.used : 0, features: s.features && typeof s.features === 'object' ? s.features : {}, noted: typeof s.noted === 'string' ? s.noted : '' };
  },
  _write(s) {
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); }
    catch (err) { throw new Error('Could not save the AI spend cap: ' + err.message); }
  },

  cap() { return this._read().cap; },
  used() { return this._read().used; },
  byFeature() { return { ...this._read().features }; },
  reached() { return this.reachedWhich() !== null; },
  reachedWhich() {
    const s = this._read();
    if (s.cap > 0 && s.used >= s.cap) return 'day';
    if (s.monthCap > 0 && s.monthUsed >= s.monthCap) return 'month';
    return null;
  },
  monthCap() { return this._read().monthCap; },
  monthUsed() { return this._read().monthUsed; },
  // The sentence the router puts in an error or a notice when a limit stopped the cloud.
  limitText() {
    const w = this.reachedWhich();
    const s = this._read();
    if (w === 'month') return "This month's limit of " + s.monthCap + ' cloud AI calls is used up';
    return "Today's limit of " + s.cap + ' cloud AI calls is used up';
  },

  setMonthCap(n, perCall) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 0 || v > this.MAX_CAP * 31) throw new Error('The monthly budget is a whole number of calls from 0 (none) to ' + this.MAX_CAP * 31);
    const s = this._read();
    s.monthCap = v;
    if (perCall !== undefined) {
      const p = Number(perCall);
      if (!Number.isFinite(p) || p < 0 || p > 1000) throw new Error('The cost per call is a number from 0 to 1000');
      s.perCall = p;
    }
    this._write(s);
    this._emit();
    return v;
  },

  setCap(n) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 0 || v > this.MAX_CAP) throw new Error('The cap is a whole number of calls from 0 (no cap) to ' + this.MAX_CAP);
    const s = this._read();
    s.cap = v;
    this._write(s);
    this._emit();
    return v;
  },

  // The router takes a slot before it calls the cloud, so requests running at the same time cannot all
  // pass the check and overshoot the cap. A failed call gives its slot back (release).
  reserve(feature) {
    const s = this._read();
    if (s.cap > 0 && s.used >= s.cap) return null;
    if (s.monthCap > 0 && s.monthUsed >= s.monthCap) return null;
    const f = String(feature || 'unknown').slice(0, 40);
    s.used++;
    s.monthUsed++;
    s.features[f] = (s.features[f] || 0) + 1;
    this._write(s);
    this._emit();
    return { day: s.day, month: s.month, feature: f };
  },
  release(token) {
    if (!token || typeof token !== 'object') throw new Error('release needs the token reserve() returned');
    const s = this._read();
    if (s.month === token.month && s.monthUsed > 0) s.monthUsed--;
    if (s.day !== token.day) { this._write(s); this._emit(); return; } // a new day began: yesterday's slot is not today's
    if (s.used > 0) s.used--;
    if (s.features[token.feature] > 1) s.features[token.feature]--;
    else delete s.features[token.feature];
    this._write(s);
    this._emit();
  },

  count(feature) {
    const s = this._read();
    s.used++;
    s.monthUsed++;
    const f = String(feature || 'unknown').slice(0, 40);
    s.features[f] = (s.features[f] || 0) + 1;
    this._write(s);
    this._emit();
    return s.used;
  },

  // One plain line: where today stands.
  line() {
    const s = this._read();
    if (!s.cap) return 'No cap. ' + s.used + ' cloud call' + (s.used === 1 ? '' : 's') + ' so far today.';
    if (s.used >= s.cap) return 'Cap reached: ' + s.used + ' of ' + s.cap + ' cloud calls today. Until midnight, AI runs on your local model only.';
    return s.used + ' of ' + s.cap + ' cloud calls used today.';
  },
  // The month's line: calls, and an estimate when a cost per call was given.
  monthLine() {
    const s = this._read();
    const est = s.perCall > 0 ? ' (about ' + (Math.round(s.monthUsed * s.perCall * 100) / 100) + ' at ' + s.perCall + ' a call, your estimate)' : '';
    if (!s.monthCap) return 'No monthly budget. ' + s.monthUsed + ' cloud call' + (s.monthUsed === 1 ? '' : 's') + ' this month' + est + '.';
    if (s.monthUsed >= s.monthCap) return 'Monthly budget reached: ' + s.monthUsed + ' of ' + s.monthCap + ' cloud calls' + est + '. Until next month, AI runs on your local model only.';
    return s.monthUsed + ' of ' + s.monthCap + ' cloud calls used this month' + est + '.';
  },

  // The router kept a request off the cloud because a limit was reached. Said once per period in the
  // ledger and as a notice, so the answer that comes back from the local model is not a mystery.
  noteDowngrade(feature) {
    const s = this._read();
    const which = this.reachedWhich() || 'day';
    const period = which === 'month' ? s.month : s.day;
    if (s.noted !== period) {
      s.noted = period;
      this._write(s);
      if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'ai-spend-cap', what: which === 'month' ? 'Kept AI requests off the cloud for the rest of the month' : 'Kept AI requests off the cloud for the rest of the day', why: (which === 'month' ? 'This month\'s budget of ' + s.monthCap : 'Today\'s cap of ' + s.cap) + ' cloud calls was reached; your local model answers instead' });
    }
    const text = (which === 'month' ? this.limitText() : "Today's cloud AI limit (" + s.cap + ' calls) is used up') + ', so "' + feature + '" ran on your local model.';
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'ai-spend-cap', urgency: 'asked', id: period }, () => window.showToast?.(text, 'info', 7000));
    else if (typeof window !== 'undefined') window.showToast?.(text, 'info', 7000);
    return text;
  },

  // ---- spend routing: task difficulty and model-quality history ----------------------------------
  routing() { try { return localStorage.getItem(this.ROUTING_KEY) === 'true'; } catch (err) { throw new Error('Could not read the spend routing switch: ' + err.message); } },
  setRouting(on) { localStorage.setItem(this.ROUTING_KEY, on ? 'true' : 'false'); this._emit(); return !!on; },

  // Always cloud-sized: the agent and multi-tab work, a picture, a long page. Always small: a tab
  // group, the digest. Everything else is judged by how much text it carries.
  HARD_FEATURES: ['agent', 'multiTab'],
  EASY_FEATURES: ['groupTabs', 'digest'],
  difficulty(feature, request) {
    if (this.HARD_FEATURES.includes(feature)) return 'hard';
    if (this.EASY_FEATURES.includes(feature)) return 'easy';
    const r = request || {};
    if (r.image) return 'hard';
    const page = r.pageContext && r.pageContext.text ? String(r.pageContext.text).length : 0;
    const sel = r.selectedText ? String(r.selectedText).length : 0;
    const msg = r.message ? String(r.message).length : 0;
    const history = Array.isArray(r.conversationHistory) ? r.conversationHistory.length : 0;
    const size = page + sel + msg;
    if (size > 12000 || history > 12) return 'hard';
    if (size <= 4000 && history <= 6) return 'easy';
    return 'normal';
  },

  _quality() {
    const raw = localStorage.getItem(this.QUALITY_KEY);
    if (raw == null) return {};
    try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    catch (err) { throw new Error('The saved AI quality history is not readable: ' + err.message); }
  },
  recordOutcome(feature, backend, ok, ms) {
    if (!['cloud', 'local', 'ondevice'].includes(backend)) return;
    const q = this._quality();
    const key = String(feature || 'unknown').slice(0, 40) + '|' + backend;
    const e = q[key] && typeof q[key] === 'object' ? q[key] : { ok: 0, fail: 0, ms: 0 };
    if (ok) { e.ok++; if (Number.isFinite(ms) && ms >= 0) e.ms = Math.round(e.ms ? (e.ms * 0.8 + ms * 0.2) : ms); } else e.fail++;
    // Old results fade: the counts are halved when they pass 40, so a backend that got better is forgiven.
    if (e.ok + e.fail > 40) { e.ok = Math.round(e.ok / 2); e.fail = Math.round(e.fail / 2); }
    q[key] = e;
    localStorage.setItem(this.QUALITY_KEY, JSON.stringify(q));
  },
  // Failure rate of a backend for a feature, or null when there is too little history to say.
  failRate(feature, backend) {
    const e = this._quality()[String(feature) + '|' + backend];
    if (!e) return null;
    const n = (e.ok || 0) + (e.fail || 0);
    return n >= 4 ? (e.fail || 0) / n : null;
  },
  qualityRows() {
    return Object.entries(this._quality()).map(([k, e]) => { const [feature, backend] = k.split('|'); return { feature, backend, ok: e.ok || 0, fail: e.fail || 0, ms: e.ms || 0 }; })
      .sort((a, b) => (b.fail - a.fail) || (b.ok - a.ok));
  },

  // The router asks, for a feature left on Auto, which backend this task deserves. null = no opinion.
  // avail = { localUp, cloudOk }. The router checks the pins and the mode before it asks.
  advise(feature, request, avail) {
    if (!this.routing()) return null;
    const a = avail || {};
    const d = this.difficulty(feature, request);
    const localBad = this.failRate(feature, 'local');
    const cloudBad = this.failRate(feature, 'cloud');
    const s = this._read();
    const nearBudget = s.monthCap > 0 && s.monthUsed >= s.monthCap * 0.8;
    if (d === 'easy' && a.localUp) {
      if (localBad !== null && localBad >= 0.5 && a.cloudOk) return { backend: 'cloud', because: 'it is a small task, but your local model failed most of these before' };
      return { backend: 'local', because: 'it is a small task, so your local model handles it and the cloud stays unspent' };
    }
    if (d === 'hard' && a.cloudOk) {
      if (cloudBad !== null && cloudBad >= 0.5 && a.localUp) return { backend: 'local', because: 'it is a big task, but the cloud failed most of these before' };
      return { backend: 'cloud', because: 'it is a big task, so it goes to the stronger cloud model' };
    }
    if (d === 'normal' && nearBudget && a.localUp) return { backend: 'local', because: 'most of this month\'s cloud budget is spent' };
    return null;
  },

  _emit() { try { document.dispatchEvent(new CustomEvent('vex:ai-spend')); } catch { /* vex-allow-empty-catch: no document in a test */ } },

  group(host) {
    const el = document.createElement('div');
    host.appendChild(el);
    const draw = () => {
      el.textContent = '';
      el.appendChild(VexSettingsGroups.note('A limit on how many times Vex may use your cloud AI Worker in one day. When it is reached, AI runs on your local model (Ollama) until midnight; if none is running you are told, and nothing is sent. 0 means no limit. This counts calls, not money.'));
      el.appendChild(VexSettingsGroups.note(this.line()));
      const row = document.createElement('div');
      row.className = 'setting-toggle-row';
      const label = document.createElement('label');
      label.textContent = 'Cloud calls per day';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.max = String(this.MAX_CAP); input.step = '1';
      input.value = String(this.cap());
      input.id = 'ai-spend-cap-input';
      input.setAttribute('aria-label', 'Cloud AI calls allowed per day, 0 for no limit');
      label.htmlFor = input.id;
      const save = VexSettingsGroups.button('Save', () => {
        try { this.setCap(input.value); window.showToast?.(this.cap() ? 'Cap set to ' + this.cap() + ' cloud calls a day' : 'No daily cap'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
        draw();
      }, { primary: true });
      row.append(label, input, save);
      el.appendChild(row);
      const by = Object.entries(this.byFeature()).sort((a, b) => b[1] - a[1]).map(([f, n]) => f + ' ' + n).join(', ');
      if (by) el.appendChild(VexSettingsGroups.note('Today by feature: ' + by));

      // Monthly budget (T3-093)
      el.appendChild(VexSettingsGroups.note('Monthly budget: the same rule over a calendar month. The optional cost per call only turns the count into an estimate here.'));
      el.appendChild(VexSettingsGroups.note(this.monthLine()));
      const mrow = document.createElement('div');
      mrow.className = 'setting-toggle-row';
      const mlabel = document.createElement('label');
      mlabel.textContent = 'Cloud calls per month';
      const minput = document.createElement('input');
      minput.type = 'number'; minput.min = '0'; minput.step = '1'; minput.id = 'ai-spend-month-input';
      minput.value = String(this.monthCap());
      minput.setAttribute('aria-label', 'Cloud AI calls allowed per month, 0 for no limit');
      mlabel.htmlFor = minput.id;
      const plabel = document.createElement('label');
      plabel.textContent = 'Estimated cost per call';
      const pinput = document.createElement('input');
      pinput.type = 'number'; pinput.min = '0'; pinput.step = '0.001'; pinput.id = 'ai-spend-percall-input';
      pinput.value = String(this._read().perCall);
      pinput.setAttribute('aria-label', 'Estimated cost of one cloud AI call, 0 for no estimate');
      plabel.htmlFor = pinput.id;
      const msave = VexSettingsGroups.button('Save budget', () => {
        try { this.setMonthCap(minput.value, pinput.value); window.showToast?.(this.monthCap() ? 'Budget set to ' + this.monthCap() + ' cloud calls a month' : 'No monthly budget'); }
        catch (err) { window.showToast?.(err.message, 'error'); }
        draw();
      }, { primary: true });
      mrow.append(mlabel, minput, plabel, pinput, msave);
      el.appendChild(mrow);

      // Task and quality routing (T3-093)
      const rrow = document.createElement('label');
      rrow.className = 'setting-toggle-row';
      const rbox = document.createElement('input');
      rbox.type = 'checkbox'; rbox.checked = this.routing(); rbox.id = 'ai-spend-routing';
      rbox.addEventListener('change', () => { try { this.setRouting(rbox.checked); } catch (err) { window.showToast?.(err.message, 'error'); } });
      rrow.append(rbox, document.createTextNode(' Route by task size and past results (features left on Auto only)'));
      el.appendChild(rrow);
      el.appendChild(VexSettingsGroups.note('Small tasks go to your local model when one is running, big ones to the cloud, and a backend that kept failing a kind of task is passed over. Pins in the per-feature table and the Where AI runs choice always win. Each answer says which backend answered and why.'));
      const rows = this.qualityRows().slice(0, 6);
      if (rows.length) el.appendChild(VexSettingsGroups.note('Results so far: ' + rows.map(r => r.feature + ' on ' + r.backend + ' ' + r.ok + ' answered, ' + r.fail + ' failed').join('; ')));
    };
    draw();
    document.addEventListener('vex:ai-spend', () => { if (el.isConnected) draw(); });
  },
};

if (typeof window !== 'undefined') {
  window.VexAISpend = VexAISpend;
  if (typeof VexSettingsGroups !== 'undefined') {
    VexSettingsGroups.register({ id: 'ai-spend-cap', title: 'AI spend cap', keywords: 'ai cloud limit budget cost spend cap daily calls worker local', before: 'about', build: (el) => VexAISpend.group(el) });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexAISpend };
