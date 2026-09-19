// === "Turn on streamer mode" — changing a setting by asking ===============
//
// Settings has well over a hundred switches and dropdowns, and finding the one
// you want means knowing which section it lives in. This reads them the way a
// person does — by the words next to them — so "turn off mouse gestures" or
// "set the search engine to DuckDuckGo" (in Ctrl+K, or asked of the agent)
// finds the control, says exactly what will change, and changes it only once
// you say yes. It sets the real control and fires its change event, so the
// code that already saves that setting is the code that saves it now: nothing
// here writes a setting of its own.
const VexSettingsControl = {
  STOP: new Set(['the', 'a', 'an', 'to', 'on', 'off', 'of', 'for', 'my', 'in', 'and', 'please', 'vex', 'setting', 'settings', 'option', 'mode', 'turn', 'switch', 'set', 'enable', 'disable', 'make', 'use', 'it', 'be', 'when', 'with']),

  _words(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !this.STOP.has(w));
  },

  // The words a person reads next to a control.
  labelFor(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    // A wrapping <label class="toggle"> holds only the slider, so it has no words.
    const lab = [...(el.labels || [])].find(l => l.textContent.trim());
    if (lab) return lab.textContent.trim();
    const row = el.closest('.setting-toggle-row');
    if (row) {
      const span = [...row.children].find(c => c.tagName === 'SPAN' && c.textContent.trim());
      if (span) return span.textContent.trim();
    }
    const prev = el.previousElementSibling;
    if (prev && prev.classList.contains('setting-row-label')) return prev.textContent.trim();
    const settingRow = el.closest('.setting-row');
    if (settingRow) {
      const head = settingRow.querySelector('.setting-label strong, .setting-label');
      if (head) {
        const strong = head.matches('strong') ? head : head.querySelector('strong');
        return (strong || head).textContent.trim().split('\n')[0].trim();
      }
    }
    return '';
  },

  // Every switch and dropdown in Settings that has words next to it.
  controls(root = document.getElementById('panel-settings')) {
    if (!root) throw new Error('Settings are not loaded');
    const out = [];
    for (const el of root.querySelectorAll('input[type="checkbox"], select')) {
      if (el.disabled) continue;
      const label = this.labelFor(el);
      if (!label) continue;
      out.push({ el, label, kind: el.tagName === 'SELECT' ? 'choice' : 'toggle' });
    }
    return out;
  },

  // "turn on X", "enable X", "turn X off", "set X to Y", "switch X to Y".
  // Returns { query, want } where want is true, false, or the words of a
  // choice. Null when the text is not asking to change a setting.
  parseRequest(text) {
    const t = String(text || '').trim().replace(/[.!?]+$/, '');
    let m;
    if ((m = /^(?:please\s+)?(?:turn|switch)\s+(on|off)\s+(.+)$/i.exec(t))) return { query: m[2], want: m[1].toLowerCase() === 'on' };
    if ((m = /^(?:please\s+)?(?:turn|switch)\s+(.+?)\s+(on|off)$/i.exec(t))) return { query: m[1], want: m[2].toLowerCase() === 'on' };
    if ((m = /^(?:please\s+)?(enable|disable)\s+(.+)$/i.exec(t))) return { query: m[2], want: m[1].toLowerCase() === 'enable' };
    if ((m = /^(?:please\s+)?(?:set|switch|change|make)\s+(.+?)\s+to\s+(.+)$/i.exec(t))) return { query: m[1], want: m[2] };
    return null;
  },

  // The control these words mean. Throws, naming the candidates, when the
  // words fit none or fit two equally — a guess here changes the wrong thing.
  find(query, { kind } = {}) {
    const want = this._words(query);
    if (!want.length) throw new Error('Say which setting');
    const scored = this.controls()
      .filter(c => !kind || c.kind === kind)
      .map(c => {
        const have = new Set(this._words(c.label));
        const hits = want.filter(w => have.has(w) || [...have].some(h => h.startsWith(w) && w.length >= 4)).length;
        return { c, score: hits / want.length, extra: have.size - hits };
      })
      .filter(x => x.score >= 0.6)
      .sort((a, b) => b.score - a.score || a.extra - b.extra);
    if (!scored.length) throw new Error(`No setting called "${query}" — open Settings and search for it`);
    const [best, next] = scored;
    if (next && next.score === best.score && next.extra === best.extra) {
      throw new Error(`"${query}" could be "${best.c.label}" or "${next.c.label}" — say which`);
    }
    return best.c;
  },

  _optionFor(select, words) {
    const want = this._words(words).join(' ');
    const opts = [...select.options];
    const exact = opts.find(o => o.value.toLowerCase() === String(words).toLowerCase().trim() || this._words(o.textContent).join(' ') === want);
    if (exact) return exact;
    const partial = opts.filter(o => this._words(o.textContent).join(' ').includes(want) || o.value.toLowerCase().includes(want.replace(/ /g, '')));
    if (partial.length === 1) return partial[0];
    throw new Error(`"${words}" is not one of: ${opts.map(o => o.textContent.trim()).join(', ')}`);
  },

  // What would change: { control, from, to, toValue, sentence }, or null
  // when it is already that way.
  plan(req) {
    const control = this.find(req.query, { kind: typeof req.want === 'boolean' ? 'toggle' : 'choice' });
    if (control.kind === 'toggle') {
      if (control.el.checked === req.want) return { control, same: true, sentence: `"${control.label}" is already ${req.want ? 'on' : 'off'}` };
      return { control, from: control.el.checked, toValue: req.want, sentence: `Turn ${req.want ? 'on' : 'off'} "${control.label}"?` };
    }
    const opt = this._optionFor(control.el, req.want);
    const now = control.el.selectedOptions[0];
    if (control.el.value === opt.value) return { control, same: true, sentence: `"${control.label}" is already "${opt.textContent.trim()}"` };
    return { control, from: control.el.value, toValue: opt.value, sentence: `Change "${control.label}" from "${now ? now.textContent.trim() : control.el.value}" to "${opt.textContent.trim()}"?` };
  },

  _set(control, value) {
    if (control.kind === 'toggle') control.el.checked = value;
    else control.el.value = value;
    control.el.dispatchEvent(new Event('input', { bubbles: true }));
    control.el.dispatchEvent(new Event('change', { bubbles: true }));
  },

  // Always asked first. → { changed, label, from, to, message }.
  async apply(text) {
    const req = typeof text === 'string' ? this.parseRequest(text) : text;
    if (!req) throw new Error('Say it as "turn on …", "turn off …" or "set … to …"');
    const p = this.plan(req);
    if (p.same) return { changed: false, label: p.control.label, message: p.sentence };
    const ok = await vexConfirm({ title: 'Change a setting', message: p.sentence, okLabel: 'Change it' });
    if (!ok) return { changed: false, label: p.control.label, message: 'Left as it was' };
    this._set(p.control, p.toValue);
    return { changed: true, label: p.control.label, id: p.control.el.id || null, from: p.from, to: p.toValue, message: p.sentence.replace(/\?$/, '') + ' — done' };
  },

  // Put one back (the agent's Undo). Only by id: a control without one cannot
  // be found again reliably, so it is not offered for undo.
  undo({ id, from }) {
    const el = id && document.getElementById(id);
    if (!el) throw new Error('That setting is no longer there');
    this._set({ el, kind: el.tagName === 'SELECT' ? 'choice' : 'toggle' }, from);
    return true;
  },
};

if (typeof window !== 'undefined') window.VexSettingsControl = VexSettingsControl;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSettingsControl };
