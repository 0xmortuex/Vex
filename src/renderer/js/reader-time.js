// === Reader view: "about N min left" ====================================================================
//
// An opt-in line in the corner of the reader view (reading-mode.js): how long the rest of the article takes at the person's own reading
// speed, updated as they scroll. It is OFF until switched on with Ctrl+K "Reader: Show Time Left"; the speed is
// 200 words a minute, 180 when Vex is in Turkish (Turkish words are longer), or a number the person types with
// Ctrl+K "Reader: Set Reading Speed" (80 to 600).
//
// Where the work is: the reader view is a page of its own (a data: document), so the small script that does the sums has to be IN that
// page. The sums are one pure function (timeLeft) that is written out into the page as text, so the tests run the very same code.
// vex-layer-exempt: the corner line is drawn inside the reader page (its own document, not a window overlay), so the layer manager does not apply.
// What it reads: the number of words of the article (counted when the reader is built) and how far the page is scrolled. It keeps
// two things in this window's storage: whether it is on and the typed speed. It sends nothing.
const VexReaderTime = {
  KEY: 'vex.reader.timeLeft',
  DEFAULT_WPM: 200,
  TURKISH_WPM: 180,
  MIN_WPM: 80,
  MAX_WPM: 600,
  SOON_SECONDS: 45,
  _t(text) { return (typeof VexI18nUI !== 'undefined' && VexI18nUI.lookup(text)) || text; },

  // ---- pure parts (timeLeft and pageFn are also written into the reader page, so they use nothing from outside) -------------
  // words: words in the whole article. fraction: 0..1, how much of it has been scrolled past. wpm: reading speed.
  // -> { minutes, done }: minutes is 0 when it is under SOON_SECONDS seconds, done when the end is on screen.
  timeLeft: function (words, fraction, wpm) {
    var w = Number(words), s = Number(wpm), f = Number(fraction);
    if (!(w >= 0)) throw new Error('The word count is not a number');
    if (!(s > 0)) throw new Error('The reading speed is not a number');
    if (!(f >= 0)) f = 0;
    if (f > 1) f = 1;
    var remaining = w * (1 - f);
    if (f >= 1 || remaining < 1) return { minutes: 0, done: true };
    var seconds = remaining / s * 60;
    if (seconds < 45) return { minutes: 0, done: false };
    return { minutes: Math.max(1, Math.round(remaining / s)), done: false };
  },
  // The part of the article that has been scrolled past: the bottom edge of the window against the article's top and height. Pure.
  fractionOf: function (viewHeight, articleTop, articleHeight) {
    if (!(articleHeight > 0)) return 0;
    var f = (viewHeight - articleTop) / articleHeight;
    return f < 0 ? 0 : f > 1 ? 1 : f;
  },
  // Runs inside the reader page. cfg: { words, wpm, labels: { left, soon, done } }. The two functions above come in as arguments.
  pageFn: function (cfg, timeLeft, fractionOf) {
    var art = document.querySelector('#vr-main article');
    if (!art || !document.body) return;
    var el = document.createElement('div');
    el.id = 'vr-timeleft';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;right:14px;bottom:12px;z-index:6;padding:4px 10px;border:1px solid var(--vr-border);border-radius:999px;background:var(--vr-bg);color:var(--vr-muted);font:12.5px/1.4 "Segoe UI",system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(el);
    var queued = false;
    function render() {
      queued = false;
      var r = art.getBoundingClientRect();
      var res = timeLeft(cfg.words, fractionOf(window.innerHeight, r.top, r.height), cfg.wpm);
      el.textContent = res.done ? cfg.labels.done : res.minutes < 1 ? cfg.labels.soon : cfg.labels.left.replace('{1}', String(res.minutes));
    }
    function queue() { if (!queued) { queued = true; window.requestAnimationFrame(render); } }
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    render();
  },
  pageSource(cfg) {
    const json = JSON.stringify(cfg).replace(/</g, '\\u003c');
    return '(' + this.pageFn.toString() + ')(' + json + ',' + this.timeLeft.toString() + ',' + this.fractionOf.toString() + ');';
  },

  // ---- the setting ----------------------------------------------------------------------------------------------------------
  isTurkish() { return typeof VexI18nUI !== 'undefined' && typeof VexI18nUI.locale === 'function' && VexI18nUI.locale() === 'tr'; },
  cleanWpm(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= this.MIN_WPM && n <= this.MAX_WPM ? n : 0;       // 0: the default for the language
  },
  state() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this.KEY) || 'null'); }
    catch (err) { window.VexProblems?.note('Reader time left', 'the saved setting could not be read', err); }
    const o = raw && typeof raw === 'object' ? raw : {};
    return { on: o.on === true, wpm: this.cleanWpm(o.wpm) };
  },
  _save(s) { localStorage.setItem(this.KEY, JSON.stringify({ on: s.on === true, wpm: this.cleanWpm(s.wpm) })); },
  enabled() { return this.state().on; },
  setEnabled(on) { const s = this.state(); s.on = !!on; this._save(s); return s.on; },
  setWpm(value) {
    const s = this.state();
    if (value === '' || value == null) s.wpm = 0;
    else {
      s.wpm = this.cleanWpm(value);
      if (!s.wpm) throw new Error('The reading speed is a number from ' + this.MIN_WPM + ' to ' + this.MAX_WPM + ' words a minute');
    }
    this._save(s);
    return this.effectiveWpm(s);
  },
  effectiveWpm(s = this.state()) { return s.wpm || (this.isTurkish() ? this.TURKISH_WPM : this.DEFAULT_WPM); },

  // The <script> for the reader page, or '' while the setting is off (called by ReadingMode.buildHtml). words: the article's word count.
  pageScript(words) {
    const s = this.state();
    if (!s.on) return '';
    const w = Math.round(Number(words));
    if (!(w > 0)) return '';
    const cfg = { words: w, wpm: this.effectiveWpm(s), labels: { left: this._t('about {1} min left'), soon: this._t('less than a minute left'), done: this._t('Finished') } };
    const code = this.pageSource(cfg);
    return `<script>${code}</script>`;
  },
};

if (typeof window !== 'undefined') {
  window.VexReaderTime = VexReaderTime;
  if (typeof VexExtras !== 'undefined' && typeof VexExtras.registerCommand === 'function') {
    VexExtras.registerCommand({ id: 'reader-time-left', label: 'Reader: Show Time Left', hint: 'Turns on or off an "about N min left" line in reader view, worked out from how far you have scrolled', icon: 'clock', action: () => { try { const on = !VexReaderTime.enabled(); VexReaderTime.setEnabled(on); window.showToast?.(VexReaderTime._t(on ? 'Reader view will show the time left' : 'Reader view will not show the time left')); } catch (err) { window.VexProblems?.note('Reader time left', 'the setting could not be changed', err); window.showToast?.(err.message, 'error'); } } });
    VexExtras.registerCommand({ id: 'reader-reading-speed', label: 'Reader: Set Reading Speed', hint: 'Words per minute for the time left in reader view: 200 by default, 180 in Turkish', icon: 'clock', action: async () => { try { const v = await window.vexPrompt({ title: VexReaderTime._t('Reading speed'), message: VexReaderTime._t('Words per minute, from 80 to 600. Leave empty to use the usual speed for your language.'), value: String(VexReaderTime.state().wpm || ''), okLabel: VexReaderTime._t('Save') }); if (v == null) return; const wpm = VexReaderTime.setWpm(String(v).trim()); window.showToast?.(VexReaderTime._t('Reading speed saved: {1} words a minute').replace('{1}', String(wpm))); } catch (err) { window.VexProblems?.note('Reader time left', 'the reading speed could not be saved', err); window.showToast?.(err.message, 'error'); } } });
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReaderTime };
