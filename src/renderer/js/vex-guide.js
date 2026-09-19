// === "Can Vex do this?" — asking Vex about Vex ==============================
//
// Vex has well over a hundred features and nobody reads a feature list. The
// question a person actually has is "I want to do X — is there something for
// that?", and the answer has to be short, in their words, and end with the
// thing happening rather than an instruction to go and find it.
//
// Answers come from the real catalogue (js/feature-catalog.js), never from a
// model's memory, so Vex cannot promise a feature it does not have. The AI is
// optional: the words are matched here, instantly, and the local model is only
// asked for the wording when it happens to be on. With no match, it says so.
const VexGuide = {
  // Words that carry no meaning in "how do I …" questions.
  STOP: new Set(['how', 'do', 'i', 'can', 'vex', 'the', 'a', 'an', 'to', 'in', 'on', 'of', 'is', 'there', 'any', 'way', 'for', 'my', 'me', 'it', 'this', 'that', 'with', 'and', 'or', 'does', 'have', 'get', 'want', 'please', 'help', 'something', 'anything', 'feature', 'able']),

  // "how do i …", "can vex …", "is there a way to …" → the words that matter.
  ask(text) {
    return String(text || '').toLowerCase()
      .replace(/^(how (do|can) i|how to|can vex|does vex|is there (a way to|anything (that|to))?|i want to|i need to)\s+/i, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(w => w && !this.STOP.has(w));
  },

  // Is this a question about what Vex can do, rather than about a web page?
  isAbout(text) {
    return /^(how (do|can) i|how to|can vex|does vex|is there|i want to|i need to|where (is|do i))\b/i.test(String(text || '').trim());
  },

  _words(entry, label) {
    return new Set(String([entry.name, label, entry.what, entry.id, (entry.phrases || []).join(' ')].filter(Boolean).join(' '))
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
  },

  // The catalogue reads the live command registry, so a renamed command shows
  // up here rather than quietly disagreeing.
  _label(entry) {
    const c = VexFeatures.command(entry);
    return (c && c.label) || '';
  },

  // The features that fit the question, best first. Every word the person used
  // is looked for; a feature matching more of them wins.
  find(question, limit = 3) {
    const want = this.ask(question);
    if (!want.length) return [];
    const items = (typeof VexFeatures !== 'undefined' ? VexFeatures.ITEMS : []) || [];
    return items
      .map(entry => {
        const label = this._label(entry);
        const have = this._words(entry, label);
        const hits = want.filter(w => have.has(w) || [...have].some(h => w.length >= 4 && h.startsWith(w))).length;
        return { entry, label, score: hits / want.length };
      })
      .filter(r => r.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  // What to do, in order, from what the catalogue knows about this feature.
  steps(entry, label = this._label(entry)) {
    const out = [];
    if (entry.panel) out.push('Open the ' + entry.panel + ' panel from the sidebar on the left.');
    if (entry.setting) out.push('In Settings, turn on “' + (entry.setting.label || entry.name) + '”.');
    if (entry.cmd) out.push('Press Ctrl+K and choose “' + (label || VexFeatures.nameOf(entry)) + '”.');
    const keys = VexFeatures.keysOf(entry);
    if (keys) out.push('The shortcut is ' + keys + '.');
    if (!out.length) out.push(entry.what);
    return out;
  },

  // The whole answer for one question. → { found, entry, headline, steps, others }
  answer(question) {
    const hits = this.find(question);
    if (!hits.length) return { found: false, headline: 'Vex has nothing for that yet — nothing in its feature list matches those words.', steps: [], others: [] };
    const [best, ...rest] = hits;
    // A feature that is switched off or hidden cannot be followed to, so the
    // first step is turning it back on.
    const off = VexFeatures.offState(best.entry);
    const steps = this.steps(best.entry, best.label);
    return {
      found: true,
      entry: best.entry,
      label: best.label,
      headline: VexFeatures.nameOf(best.entry) + ' — ' + best.entry.what,
      off: off ? off.reason : null,
      steps: off ? [off.reason + ' — Vex can switch it back on.', ...steps] : steps,
      others: rest.map(r => VexFeatures.nameOf(r.entry)),
    };
  },

  // Do it, rather than describe it: run the command, open the panel, or point
  // at the real control.
  run(entry) {
    const c = VexFeatures.command(entry);
    if (c) return Promise.resolve(c.action());
    if (entry.panel && typeof SidebarManager !== 'undefined') return Promise.resolve(SidebarManager.openPanel(entry.panel));
    return this.show(entry);
  },

  // Point at the control itself, so the next time they know where it lives.
  show(entry) {
    if (entry.setting && entry.setting.id && typeof SettingsUI !== 'undefined') return SettingsUI.openSection(entry.setting.id);
    if (entry.sel && typeof VexTour !== 'undefined') {
      return VexTour.run([{ sel: entry.sel, title: VexFeatures.nameOf(entry), html: entry.what }], { markSeen: false });
    }
    window.showToast?.('There is nothing to point at for that one — ' + entry.what, 'info', 7000);
    return null;
  },
};

if (typeof window !== 'undefined') window.VexGuide = VexGuide;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexGuide };
