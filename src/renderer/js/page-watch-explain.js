// === Page Watcher: "what changed, and does it matter" ========================
//
// The words the LOCAL model is asked for when a watched page changed, and the
// rules around them. Only a local model (Ollama) is ever asked: the lines of
// a page you watch are not sent to any cloud backend, there is no fallback to
// one, and with no local model the plain summary (PageWatchDiff.summarize) is
// all there is. js/page-watch.js (aiSentence) is the caller; the diff itself
// comes from js/page-watch-diff.js.
//
//   requestText(watch, diff)            the request text (pure)
//   clean(out)                     the model's answer as one or two sentences
//   explain(watch, diff, deps)     { generate, model, signal } -> string
//   explainStored(watchId, deps)   the same for the last two kept snapshots
const PageWatchExplain = {
  MAX_LINES: 12,
  MAX_LINE: 200,
  MAX_ANSWER: 320,

  requestText(watch, diff) {
    const lines = (arr, sign) => (arr || []).slice(0, this.MAX_LINES).map(l => sign + ' ' + String(l).slice(0, this.MAX_LINE)).join('\n');
    const what = watch && (watch.title || watch.url) ? String(watch.title || watch.url).slice(0, 120) : 'a web page';
    return 'A web page the user watches ("' + what + '") changed. Lines removed (-) and added (+):\n'
      + lines(diff && diff.removed, '-') + '\n' + lines(diff && diff.added, '+')
      + '\n\nIn one or two short plain sentences: say what changed, then whether it probably matters to someone who is watching this page '
      + '(for example a price, a version, stock or a deadline matters; a rotated advert or a date does not). No preamble, no list.';
  },

  clean(out) {
    return String(out == null ? '' : out).replace(/\s+/g, ' ').trim().slice(0, this.MAX_ANSWER);
  },

  // `generate(model, prompt, opts)` is Ollama.generate. Nothing else is
  // accepted: the caller passes the local one, and there is no other path.
  async explain(watch, diff, { generate, model, signal, timeoutMs = 20000 } = {}) {
    if (typeof generate !== 'function') throw new Error('No local model function was given');
    if (!model) return '';
    if (!diff || (!(diff.added && diff.added.length) && !(diff.removed && diff.removed.length))) return '';
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', stop, { once: true }); }
    const timer = setTimeout(stop, timeoutMs);
    try {
      return this.clean(await generate(model, this.requestText(watch, diff), { temperature: 0.2, maxTokens: 110, signal: ctl.signal }));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  },

  // For a button on a watch that already changed: compares its last two kept
  // snapshots. Returns { sentence, diff } or null when there is nothing to
  // compare. Throws when the local model fails (the caller says so).
  async explainStored(watchId, { generate, model, watches, snaps } = {}) {
    const D = typeof PageWatchDiff !== 'undefined' ? PageWatchDiff : require('./page-watch-diff.js').PageWatchDiff;
    const list = snaps && snaps[watchId];
    if (!Array.isArray(list) || list.length < 2) return null;
    const a = list[list.length - 2], b = list[list.length - 1];
    const diff = D.lineDiff(D.normalizeText(a.text), D.normalizeText(b.text));
    if (!diff.added.length && !diff.removed.length) return null;
    const watch = (watches || []).find(w => w.id === watchId) || { id: watchId };
    const sentence = await this.explain(watch, diff, { generate, model });
    return { sentence, diff };
  },
};

if (typeof window !== 'undefined') window.PageWatchExplain = PageWatchExplain;
if (typeof module !== 'undefined' && module.exports) module.exports = { PageWatchExplain };
