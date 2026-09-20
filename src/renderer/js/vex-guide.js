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
  STOP: new Set([
    'how', 'do', 'i', 'can', 'vex', 'the', 'a', 'an', 'to', 'in', 'on', 'of', 'is', 'there', 'any', 'way', 'for',
    'my', 'me', 'it', 'this', 'that', 'with', 'and', 'or', 'does', 'have', 'get', 'want', 'please', 'help',
    'something', 'anything', 'feature', 'able', 'make', 'change', 'see', 'use', 'using', 'set', 'put', 'turn',
    'add', 'new', 'some', 'when', 'what', 'where', 'from', 'at', 'be', 'am', 'are', 'you', 'your', 'one', 'again', 'take', 'open', 'go', 'keep', 'stop', 'work', 'working', 'all',
  ]),

  // "tabs" and "tab" are the same word to a person.
  _stem(w) { return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w; },

  // "how do i …", "can vex …", "is there a way to …" → the words that matter.
  ask(text) {
    return String(text || '').toLowerCase()
      .replace(/^(how (do|can) i|how to|can vex|does vex|is there (a way to|anything (that|to))?|i want to|i need to)\s+/i, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(w => w && !this.STOP.has(w))
      .map(w => this._stem(w));
  },

  // Is this a question about what Vex can do, rather than about a web page?
  isAbout(text) {
    const asked = String(text || '').trim();
    if (/^(how (do|can) i|how to|can vex|does vex|is there|i want to|i need to|where (is|do i)|what can (you|vex))\b/i.test(asked)) return true;
    // "it is using all my RAM", "too many tabs", "stop autoplay": a complaint
    // is a question too, and the templates (js/guide-templates.js) know these
    // by name rather than by the shape of the sentence.
    return typeof GuideTemplates !== 'undefined' && !!GuideTemplates.match(asked);
  },

  _bag(text) {
    return new Set(String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).map(w => this._stem(w)));
  },

  // A word in the feature's NAME or in the words people use for it counts for
  // much more than the same word buried in its description — "stop ads" must
  // land on the ad blocker, not on a page-speed check that mentions adverts.
  STRONG: 3,

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
        const strong = this._bag([entry.name, label, entry.id, entry.phrases].filter(Boolean).join(' '));
        const weak = this._bag(entry.what);
        // Whole words, or the same word with an ending ("block"/"blocking").
        // Not "screen"/"screenshot": a longer word is a different word, so the
        // tail may only be a couple of letters.
        const has = (bag, w) => bag.has(w) || [...bag].some(h => {
          const [short, long] = h.length <= w.length ? [h, w] : [w, h];
          // Only a real ending: "read"/"reading" yes, "list"/"listen" no.
          return short.length >= 4 && long.startsWith(short) && /^(s|es|ed|d|ing|ion|er|ers|ly)$/.test(long.slice(short.length));
        });
        let strongHits = 0, weakHits = 0;
        for (const w of want) { if (has(strong, w)) strongHits++; else if (has(weak, w)) weakHits++; }
        const missed = want.length - strongHits - weakHits;
        // How much of the feature's OWN name the question did not account for:
        // asked "take a screenshot", plain Screenshot beats Screenshot to code.
        const nameBag = this._bag([entry.name, label, entry.id].filter(Boolean).join(' '));
        const spare = [...nameBag].filter(h => !want.some(w => has(new Set([h]), w))).length;
        return { entry, label, strongHits, missed, spare, score: strongHits * this.STRONG + weakHits };
      })
      // Everything they said has to be somewhere in the feature (one word may
      // be missing when the rest is in its own name), and a feature that only
      // mentions their words in passing is not an answer.
      .filter(r => (r.missed === 0 && (r.strongHits > 0 || want.length > 1)) || (r.missed <= 1 && r.strongHits >= 1))
      .sort((a, b) => b.strongHits - a.strongHits || a.missed - b.missed || a.spare - b.spare || b.score - a.score)
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
    // A question people actually ask, answered the way a person would answer
    // it (js/guide-templates.js). Those beat the feature search, which knows
    // what features are called but not what people call their problems.
    if (typeof GuideTemplates !== 'undefined') {
      const ready = GuideTemplates.answer(question);
      if (ready) return ready;
    }
    const hits = this.find(question);
    if (!hits.length) return { found: false, headline: 'Vex has nothing for that yet — nothing in its feature list matches those words.', steps: [], others: [] };
    const [best, ...rest] = hits;
    // A feature that is switched off or hidden cannot be followed to, so the
    // first step is turning it back on.
    let off = null;
    try { off = VexFeatures.offState(best.entry); } catch { off = null; }   // needs a window; never worth failing the answer
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

  // The few features that really take several steps (signing in to sync, a
  // container tab, setting the agent loose) carry their own step list, and
  // that is a walkthrough: highlight, wait, next.
  walk(entry) {
    if (!entry.steps || !entry.steps.length) return this.show(entry);
    return VexTour.run(entry.steps.map(s => ({ sel: s.sel, title: s.title || VexFeatures.nameOf(entry), html: s.html })), { markSeen: false });
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
