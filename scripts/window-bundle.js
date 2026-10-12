// The window's scripts as a few files instead of ~280.
//
// src/renderer/index.html loads every feature as its own blocking <script>.
// Each one is a separate file:// fetch, compile and task, and together they
// held the window back by ~0.5 s every time a window or private window opened
// (domInteractive 835 ms with the separate files, ~320 ms with the same code in
// one file; cat-perf probe, 2026-10-11).
//
// The packaged app loads the same code concatenated into a few "chunks". The
// source tree is untouched: index.html keeps one tag per file and is what
// development (npm start, the smoke tests, probes) runs. At package time
// electron-builder's beforePack hook (this file) writes build/window-bundle/:
//   src/renderer/index.html            index.html with each run of plain
//                                      <script src> tags replaced by its chunk
//   src/renderer/bundle/window-N.js    the chunk (+ .map, line-level, so
//                                      DevTools shows the original files)
// and package.json "build.files" maps that folder over src/ in the package.
//
// Why plain concatenation, in order, with nothing wrapped: the renderer shares
// top-level const/let/class across classic scripts (TabManager, CommandBar,
// AIPanel... are lexical globals, not window.X). Wrapping a file in a function
// or a try block would hide them. Concatenated, they stay in the one global
// lexical scope, exactly as separate scripts are.
//
// What concatenation changes, and how each is handled:
//  1. A top-level throw stops the rest of its CHUNK, not just its file, and
//     the later files' lexical bindings stay uninitialised for good. Hence a
//     few chunks, split where index.html says <!-- window-bundle: break -->,
//     instead of one; a throw costs at most the rest of one chunk. Each chunk
//     ends by recording that it finished (VexWindowBundle) and the boot smoke
//     test fails unless every chunk did.
//  2. Within a chunk, a later file's const/let/class exist (uninitialised)
//     before the earlier files run, and its function declarations are already
//     defined. Code that runs at load and touches such a name behaves
//     differently (`typeof Later` throws instead of giving 'undefined'). The
//     analysis below refuses to build if any file does that, or if two files
//     in one chunk declare the same function.
//  3. A file's own "use strict" directive would be lost (or imposed on the
//     whole chunk); refused.
//  4. Code that looks for its own <script src> tag no longer finds it; such a
//     lookup of a bundled file is refused. Chunk tags carry
//     data-vex-window-bundle so "am I in the real page" checks can see them.
//  5. document.currentScript is the chunk: bundle/ sits one level under
//     renderer/, like js/, so a URL resolved against it ("../vendor/...")
//     lands in the same place.
// Anything that is not a plain classic <script src="..."></script> (inline,
// type=module, async/defer) stays where it is and ends the chunk before it, so
// load order is exactly index.html's. Lazily loaded files (VexLazy, the
// Toolbox packs) are not in index.html and stay separate files.
//
// CLI:  node scripts/window-bundle.js            write build/window-bundle/
//       node scripts/window-bundle.js --check    analyse only (check:source)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RENDERER = 'src/renderer';
const OUT = 'build/window-bundle';
const CHUNK_DIR = 'bundle';
const BREAK = /^\s*window-bundle:\s*break\b/;

// Every <script> tag and window-bundle break comment in the page, in order.
// Other comments are skipped, so a commented-out tag is not a script.
function scanPage(html) {
  const items = [];
  const re = /<!--([\s\S]*?)-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    if (m[1] !== undefined) {
      if (BREAK.test(m[1])) items.push({ kind: 'break', start: m.index, end: m.index + m[0].length });
      continue;
    }
    const attrs = m[2].trim();
    const plain = /^src="([^"]+)"$/.exec(attrs);
    const local = plain && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(plain[1]) && !/[?#]/.test(plain[1]);
    items.push(plain && local && !m[3].trim()
      ? { kind: 'script', src: plain[1], start: m.index, end: m.index + m[0].length }
      : { kind: 'fixed', tag: m[0], start: m.index, end: m.index + m[0].length });
  }
  return items;
}

// The plain script srcs of index.html, in load order (what the bundle must hold).
function pageScripts(html) {
  return scanPage(html).filter(i => i.kind === 'script').map(i => i.src);
}

function readFile(root, src) {
  const file = path.resolve(root, RENDERER, src);
  if (!fs.existsSync(file)) throw new Error(`window-bundle: index.html loads ${src}, which does not exist`);
  return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

// Runs of consecutive plain scripts, split at break comments and at any tag
// that is not a plain script.
function planChunks(html) {
  const chunks = [];
  let cur = null;
  for (const item of scanPage(html)) {
    if (item.kind === 'script') {
      if (!cur) { cur = { items: [] }; chunks.push(cur); }
      cur.items.push(item);
    } else cur = null;
  }
  return chunks.map((c, i) => ({ name: `${CHUNK_DIR}/window-${i + 1}.js`, files: c.items.map(it => it.src), items: c.items }));
}

// ---- analysis ----------------------------------------------------------

function parseFile(src, code) {
  const espree = require('espree');
  try { return espree.parse(code, { ecmaVersion: 'latest', sourceType: 'script', range: true, loc: true }); }
  catch (e) { throw new Error(`window-bundle: ${src} does not parse: ${e.message}`); }
}

const SYNC_CALLBACK = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce', 'reduceRight', 'flatMap', 'sort', 'toSorted']);

function setParents(node, parent) {
  if (!node || typeof node.type !== 'string') return;
  Object.defineProperty(node, 'parent', { value: parent, enumerable: false, configurable: true });
  for (const key of Object.keys(node)) {
    if (key === 'range' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(n => setParents(n, node));
    else if (v && typeof v.type === 'string') setParents(v, node);
  }
}

// Whether a function runs while its file loads: an IIFE (also .call/.apply),
// or a callback of an array method called at load.
function runsAtLoad(fn) {
  let p = fn.parent;
  while (p && p.type === 'ChainExpression') p = p.parent;
  if (!p) return false;
  if ((p.type === 'CallExpression' || p.type === 'NewExpression') && p.callee === fn) return true;
  if (p.type === 'MemberExpression' && p.object === fn && !p.computed && /^(call|apply)$/.test(p.property.name)) {
    return p.parent && p.parent.type === 'CallExpression' && p.parent.callee === p;
  }
  if (p.type === 'CallExpression' && p.arguments.includes(fn) && p.callee.type === 'MemberExpression' && !p.callee.computed) {
    return SYNC_CALLBACK.has(p.callee.property.name);
  }
  return false;
}

function atLoad(scope) {
  for (let s = scope; s && s.type !== 'global'; s = s.upper) {
    if (s.type === 'function') { if (!runsAtLoad(s.block)) return false; }
    else if (s.type === 'class-field-initializer') { if (!(s.block.parent && s.block.parent.static)) return false; }
  }
  return true;
}

function describeFile(src, code) {
  const eslintScope = require('eslint-scope');
  const ast = parseFile(src, code);
  setParents(ast, null);
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script' });
  const g = scopes.globalScope;
  const lexical = new Set(), functions = new Set(), vars = new Set();
  for (const v of g.variables) {
    for (const d of v.defs) {
      if (d.type === 'ClassName' || (d.type === 'Variable' && d.parent.kind !== 'var')) lexical.add(v.name);
      else if (d.type === 'FunctionName') functions.add(v.name);
      else if (d.type === 'Variable') vars.add(v.name);
    }
  }
  // Names of other files this file touches while it loads.
  const atLoadRefs = new Map();
  for (const s of scopes.scopes) {
    for (const r of s.references) {
      if (r.resolved) continue;
      if (!atLoad(r.from)) continue;
      if (!atLoadRefs.has(r.identifier.name)) atLoadRefs.set(r.identifier.name, r.identifier.loc.start.line);
    }
  }
  const strict = ast.body.some(n => n.directive === 'use strict') && ast.body[0] && ast.body[0].directive !== undefined;
  return { src, lexical, functions, vars, atLoadRefs, strict };
}

// Every reason the chunks would not behave like the separate scripts.
function analyze(chunks, read) {
  const problems = [];
  const all = [];
  for (const chunk of chunks) {
    const infos = chunk.files.map(src => describeFile(src, read(src)));
    all.push(...infos);
    infos.forEach((info, i) => {
      if (info.strict) problems.push(`${info.src} starts with "use strict": concatenated it would not be strict (or would make its whole chunk strict). Put it inside the file's function instead.`);
      for (const later of infos.slice(i + 1)) {
        for (const name of later.functions) {
          if (info.functions.has(name)) problems.push(`${info.src} and ${later.src} both declare function ${name}(): in one chunk the later one replaces it before either runs. Rename one, or put a <!-- window-bundle: break --> between them.`);
        }
        for (const [name, line] of info.atLoadRefs) {
          if (later.lexical.has(name) || later.functions.has(name)) {
            problems.push(`${info.src}:${line} uses ${name} while it loads, and ${name} is declared later by ${later.src} in the same chunk: bundled, that ${later.lexical.has(name) ? 'throws (not yet initialised) instead of finding it undefined' : 'finds the function already defined'}. Put a <!-- window-bundle: break --> between them, or touch ${name} only after load.`);
          }
        }
      }
    });
  }
  // A name declared lexically by two files fails at runtime anyway; bundled it
  // would take its whole chunk down instead of one file.
  const owner = new Map();
  for (const info of all) {
    for (const name of [...info.lexical, ...info.functions, ...info.vars]) {
      const kind = info.lexical.has(name) ? 'lexical' : 'var';
      const prev = owner.get(name);
      if (prev && (kind === 'lexical' || prev.kind === 'lexical') && prev.src !== info.src) {
        problems.push(`${name} is declared by both ${prev.src} and ${info.src}, and at least one is const/let/class: the second file fails to load.`);
      }
      if (!prev || kind === 'lexical') owner.set(name, { src: info.src, kind });
    }
  }
  return problems;
}

// Source that looks up a bundled file by its own <script src> tag.
function tagLookups(root, files) {
  const problems = [];
  const bundled = new Set(files);
  const dir = path.join(root, RENDERER, 'js');
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const m of text.matchAll(/script\[src=\\?["']([^"'\\]+)\\?["']\]/g)) {
      const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index));
      if (bundled.has(m[1]) && !line.includes('data-vex-window-bundle')) problems.push(`js/${name} looks for <script src="${m[1]}">, which the packaged window does not have (it is in a bundle chunk). Look for script[data-vex-window-bundle] too.`);
    }
  }
  return problems;
}

// ---- output ------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(n) {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1, out = '';
  do { let d = v & 31; v >>>= 5; if (v) d |= 32; out += B64[d]; } while (v);
  return out;
}

function buildChunk(chunk, index, read) {
  let code = '';
  const mappings = [];
  let prevSource = 0, prevLine = 0;
  chunk.files.forEach((src, si) => {
    let text = read(src);
    if (!text.endsWith('\n')) text += '\n';
    // The ";" ends the previous file's last statement (no ASI surprises when
    // a file starts with "(" or "[").
    code += `;// ---- ${src}\n` + text;
    mappings.push('');
    const lines = text.split('\n').length - 1;
    for (let li = 0; li < lines; li++) {
      mappings.push('A' + vlq(si - prevSource) + vlq(li - prevLine) + 'A');
      prevSource = si; prevLine = li;
    }
  });
  code += `;(globalThis.VexWindowBundle || (globalThis.VexWindowBundle = [])).push(${index + 1});\n`;
  code += `//# sourceMappingURL=${path.basename(chunk.name)}.map\n`;
  const map = { version: 3, file: path.basename(chunk.name), sources: chunk.files.map(s => '../' + s), names: [], mappings: mappings.join(';') };
  return { code, map: JSON.stringify(map) };
}

function bundledHtml(html, chunks) {
  const starts = new Map(chunks.map(c => [c.items[0].start, c]));
  const bundled = new Set(chunks.flatMap(c => c.items.map(i => i.start)));
  let out = '', at = 0;
  for (const item of scanPage(html)) {
    if (item.kind === 'fixed') continue;
    if (item.kind === 'break') { out += html.slice(at, item.start); at = item.end; continue; }
    if (!bundled.has(item.start)) continue;
    // Drop the tag and the whitespace/newline that followed it.
    out += html.slice(at, item.start);
    const chunk = starts.get(item.start);
    if (chunk) out += `<script src="${chunk.name}" data-vex-window-bundle></script>`;
    at = item.end;
    const nl = /^[ \t]*\r?\n[ \t]*/.exec(html.slice(at));
    if (nl && !chunk) at += nl[0].length;
  }
  out += html.slice(at);
  // Preloaded from <head>, every chunk is fetched and compiled off the main
  // thread while the stylesheets load. Without it each chunk after the first
  // compiled only once the one before it had run: ~50 ms per window for a
  // break near the top (b12 probe, 2026-10-11).
  const head = [`<meta name="vex-window-bundle" content="${chunks.length}">`, ...chunks.map(c => `<link rel="preload" as="script" href="${c.name}">`)];
  if (!/<\/head>/i.test(out)) throw new Error('window-bundle: index.html has no </head>');
  return out.replace(/<\/head>/i, head.map(h => `  ${h}\r\n`).join('') + '</head>');
}

// Plans, checks and returns everything the packaged window needs.
function plan(root = ROOT) {
  const html = fs.readFileSync(path.join(root, RENDERER, 'index.html'), 'utf8');
  const cache = new Map();
  const read = (src) => { if (!cache.has(src)) cache.set(src, readFile(root, src)); return cache.get(src); };
  const chunks = planChunks(html);
  const problems = [...analyze(chunks, read), ...tagLookups(root, chunks.flatMap(c => c.files))];
  const built = chunks.map((c, i) => buildChunk(c, i, read));
  built.forEach((b, i) => {
    try { new vm.Script(b.code, { filename: chunks[i].name }); }
    catch (e) { problems.push(`${chunks[i].name} does not parse: ${e.message}`); }
  });
  return { html, chunks, built, problems, page: bundledHtml(html, chunks) };
}

function write(root = ROOT, outDir = path.join(root, OUT)) {
  const p = plan(root);
  if (p.problems.length) throw new Error('window-bundle: the window scripts cannot be bundled safely:\n  ' + p.problems.join('\n  '));
  fs.rmSync(outDir, { recursive: true, force: true });
  const dest = path.join(outDir, RENDERER);
  fs.mkdirSync(path.join(dest, CHUNK_DIR), { recursive: true });
  fs.writeFileSync(path.join(dest, 'index.html'), p.page);
  p.chunks.forEach((c, i) => {
    fs.writeFileSync(path.join(dest, c.name), p.built[i].code);
    fs.writeFileSync(path.join(dest, c.name + '.map'), p.built[i].map);
  });
  return { outDir, chunks: p.chunks.map(c => ({ name: c.name, files: c.files.length })) };
}

// electron-builder beforePack hook: runs on every build (npm run dist, pack,
// publish, or electron-builder called directly), before the app's files are
// collected, so the package can never carry a stale or missing bundle.
async function beforePack(context) {
  const root = (context && context.packager && context.packager.projectDir) || ROOT;
  const r = write(root);
  console.log(`  • window-bundle  ${r.chunks.length} chunks: ${r.chunks.map(c => c.files).join('+')} scripts`);
}

module.exports = beforePack;
module.exports.default = beforePack;
Object.assign(module.exports, { scanPage, pageScripts, planChunks, analyze, plan, write, OUT, RENDERER, CHUNK_DIR });

if (require.main === module) {
  try {
    if (process.argv.includes('--check')) {
      const p = plan();
      if (p.problems.length) { console.error('window-bundle:\n  ' + p.problems.join('\n  ')); process.exit(1); }
      console.log(`window-bundle: ${p.chunks.length} chunks, ${p.chunks.reduce((a, c) => a + c.files.length, 0)} scripts, safe to bundle`);
    } else {
      const r = write();
      console.log(`window-bundle: wrote ${r.outDir} (${r.chunks.map(c => c.name + ' ' + c.files).join(', ')})`);
    }
  } catch (e) { console.error(e.message || e); process.exit(1); }
}
