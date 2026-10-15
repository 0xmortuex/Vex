// === Vex Packs: the format, the validator and the signatures ==================
//
// A Vex Pack is ONE JSON file (.vexpack) that carries only DECLARATIVE items
// Vex already knows how to interpret: colour themes, brief sections written as
// data, command chains, page-action scripts (the fixed step language, never
// JavaScript), per-site readability presets, sticker and medal-frame art as
// SVG, command aliases, and quote / fortune lists.
//
// There is no executable item type. Nothing in a pack is ever evaluated,
// required, imported or concatenated into code anywhere in Vex.
//
// This file is the part with no Electron and no disk in it, so every rule can
// be tested, including the hostile-pack corpus (tests/main/packs.test.js):
//
//   parseStrictJson   a strict JSON parser: depth, size and node limits, no
//                     duplicate keys, no __proto__ / constructor / prototype
//   validatePack      rebuilds the pack field by field from known fields only;
//                     unknown fields, unknown item types and every string that
//                     is not clean text are REJECTED with an explicit error.
//                     It never "fixes" a string: what is stored is exactly
//                     what was signed.
//   sanitizeSvg       a tokenizer-based allow-list for sticker / medal art
//   canonicalize / contentHash / signPack / verifyPack   Ed25519 (node:crypto)
//
// docs/packs.md is the written form of all of this.
'use strict';

const crypto = require('node:crypto');

const FORMAT = 'vex-pack';
const VERSION = 1;

const LIMITS = Object.freeze({
  maxBytes: 256 * 1024,
  maxItems: 200,
  maxDepth: 8,
  maxNodes: 20000,
  maxNameChars: 80,
  maxDescriptionChars: 600,
  maxSvgChars: 16 * 1024,
  maxSvgElements: 400,
  maxSvgDepth: 12,
  maxPermissions: 8,
});

// What a pack may declare it needs. A pack must declare exactly what its items
// require: a missing one and an unused one are both refused, so the list the
// person reads is the truth.
const PERMISSIONS = Object.freeze({
  'runs-on:origin': 'Act on the websites named in its page actions: click, scroll, hide and fill in fields there as if you had done it yourself. Only when you run an action.',
  'runs:commands': 'Run Vex commands one after another when you pick one of its chains or type one of its command shortcuts.',
  'styles:pages': 'Change the text size, contrast and width of the websites it names.',
  'opens:links': 'Show links that open web pages when you click them.',
  'reads:tabs': 'Read the address or the site of the page you are on, to fill in a link it builds.',
});

class PackError extends Error {
  constructor(code, message) { super(message); this.name = 'PackError'; this.code = code; }
}
const fail = (code, message) => { throw new PackError(code, message); };

// --- strict JSON -----------------------------------------------------------

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Returns plain data (null-prototype objects). Never calls JSON.parse, so a
// deep or odd document is judged by these limits, not by the engine's stack.
function parseStrictJson(input, limits = LIMITS) {
  if (typeof input !== 'string') fail('not-text', 'A pack must be text');
  let text = input;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  let i = 0, nodes = 0;
  const len = text.length;
  const err = (msg) => fail('bad-json', 'The file is not valid pack JSON: ' + msg + ' (at character ' + i + ')');
  const ws = () => { while (i < len) { const c = text.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } };
  const node = () => { if (++nodes > limits.maxNodes) fail('too-complex', 'The pack has more than ' + limits.maxNodes + ' values'); };
  function str() {
    i++; // opening quote
    let out = '';
    for (;;) {
      if (i >= len) err('unterminated string');
      const c = text[i];
      const code = text.charCodeAt(i);
      if (c === '"') { i++; return out; }
      if (code < 0x20) err('control character in string');
      if (c === '\\') {
        const n = text[i + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (n === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) err('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else if (Object.prototype.hasOwnProperty.call(map, n)) { out += map[n]; i += 2; }
        else err('bad escape');
      } else { out += c; i++; }
    }
  }
  function value(depth) {
    if (depth > limits.maxDepth) fail('too-deep', 'The pack is nested deeper than ' + limits.maxDepth + ' levels');
    ws();
    if (i >= len) err('unexpected end');
    const c = text[i];
    node();
    if (c === '{') {
      i++;
      const o = Object.create(null);
      ws();
      if (text[i] === '}') { i++; return o; }
      for (;;) {
        ws();
        if (text[i] !== '"') err('expected a key');
        const key = str();
        if (FORBIDDEN_KEYS.has(key)) fail('forbidden-key', 'The pack uses the forbidden key "' + key + '"');
        if (key in o) fail('duplicate-key', 'The pack repeats the key "' + key.slice(0, 40) + '"');
        ws();
        if (text[i] !== ':') err('expected ":"');
        i++;
        o[key] = value(depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return o; }
        err('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(value(depth + 1));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return a; }
        err('expected "," or "]"');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,15})?(?:[eE][+-]?\d{1,3})?/.exec(text.slice(i, i + 40));
    if (!m) err('unexpected character');
    i += m[0].length;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) err('number out of range');
    return n;
  }
  ws();
  if (text[i] !== '{') err('a pack is a JSON object');
  const root = value(0);
  ws();
  if (i < len) err('extra text after the pack');
  return root;
}

// --- text rules ------------------------------------------------------------

// Characters a pack string may never contain: controls, bidirectional
// overrides and isolates (they reorder what the person reads), zero-width and
// other invisible characters, private use, line / paragraph separators,
// language tags and non-characters.
// Lone surrogates, language tags (U+E0000 block) and plane-15 private use are
// refused too; ordinary emoji (surrogate pairs) stay allowed.
// eslint-disable-next-line no-misleading-character-class -- a deliberate deny-list of invisible and combining characters
const BAD_CHARS_NO_MODIFIER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uE000-\uF8FF\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\uDB40[\uDC00-\uDFFF]|\uDB80[\uDC00-\uDFFF]/;

function text(value, where, { max = 200, min = 1, multiline = false } = {}) {
  if (typeof value !== 'string') fail('bad-type', where + ' must be text');
  if (value.length > max) fail('too-long', where + ' is longer than ' + max + ' characters');
  if (value.length < min) fail('empty', where + ' is empty');
  const probe = multiline ? value.replace(/\n/g, '') : value;
  if (/[\r\u0085]/.test(probe)) fail('bad-text', where + ' contains a carriage return');
  const m = BAD_CHARS_NO_MODIFIER.exec(probe);
  if (m) fail('bad-text', where + ' contains a hidden, control or direction-changing character (U+' + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + ')');
  if (!multiline && value !== value.trim()) fail('bad-text', where + ' starts or ends with a space');
  if (!multiline && /[\n\t]/.test(value)) fail('bad-text', where + ' must be one line');
  return value;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// A value named in an error message: never String() of an object.
const show = (v) => (typeof v === 'string' ? v.slice(0, 40) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v);

function exact(obj, where, allowed, required = allowed) {
  if (!isObject(obj)) fail('bad-type', where + ' must be an object');
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail('unknown-field', where + ' has an unknown field "' + String(k).slice(0, 40) + '"');
  for (const k of required) if (!(k in obj)) fail('missing-field', where + ' is missing "' + k + '"');
}

const PACK_ID = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/;
function packId(value, where) {
  if (typeof value !== 'string' || !PACK_ID.test(value) || value.includes('..') || /[.]$/.test(value) || RESERVED.test(value)) {
    fail('bad-id', where + ' must be 3-64 lowercase letters, digits, "." "_" or "-", starting with a letter or digit');
  }
  return value;
}
function itemId(value, where) {
  if (typeof value !== 'string' || !ITEM_ID.test(value)) fail('bad-id', where + ' must be 1-48 lowercase letters, digits, "_" or "-"');
  return value;
}

// --- item validators -------------------------------------------------------

// Command ids a chain or an alias may point at. A pack can never make a
// command bar word or a chain that wipes, installs, exports, signs out,
// restarts or reaches saved secrets.
const DANGEROUS_COMMAND = /(?:clear|delete|remove|wipe|reset|uninstall|install|quit|exit|restart|vault|password|passkey|totp|secret|export|import|sync|send|logout|sign-?out|erase|forget|format|purge|revoke|update|download|pack)/i;
const COMMAND_ID = /^[a-z0-9][a-z0-9:_.-]{0,79}$/i;
function commandId(value, where) {
  if (typeof value !== 'string' || !COMMAND_ID.test(value)) fail('bad-command', where + ' is not a command id');
  if (DANGEROUS_COMMAND.test(value)) fail('dangerous-command', where + ' names "' + value + '", which a pack may not run');
  return value;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEME_COLORS = ['background', 'surface', 'text', 'muted', 'primary', 'success', 'warning', 'danger', 'border'];
const THEME_REQUIRED = ['background', 'surface', 'text', 'primary'];

const HOST = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const ORIGIN = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::([0-9]{1,5}))?$/;

function httpsUrl(value, where) {
  text(value, where, { max: 500 });
  if (!/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s"'<>\\^`{|}]*)?$/i.test(value)) fail('bad-url', where + ' must be a plain https:// address');
  let u;
  try { u = new URL(value); } catch { fail('bad-url', where + ' is not a web address'); }
  if (u.protocol !== 'https:' || u.username || u.password) fail('bad-url', where + ' must be a plain https:// address');
  if (!HOST.test(u.hostname) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)) fail('bad-url', where + ' has an unusable host');
  return value;
}

// The page-action step language (the same grammar the interpreter in
// js/page-actions.js accepts). Validated here so a pack cannot carry a line
// the interpreter would reject, and so the confirm can list every step.
const MAX_ACTION_SOURCE = 4000, MAX_ACTION_STEPS = 40, MAX_ACTION_WAIT = 5000;
function parseActionSource(source, where) {
  text(source, where, { max: MAX_ACTION_SOURCE, multiline: true });
  const steps = [];
  const quoted = (s) => { const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim()); return m ? m[1].replace(/\\(.)/g, '$1') : null; };
  const selectorOf = (s) => { const m = /^selector\s*:\s*(.+)$/i.exec(s.trim()); return m ? m[1].trim() : null; };
  const okSelector = (s, line) => { if (s.length > 200 || /[\u0000-\u001F]/.test(s)) fail('bad-step', where + ' line ' + line + ': the selector is too long or has control characters'); return s; };
  source.split('\n').forEach((raw, idx) => {
    const line = idx + 1, t = raw.trim();
    if (!t || t.startsWith('#')) return;
    if (steps.length >= MAX_ACTION_STEPS) fail('bad-step', where + ' has more than ' + MAX_ACTION_STEPS + ' steps');
    let m;
    if ((m = /^click\s+(.+)$/i.exec(t))) {
      const sel = selectorOf(m[1]), q = quoted(m[1]);
      if (sel) steps.push('Click the element matching ' + okSelector(sel, line));
      else if (q !== null) steps.push('Click the button or link with the words "' + q + '"');
      else fail('bad-step', where + ' line ' + line + ': click needs "some words" or selector: ...');
    } else if ((m = /^scroll\s+to\s+(.+)$/i.exec(t))) {
      const sel = selectorOf(m[1]), q = quoted(m[1]);
      if (sel) steps.push('Scroll to the element matching ' + okSelector(sel, line));
      else if (q !== null) steps.push('Scroll to the heading or section with the words "' + q + '"');
      else fail('bad-step', where + ' line ' + line + ': scroll to needs "some words" or selector: ...');
    } else if ((m = /^scroll\s+(top|bottom)$/i.exec(t))) {
      steps.push('Scroll to the ' + m[1].toLowerCase() + ' of the page');
    } else if ((m = /^wait\s+(\d{1,5})$/i.exec(t))) {
      if (Number(m[1]) > MAX_ACTION_WAIT) fail('bad-step', where + ' line ' + line + ': wait is at most ' + MAX_ACTION_WAIT + ' milliseconds');
      steps.push('Wait ' + m[1] + ' milliseconds');
    } else if ((m = /^hide\s+(.+)$/i.exec(t))) {
      const sel = selectorOf(m[1]);
      if (!sel) fail('bad-step', where + ' line ' + line + ': hide needs selector: ...');
      steps.push('Hide every element matching ' + okSelector(sel, line));
    } else if ((m = /^type\s+selector\s*:\s*(.+?)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/i.exec(t))) {
      steps.push('Type "' + quoted(m[2]) + '" into the field matching ' + okSelector(m[1].trim(), line));
    } else {
      fail('bad-step', where + ' line ' + line + ' is not a step: ' + t.slice(0, 60));
    }
  });
  if (!steps.length) fail('bad-step', where + ' has no steps');
  return steps;
}

// --- SVG allow-list --------------------------------------------------------

const SVG_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'radialGradient', 'stop']);
const SVG_ATTRS = new Set(['viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'points',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'transform', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'id', 'xmlns', 'preserveAspectRatio']);
const SVG_PLAIN_VALUE = /^[A-Za-z0-9 .,#()%+\-_]{0,2000}$/;
const SVG_URL_VALUE = /^url\(#[A-Za-z][A-Za-z0-9_-]{0,31}\)$/;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Parses and re-serializes. Anything outside the allow-list THROWS: there is
// no silent stripping, so a pack that passes is safe to store exactly as it is.
// The returned string is rebuilt from the parsed tree and is what the window
// shows (always as an <img> data address, which cannot run script or load
// anything).
function sanitizeSvg(source, where = 'The picture') {
  if (typeof source !== 'string') fail('bad-type', where + ' must be text');
  if (source.length > LIMITS.maxSvgChars) fail('svg-too-large', where + ' is larger than ' + LIMITS.maxSvgChars + ' characters');
  const m0 = BAD_CHARS_NO_MODIFIER.exec(source.replace(/[\n\t]/g, ' '));
  if (m0) fail('svg-bad-char', where + ' contains a control or hidden character');
  if (/<\s*[!?]/.test(source)) fail('svg-forbidden', where + ' has a comment, doctype, entity, CDATA or processing instruction');
  let i = 0, elements = 0;
  const stack = [];
  let out = '', rootSeen = false, rootClosed = false;
  const ids = new Set(), refs = [];
  const len = source.length;
  const skipWs = () => { while (i < len && /\s/.test(source[i])) i++; };
  while (i < len) {
    if (source[i] !== '<') {
      const j = source.indexOf('<', i);
      const chunk = source.slice(i, j < 0 ? len : j);
      if (/\S/.test(chunk)) fail('svg-forbidden', where + ' has text content, which is not allowed');
      i = j < 0 ? len : j;
      continue;
    }
    if (source[i + 1] === '/') {
      const j = source.indexOf('>', i);
      if (j < 0) fail('svg-bad', where + ' has an unterminated tag');
      const name = source.slice(i + 2, j).trim();
      const open = stack.pop();
      if (!open || open !== name) fail('svg-bad', where + ' has mismatched tags');
      out += '</' + name + '>';
      if (!stack.length) rootClosed = true;
      i = j + 1;
      continue;
    }
    // opening tag
    i++;
    const nm = /^[A-Za-z][A-Za-z0-9]*/.exec(source.slice(i, i + 40));
    if (!nm) fail('svg-bad', where + ' has a malformed tag');
    const name = nm[0];
    if (!SVG_ELEMENTS.has(name)) fail('svg-forbidden', where + ' uses the element <' + name.slice(0, 30) + '>, which is not allowed');
    if (rootClosed) fail('svg-bad', where + ' has more than one root');
    if (!rootSeen && name !== 'svg') fail('svg-bad', where + ' must start with <svg>');
    if (rootSeen && name === 'svg') fail('svg-forbidden', where + ' nests an <svg>, which is not allowed');
    rootSeen = true;
    if (++elements > LIMITS.maxSvgElements) fail('svg-too-large', where + ' has more than ' + LIMITS.maxSvgElements + ' elements');
    i += name.length;
    let attrs = '', selfClose = false;
    const seen = new Set();
    for (;;) {
      skipWs();
      if (i >= len) fail('svg-bad', where + ' has an unterminated tag');
      if (source[i] === '/' && source[i + 1] === '>') { selfClose = true; i += 2; break; }
      if (source[i] === '>') { i++; break; }
      const am = /^[A-Za-z_:][-A-Za-z0-9_:.]*/.exec(source.slice(i, i + 60));
      if (!am) fail('svg-bad', where + ' has a malformed attribute');
      const an = am[0];
      i += an.length;
      skipWs();
      if (source[i] !== '=') fail('svg-bad', where + ' has an attribute without a value');
      i++;
      skipWs();
      const q = source[i];
      if (q !== '"' && q !== "'") fail('svg-bad', where + ' has an unquoted attribute');
      const end = source.indexOf(q, i + 1);
      if (end < 0) fail('svg-bad', where + ' has an unterminated attribute');
      const val = source.slice(i + 1, end);
      i = end + 1;
      if (/^on/i.test(an)) fail('svg-forbidden', where + ' has an event handler (' + an.slice(0, 20) + ')');
      if (!SVG_ATTRS.has(an)) fail('svg-forbidden', where + ' uses the attribute "' + an.slice(0, 30) + '", which is not allowed');
      if (seen.has(an)) fail('svg-bad', where + ' repeats the attribute "' + an + '"');
      seen.add(an);
      if (an === 'xmlns') { if (val !== SVG_NS || name !== 'svg') fail('svg-forbidden', where + ' has a namespace other than SVG'); }
      else if (SVG_URL_VALUE.test(val)) {
        if (an !== 'fill' && an !== 'stroke') fail('svg-forbidden', where + ' references "' + val.slice(0, 40) + '" from "' + an + '"');
        refs.push(val.slice(5, -1));
      } else if (!SVG_PLAIN_VALUE.test(val) || /url\s*\(|javascript|data\s*:|expression/i.test(val)) {
        fail('svg-forbidden', where + ' has a value that is not allowed in "' + an + '"');
      }
      if (an === 'id') { if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(val) || ids.has(val)) fail('svg-bad', where + ' has a bad or repeated id'); ids.add(val); }
      attrs += ' ' + an + '="' + val + '"';
    }
    if (selfClose) { out += '<' + name + attrs + '/>'; if (!stack.length) rootClosed = true; }
    else {
      stack.push(name);
      if (stack.length > LIMITS.maxSvgDepth) fail('svg-too-deep', where + ' is nested deeper than ' + LIMITS.maxSvgDepth);
      out += '<' + name + attrs + '>';
    }
  }
  if (!rootSeen || stack.length) fail('svg-bad', where + ' is not a complete <svg> document');
  for (const r of refs) if (!ids.has(r)) fail('svg-bad', where + ' points at "#' + r + '", which it does not define');
  return out;
}

// --- items -----------------------------------------------------------------

function validateItem(raw, index) {
  const where = 'Item ' + (index + 1);
  if (!isObject(raw)) fail('bad-type', where + ' must be an object');
  const type = raw.type;
  if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(ITEM_TYPES, type)) {
    fail('unknown-item-type', where + ' has the unknown type "' + show(type) + '"');
  }
  const def = ITEM_TYPES[type];
  exact(raw, where + ' (' + type + ')', ['type', 'id', ...def.fields]);
  const id = itemId(raw.id, where + ' id');
  return def.build(raw, where + ' (' + id + ')', id);
}

const ITEM_TYPES = {
  theme: {
    label: 'Colour theme', fields: ['name', 'colors'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 40 });
      exact(raw.colors, where + ' colors', THEME_COLORS, THEME_REQUIRED);
      const colors = {};
      for (const k of THEME_COLORS) {
        if (!(k in raw.colors)) continue;
        if (typeof raw.colors[k] !== 'string' || !HEX.test(raw.colors[k])) fail('bad-colour', where + ' colour "' + k + '" must be like #1a2b3c');
        colors[k] = raw.colors[k];
      }
      return { item: { type: 'theme', id, name, colors }, needs: [], line: 'Colour theme "' + name + '" (changes the colours of Vex when you pick it)' };
    },
  },
  chain: {
    label: 'Command chain', fields: ['name', 'steps'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 60 });
      if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > 20) fail('bad-type', where + ' steps must be 1 to 20 commands');
      const steps = raw.steps.map((s, k) => commandId(s, where + ' step ' + (k + 1)));
      return { item: { type: 'chain', id, name, steps }, needs: ['runs:commands'], line: 'Command chain "' + name + '" runs: ' + steps.join(', then ') };
    },
  },
  'page-action': {
    label: 'Page action', fields: ['name', 'origin', 'source'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 80 });
      const origin = text(raw.origin, where + ' origin', { max: 280 });
      const om = ORIGIN.exec(origin);
      if (!om || (om[2] && Number(om[2]) > 65535)) fail('bad-origin', where + ' origin must be exactly one site such as https://example.com');
      const steps = parseActionSource(raw.source, where + ' script');
      return {
        item: { type: 'page-action', id, name, origin, source: raw.source }, needs: ['runs-on:origin'],
        line: 'Page action "' + name + '" on ' + origin + ' (' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '): ' + steps.join('; '),
      };
    },
  },
  'brief-section': {
    label: 'Brief section', fields: ['title', 'blocks'],
    build(raw, where, id) {
      const title = text(raw.title, where + ' title', { max: 60 });
      if (!Array.isArray(raw.blocks) || raw.blocks.length < 1 || raw.blocks.length > 20) fail('bad-type', where + ' blocks must be 1 to 20');
      const needs = new Set();
      const blocks = raw.blocks.map((b, k) => {
        const w = where + ' block ' + (k + 1);
        if (!isObject(b)) fail('bad-type', w + ' must be an object');
        if (b.kind === 'text') {
          exact(b, w, ['kind', 'text']);
          return { kind: 'text', text: text(b.text, w + ' text', { max: 500, multiline: true }) };
        }
        if (b.kind === 'link') {
          exact(b, w, ['kind', 'label', 'url']);
          needs.add('opens:links');
          return { kind: 'link', label: text(b.label, w + ' label', { max: 80 }), url: httpsUrl(b.url, w + ' url') };
        }
        if (b.kind === 'url-template') {
          exact(b, w, ['kind', 'label', 'template']);
          const label = text(b.label, w + ' label', { max: 80 });
          const template = text(b.template, w + ' template', { max: 500 });
          const holes = template.match(/\{[^{}]*\}/g) || [];
          for (const h of holes) {
            if (!['{query}', '{tab-url}', '{tab-host}'].includes(h)) fail('bad-template', w + ' uses the unknown placeholder ' + h.slice(0, 30));
            if (h !== '{query}') needs.add('reads:tabs');
          }
          if (/[{}]/.test(template.replace(/\{(?:query|tab-url|tab-host)\}/g, ''))) fail('bad-template', w + ' has a stray brace');
          const head = /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?\//i.exec(template);
          if (!head) fail('bad-template', w + ' must begin with a fixed https://site/ (a placeholder may not choose the site)');
          httpsUrl(template.replace(/\{(?:query|tab-url|tab-host)\}/g, 'x'), w + ' template');
          needs.add('opens:links');
          return { kind: 'url-template', label, template };
        }
        return fail('unknown-block', w + ' has the unknown kind "' + show(b.kind) + '"');
      });
      const links = blocks.filter(b => b.kind !== 'text').length;
      return {
        item: { type: 'brief-section', id, title, blocks }, needs: [...needs],
        line: 'Brief section "' + title + '" (' + blocks.length + ' block' + (blocks.length === 1 ? '' : 's') + (links ? ', ' + links + ' link' + (links === 1 ? '' : 's') : '') + ')',
      };
    },
  },
  'readability-preset': {
    label: 'Readability preset', fields: ['name', 'host', 'font', 'contrast', 'width'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 60 });
      const host = text(raw.host, where + ' host', { max: 253 });
      if (!HOST.test(host)) fail('bad-host', where + ' host must be a site name such as example.com');
      const int = (v, lo, hi, nm) => { if (!Number.isInteger(v) || v < lo || v > hi) fail('bad-number', where + ' ' + nm + ' must be a whole number from ' + lo + ' to ' + hi); return v; };
      const font = int(raw.font, 70, 250, 'font'), contrast = int(raw.contrast, 100, 200, 'contrast');
      if (!Number.isInteger(raw.width) || (raw.width !== 0 && (raw.width < 400 || raw.width > 1600))) fail('bad-number', where + ' width must be 0 or from 400 to 1600');
      return {
        item: { type: 'readability-preset', id, name, host, font, contrast, width: raw.width }, needs: ['styles:pages'],
        line: 'Readability preset "' + name + '" for ' + host + ' (text ' + font + '%, contrast ' + contrast + '%, width ' + (raw.width || 'the site\'s own') + ')',
      };
    },
  },
  sticker: {
    label: 'Sticker', fields: ['name', 'svg'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 40 });
      sanitizeSvg(raw.svg, where + ' picture');
      return { item: { type: 'sticker', id, name, svg: raw.svg }, needs: [], line: 'Sticker "' + name + '" (a picture)' };
    },
  },
  'medal-frame': {
    label: 'Medal frame', fields: ['name', 'svg'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 40 });
      sanitizeSvg(raw.svg, where + ' picture');
      return { item: { type: 'medal-frame', id, name, svg: raw.svg }, needs: [], line: 'Medal frame "' + name + '" (a picture)' };
    },
  },
  aliases: {
    label: 'Command shortcuts', fields: ['name', 'entries'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 60 });
      if (!Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > 50) fail('bad-type', where + ' entries must be 1 to 50');
      const seen = new Set();
      const entries = raw.entries.map((e, k) => {
        const w = where + ' entry ' + (k + 1);
        exact(e, w, ['word', 'command']);
        if (typeof e.word !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,15}$/.test(e.word)) fail('bad-alias', w + ' word must be 1-16 lowercase letters, digits, "." "_" or "-"');
        if (seen.has(e.word)) fail('duplicate-id', w + ' repeats the word "' + e.word + '"');
        seen.add(e.word);
        return { word: e.word, command: commandId(e.command, w + ' command') };
      });
      return { item: { type: 'aliases', id, name, entries }, needs: ['runs:commands'], line: 'Command shortcuts "' + name + '": ' + entries.map(e => e.word + ' -> ' + e.command).join(', ') };
    },
  },
  quotes: {
    label: 'Quotes or fortunes', fields: ['name', 'kind', 'entries'],
    build(raw, where, id) {
      const name = text(raw.name, where + ' name', { max: 60 });
      if (raw.kind !== 'quote' && raw.kind !== 'fortune') fail('bad-type', where + ' kind must be "quote" or "fortune"');
      if (!Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > 100) fail('bad-type', where + ' entries must be 1 to 100');
      const entries = raw.entries.map((e, k) => {
        const w = where + ' entry ' + (k + 1);
        exact(e, w, ['text', 'by'], ['text']);
        const o = { text: text(e.text, w + ' text', { max: 280, multiline: true }) };
        if ('by' in e) o.by = text(e.by, w + ' by', { max: 60 });
        return o;
      });
      return { item: { type: 'quotes', id, name, kind: raw.kind, entries }, needs: [], line: (raw.kind === 'quote' ? 'Quote list' : 'Fortune list') + ' "' + name + '" (' + entries.length + ' entries)' };
    },
  },
};
const ITEM_TYPE_NAMES = Object.freeze(Object.keys(ITEM_TYPES));

// --- canonical form, hash, signature ----------------------------------------

function canonicalize(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) fail('bad-type', 'A number is not finite'); return JSON.stringify(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (isObject(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
  return fail('bad-type', 'A value of an unsupported kind');
}
const CONTENT_FIELDS = ['format', 'version', 'id', 'name', 'author', 'description', 'items', 'permissions'];
const contentOf = (pack) => { const c = {}; for (const k of CONTENT_FIELDS) c[k] = pack[k]; return c; };
const contentHash = (pack) => crypto.createHash('sha256').update(canonicalize(contentOf(pack)), 'utf8').digest('hex');
const SIGN_PREFIX = 'vexpack-v1\n';
const signedBytes = (pack) => Buffer.from(SIGN_PREFIX + canonicalize(contentOf(pack)), 'utf8');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function publicKeyObject(raw32) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw32]), format: 'der', type: 'spki' });
}
function rawPublicKey(keyObject) {
  const der = keyObject.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}
const fingerprintOf = (raw32) => {
  const h = crypto.createHash('sha256').update(raw32).digest('hex').slice(0, 32);
  return h.match(/.{4}/g).join('-');
};
function b64(value, bytes, where) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('bad-signature', where + ' is not base64');
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== bytes || buf.toString('base64') !== value) fail('bad-signature', where + ' is not ' + bytes + ' bytes');
  return buf;
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: rawPublicKey(publicKey).toString('base64'),
    fingerprint: fingerprintOf(rawPublicKey(publicKey)),
    privateKeyDer: privateKey.export({ format: 'der', type: 'pkcs8' }),
  };
}

// Signs an already validated pack object. Returns a new object with hash and
// signature added; the input is not changed.
function signPack(pack, privateKeyDer) {
  const key = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const pub = rawPublicKey(crypto.createPublicKey(key));
  const withHash = { ...contentOf(pack), hash: contentHash(pack) };
  const sig = crypto.sign(null, signedBytes(pack), key);
  return { ...withHash, signature: { alg: 'ed25519', key: pub.toString('base64'), sig: sig.toString('base64') } };
}
function withHash(pack) { return { ...contentOf(pack), hash: contentHash(pack) }; }

// --- the whole pack ---------------------------------------------------------

// text -> { pack, hash, trust, fingerprint, summary }
//   trust: 'unsigned' | 'unknown-key' | 'trusted'
// `trustedKeys` is a Set of fingerprints. Every refusal is a thrown PackError
// with a code; nothing is returned half-valid.
function parsePack(input, { trustedKeys = new Set() } = {}) {
  if (typeof input !== 'string') fail('not-text', 'A pack must be text');
  if (Buffer.byteLength(input, 'utf8') > LIMITS.maxBytes) fail('too-large', 'The pack is larger than ' + (LIMITS.maxBytes / 1024) + ' KB');
  const raw = parseStrictJson(input);
  exact(raw, 'The pack', [...CONTENT_FIELDS, 'hash', 'signature'], [...CONTENT_FIELDS, 'hash']);
  if (raw.format !== FORMAT) fail('bad-format', 'This is not a Vex pack (format must be "' + FORMAT + '")');
  if (raw.version !== VERSION) fail('bad-version', 'This pack is version ' + show(raw.version) + '; this Vex reads version ' + VERSION);
  const id = packId(raw.id, 'The pack id');
  const name = text(raw.name, 'The pack name', { max: LIMITS.maxNameChars });
  const author = text(raw.author, 'The author', { max: 60 });
  const description = text(raw.description, 'The description', { max: LIMITS.maxDescriptionChars, multiline: true, min: 0 });
  if (!Array.isArray(raw.items)) fail('bad-type', 'items must be a list');
  if (raw.items.length < 1) fail('empty', 'The pack has no items');
  if (raw.items.length > LIMITS.maxItems) fail('too-many-items', 'The pack has more than ' + LIMITS.maxItems + ' items');
  const seen = new Set();
  const built = raw.items.map((it, k) => {
    const b = validateItem(it, k);
    const key = b.item.type + ':' + b.item.id;
    if (seen.has(key)) fail('duplicate-id', 'Two items share the id "' + b.item.id + '" of type ' + b.item.type);
    seen.add(key);
    return b;
  });
  if (!Array.isArray(raw.permissions) || raw.permissions.length > LIMITS.maxPermissions) fail('bad-type', 'permissions must be a list of at most ' + LIMITS.maxPermissions);
  const declared = raw.permissions.map((p) => {
    if (typeof p !== 'string' || !Object.prototype.hasOwnProperty.call(PERMISSIONS, p)) fail('unknown-permission', 'The pack declares the unknown permission "' + String(p).slice(0, 40) + '"');
    return p;
  });
  if (new Set(declared).size !== declared.length) fail('duplicate-id', 'The pack declares a permission twice');
  const needed = new Set(built.flatMap(b => b.needs));
  for (const p of needed) if (!declared.includes(p)) fail('missing-permission', 'Its items need the permission "' + p + '" but the pack does not declare it');
  for (const p of declared) if (!needed.has(p)) fail('unused-permission', 'The pack declares "' + p + '" but no item uses it');
  const pack = {
    format: FORMAT, version: VERSION, id, name, author, description,
    // The file's own order is part of what was signed, so it is kept.
    items: built.map(b => b.item), permissions: declared.slice(),
  };
  const hash = contentHash(pack);
  if (typeof raw.hash !== 'string' || raw.hash !== hash) fail('hash-mismatch', 'The pack\'s hash does not match its content, so it was changed after it was made');
  let trust = 'unsigned', fingerprint = '', signature = null;
  if ('signature' in raw) {
    exact(raw.signature, 'The signature', ['alg', 'key', 'sig']);
    if (raw.signature.alg !== 'ed25519') fail('bad-signature', 'The signature algorithm must be ed25519');
    const key = b64(raw.signature.key, 32, 'The signing key');
    const sig = b64(raw.signature.sig, 64, 'The signature');
    let ok = false;
    try { ok = crypto.verify(null, signedBytes(pack), publicKeyObject(key), sig); }
    catch (e) { fail('bad-signature', 'The signature could not be checked: ' + e.message); }
    if (!ok) fail('bad-signature', 'The signature does not match this content (the pack was changed, or it was signed by someone else)');
    fingerprint = fingerprintOf(key);
    signature = { alg: 'ed25519', key: raw.signature.key, sig: raw.signature.sig };
    trust = trustedKeys.has(fingerprint) ? 'trusted' : 'unknown-key';
  }
  const full = { ...pack, hash };
  if (signature) full.signature = signature;
  return {
    pack: full, hash, trust, fingerprint,
    summary: {
      id, name, author, description, trust, fingerprint, hash,
      items: built.map(b => ({ type: b.item.type, id: b.item.id, label: ITEM_TYPES[b.item.type].label, line: b.line })),
      permissions: declared.map(p => ({ id: p, text: PERMISSIONS[p] })),
    },
  };
}

// Re-serializes a validated pack for a file (pretty, stable key order).
function serializePack(pack) {
  const o = { ...contentOf(pack), hash: pack.hash || contentHash(pack) };
  if (pack.signature) o.signature = pack.signature;
  return JSON.stringify(o, null, 2) + '\n';
}

// Builds and validates a pack from loose parts (the export path). The same
// validators run, so an export can never produce a file Vex would refuse.
function buildPack({ id, name, author, description = '', items }) {
  const content = { format: FORMAT, version: VERSION, id, name, author, description, items: [], permissions: [] };
  if (!Array.isArray(items)) fail('bad-type', 'items must be a list');
  const built = items.map((it, k) => validateItem(it, k));
  content.items = built.map(b => b.item);
  const need = [...new Set(built.flatMap(b => b.needs))];
  content.permissions = need;
  const hashed = withHash(content);
  const checked = parsePack(JSON.stringify(hashed));
  return checked.pack;
}

module.exports = {
  FORMAT, VERSION, LIMITS, PERMISSIONS, ITEM_TYPE_NAMES, PackError,
  parseStrictJson, parsePack, serializePack, buildPack, sanitizeSvg, parseActionSource,
  canonicalize, contentHash, signPack, generateKeyPair, fingerprintOf, rawPublicKey, publicKeyObject,
  packId, itemId, withHash,
};
