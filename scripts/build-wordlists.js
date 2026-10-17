// Builds the large "I already know these" word list of the Learner reading aids (T3-034) from texts that are in the
// PUBLIC DOMAIN, so the list can be shipped with Vex without a licence to carry.
//
//   node scripts/build-wordlists.js <folder with pgNNNN.txt files> [--write]
//
// The source is Project Gutenberg plain-text books (the books' texts are in the public domain in the United States;
// only the project's name is restricted, and no text is copied: only counts of words are kept). Which books were
// used is printed, and src/renderer/js/reading-aids-data.js records the ids and THIRD_PARTY_NOTICES.md names the source.
//
// How a word gets in: it is counted in lower case; a capitalised word that is not at the start of a sentence is a
// name and is skipped; it must appear in at least 55 percent of the books (this drops the names and places of one
// novel), and the words are ordered by how often they occur per million words across all of them. Archaic forms
// (thou, hath, ...) are dropped, and a few modern words that no 19th century novel uses (see EXTRA_MODERN) are added at
// the end by hand, written for this list and given away with it. Turkish has no public-domain corpus of everyday
// language that could be found, so Turkish keeps its starter list and gets better word-ending rules instead.
const fs = require('fs');
const path = require('path');

const ARCHAIC = new Set(('thou thee thy thine thyself hath hast doth dost art ye shalt wilt unto whilst yea nay oft ere nigh betwixt amongst wherefore thither hither whither whence hence '
  + 'mr mrs de th re st ah').split(' '));
// Everyday words of the last fifty years that a public-domain novel cannot contain. Written for this list.
const EXTRA_MODERN = 'internet computer phone email online website video photo password app mobile screen click download file text message browser tab search page link program software data network digital camera battery update account email user store shop ticket card bank cash price offer order delivery customer service news media society science technology system project team business office meeting report plan result problem solution question answer example idea information'.split(' ');

function words(text) {
  const start = text.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG/i);
  const end = text.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  const body = text.slice(start >= 0 ? text.indexOf('\n', start) + 1 : 0, end >= 0 ? end : text.length);
  const out = [];
  const re = /[A-Za-z][A-Za-z'’]*[A-Za-z]|[A-Za-z]/g;
  let m;
  while ((m = re.exec(body))) {
    let w = m[0].replace(/’/g, "'");
    if (w.includes("'")) continue;                      // contractions and possessives are handled by the lemma rules
    if (/^[A-Z]/.test(w)) {
      let i = m.index - 1;
      while (i >= 0 && /[\s"“”‘’'_(*\[]/.test(body[i])) i--;
      const prev = i >= 0 ? body[i] : '.';
      if (!/[.!?:]/.test(prev) && w !== 'I') continue;  // a capital in the middle of a sentence is a name
      if (w.length > 1 && w === w.toUpperCase()) continue;  // CHAPTER HEADINGS
    }
    out.push(w.toLowerCase());
  }
  return out;
}

function build(dir) {
  const files = fs.readdirSync(dir).filter(f => /^pg\d+\.txt$/.test(f)).sort();
  if (files.length < 20) throw new Error('Need at least 20 books to tell a name from a word; found ' + files.length);
  const total = new Map(), docs = new Map();
  let all = 0;
  for (const f of files) {
    const ws = words(fs.readFileSync(path.join(dir, f), 'utf8'));
    all += ws.length;
    const seen = new Set();
    for (const w of ws) { total.set(w, (total.get(w) || 0) + 1); seen.add(w); }
    for (const w of seen) docs.set(w, (docs.get(w) || 0) + 1);
  }
  const need = Math.ceil(files.length * 0.55);
  const ranked = [...total.entries()]
    .filter(([w, n]) => (docs.get(w) || 0) >= need && !ARCHAIC.has(w) && (w.length > 1 || w === 'a' || w === 'i') && /^[a-z]+$/.test(w))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([w]) => w);
  return { files, tokens: all, ranked };
}

module.exports = { build, words, EXTRA_MODERN, ARCHAIC };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/build-wordlists.js <folder of pgNNNN.txt> [--write]'); process.exit(2); }
  const r = build(path.resolve(dir));
  const top = r.ranked.slice(0, 3000);
  const extra = [...new Set(EXTRA_MODERN)].filter(w => !top.includes(w));
  const list = [...top, ...extra];
  console.log('books:', r.files.length, 'tokens:', r.tokens, 'words kept:', r.ranked.length, 'shipped:', list.length);
  console.log('first 40:', list.slice(0, 40).join(' '));
  console.log('around 2900:', list.slice(2900, 2940).join(' '));
  if (process.argv.includes('--write')) {
    const out = path.join(__dirname, '..', 'src', 'renderer', 'js', 'reading-aids-lists.js');
    const ids = r.files.map(f => f.replace(/^pg|\.txt$/g, ''));
    const src = '// === Reading aids: the large English common-word list (T3-034) ==================\n//\n'
      + '// GENERATED by scripts/build-wordlists.js; do not edit by hand. ' + list.length + ' words, most common first.\n'
      + '// Source: counts of words in ' + r.files.length + ' public-domain books from Project Gutenberg (ids ' + ids.join(', ') + '),\n'
      + '// kept when the word is in at least 55 percent of them, plus ' + extra.length + ' modern everyday words written for this list.\n'
      + '// Nothing here is a copy of any text: it is a list of single words.\n'
      + 'const VexReadingAidsLists = {\n  VERSION: 1,\n  EN: (' + JSON.stringify(list.join(' ')) + ').split(\' \'),\n};\n\n'
      + 'if (typeof window !== \'undefined\') window.VexReadingAidsLists = VexReadingAidsLists;\n'
      + 'if (typeof module !== \'undefined\' && module.exports) module.exports = { VexReadingAidsLists };\n';
    fs.writeFileSync(out, src);
    console.log('wrote', out, src.length, 'bytes');
  }
}
