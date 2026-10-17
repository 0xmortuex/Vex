// === Turkish word endings, by rule (T3-034) ==========================================
//
// Turkish builds a word by adding endings one after another: ev (house), ev-ler (houses), ev-ler-im (my
// houses), ev-ler-im-den (from my houses). Looking such a word up in a dictionary means taking the endings
// off again. This does that by rule, and only where the rule of vowel harmony and of d/t allows it, so it
// does not strip "-lar" off a front-vowel word or "-da" off a stem that ends in a hard consonant.
//
//   VexTrLemma.candidates(word)   the forms the word may come from, most likely first (the word itself
//                                 first): stems with endings removed, the soft consonant put back
//                                 (kitab-ı -> kitap, gid-eceğim -> git), a dropped vowel put back
//                                 (burn-u -> burun), and the -mak / -mek form of a verb stem by harmony
//                                 (oku-yor-um -> okumak).
//
// It makes candidates, not decisions: the caller looks each one up in a word list and takes the first that is
// there, so a wrong candidate that is not a word costs nothing. It is approximate by design (irregular
// stems such as "demek/diyor" and compound verbs are left to the lists), and it says so wherever it is shown.
const VexTrLemma = {
  BACK: 'aıou',
  FRONT: 'eiöü',
  VOICELESS: 'çfhkpsşt',
  MAX_DEPTH: 4,
  MAX_CANDIDATES: 60,

  // Endings, from the end of the word inward in the order Turkish stacks them (person, tense, negation, voice, case,
  // possessive, plural, then the common word-makers). The first vowel of an ending is checked against the stem's last vowel.
  SUFFIXES: [
    // person endings and the copula
    'sınız', 'siniz', 'sunuz', 'sünüz', 'ınız', 'iniz', 'unuz', 'ünüz', 'yız', 'yiz', 'yuz', 'yüz', 'dır', 'dir', 'dur', 'dür', 'tır', 'tir', 'tur', 'tür',
    'sın', 'sin', 'sun', 'sün', 'ız', 'iz', 'uz', 'üz', 'lar', 'ler', 'ım', 'im', 'um', 'üm', 'k', 'm', 'n',
    // tense and mood
    'yor', 'acak', 'ecek', 'acağ', 'eceğ', 'mış', 'miş', 'muş', 'müş', 'dı', 'di', 'du', 'dü', 'tı', 'ti', 'tu', 'tü', 'malı', 'meli', 'ar', 'er', 'ır', 'ir', 'ur', 'ür', 'sa', 'se', 'ya', 'ye',
    'dığ', 'diğ', 'duğ', 'düğ', 'tığ', 'tiğ', 'tuğ', 'tüğ', 'dık', 'dik', 'duk', 'dük', 'tık', 'tik', 'tuk', 'tük', 'ken', 'arak', 'erek', 'ıp', 'ip', 'up', 'üp', 'ınca', 'ince', 'unca', 'ünce',
    // negation and voice
    'maz', 'mez', 'ma', 'me', 'ıl', 'il', 'ul', 'ül', 'ın', 'in', 'un', 'ün', 'ış', 'iş', 'uş', 'üş', 'dır', 'dir', 'tır', 'tir', 'ıt', 'it', 'ut', 'üt', 'abil', 'ebil',
    // case, possessive, plural
    'ndan', 'nden', 'nda', 'nde', 'nın', 'nin', 'nun', 'nün', 'yla', 'yle', 'dan', 'den', 'tan', 'ten', 'da', 'de', 'ta', 'te', 'ya', 'ye', 'na', 'ne', 'ı', 'i', 'u', 'ü', 'yı', 'yi', 'yu', 'yü', 'nı', 'ni', 'nu', 'nü',
    'sı', 'si', 'su', 'sü', 'ımız', 'imiz', 'umuz', 'ümüz', 'ları', 'leri', 'la', 'le', 'a', 'e', 'ki',
    // word-makers
    'lık', 'lik', 'luk', 'lük', 'cı', 'ci', 'cu', 'cü', 'çı', 'çi', 'çu', 'çü', 'sız', 'siz', 'suz', 'süz', 'lı', 'li', 'lu', 'lü', 'laş', 'leş', 'cık', 'cik', 'ca', 'ce', 'ça', 'çe',
  ],

  lastVowel(s) {
    for (let i = s.length - 1; i >= 0; i--) if ('aıoueiöü'.includes(s[i])) return s[i];
    return '';
  },
  _isVowel(c) { return 'aıoueiöü'.includes(c); },

  // Does this ending fit after this stem? Vowel harmony (two-fold a/e, four-fold ı/i/u/ü) and d/t after voiceless consonants.
  fits(stem, suffix) {
    if (stem.length < 2) return false;
    const last = stem[stem.length - 1];
    const first = suffix[0];
    // d/t: -da after a vowel or a voiced consonant, -ta after a voiceless one
    if (first === 'd' && this.VOICELESS.includes(last)) return false;
    if (first === 't' && !this.VOICELESS.includes(last)) return false;
    // a buffer y or n between two vowels
    if (first === 'y' && !this._isVowel(last)) return false;
    if (first === 'n' && suffix.length > 1 && 'aeıiuü'.includes(suffix[1]) && !this._isVowel(last)) return false;
    // a suffix that starts with a vowel needs a stem that ends in a consonant, except after the buffer-less case endings -a -e -ı ...
    const v = suffix.split('').find(c => this._isVowel(c));
    if (!v) return true;
    if (suffix === 'yor' || suffix === 'ken' || suffix === 'ki') return true;
    const L = this.lastVowel(stem);
    if (!L) return false;
    if (v === 'a') return this.BACK.includes(L);
    if (v === 'e') return this.FRONT.includes(L);
    const want = { a: 'ı', 'ı': 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[L];
    return v === want;
  },

  _soften(stem) {
    // a stem that ends in a soft consonant lost its hard one before a vowel ending: kitab -> kitap, çocuğ -> çocuk, gid -> git
    const hard = { b: 'p', c: 'ç', d: 't', 'ğ': 'k' }[stem[stem.length - 1]];
    return hard ? stem.slice(0, -1) + hard : '';
  },
  _restoreVowel(stem) {
    // burn -> burun, ağz -> ağız, oğl -> oğul: a vowel dropped before a vowel ending comes back, by harmony
    if (stem.length < 3 || this._isVowel(stem[stem.length - 1]) || this._isVowel(stem[stem.length - 2])) return '';
    const L = this.lastVowel(stem.slice(0, -1));
    const v = { a: 'ı', 'ı': 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[L];
    return v ? stem.slice(0, -1) + v + stem[stem.length - 1] : '';
  },
  _infinitive(stem) {
    const L = this.lastVowel(stem);
    if (!L || stem.length < 2) return '';
    return stem + (this.BACK.includes(L) ? 'mak' : 'mek');
  },

  candidates(word) {
    const w = String(word == null ? '' : word).normalize('NFC').toLocaleLowerCase('tr').replace(/[’']/g, '');
    if (!w) return [];
    const out = [w];
    const seen = new Set([w]);
    const push = (x) => { if (x && x.length >= 2 && !seen.has(x)) { seen.add(x); out.push(x); } };
    let frontier = [w];
    // longer endings first, so "-lerinden" comes off as -nden, -leri, not as -n, -i, -r ...
    const suffixes = [...new Set(this.SUFFIXES)].sort((a, b) => b.length - a.length);
    for (let depth = 0; depth < this.MAX_DEPTH && out.length < this.MAX_CANDIDATES; depth++) {
      const next = [];
      for (const f of frontier) {
        for (const s of suffixes) {
          if (f.length - s.length < 2 || !f.endsWith(s)) continue;
          const stem = f.slice(0, -s.length);
          if (!this.fits(stem, s) || seen.has(stem)) continue;
          if (!this.lastVowel(stem)) continue;
          push(stem); next.push(stem);
          const soft = this._soften(stem); if (soft) push(soft);
          const vowel = this._restoreVowel(stem); if (vowel) push(vowel);
          // before -yor a verb stem that ends in a/e narrows (yaşa-yor -> yaşıyor, ye-yor -> yiyor): put the wide vowel back
          if (s === 'yor') { const wide = { 'ı': 'a', i: 'e', u: 'a', 'ü': 'e' }[stem[stem.length - 1]]; if (wide) push(stem.slice(0, -1) + wide); }
        }
      }
      frontier = next.slice(0, 40);
      if (!frontier.length) break;
    }
    // a verb stem is looked up by its infinitive
    for (const stem of out.slice(0, 24)) { const inf = this._infinitive(stem); if (inf) push(inf); }
    return out.slice(0, this.MAX_CANDIDATES);
  },
};

if (typeof window !== 'undefined') window.VexTrLemma = VexTrLemma;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexTrLemma };
