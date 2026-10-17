// === Plurals that are right in English and in Turkish (T3-053) ===============================
//
// English adds an ending when the count is not one: "1 tab", "2 tabs". Turkish does NOT make
// the noun plural after a number: "1 sekme", "2 sekme", "3 sekme" (never "sekmeler"). Writing the
// ending by hand at each place (`n === 1 ? '' : 's'`, 341 times) gave every string the English rule,
// so a string that gets a Turkish translation would carry the wrong ending with it.
//
//   VexPlural.s(n)                  '' for one, 's' otherwise     "tab" + VexPlural.s(n)
//   VexPlural.es(n)                 '' for one, 'es' otherwise    "match" + VexPlural.es(n)
//   VexPlural.en(n, one, many)      the English word for a count   VexPlural.en(n, 'person', 'people')
//   VexPlural.tr(n, noun)           the Turkish noun: always as written, whatever the count
//   VexPlural.count(n, forms)       "3 tabs" or "3 sekme" by the language of the interface:
//                                   VexPlural.count(n, { en: ['tab', 'tabs'], tr: 'sekme' })
//
// Every one of them is a pure function of the count (the language is read once per call from the
// interface language the app already keeps). s, es and en keep the old rule exactly (anything that
// is not 1 is plural), so a call site moved onto them answers as before; count() writes the number
// into the text, so a count that is not a finite number is an error there, not "NaN tabs".
const VexPlural = {
  _check(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('VexPlural needs a count, not ' + String(n));
    return n;
  },
  s(n) { return n === 1 ? '' : 's'; },
  es(n) { return n === 1 ? '' : 'es'; },
  en(n, one, many) {
    const o = String(one);
    return n === 1 ? o : (many == null ? o + 's' : String(many));
  },
  tr(n, noun) { return String(noun); },

  // 'en' or 'tr', from the interface language (VexI18n.locale), else English.
  language() {
    try {
      return typeof VexI18n !== 'undefined' && VexI18n.locale() === 'tr' ? 'tr' : 'en';
    } catch (err) {
      console.error('[VexPlural] could not read the interface language:', err);
      return 'en';
    }
  },
  // forms: { en: [one, many] | one, tr: noun }. The number is written in front of the word.
  count(n, forms, lang) {
    this._check(n);
    if (!forms || typeof forms !== 'object') throw new Error('VexPlural.count needs { en, tr } forms');
    const l = lang || this.language();
    // A language with no form of its own falls back to the English words, with the English rule.
    const used = forms[l] != null ? l : 'en';
    const f = forms[used];
    if (f == null) throw new Error('VexPlural.count has no form for the language ' + l);
    if (used === 'tr') return n + ' ' + this.tr(n, Array.isArray(f) ? f[0] : f);
    return n + ' ' + (Array.isArray(f) ? this.en(n, f[0], f[1]) : this.en(n, f));
  },
};

if (typeof window !== 'undefined') window.VexPlural = VexPlural;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPlural };
