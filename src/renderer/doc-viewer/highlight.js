// A small syntax highlighter, written for this viewer (no library): one line at a time, with a small state carried from line to line
// (inside a block comment, inside a template or triple-quoted string). It colours what a reader needs to find their way (comments,
// strings, numbers, keywords, names of things) and does not try to be a parser: an unusual construct is simply left uncoloured.
//
//   highlightLine(lang, text, state) -> { html, state }      html is already escaped; classes are tk-kw, tk-str, tk-com ...
//   highlightLines(lang, lines, state) -> { html: [..], state }

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const span = (cls, text) => '<span class="tk-' + cls + '">' + esc(text) + '</span>';
const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const JS_KW = words('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await from as get set enum implements interface package private protected public readonly abstract declare namespace type keyof satisfies');
const JS_LIT = words('null true false undefined NaN Infinity');
const JS_TY = words('string number boolean any unknown never object symbol bigint Array Map Set Promise Record Partial Date RegExp Error Object Function JSON Math console window document require module exports');

const DEFS = {
  js: { kw: JS_KW, lit: JS_LIT, ty: JS_TY, lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], tpl: '`', call: true },
  ts: { kw: JS_KW, lit: JS_LIT, ty: JS_TY, lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], tpl: '`', call: true },
  json: { kw: new Set(), lit: words('null true false'), ty: new Set(), lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], keys: true },
  java: { kw: words('abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try void volatile while var val fun object when is in out override open sealed data lateinit companion namespace using struct readonly internal virtual async await get set partial record init let func guard defer'), lit: words('null true false nil'), ty: words('int long short byte char float double boolean String Integer Long Double Float Boolean Object List Map Set Optional Int Unit Any Nothing Void bool decimal string dynamic'), lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], call: true, meta: '@' },
  c: { kw: words('auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while class namespace template typename public private protected virtual override new delete this using try catch throw operator constexpr nullptr noexcept explicit friend mutable'), lit: words('NULL true false nullptr'), ty: words('int long short char float double void unsigned signed bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t wchar_t string vector map set'), lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], call: true, preproc: true },
  go: { kw: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'), lit: words('nil true false iota'), ty: words('int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error any'), lc: ['//'], bc: ['/*', '*/'], str: ['"', "'"], tpl: '`', call: true },
  rs: { kw: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'), lit: words('true false None Some Ok Err'), ty: words('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap HashSet'), lc: ['//'], bc: ['/*', '*/'], str: ['"'], call: true, meta: '#' },
  py: { kw: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'), lit: words('None True False'), ty: words('int str float bool list dict set tuple bytes object type self cls print len range'), lc: ['#'], str: ['"', "'"], triple: true, call: true, meta: '@' },
  rb: { kw: words('alias and begin break case class def defined do else elsif end ensure for if in module next nil not or redo rescue retry return self super then undef unless until when while yield require include extend attr_accessor attr_reader attr_writer puts'), lit: words('nil true false'), ty: new Set(), lc: ['#'], str: ['"', "'"], call: true },
  php: { kw: words('abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield'), lit: words('null true false NULL TRUE FALSE'), ty: words('int float string bool array object mixed void self parent'), lc: ['//', '#'], bc: ['/*', '*/'], str: ['"', "'"], call: true, vars: '$' },
  lua: { kw: words('and break do else elseif end for function goto if in local not or repeat return then until while'), lit: words('nil true false'), ty: words('self string table math io os'), lc: ['--'], str: ['"', "'"], call: true },
  sh: { kw: words('if then else elif fi for while until do done case esac in function select time return exit break continue export local readonly declare unset source alias set shift trap eval exec cd echo printf read test'), lit: words('true false'), ty: new Set(), lc: ['#'], str: ['"', "'"], vars: '$', call: false },
  bat: { kw: words('if else for in do goto call set setlocal endlocal echo exit rem pause shift not exist errorlevel defined start cd md rd del copy move'), lit: new Set(), ty: new Set(), lc: ['::', 'REM ', 'rem '], str: ['"'], vars: '%', ci: true },
  ps: { kw: words('begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow'), lit: words('$true $false $null'), ty: new Set(), lc: ['#'], bc: ['<#', '#>'], str: ['"', "'"], vars: '$', ci: true, call: true },
  sql: { kw: words('add all alter and any as asc backup begin between by case check column commit constraint create database default delete desc distinct drop else end exec exists foreign from full group having if in index inner insert into is join key left like limit not null on or order outer primary procedure replace returns right rollback select set table top truncate union unique update values view when where with offset fetch next rows only over partition window returning cascade references trigger function'), lit: words('null true false'), ty: words('int integer bigint smallint decimal numeric float real double varchar char text date time timestamp boolean blob serial uuid json jsonb'), lc: ['--'], bc: ['/*', '*/'], str: ["'", '"'], ci: true, call: true },
  toml: { kw: new Set(), lit: words('true false'), ty: new Set(), lc: ['#'], str: ['"', "'"], triple: true, config: 'toml' },
  ini: { kw: new Set(), lit: words('true false yes no on off'), ty: new Set(), lc: ['#', ';'], str: ['"', "'"], config: 'ini' },
  yaml: { kw: new Set(), lit: words('true false null yes no on off True False Null ~'), ty: new Set(), lc: ['#'], str: ['"', "'"], config: 'yaml' },
  css: { kw: words('important'), lit: new Set(), ty: new Set(), bc: ['/*', '*/'], lc: ['//'], str: ['"', "'"], css: true },
};
DEFS.php.lc = ['//', '#'];

const NUM_RE = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?[a-zA-Z]{0,3})/;
const IDENT_RE = /^[A-Za-z_$\u00c0-\uffff][\w$\u00c0-\uffff]*/;

// ---- the generic scanner: C-like, scripting and SQL languages
function scanGeneric(def, line, state) {
  let out = '';
  let i = 0;
  const n = line.length;
  // resume what the previous line left open
  if (state === 'bc') {
    const end = line.indexOf(def.bc[1]);
    if (end === -1) return { html: span('com', line), state };
    out += span('com', line.slice(0, end + def.bc[1].length));
    i = end + def.bc[1].length; state = '';
  } else if (state === 'tpl') {
    const r = endOfString(line, 0, def.tpl);
    if (r === -1) return { html: span('str', line), state };
    out += span('str', line.slice(0, r)); i = r; state = '';
  } else if (state && state.startsWith('tq')) {
    const q = state.slice(2);
    const end = line.indexOf(q + q + q);
    if (end === -1) return { html: span('str', line), state };
    out += span('str', line.slice(0, end + 3)); i = end + 3; state = '';
  }
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') { let j = i; while (j < n && (line[j] === ' ' || line[j] === '\t')) j++; out += line.slice(i, j); i = j; continue; }
    // comments
    const lc = def.lc && def.lc.find((m) => line.startsWith(m, i));
    if (lc) { out += span('com', line.slice(i)); i = n; break; }
    if (def.bc && line.startsWith(def.bc[0], i)) {
      const end = line.indexOf(def.bc[1], i + def.bc[0].length);
      if (end === -1) { out += span('com', line.slice(i)); state = 'bc'; i = n; break; }
      out += span('com', line.slice(i, end + def.bc[1].length)); i = end + def.bc[1].length; continue;
    }
    // strings
    if (def.triple && (c === '"' || c === "'") && line.startsWith(c + c + c, i)) {
      const end = line.indexOf(c + c + c, i + 3);
      if (end === -1) { out += span('str', line.slice(i)); state = 'tq' + c; i = n; break; }
      out += span('str', line.slice(i, end + 3)); i = end + 3; continue;
    }
    if (def.tpl && c === def.tpl) {
      const r = endOfString(line, i + 1, c);
      if (r === -1) { out += span('str', line.slice(i)); state = 'tpl'; i = n; break; }
      out += span('str', line.slice(i, r)); i = r; continue;
    }
    if (def.str.includes(c)) {
      const r = endOfString(line, i + 1, c);
      const text = line.slice(i, r === -1 ? n : r);
      // in JSON a string followed by a colon is a key
      if (def.keys && r !== -1 && /^\s*:/.test(line.slice(r))) out += span('attr', text);
      else out += span('str', text);
      i = r === -1 ? n : r; continue;
    }
    if (def.vars && c === def.vars) {
      const m = /^\$(?:\{[^}]*\}|[A-Za-z_]\w*|[0-9@#?*!$-])/.exec(line.slice(i)) || (def.vars === '%' ? /^%[^%\s]+%/.exec(line.slice(i)) : null);
      if (m) { out += span('var', m[0]); i += m[0].length; continue; }
    }
    if (def.meta && c === def.meta && (def.meta !== '#' || line[i + 1] === '[' || line[i + 1] === '!')) {
      // an annotation or decorator (@Name, @Name(args)) or a Rust attribute (#[derive(Debug)], #![allow(x)])
      const m = (def.meta === '@' ? /^@[\w.]+(?:\([^)]*\))?/ : /^#!?\[[^\]]*\]/).exec(line.slice(i));
      if (m) { out += span('meta', m[0]); i += m[0].length; continue; }
    }
    if (def.preproc && c === '#' && /^\s*$/.test(line.slice(0, i))) { out += span('meta', line.slice(i)); i = n; break; }
    if ((c >= '0' && c <= '9') || (c === '.' && line[i + 1] >= '0' && line[i + 1] <= '9')) {
      const m = NUM_RE.exec(line.slice(i));
      if (m) { out += span('num', m[0]); i += m[0].length; continue; }
    }
    const id = IDENT_RE.exec(line.slice(i));
    if (id) {
      const w = id[0];
      const key = def.ci ? w.toLowerCase() : w;
      let cls = '';
      if (def.kw.has(key)) cls = 'kw';
      else if (def.lit.has(key)) cls = 'lit';
      else if (def.ty.has(w)) cls = 'ty';
      else if (def.call && line[i + w.length] === '(') cls = 'fn';
      else if (/^[A-Z][A-Z0-9_]{2,}$/.test(w)) cls = 'const';
      else if (/^[A-Z]/.test(w) && def.call !== false && def !== DEFS.sql) cls = 'ty';
      out += cls ? span(cls, w) : esc(w);
      i += w.length; continue;
    }
    out += esc(c); i++;
  }
  return { html: out, state };
}

// The index just after the closing quote (an escaped quote does not close it), or -1.
function endOfString(line, from, q) {
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') { i++; continue; }
    if (c === q) return i + 1;
  }
  return -1;
}

// ---- CSS
function scanCss(def, line, state) {
  let out = '';
  let i = 0;
  const n = line.length;
  let depth = 0;
  let inComment = false;
  const parts = (state || '').split(':');
  if (parts[0] === 'bc') inComment = true;
  depth = Number(parts[1] || 0) || 0;
  let inValue = parts[2] === 'v';
  while (i < n) {
    if (inComment) {
      const end = line.indexOf('*/', i);
      if (end === -1) { out += span('com', line.slice(i)); i = n; break; }
      out += span('com', line.slice(i, end + 2)); i = end + 2; inComment = false; continue;
    }
    const c = line[i];
    if (line.startsWith('/*', i)) {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) { out += span('com', line.slice(i)); i = n; inComment = true; break; }
      out += span('com', line.slice(i, end + 2)); i = end + 2; continue;
    }
    if (c === '"' || c === "'") { const r = endOfString(line, i + 1, c); out += span('str', line.slice(i, r === -1 ? n : r)); i = r === -1 ? n : r; continue; }
    if (c === '{') { depth++; inValue = false; out += '{'; i++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); inValue = false; out += '}'; i++; continue; }
    if (c === ';') { inValue = false; out += ';'; i++; continue; }
    if (c === ':' && depth > 0 && !inValue) { inValue = true; out += ':'; i++; continue; }
    if (c === '@') { const m = /^@[\w-]+/.exec(line.slice(i)); if (m) { out += span('kw', m[0]); i += m[0].length; continue; } }
    if (c === '#' && inValue) { const m = /^#[0-9a-fA-F]{3,8}\b/.exec(line.slice(i)); if (m) { out += span('num', m[0]); i += m[0].length; continue; } }
    if (inValue) {
      const num = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/.exec(line.slice(i));
      if (num && !/[\w-]/.test(line[i - 1] || ' ')) { out += span('num', num[0]); i += num[0].length; continue; }
      const id = /^[\w-]+/.exec(line.slice(i));
      if (id) { out += line[i + id[0].length] === '(' ? span('fn', id[0]) : (id[0] === 'important' ? span('kw', id[0]) : esc(id[0])); i += id[0].length; continue; }
    } else {
      const id = /^[-\w]+/.exec(line.slice(i));
      if (id) {
        // inside a rule, the word before the colon is a property; outside, part of a selector
        const isProp = depth > 0 && /^\s*:/.test(line.slice(i + id[0].length));
        out += isProp ? span('attr', id[0]) : (depth === 0 ? span('tag', id[0]) : esc(id[0]));
        i += id[0].length; continue;
      }
      if ((c === '.' || c === '#') && depth === 0) { const m = /^[.#][-\w]+/.exec(line.slice(i)); if (m) { out += span('ty', m[0]); i += m[0].length; continue; } }
    }
    out += esc(c); i++;
  }
  return { html: out, state: inComment ? 'bc:' + depth : depth ? 'd:' + depth + (inValue ? ':v' : '') : '' };
}

// ---- HTML and XML
function scanMarkup(line, state) {
  let out = '';
  let i = 0;
  const n = line.length;
  let mode = state || '';          // '' text | 'com' comment | 'tag' inside a tag | 'cdata'
  while (i < n) {
    if (mode === 'com') {
      const end = line.indexOf('-->', i);
      if (end === -1) { out += span('com', line.slice(i)); i = n; break; }
      out += span('com', line.slice(i, end + 3)); i = end + 3; mode = ''; continue;
    }
    if (mode === 'cdata') {
      const end = line.indexOf(']]>', i);
      if (end === -1) { out += span('str', line.slice(i)); i = n; break; }
      out += span('str', line.slice(i, end + 3)); i = end + 3; mode = ''; continue;
    }
    if (mode === 'tag') {
      const c = line[i];
      if (c === '>' || (c === '/' && line[i + 1] === '>') || (c === '?' && line[i + 1] === '>')) { const len = c === '>' ? 1 : 2; out += span('tag', line.slice(i, i + len)); i += len; mode = ''; continue; }
      if (c === '"' || c === "'") { const end = line.indexOf(c, i + 1); const e = end === -1 ? n : end + 1; out += span('str', line.slice(i, e)); i = e; continue; }
      const m = /^[^\s=>/"']+/.exec(line.slice(i));
      if (m) { out += span('attr', m[0]); i += m[0].length; continue; }
      out += esc(c); i++; continue;
    }
    if (line.startsWith('<!--', i)) { mode = 'com'; const end = line.indexOf('-->', i + 4); if (end === -1) { out += span('com', line.slice(i)); i = n; break; } out += span('com', line.slice(i, end + 3)); i = end + 3; mode = ''; continue; }
    if (line.startsWith('<![CDATA[', i)) { mode = 'cdata'; const end = line.indexOf(']]>', i + 9); if (end === -1) { out += span('str', line.slice(i)); i = n; break; } out += span('str', line.slice(i, end + 3)); i = end + 3; mode = ''; continue; }
    if (line[i] === '<') {
      const m = /^<[/!?]?[A-Za-z][\w:.-]*|^<[/!?]/.exec(line.slice(i));
      if (m) { out += span('tag', m[0]); i += m[0].length; mode = 'tag'; continue; }
    }
    if (line[i] === '&') { const m = /^&(?:#\d+|#x[0-9a-fA-F]+|\w+);/.exec(line.slice(i)); if (m) { out += span('num', m[0]); i += m[0].length; continue; } }
    const end = line.indexOf('<', i + 1);
    const e = end === -1 ? n : end;
    out += esc(line.slice(i, e)); i = e;
  }
  return { html: out, state: mode };
}

// ---- YAML, TOML, INI
function scanConfig(def, line, state) {
  const kind = def.config;
  const t = line;
  let m;
  if (state && state.startsWith('tq')) {
    const q = state.slice(2);
    const end = t.indexOf(q + q + q);
    if (end === -1) return { html: span('str', t), state };
    return { html: span('str', t.slice(0, end + 3)) + esc(t.slice(end + 3)), state: '' };
  }
  if (/^\s*$/.test(t)) return { html: esc(t), state };
  if ((m = /^(\s*)([#;].*)$/.exec(t)) && (kind !== 'yaml' || m[2][0] === '#') && (kind === 'ini' || m[2][0] === '#')) return { html: esc(m[1]) + span('com', m[2]), state };
  if (kind === 'yaml' && /^(?:---|\.\.\.)\s*$/.test(t)) return { html: span('meta', t), state };
  if (kind !== 'yaml' && (m = /^(\s*)(\[\[?[^\]]*\]\]?)(\s*(?:[#;].*)?)$/.exec(t))) return { html: esc(m[1]) + span('tag', m[2]) + (m[3] ? span('com', m[3]) : ''), state };
  let out = '';
  let rest = t;
  if (kind === 'yaml') {
    m = /^(\s*(?:-\s+)*)((?:"[^"]*"|'[^']*'|[^\s#:][^#:]*?))(\s*:)(?=\s|$)/.exec(rest);
    if (m) { out += esc(m[1]) + span('attr', m[2]) + esc(m[3]); rest = rest.slice(m[0].length); }
    else if ((m = /^(\s*-\s+)/.exec(rest))) { out += esc(m[1]); rest = rest.slice(m[0].length); }
  } else if ((m = /^(\s*)([^=:#;\s][^=#;]*?)(\s*[=:]\s*)/.exec(rest))) {
    out += esc(m[1]) + span('attr', m[2]) + esc(m[3]); rest = rest.slice(m[0].length);
  }
  // the value
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === '#' && (i === 0 || /\s/.test(rest[i - 1]))) { out += span('com', rest.slice(i)); i = rest.length; break; }
    if (kind === 'ini' && c === ';' && (i === 0 || /\s/.test(rest[i - 1]))) { out += span('com', rest.slice(i)); i = rest.length; break; }
    if (def.triple && (c === '"' || c === "'") && rest.startsWith(c + c + c, i)) {
      const end = rest.indexOf(c + c + c, i + 3);
      if (end === -1) { out += span('str', rest.slice(i)); state = 'tq' + c; i = rest.length; break; }
      out += span('str', rest.slice(i, end + 3)); i = end + 3; continue;
    }
    if (c === '"' || c === "'") { const r = endOfString(rest, i + 1, c); out += span('str', rest.slice(i, r === -1 ? rest.length : r)); i = r === -1 ? rest.length : r; continue; }
    if (c === '&' || c === '*' || c === '!') { const a = /^[&*!][\w./-]*/.exec(rest.slice(i)); if (a && kind === 'yaml') { out += span('meta', a[0]); i += a[0].length; continue; } }
    const id = /^[\w.+-]+/.exec(rest.slice(i));
    if (id) {
      const w = id[0];
      out += /^[+-]?(?:\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+)$/.test(w) || /^\d{4}-\d\d-\d\d/.test(w) ? span('num', w) : def.lit.has(w) ? span('lit', w) : esc(w);
      i += w.length; continue;
    }
    out += esc(c); i++;
  }
  return { html: out, state };
}

// ---- a diff, a log, Markdown
function scanDiff(line) {
  if (/^(?:diff |index |--- |\+\+\+ )/.test(line)) return { html: span('meta', line), state: '' };
  if (line.startsWith('@@')) return { html: span('tag', line), state: '' };
  if (line.startsWith('+')) return { html: span('add', line), state: '' };
  if (line.startsWith('-')) return { html: span('del', line), state: '' };
  return { html: esc(line), state: '' };
}

const LOG_LEVEL = /\b(FATAL|CRITICAL|SEVERE|ERROR|ERR|WARN(?:ING)?|INFO|NOTICE|DEBUG|TRACE|VERBOSE)\b/;
function scanLog(line) {
  let out = '';
  let rest = line;
  const ts = /^(\s*\[?\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:[.,]\d+)?)?(?:Z|[+-]\d\d:?\d\d)?\]?|\s*\[?\d\d:\d\d:\d\d(?:[.,]\d+)?\]?)/.exec(rest);
  if (ts) { out += span('com', ts[0]); rest = rest.slice(ts[0].length); }
  const lv = LOG_LEVEL.exec(rest);
  if (lv) {
    const level = lv[1];
    const cls = /^(?:FATAL|CRITICAL|SEVERE|ERROR|ERR)$/.test(level) ? 'del' : /^WARN/.test(level) ? 'warn' : /^(?:DEBUG|TRACE|VERBOSE)$/.test(level) ? 'com' : 'kw';
    out += esc(rest.slice(0, lv.index)) + span(cls, level) + esc(rest.slice(lv.index + level.length));
  } else out += esc(rest);
  return { html: out, state: '' };
}

function scanMarkdown(line, state) {
  if (state === 'fence') {
    if (/^\s*(?:```|~~~)/.test(line)) return { html: span('meta', line), state: '' };
    return { html: span('str', line), state };
  }
  if (/^\s*(?:```|~~~)/.test(line)) return { html: span('meta', line), state: 'fence' };
  let m;
  if ((m = /^(#{1,6})(\s.*)?$/.exec(line))) return { html: span('kw', m[1]) + span('ty', m[2] || ''), state: '' };
  if ((m = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line))) return { html: esc(m[1]) + span('kw', m[2]) + esc(m[3]) + mdInline(m[4]), state: '' };
  if (/^\s*>/.test(line)) return { html: span('com', line), state: '' };
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return { html: span('meta', line), state: '' };
  return { html: mdInline(line), state: '' };
}
function mdInline(text) {
  let out = '';
  const re = /`[^`]*`|\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|<https?:[^>]+>/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += m[0][0] === '`' ? span('str', m[0]) : m[0][0] === '[' || m[0][0] === '<' ? span('attr', m[0]) : span('kw', m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// ---- entry points
export function highlightLine(lang, text, state) {
  const st = state || '';
  switch (lang) {
    case 'html': case 'xml': return scanMarkup(text, st);
    case 'css': return scanCss(DEFS.css, text, st);
    case 'yaml': case 'toml': case 'ini': return scanConfig(DEFS[lang], text, st);
    case 'diff': return scanDiff(text);
    case 'log': return scanLog(text);
    case 'md': return scanMarkdown(text, st);
    case 'plain': return { html: esc(text), state: '' };
    default: {
      const def = DEFS[lang];
      return def ? scanGeneric(def, text, st) : { html: esc(text), state: '' };
    }
  }
}

export function highlightLines(lang, lines, state) {
  const html = new Array(lines.length);
  let st = state || '';
  for (let i = 0; i < lines.length; i++) {
    const r = highlightLine(lang, lines[i], st);
    html[i] = r.html; st = r.state;
  }
  return { html, state: st };
}

export const HIGHLIGHT_LANGS = Object.freeze(['plain', 'log', 'js', 'ts', 'json', 'css', 'html', 'xml', 'md', 'py', 'sh', 'bat', 'ps', 'ini', 'toml', 'yaml', 'sql', 'java', 'c', 'go', 'rs', 'rb', 'php', 'lua', 'diff']);
