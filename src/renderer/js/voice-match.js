// === Voice control: what was said -> which Ctrl+K command ===================================
//
// Pure logic, no window and no microphone: the engine's text goes in, a DECISION comes out. The caller (js/voice-control.js)
// shows it; nothing here runs a command.
//
//   decide(text, commands, deps) -> { action, command, candidates, confidence, risky, reason }
//     action 'run'      one command, heard clearly, nothing risky: shown for a second with Cancel, then run
//     action 'confirm'  the command (or the words) is destructive or outward: NEVER run on one utterance, asks first
//     action 'choose'   not sure: "Did you mean ..." with up to three commands to click, nothing runs
//     action 'none'     nothing close enough: says what was heard
//
// How a phrase is matched. The words are folded (case, diacritics: "Düzenle" = "duzenle"), Turkish endings after an
// apostrophe are cut ("GitHub'u" -> "github"), and filler is dropped in two ways (please / lütfen; and the verbs open / aç / go to).
// Each command has up to four names: its label, the label's other-language twin (the i18n table: "Organize My Tabs" ~
// "Sekmelerimi düzenle"), the words of its id, and the shortcut words the person made (js/command-aliases.js). A spoken word and a
// name word are the same word when they are equal, share a stem of 4 or more letters (Turkish endings through js/turkish-lemma.js,
// English plurals), or are one slip apart (the engine's "sikme" for "sekme"; 5+ letters only). Confidence is how much of the
// NAME was heard, times the square root of the share of the spoken words it explains (a long sentence that only touches a one-word name is a guess). Below SUGGEST nothing is offered; between SUGGEST and ACT the
// person chooses; at ACT or more the command is the one, unless a second command is almost as good (ambiguous -> choose).
//
// Risk is decided on the command's name AND on what was said, so "delete my bookmarks" never runs on a match with "Bookmarks".
const VexVoiceMatch = {
  ACT: 0.85,
  SUGGEST: 0.45,
  MARGIN: 0.1,
  MAX_CHOICES: 3,

  // Words dropped whatever the name is, and verbs dropped only in the second reading of the phrase.
  STOP: new Set(['please', 'pls', 'hey', 'vex', 'can', 'could', 'would', 'you', 'i', 'want', 'need', 'let', 'lets', 'us', 'the', 'a', 'an', 'to', 'my', 'me', 'of', 'for', 'and', 'this', 'that', 'it', 'up', 'page',
    'sayfa', 'sayfayi', 'sayfanin', 'lutfen', 'bana', 'benim', 'bir', 'ya', 'mi', 'mu', 'misin', 'musun', 'ki', 'de', 'da', 've', 'ile', 'bu', 'su', 'bunu', 'sunu']),
  VERBS: new Set(['open', 'go', 'show', 'launch', 'start', 'run', 'take', 'switch', 'bring', 'do', 'make',
    'ac', 'acar', 'git', 'goster', 'baslat', 'calistir', 'getir', 'yap']),

  // Destructive or outward: asks first, always (folded words). Tested on the command's label/id and on the spoken words.
  RISKY: /\b(?:delet\w*|remov\w*|clear\w*|wip\w*|eras\w*|forget\w*|reset\w*|sign ?out|log ?out|logout|quit|exit|uninstall\w*|empty|format|revok\w*|disconnect\w*|unpair\w*|factory|kill|purge\w*|shred\w*|send\w*|share\w*|publish\w*|post|submit\w*|buy\w*|purchas\w*|pay\w*|order\w*|checkout|subscrib\w*|upload\w*|email|mail it|close all|close others|close every\w*|sil|silin\w*|silme\w*|temizle\w*|kaldir\w*|unut\w*|sifirla\w*|cikis|cik|cikar\w*|gonder\w*|paylas\w*|yayinla\w*|satin\w*|ode|odeme\w*|abone\w*|yukle\w*|tumunu kapat|hepsini kapat|digerlerini kapat|diger sekmeleri kapat|tum sekmeleri kapat|kapat tum\w*)\b/,

  _deps(deps) {
    const d = deps || {};
    const VexTr = d.VexTr || globalThis.VexTr || require('./vex-tr.js').VexTr;
    const lemma = d.lemma !== undefined ? d.lemma : (globalThis.VexTrLemma || null);
    const twin = d.twin !== undefined ? d.twin : ((typeof globalThis.VexSmartSearch !== 'undefined' && globalThis.VexSmartSearch.otherLanguage) ? (s) => globalThis.VexSmartSearch.otherLanguage(s) : () => '');
    const aliases = d.aliases || null;      // { word: commandId }
    return { fold: (s) => VexTr.fold(String(s == null ? '' : s)), lemma, twin, aliases };
  },

  // Folded words of a phrase. A Turkish ending after an apostrophe is not part of the word ("GitHub'u").
  words(text, deps) {
    const { fold } = this._deps(deps);
    return fold(String(text || '').replace(/['’`´][^\s]*/g, ' '))
      .replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
  },

  _lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  },

  _stems(tok, deps) {
    const { fold, lemma } = this._deps(deps);
    const out = new Set([tok]);
    if (lemma && typeof lemma.candidates === 'function' && tok.length >= 5) {
      for (const c of lemma.candidates(tok).slice(0, 8)) { const f = fold(c); if (f.length >= 4 && tok.startsWith(f)) out.add(f); }
    }
    if (tok.length >= 5 && tok.endsWith('ies')) out.add(tok.slice(0, -3) + 'y');
    if (tok.length >= 5 && tok.endsWith('es')) out.add(tok.slice(0, -2));
    if (tok.length >= 4 && tok.endsWith('s')) out.add(tok.slice(0, -1));
    return out;
  },

  // 0..1: how much a spoken word is a name word.
  similar(a, b, deps) {
    if (a === b) return 1;
    const sa = this._stems(a, deps), sb = this._stems(b, deps);
    // A shared stem is a real match when it is most of the longer word ("sekme" in "sekmeleri"); a short root inside a long derived
    // word ("yeni" in "yenilikler", a different word) counts for less, so it can never be the clear winner.
    let stem = 0;
    for (const s of sa) if (sb.has(s) && (s.length >= 4 || s === a || s === b) && s.length > stem) stem = s.length;
    if (stem) { const share = stem / Math.max(a.length, b.length); return share >= 0.5 ? 0.95 : (share >= 0.35 ? (stem >= 5 ? 0.9 : 0.8) : 0); }
    const n = Math.min(a.length, b.length);
    if (n >= 5 && this._lev(a, b, 1) <= 1) return 0.85;
    if (n >= 9 && this._lev(a, b, 2) <= 2) return 0.8;
    return 0;
  },

  // How well the spoken words Q (an array) match the name words L (an array): { cov, extras, conf }.
  _score(Q, L, deps) {
    if (!Q.length || !L.length) return { cov: 0, extras: Q.length, conf: 0 };
    const usedQ = new Set();
    let sum = 0;
    for (const l of L) {
      let best = 0, at = -1;
      Q.forEach((q, i) => { if (usedQ.has(i)) return; const s = this.similar(q, l, deps); if (s > best) { best = s; at = i; } });
      if (at >= 0) { usedQ.add(at); sum += best; }
    }
    const cov = sum / L.length;
    const extras = Q.length - usedQ.size;
    return { cov, extras, conf: cov * Math.sqrt(usedQ.size / Q.length) };
  },

  // The names a command answers to, as word lists.
  _names(c, deps) {
    const d = this._deps(deps);
    const keep = (arr) => arr.filter(w => !this.STOP.has(w));
    const names = [];
    const label = String(c.label || '');
    names.push(this.words(label, deps));
    const tw = d.twin(label);
    if (tw) names.push(this.words(tw, deps));
    names.push(this.words(String(c.id || '').replace(/[-_:.]+/g, ' '), deps));
    if (d.aliases) for (const [w, id] of Object.entries(d.aliases)) if (id === c.id) names.push(this.words(w, deps));
    return names.map(keep).filter(n => n.length);
  },

  // Every command with its confidence, best first.
  rank(text, commands, deps) {
    const all = this.words(text, deps);
    const q1 = all.filter(w => !this.STOP.has(w));
    const q2 = q1.filter(w => !this.VERBS.has(w));
    const readings = [q1, q2].filter(q => q.length);
    const out = [];
    for (const c of commands || []) {
      if (!c || !c.id || !c.label) continue;
      let best = 0;
      for (const L of this._names(c, deps)) {
        for (const Q of readings) {
          const s = this._score(Q, L, deps);
          // 
          if (s.conf > best) best = s.conf;
        }
      }
      if (best > 0) out.push({ command: c, confidence: Math.round(best * 1000) / 1000 });
    }
    return out.sort((a, b) => b.confidence - a.confidence || String(a.command.label).length - String(b.command.label).length);
  },

  // Destructive or outward: by the command (label/id) or by what was said.
  isRisky(command, text, deps) {
    const { fold } = this._deps(deps);
    const spoken = fold(String(text || '').replace(/['’][^\s]*/g, ' ')).replace(/[^a-z0-9\s]+/g, ' ');
    const named = fold(String((command && command.label) || '') + ' ' + String((command && command.id) || '').replace(/[-_:.]+/g, ' ')).replace(/[^a-z0-9\s]+/g, ' ');
    if (command && command.voiceRisk === true) return true;
    return this.RISKY.test(named) || this.RISKY.test(spoken);
  },

  decide(text, commands, deps) {
    const heard = String(text || '').replace(/\s+/g, ' ').trim();
    if (!heard) return { action: 'none', command: null, candidates: [], confidence: 0, risky: false, reason: 'nothing was heard' };
    const ranked = this.rank(heard, commands, deps);
    const candidates = ranked.filter(r => r.confidence >= this.SUGGEST).slice(0, this.MAX_CHOICES);
    if (!candidates.length) return { action: 'none', command: null, candidates: [], confidence: ranked.length ? ranked[0].confidence : 0, risky: false, reason: 'no command is close to what was heard' };
    const top = candidates[0];
    const second = candidates[1];
    const risky = this.isRisky(top.command, '', deps);
    const clear = top.confidence >= this.ACT && !(second && second.confidence >= this.ACT && top.confidence - second.confidence < this.MARGIN);
    // "delete my bookmarks" matched "Bookmarks": the words ask for a change the command does not make. Never acted on, only offered.
    if (!risky && this.isRisky(null, heard, deps)) return { action: 'choose', command: null, candidates, confidence: top.confidence, risky: true, reason: 'what was said asks to delete, send or leave something; pick the command yourself' };
    if (!clear) return { action: 'choose', command: null, candidates, confidence: top.confidence, risky: false, reason: top.confidence >= this.ACT ? 'two commands fit about equally' : 'not sure enough to act' };
    return { action: risky ? 'confirm' : 'run', command: top.command, candidates, confidence: top.confidence, risky, reason: risky ? 'this command deletes, sends or leaves, so it always asks' : 'heard clearly' };
  },

  // The answer to "Run it?": 'yes', 'no', or null when it was neither (then nothing happens).
  interpretAnswer(text, deps) {
    const w = this.words(text, deps);
    const joined = ' ' + w.join(' ') + ' ';
    if (/ (no|nope|cancel|stop|dont|hayir|iptal|vazgec|dur|olmaz) /.test(joined)) return 'no';
    if (/ (yes|yeah|yep|confirm|ok|okay|sure|evet|tamam|onay|onayla|olur) /.test(joined) || / do it /.test(joined)) return 'yes';
    return null;
  },
};

if (typeof window !== 'undefined') window.VexVoiceMatch = VexVoiceMatch;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexVoiceMatch };
