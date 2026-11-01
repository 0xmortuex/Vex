#!/usr/bin/env node
'use strict';
// Finds English text a Turkish user would still see, without starting Vex.
//
//   node scripts/scan-turkish-leftovers.js                list the files with the most leftovers
//   node scripts/scan-turkish-leftovers.js --file brief   list every leftover string of files matching "brief"
//   node scripts/scan-turkish-leftovers.js --write-baseline   record today's counts (tests/renderer/turkishLeftoversBaseline.json)
//
// What it reads: the user-visible string literals of src/renderer/js/*.js and the text of index.html: the right-hand side of
// .textContent / .title / .placeholder / .innerText, setAttribute('title' | 'aria-label' | 'placeholder', ...), the first argument of
// showToast / vexConfirm / vexPrompt, the title / label / text / hint / message / desc props of an object, and the words between
// tags in any markup string. A string counts as a leftover when it reads as English (see looksEnglish) and VexI18nUI.lookup(text, 'tr')
// finds nothing (no entry, no template, no rule).
//
// What it cannot see: a text put together from pieces at run time (that is what the live scan is for: scripts/turkish-scan/,
// which starts Vex on a throwaway profile in Turkish, opens the surfaces over the debugging port and reads every visible text node),
// and the main process (see scanMain below, a coarser list of dialog / notification strings).
//
// tests/renderer/turkishLeftoversStatic.test.js holds the counts per file against the baseline: they may go down, never up.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const BASELINE = path.join(ROOT, 'tests', 'renderer', 'turkishLeftoversBaseline.json');

// Words that make a short UI text read as English. Brand names, keys, units, file names and code are never counted.
const STOP = new Set(('the your and to for is of with an in on you are this that or not can will be from by at it as all ' +
  'if when what how why which who has have had was were does did no yes any more most less use used using ' +
  'open close save cancel delete remove add edit show hide search find choose select enable disable turn off ' +
  'settings help back next skip done start stop run set get see view make create copy paste undo redo reset clear ' +
  'name title list item items click press drag drop here there them they their its our we us me my ' +
  'only also just but so than then into out up down over under about after before while between each every per without within ' +
  'now today tomorrow yesterday never always file folder page tabs window site sites link links image images text word words ' +
  'error failed failure please try loading loaded unavailable available enabled disabled ' +
  'download downloads upload history bookmark bookmarks password passwords account sign login logout ' +
  'allow block blocked allowed ask deny update updates version install installed free private public default custom automatic ' +
  'one two three first last other another some many few keep keeps kept move send sent ' +
  'minutes minute hours hour seconds second days day week weeks month dialog panel menu button toolbar sidebar learn tip tips note notes').split(/\s+/));
const AMBIG = new Set('a on all as at it no ok in do new open page tab tabs size mode theme time day second minute hour set get see use used show hide start stop name list copy move keep kept one two three other some per via text file link links site sites image video panel menu button'.split(' '));
const NEUTRAL = new Set('vex ok url http https www api ai css html js json pdf zip gb mb kb ms px ctrl alt shift tab enter esc vpn dns tor ip tls ssl wifi usb gpu cpu ram ssd'.split(' '));
const TR_HINT = /[çğıöşüÇĞİÖŞÜ]|\b(ve|bir|için|ile|bu|şu|olarak|daha|veya|değil|yok|var|çok|kadar|gibi|ama|her|tüm|hiç)\b/;

function looksEnglish(raw) {
  const t = String(raw).replace(/\s+/g, ' ').trim();
  if (t.length < 4) return false;
  if (/^(https?:|vex:|file:|www\.|\/|\.|#|data:)/i.test(t) || /^[\w.-]+\.(com|org|net|io|js|json|exe|md|html|txt|png|zip)\b/i.test(t)) return false;
  if (/^[^A-Za-z]*$/.test(t)) return false;
  if (/[{}=;]|=>|\(\)|\bfunction\b|\breturn\b|\bconst\b/.test(t)) return false;   // code, not words
  if (/^[A-Za-z0-9_.-]+$/.test(t)) return false;                                   // one token: an id or a class
  const words = t.match(/[A-Za-z][A-Za-z'’]*/g) || [];
  if (words.length < 2) return false;
  const lw = words.map(w => w.toLowerCase().replace(/['’]s$/, ''));
  if (!lw.some(w => !NEUTRAL.has(w))) return false;
  const hasTr = TR_HINT.test(t);
  const hits = lw.filter(w => STOP.has(w)).length;
  const strong = lw.filter(w => STOP.has(w) && !AMBIG.has(w)).length;
  return hasTr ? strong >= 2 : hits >= 1;
}

const LIT = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\\n])*)\1`;
const PATTERNS = [
  new RegExp(String.raw`\.(?:textContent|innerText|title|placeholder|ariaLabel)\s*=\s*` + LIT, 'g'),
  new RegExp(String.raw`setAttribute\(\s*['"](?:title|aria-label|placeholder|alt)['"]\s*,\s*` + LIT, 'g'),
  new RegExp(String.raw`\b(?:showToast|toast|vexConfirm|vexPrompt|notify)\(\s*` + LIT, 'g'),
  new RegExp(String.raw`\b(?:title|label|text|hint|message|desc|description|placeholder|tip|sub|empty)\s*:\s*` + LIT, 'g'),
];

function unescapeLiteral(s) {
  return s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, ' ').replace(/\\u2019/g, '’').replace(/\\u2014/g, '—').replace(/\\u2026/g, '…');
}

// The texts a string holds: itself, or the words between its tags.
function textsOf(lit) {
  const s = unescapeLiteral(lit);
  if (s.includes('${')) return [];
  if (!/[<>]/.test(s)) return [s];
  return [...s.matchAll(/>([^<>]{4,})</g)].map(m => m[1]);
}

function extract(src) {
  const found = new Set();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) for (const t of textsOf(m[2])) found.add(t.replace(/\s+/g, ' ').trim());
  }
  // markup strings: any quoted literal with a tag in it
  for (const m of src.matchAll(/(['"\x60])((?:\\.|(?!\1)[^\\\n])*<[a-z][^\\\n]*>(?:\\.|(?!\1)[^\\\n])*)\1/g)) for (const t of textsOf(m[2])) found.add(t.replace(/\s+/g, ' ').trim());
  return [...found];
}

function loadLookup() {
  // i18n-ui.js assigns to window / document only inside `typeof window !== 'undefined'`, so it can be required in plain Node.
  const { VexI18nUI } = require(path.join(JS, 'i18n-ui.js'));
  return (text) => VexI18nUI.lookup(text, 'tr');
}

function scanStatic({ filter } = {}) {
  const lookup = loadLookup();
  const byFile = {};
  const files = fs.readdirSync(JS).filter(n => n.endsWith('.js') && n !== 'i18n-ui.js' && !/(^|-)tr\.js$|^i18n\.js$|^faq-data\.js$/.test(n));
  if (!filter) files.push('../index.html');
  for (const f of files) {
    if (filter && !f.includes(filter)) continue;
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    const left = extract(src).filter(t => looksEnglish(t) && lookup(t) == null);
    if (left.length) byFile[f.replace('../', '')] = left.sort();
  }
  return byFile;
}

// Strings the main process shows a person directly (native dialogs, notifications, tray and menu labels, error pages).
// A coarse list: the literal that follows dialog.showMessageBox / showErrorBox / new Notification / label: in src/main*.js.
function scanMain() {
  const out = {};
  const mainFiles = [path.join(ROOT, 'src', 'main.js')].concat(fs.readdirSync(path.join(ROOT, 'src', 'main')).filter(n => n.endsWith('.js')).map(n => path.join(ROOT, 'src', 'main', n)));
  for (const f of mainFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const hits = new Set();
    for (const m of src.matchAll(/(?:showErrorBox\(\s*|\b(?:title|message|detail|body|label|buttons?)\s*:\s*\[?\s*)(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
      const t = unescapeLiteral(m[2]);
      if (!t.includes('${') && looksEnglish(t)) hits.add(t);
    }
    if (hits.size) out[path.relative(ROOT, f).replace(/\\/g, '/')] = [...hits].sort();
  }
  return out;
}

function counts(byFile) {
  const c = {};
  for (const [f, list] of Object.entries(byFile)) c[f] = list.length;
  return c;
}

module.exports = { looksEnglish, scanStatic, scanMain, counts, BASELINE };

if (require.main === module) {
  const args = process.argv.slice(2);
  const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
  const byFile = scanStatic({ filter: fileArg });
  const c = counts(byFile);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  if (args.includes('--write-baseline')) {
    const sorted = Object.fromEntries(Object.entries(c).sort((a, b) => a[0].localeCompare(b[0])));
    fs.writeFileSync(BASELINE, JSON.stringify({ note: 'English-looking user-visible literals with no Turkish entry, per file (scripts/scan-turkish-leftovers.js). May only shrink.', total, files: sorted }, null, 1) + '\n');
    console.log('baseline written:', total, 'strings in', Object.keys(c).length, 'files');
    process.exit(0);
  }
  if (fileArg) {
    for (const [f, list] of Object.entries(byFile)) { console.log('\n' + f + ' (' + list.length + ')'); for (const t of list) console.log('  ' + t); }
  } else {
    for (const [f, n] of Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String(n).padStart(5), f);
  }
  console.log('\nTOTAL', total, 'English-looking strings with no Turkish entry in', Object.keys(c).length, 'files');
  if (args.includes('--main')) {
    const m = scanMain();
    console.log('\nMain process (coarse):');
    for (const [f, list] of Object.entries(m)) { console.log(f + ' (' + list.length + ')'); for (const t of list.slice(0, 8)) console.log('  ' + t); }
  }
}
