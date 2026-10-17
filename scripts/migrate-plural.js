// Moves the hand-written English plural endings in src/renderer/js onto VexPlural (T3-053).
//
//   node scripts/migrate-plural.js            report what it would change and what it leaves
//   node scripts/migrate-plural.js --write    rewrite the files
//
// It rewrites only the three spellings that mean exactly "an 's' (or 'es') unless the count is 1":
//   (n === 1 ? '' : 's')    (n !== 1 ? 's' : '')    ${n === 1 ? '' : 's'}    and the 'es' forms of the same
// where n is a plain name, member chain, index or no-argument call (items.length, st.count, list()). Anything else (an
// expression with an operator, a different rule such as `> 1`) is listed and left for a person to look at.
// It never touches a file that runs where vex-plural.js is not loaded: the pages other than index.html (start.html,
// popup-chrome.html ...) and the files the main process requires.
//
// It is safe to run again, and after a merge: a conflict in a plural line is solved by taking either side and running
// it with --write. Exported for the ratchet test (tests/renderer/pluralRatchet.test.js).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const EXPR = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\[[\\w$.]+\\]|\\(\\))*';
const RULES = [
  { re: new RegExp("(?<![\\w$.])\\(\\s*(" + EXPR + ")\\s*===\\s*1\\s*\\?\\s*''\\s*:\\s*'s'\\s*\\)", 'g'), to: (m, e) => 'VexPlural.s(' + e + ')' },
  { re: new RegExp("(?<![\\w$.])\\(\\s*(" + EXPR + ")\\s*!==\\s*1\\s*\\?\\s*'s'\\s*:\\s*''\\s*\\)", 'g'), to: (m, e) => 'VexPlural.s(' + e + ')' },
  { re: new RegExp("(?<![\\w$.])\\(\\s*(" + EXPR + ")\\s*===\\s*1\\s*\\?\\s*''\\s*:\\s*'es'\\s*\\)", 'g'), to: (m, e) => 'VexPlural.es(' + e + ')' },
  { re: new RegExp("\\$\\{\\s*(" + EXPR + ")\\s*===\\s*1\\s*\\?\\s*''\\s*:\\s*'s'\\s*\\}", 'g'), to: (m, e) => '${VexPlural.s(' + e + ')}' },
  { re: new RegExp("\\$\\{\\s*(" + EXPR + ")\\s*!==\\s*1\\s*\\?\\s*'s'\\s*:\\s*''\\s*\\}", 'g'), to: (m, e) => '${VexPlural.s(' + e + ')}' },
  { re: new RegExp("\\$\\{\\s*(" + EXPR + ")\\s*===\\s*1\\s*\\?\\s*''\\s*:\\s*'es'\\s*\\}", 'g'), to: (m, e) => '${VexPlural.es(' + e + ')}' },
];
// What is left after the rules: any spelling of the same rule that did not match them.
const LEFTOVER = /===\s*1\s*\?\s*''\s*:\s*'e?s'|!==\s*1\s*\?\s*'e?s'\s*:\s*''/g;

// The files that must keep working without vex-plural.js.
function excluded() {
  // The toolbox packs are loaded on their own by a child process in the tests (and are plain data-and-function files), so they keep their own endings.
  const out = new Set(['vex-plural.js', ...fs.readdirSync(JS).filter(f => /^toolbox-pack-.*\.js$/.test(f))]);
  const rendererDir = path.join(ROOT, 'src', 'renderer');
  for (const f of fs.readdirSync(rendererDir).filter(x => x.endsWith('.html') && x !== 'index.html')) {
    for (const m of fs.readFileSync(path.join(rendererDir, f), 'utf8').matchAll(/src="js\/([^"]+\.js)"/g)) out.add(m[1]);
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (p === JS || e.name === 'node_modules') continue; walk(p); }
      else if (e.name.endsWith('.js')) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/require\(\s*['"][^'"]*renderer\/js\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)) out.add(m[1] + '.js');
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

// -> { changed: [{ file, n }], left: [{ file, line, text }], skipped: [file] }
function run({ write = false } = {}) {
  const skip = excluded();
  const changed = [], left = [], skipped = [];
  for (const file of fs.readdirSync(JS).filter(f => f.endsWith('.js')).sort()) {
    const p = path.join(JS, file);
    const raw = fs.readFileSync(p, 'utf8');
    const crlf = raw.includes('\r\n');
    let text = raw.replace(/\r\n/g, '\n');
    if (skip.has(file)) { if (LEFTOVER.test(text)) skipped.push(file); LEFTOVER.lastIndex = 0; continue; }
    let n = 0;
    for (const r of RULES) text = text.replace(r.re, (...a) => { n++; return r.to(...a); });
    text.split('\n').forEach((l, i) => { LEFTOVER.lastIndex = 0; if (LEFTOVER.test(l)) left.push({ file, line: i + 1, text: l.trim().slice(0, 160) }); });
    LEFTOVER.lastIndex = 0;
    if (n) {
      changed.push({ file, n });
      if (write) fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text);
    }
  }
  return { changed, left, skipped };
}

// How many hand-written plural endings are left in the files that load VexPlural (the ratchet counts these).
function countRaw() {
  const skip = excluded();
  let n = 0;
  for (const file of fs.readdirSync(JS).filter(f => f.endsWith('.js'))) {
    if (skip.has(file)) continue;
    const text = fs.readFileSync(path.join(JS, file), 'utf8');
    n += (text.match(LEFTOVER) || []).length;
  }
  return n;
}

module.exports = { run, countRaw, excluded, _rules: RULES };

if (require.main === module) {
  const write = process.argv.includes('--write');
  const r = run({ write });
  const total = r.changed.reduce((a, c) => a + c.n, 0);
  console.log((write ? 'Rewrote ' : 'Would rewrite ') + total + ' plural ending(s) in ' + r.changed.length + ' file(s).');
  if (r.skipped.length) console.log('Left alone, because they run without vex-plural.js: ' + r.skipped.join(', '));
  if (r.left.length) {
    console.log(r.left.length + ' other spelling(s) need a look:');
    for (const l of r.left.slice(0, 60)) console.log('  ' + l.file + ':' + l.line + '  ' + l.text);
  }
}
