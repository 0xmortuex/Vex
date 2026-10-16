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
//   VexAISpend.count(feature)           one cloud call was made (the router calls this)
//   VexAISpend.noteDowngrade(feature)   a request was kept off the cloud (the router calls this)
//   VexAISpend.byFeature()              today's calls per feature, for the Settings line
//
// Stored on this device only: vex.aiSpend = { cap, day, used, features }. A new day starts at zero.
// The cap is a count of calls, not a price: the Worker's own bill is the truth about money.

const VexAISpend = {
  KEY: 'vex.aiSpend',
  MAX_CAP: 100000,

  _now() { return new Date(); },
  _day(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },

  _read() {
    const raw = localStorage.getItem(this.KEY);
    let v = null;
    if (raw != null) {
      try { v = JSON.parse(raw); } catch (err) { throw new Error('The saved AI spend cap is not readable: ' + err.message); }
    }
    const day = this._day(this._now());
    const s = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const cap = Number.isInteger(s.cap) && s.cap >= 0 && s.cap <= this.MAX_CAP ? s.cap : 0;
    if (s.day !== day) return { cap, day, used: 0, features: {}, noted: '' };
    return { cap, day, used: Number.isInteger(s.used) && s.used >= 0 ? s.used : 0, features: s.features && typeof s.features === 'object' ? s.features : {}, noted: typeof s.noted === 'string' ? s.noted : '' };
  },
  _write(s) {
    try { localStorage.setItem(this.KEY, JSON.stringify(s)); }
    catch (err) { throw new Error('Could not save the AI spend cap: ' + err.message); }
  },

  cap() { return this._read().cap; },
  used() { return this._read().used; },
  byFeature() { return { ...this._read().features }; },
  reached() { const s = this._read(); return s.cap > 0 && s.used >= s.cap; },

  setCap(n) {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 0 || v > this.MAX_CAP) throw new Error('The cap is a whole number of calls from 0 (no cap) to ' + this.MAX_CAP);
    const s = this._read();
    s.cap = v;
    this._write(s);
    this._emit();
    return v;
  },

  count(feature) {
    const s = this._read();
    s.used++;
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

  // The router kept a request off the cloud because the cap was reached. Said once a day in the
  // ledger and as a notice, so the answer that comes back from the local model is not a mystery.
  noteDowngrade(feature) {
    const s = this._read();
    if (s.noted !== s.day) {
      s.noted = s.day;
      this._write(s);
      if (typeof VexLedger !== 'undefined') VexLedger.note({ feature: 'ai-spend-cap', what: 'Kept AI requests off the cloud for the rest of the day', why: 'Today\'s cap of ' + s.cap + ' cloud calls was reached; your local model answers instead' });
    }
    const text = 'Today\'s cloud AI limit (' + s.cap + ' calls) is used up, so "' + feature + '" ran on your local model.';
    if (typeof VexAttention !== 'undefined') VexAttention.notify({ feature: 'ai-spend-cap', urgency: 'asked', id: s.day }, () => window.showToast?.(text, 'info', 7000));
    else if (typeof window !== 'undefined') window.showToast?.(text, 'info', 7000);
    return text;
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
