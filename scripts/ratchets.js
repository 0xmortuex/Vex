// Source ratchets run by `npm run check:source` (scripts/verify-source.js).
//
// A ratchet is a rule the old code already breaks. The files that break it
// today are listed, with how many times, in scripts/ratchet-allowlist.json.
// A file that is not listed may not break the rule at all; a listed file may
// not break it MORE than listed. The numbers only go down: when a listed file
// improves, `node scripts/ratchets.js --tighten` rewrites the list lower, and
// nothing in this repo may raise a number or add a file (review the diff).
//
//   no-raw-interval  T0-020  src/renderer/js: no setInterval outside VexJobs
//                            (jobs.js holds the Game / battery / hidden-window
//                            pauses a raw timer skips)
//   no-silent-catch  T0-008  src/**: no empty catch and no .catch(() => {});
//                            report with VexProblems.note(...) or rethrow.
//                            A deliberate one carries, inside the block,
//                            `vex-allow-empty-catch: <reason>`.
//
// Pure functions are exported so tests/main/ratchets.test.js can drive them.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST = path.join(__dirname, 'ratchet-allowlist.json');
const MARKER = 'vex-allow-empty-catch:';

// Replace comments with spaces and the inside of string/template literals with
// spaces, keeping every newline and offset, so the rules can look at code only.
// Regex literals are not understood; a quote inside one can confuse a single
// line (strings end at a newline), never the whole file.
function mask(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\r\n]/g, ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      out += blank(src.slice(i, j)); i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      out += blank(src.slice(i, j)); i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      out += c + blank(src.slice(i + 1, j - 1)) + (src[j - 1] === c ? c : blank(src[j - 1] || ''));
      i = j;
    } else if (c === '`') {
      let j = i + 1; let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (depth === 0 && src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && src[j] === '}') { depth--; j++; continue; }
        j++;
      }
      j = Math.min(j + 1, n);
      // Keep ${...} code visible would need a parser; the inside is blanked.
      out += '`' + blank(src.slice(i + 1, j - 1)) + '`';
      i = j;
    } else { out += c; i++; }
  }
  return out;
}

function lineOf(src, offset) { return src.slice(0, offset).split('\n').length; }

function findRawIntervals(src) {
  const code = mask(src);
  const hits = [];
  for (const m of code.matchAll(/(?<![\w$.])(?:window\.|globalThis\.)?setInterval\s*\(/g)) hits.push({ line: lineOf(src, m.index), text: 'setInterval' });
  return hits;
}

function findSilentCatches(src) {
  const code = mask(src);
  const hits = [];
  for (const m of code.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, j = open;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}' && --depth === 0) break;
    }
    if (code.slice(open + 1, j).trim() !== '') continue;
    if (src.slice(open, j).includes(MARKER)) continue;
    hits.push({ line: lineOf(src, m.index), text: 'empty catch' });
  }
  for (const m of code.matchAll(/\.catch\(\s*(?:\([^)]*\)|[\w$]+)?\s*=>\s*\{\s*\}\s*\)/g)) {
    if (src.slice(m.index, m.index + m[0].length).includes(MARKER)) continue;
    hits.push({ line: lineOf(src, m.index), text: '.catch(() => {})' });
  }
  return hits;
}

const RULES = {
  'no-raw-interval': {
    why: 'use VexJobs.every(...) (js/jobs.js) so Game mode, battery and a hidden window pause it',
    dirs: ['src/renderer/js'],
    find: findRawIntervals,
  },
  'no-silent-catch': {
    why: 'report with VexProblems.note(area, message, err) or let the error propagate; a deliberate one needs "' + MARKER + ' <reason>" inside the block',
    dirs: ['src'],
    find: findSilentCatches,
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// counts: { rule: { 'src/relative/file.js': n } } for the tree under `root`.
function scan(root = ROOT) {
  const counts = {};
  for (const [name, rule] of Object.entries(RULES)) {
    counts[name] = {};
    for (const dir of rule.dirs) {
      for (const file of walk(path.join(root, dir))) {
        const hits = rule.find(fs.readFileSync(file, 'utf8'));
        if (hits.length) counts[name][path.relative(root, file).split(path.sep).join('/')] = hits.length;
      }
    }
  }
  return counts;
}

// Compare counts to the allowlist. errors: breaking the ratchet. notes: a
// listed file got better and the list can be tightened.
function compare(counts, allow) {
  const errors = [], notes = [];
  for (const [name, rule] of Object.entries(RULES)) {
    const have = counts[name] || {}, listed = (allow && allow[name]) || {};
    for (const [file, n] of Object.entries(have)) {
      if (!(file in listed)) errors.push(`${file}: ${name} (${n}x) is not allowed in a file that was clean: ${rule.why}`);
      else if (n > listed[file]) errors.push(`${file}: ${name} went from ${listed[file]} to ${n}: ${rule.why}`);
      else if (n < listed[file]) notes.push(`${file}: ${name} improved ${listed[file]} -> ${n}; run node scripts/ratchets.js --tighten`);
    }
    for (const file of Object.keys(listed)) if (!(file in have)) notes.push(`${file}: ${name} is gone; run node scripts/ratchets.js --tighten`);
  }
  return { errors, notes };
}

function loadAllowlist() { return JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')); }

function check(root = ROOT) {
  const allow = loadAllowlist();
  return compare(scan(root), allow);
}

function sortedObject(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

// Never raises a number or adds a file: only lowers or removes.
function tighten(root = ROOT) {
  const allow = loadAllowlist(), counts = scan(root), next = {};
  for (const name of Object.keys(RULES)) {
    next[name] = {};
    for (const [file, listed] of Object.entries(allow[name] || {})) {
      const now = (counts[name] || {})[file] || 0;
      if (now > 0) next[name][file] = Math.min(listed, now);
    }
    next[name] = sortedObject(next[name]);
  }
  fs.writeFileSync(ALLOWLIST, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// Writes the first allowlist from the current tree. Refuses to overwrite.
function init(root = ROOT) {
  if (fs.existsSync(ALLOWLIST)) throw new Error('ratchet-allowlist.json already exists; use --tighten');
  const counts = scan(root);
  const next = {};
  for (const name of Object.keys(RULES)) next[name] = sortedObject(counts[name]);
  fs.writeFileSync(ALLOWLIST, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { mask, findRawIntervals, findSilentCatches, scan, compare, check, tighten, init, RULES, ALLOWLIST, MARKER };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--init') { const r = init(); console.log('wrote allowlist', Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Object.keys(v).length]))); }
  else if (arg === '--tighten') { tighten(); console.log('allowlist tightened'); }
  else {
    const r = check();
    for (const n of r.notes) console.log('note: ' + n);
    for (const e of r.errors) console.error('ratchet: ' + e);
    process.exitCode = r.errors.length ? 1 : 0;
  }
}
