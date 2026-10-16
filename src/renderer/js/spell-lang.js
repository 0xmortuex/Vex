// === English / Turkish spelling, one click away (T3-040) ========================
//
// The spell checker followed the system language (and English). Someone who
// writes in both English and Turkish had one of them red-underlined all the time,
// and no way to say a word was right. Now, in the right-click menu of anything you
// can type in:
//
//   Spelling language  >  Automatic · English · Turkish · English and Turkish
//   Add to dictionary     (on a word that is underlined)
//
// "Automatic" is exactly what Vex did before. The choice is kept on this device
// (vex.spellLang) and handed to the main process, which sets it on every session
// (main.js spellLanguagesFor). The first time Turkish is switched on, Chromium
// fetches its dictionary itself; until it has, Turkish words may still be
// underlined. "Add to dictionary" keeps the word in this profile's own list; in a
// private window it is kept in memory for that window only.
const VexSpellLang = {
  CHOICE_KEY: 'vex.spellLang',          // 'auto' | 'en' | 'tr' | 'both'
  KEY: 'vex.spellLang.menu',            // '0' = off: the menu rows go and the checker is back to Automatic
  CHOICES: [['auto', 'Automatic'], ['en', 'English'], ['tr', 'Turkish'], ['both', 'English and Turkish']],

  enabled() { return localStorage.getItem(this.KEY) !== '0'; },

  choice() {
    const c = localStorage.getItem(this.CHOICE_KEY);
    return this.CHOICES.some(x => x[0] === c) ? c : 'auto';
  },

  _api() {
    const api = window.vexSpellcheck;
    if (!api || typeof api.setLanguages !== 'function') throw new Error('The spell checker cannot be reached from here');
    return api;
  },

  // Tell main which languages to use (not what is stored).
  _apply(choice) { return this._api().setLanguages(choice); },

  setEnabled(on) {
    localStorage.setItem(this.KEY, on ? '1' : '0');
    // Off puts the checker back to what it did before this existed; on puts the saved choice back.
    return this._apply(on ? this.choice() : 'auto').catch(err => {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Spelling', 'Could not switch the spelling languages', err);
      else console.error('[Spelling] could not switch the spelling languages:', err);
    });
  },

  async setChoice(choice) {
    if (!this.CHOICES.some(x => x[0] === choice)) throw new Error('Unknown spelling language: ' + choice);
    const r = await this._apply(choice);       // main refuses (and says why) before anything is kept
    localStorage.setItem(this.CHOICE_KEY, choice);
    return r;
  },

  async addWord(webview, word) {
    const id = webview.getWebContentsId();
    const r = await this._api().addWord(id, word);
    if (!r || !r.ok) throw new Error('"' + word + '" could not be added');
    return r;
  },

  // Rows for a page's right-click menu. → { word: [...] above the suggestions' separator, lang: [...] for editable fields }
  menuRows(webview, params) {
    const rows = { word: [], lang: [] };
    if (!this.enabled() || !params) return rows;
    const fail = (err) => window.showToast?.((err && err.message) || String(err), 'error');
    if (params.misspelledWord) {
      const word = String(params.misspelledWord);
      rows.word.push({ label: 'Add "' + (word.length > 24 ? word.slice(0, 24) + '…' : word) + '" to the dictionary', action: () => { this.addWord(webview, word).then(() => window.showToast?.('Added to the dictionary')).catch(fail); } });
    }
    if (params.isEditable) {
      const now = this.choice();
      rows.lang.push({
        label: 'Spelling language',
        sub: this.CHOICES.map(([id, label]) => ({
          label, kind: 'radio', checked: id === now,
          action: () => { this.setChoice(id).then(() => window.showToast?.('Spelling: ' + label)).catch(fail); },
        })),
      });
    }
    return rows;
  },

  // At start: a saved choice other than Automatic is handed to main (Automatic is what main starts with).
  init() {
    if (this._inited) return false;
    this._inited = true;
    if (!this.enabled() || this.choice() === 'auto') return true;
    this._apply(this.choice()).catch(err => {
      if (typeof VexProblems !== 'undefined') VexProblems.note('Spelling', 'Could not put the saved spelling languages back', err);
      else console.error('[Spelling] could not put the saved spelling languages back:', err);
    });
    return true;
  },
};

if (typeof window !== 'undefined') window.VexSpellLang = VexSpellLang;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSpellLang };
