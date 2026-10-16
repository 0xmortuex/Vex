// === Provenance chip on generated output (T3-107) =================================
//
// A summary, a rewrite, a search answer or a drafted line written by a model reads
// as confidently as a fact. Every such output carries a small chip that says what
// made it, so a wrong summary is never mistaken for something Vex knows:
//
//   "Vex AI"  the cloud backend (your own AI worker)
//   "Local AI" a model on this computer (Ollama or on-device), with its name
//   "Rule"    fixed rules, no model at all (a pattern, a count, a sort)
//
// The SOURCE argument is required. A caller that cannot say what made the text
// does not get a chip, it gets an error, so a missing label is a bug someone sees
// and not a silent gap:
//
//   VexProvenance.chip({ kind: 'local', model: 'llama3.2:3b', read: 'the page you were on' })
//   VexProvenance.fromResult(aiResult, { read: 'your saved articles' })   // aiResult = AIRouter.callAI(...)
//   VexProvenance.html(source)   // the same chip as escaped markup, for template strings
//   VexProvenance.label(source)  // the same words as plain text, for a note line
//
// `read` is the data the output was made from, in words. It is the chip's hover text.
const VexProvenance = {
  KINDS: {
    ai: { label: 'Vex AI', how: 'Written by the cloud AI you set up' },
    local: { label: 'Local AI', how: 'Written by a model on this computer' },
    rule: { label: 'Rule', how: 'Worked out by fixed rules, no AI' },
  },

  // 'cloud' answers come from the worker; 'local' and 'ondevice' never leave this computer.
  kindOfBackend(backend) {
    if (backend === 'cloud') return 'ai';
    if (backend === 'local' || backend === 'ondevice') return 'local';
    throw new Error('Do not know what kind of AI "' + backend + '" is');
  },

  // Validates a source and fills in the words.
  describe(source) {
    if (!source || typeof source !== 'object') throw new Error('Generated output needs a source: say what made it (js/provenance-chip.js)');
    const k = this.KINDS[source.kind];
    if (!k) throw new Error('A source is "ai", "local" or "rule", not "' + source.kind + '"');
    const model = source.kind === 'rule' ? '' : String(source.model || '').slice(0, 60);
    const read = String(source.read || '').slice(0, 120);
    const text = k.label + (model ? ' · ' + model : '');
    const title = k.how + (model ? ' (' + model + ')' : '') + (read ? ', from ' + read : '') + '. Check it before you rely on it.';
    return { kind: source.kind, text, title, model, read };
  },

  // From what AIRouter.callAI answered: { result, backend, model }.
  fromResult(res, { read = '' } = {}) {
    if (!res || typeof res !== 'object' || !res.backend) throw new Error('The AI answer does not say which backend wrote it');
    return { kind: this.kindOfBackend(res.backend), model: res.model || '', read };
  },

  label(source) { return this.describe(source).text; },

  _style: 'display:inline-flex;align-items:center;gap:4px;font-size:10.5px;line-height:1;padding:2px 7px;border:1px solid var(--border);border-radius:999px;color:var(--text-muted);background:none;vertical-align:middle;white-space:nowrap',

  chip(source) {
    const d = this.describe(source);
    const el = document.createElement('span');
    el.className = 'vex-prov-chip';
    el.dataset.kind = d.kind;
    el.setAttribute('role', 'note');
    el.title = d.title;
    el.setAttribute('aria-label', d.title);
    el.style.cssText = this._style;
    const icon = document.createElement('span');
    icon.style.cssText = 'display:inline-flex';
    if (typeof VexIcons !== 'undefined') icon.innerHTML = VexIcons.svg(d.kind === 'rule' ? 'list' : (d.kind === 'ai' ? 'sparkles' : 'cpu'), { size: 11 });
    const text = document.createElement('span');
    text.textContent = d.text;
    el.append(icon, text);
    return el;
  },

  html(source) {
    const d = this.describe(source);
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const icon = typeof VexIcons !== 'undefined' ? VexIcons.svg(d.kind === 'rule' ? 'list' : (d.kind === 'ai' ? 'sparkles' : 'cpu'), { size: 11 }) : '';
    return '<span class="vex-prov-chip" data-kind="' + esc(d.kind) + '" role="note" title="' + esc(d.title) + '" aria-label="' + esc(d.title) + '" style="' + esc(this._style) + '">'
      + '<span style="display:inline-flex">' + icon + '</span><span>' + esc(d.text) + '</span></span>';
  },

  // Puts the chip at the start of a container (or the end).
  attach(container, source, { prepend = true } = {}) {
    if (!container) throw new Error('There is nowhere to put the chip');
    container.querySelector(':scope > .vex-prov-chip')?.remove();
    const el = this.chip(source);
    if (prepend) container.prepend(el); else container.append(el);
    return el;
  },
};

if (typeof window !== 'undefined') window.VexProvenance = VexProvenance;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexProvenance };
