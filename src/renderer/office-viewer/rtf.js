// Rich Text Format (.rtf) read into the same DOM the Word reader makes. Text, bold, italic, underline, strikethrough, super- and
// subscript, alignment, paragraphs, tabs, special characters (Turkish and every other code page the file names, \u escapes), tables
// (cells in rows) and PNG / JPEG pictures. Fonts, sizes, colours, headers and footers, and fields' codes are not read; the text of a
// hyperlink field is kept and its address is not followed.

import { t } from './strings.js';

// Groups whose content is not text of the document.
const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'footnote', 'themedata', 'colorschememapping', 'latentstyles',
  'datastore', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'revtbl', 'xmlnstbl', 'pgdsctbl', 'fldinst', 'private', 'userprops', 'filetbl', 'mmathPr', 'wgrffmtfilter', 'object', 'bkmkstart', 'bkmkend']);
const SPECIAL = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', emspace: ' ', enspace: ' ', tab: ' ', '~': ' ', _: '‑', '-': '' };

// The code pages an RTF file names (\ansicpg) and the label the browser knows each by. A page not listed is read as Western (1252).
const CODEPAGES = { 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 65001: 'utf-8' };
function decoderFor(codepage) {
  return new TextDecoder(CODEPAGES[codepage || 1252] || 'windows-1252');
}

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// text: the file as a string where every byte is one char (latin-1 read). -> { paragraphs, blocks }
export function parseRtf(text) {
  if (!/^\s*\{\\rtf/.test(text)) throw Object.assign(new Error('This is not a Rich Text Format file'), { code: 'corrupt' });
  let codepage = 1252;
  const cpm = /\\ansicpg(\d+)/.exec(text.slice(0, 2000));
  if (cpm) codepage = +cpm[1];
  const dec = decoderFor(codepage);
  const blocks = [];             // paragraph objects and table objects, in order
  let para = null, row = null, cell = null, inTable = false;
  let st = { b: false, i: false, u: false, s: false, sup: false, sub: false, skip: false, uc: 1 };
  const stack = [];
  let align = 'left', indent = 0;
  const bytes = [];
  let pict = null;

  const newPara = () => ({ runs: [], align, indent });
  const ensurePara = () => { if (!para) para = newPara(); return para; };
  const flushBytes = () => { if (bytes.length) { addText(dec.decode(new Uint8Array(bytes.splice(0)))); } };
  const addText = (s) => {
    if (!s || st.skip) return;
    ensurePara().runs.push({ text: s, b: st.b, i: st.i, u: st.u, s: st.s, sup: st.sup, sub: st.sub });
  };
  const endPara = () => {
    flushBytes();
    const p = para || newPara();
    para = null;
    if (inTable && cell) cell.push(p); else blocks.push(p);
  };
  const endCell = () => { flushBytes(); if (para) { cell.push(para); para = null; } if (!row) row = []; row.push(cell || []); cell = []; };
  const endRow = () => {
    if (!row) row = [];
    if (cell && (cell.length || para)) { if (para) { cell.push(para); para = null; } row.push(cell); }
    blocks.push({ table: row });
    row = null; cell = null; inTable = false;
  };

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '{') { flushBytes(); stack.push({ ...st }); i++; continue; }
    if (ch === '}') {
      flushBytes();
      if (pict && stack.length === pict.depth) {
        pict.done = true;
      }
      st = stack.pop() || st;
      if (pict && pict.done) { blocks.push({ picture: pict }); pict = null; }
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (ch !== '\\') {
      if (pict && pict.collect) { pict.hex += ch; i++; continue; }
      let j = i;
      while (j < n && text[j] !== '\\' && text[j] !== '{' && text[j] !== '}' && text[j] !== '\r' && text[j] !== '\n') j++;
      const chunk = text.slice(i, j);
      if (!st.skip) { for (let k = 0; k < chunk.length; k++) bytes.push(chunk.charCodeAt(k) & 255); }
      i = j;
      continue;
    }
    // a control word or symbol
    i++;
    const c = text[i];
    if (c === '\\' || c === '{' || c === '}') { if (!st.skip) bytes.push(c.charCodeAt(0)); i++; continue; }
    if (c === "'") { const hex = text.substr(i + 1, 2); i += 3; if (!st.skip) bytes.push(parseInt(hex, 16) || 63); continue; }
    if (c === '*') { // an optional destination: skipped unless known (none are)
      i++; st.skip = true; continue;
    }
    if (c === '~' || c === '_' || c === '-') { flushBytes(); addText(SPECIAL[c]); i++; continue; }
    if (!/[a-zA-Z]/.test(c)) { i++; continue; }
    let j = i;
    while (j < n && /[a-zA-Z]/.test(text[j])) j++;
    const word = text.slice(i, j);
    let numStr = '';
    if (text[j] === '-' || /\d/.test(text[j] || '')) { let k = j; if (text[k] === '-') k++; while (k < n && /\d/.test(text[k])) k++; numStr = text.slice(j, k); j = k; }
    const num = numStr === '' ? null : parseInt(numStr, 10);
    if (text[j] === ' ') j++;
    i = j;
    if (SKIP_DEST.has(word)) { st.skip = true; continue; }
    if (word === 'nonshppict') { st.skip = true; st.noPict = true; continue; }
    if (pict && pict.collect) { continue; }
    if (st.skip && !(word === 'pict' && !st.noPict)) continue;
    switch (word) {
      case 'par': case 'sect': endPara(); break;
      case 'line': flushBytes(); addText('\n'); break;
      case 'tab': flushBytes(); addText(' '); break;
      case 'pard': flushBytes(); align = 'left'; indent = 0; break;
      case 'plain': st.b = st.i = st.u = st.s = st.sup = st.sub = false; break;
      case 'b': flushBytes(); st.b = num !== 0; break;
      case 'i': flushBytes(); st.i = num !== 0; break;
      case 'ul': case 'uld': case 'uldb': flushBytes(); st.u = num !== 0; break;
      case 'ulnone': flushBytes(); st.u = false; break;
      case 'strike': case 'striked': flushBytes(); st.s = num !== 0; break;
      case 'super': flushBytes(); st.sup = true; st.sub = false; break;
      case 'sub': flushBytes(); st.sub = true; st.sup = false; break;
      case 'nosupersub': flushBytes(); st.sup = st.sub = false; break;
      case 'qc': align = 'center'; break;
      case 'qr': align = 'right'; break;
      case 'qj': align = 'justify'; break;
      case 'ql': align = 'left'; break;
      case 'li': indent = (num || 0) / 20; break;
      case 'uc': st.uc = num == null ? 1 : num; break;
      case 'u': {
        flushBytes();
        const code = num < 0 ? num + 65536 : num;
        addText(String.fromCharCode(code));
        // skip the fallback characters that follow
        let skip = st.uc;
        while (skip > 0 && i < n) {
          if (text[i] === '\\' && text[i + 1] === "'") { i += 4; skip--; }
          else if (text[i] === '\\' || text[i] === '{' || text[i] === '}') break;
          else { i++; skip--; }
        }
        break;
      }
      case 'trowd': flushBytes(); inTable = true; if (!cell) cell = []; break;
      case 'intbl': inTable = true; if (!cell) cell = []; break;
      case 'cell': endCell(); break;
      case 'row': endRow(); break;
      case 'pict': pict = { depth: stack.length, hex: '', format: null, collect: false, done: false }; st.skip = false; break;
      case 'pngblip': if (pict) { pict.format = 'image/png'; pict.collect = true; } break;
      case 'jpegblip': if (pict) { pict.format = 'image/jpeg'; pict.collect = true; } break;
      case 'emfblip': case 'wmetafile': case 'dibitmap': case 'wbitmap': if (pict) { pict.format = 'unsupported'; pict.collect = true; } break;
      default:
        if (SPECIAL[word] != null) { flushBytes(); addText(SPECIAL[word]); }
    }
  }
  flushBytes();
  if (para) endPara();
  if (row) endRow();
  return { blocks };
}

export function renderRtf(parsed, host) {
  host.textContent = '';
  const root = document.createElement('div');
  root.className = 'od-doc';
  host.append(root);
  const unsupported = { picture: 0 };
  const paragraph = (p, into) => {
    const el = document.createElement('p');
    if (p.align !== 'left') el.style.textAlign = p.align;
    if (p.indent > 0 && p.indent < 300) el.style.marginInlineStart = Math.round(p.indent) + 'px';
    for (const r of p.runs) {
      const s = document.createElement('span');
      const cls = [];
      if (r.b) cls.push('b'); if (r.i) cls.push('i'); if (r.u) cls.push('u'); if (r.s) cls.push('s'); if (r.sup) cls.push('sup'); if (r.sub) cls.push('sub');
      if (cls.length) s.className = 'od-r ' + cls.join(' ');
      const lines = r.text.split('\n');
      lines.forEach((line, k) => { if (k) s.append(document.createElement('br')); s.append(document.createTextNode(line)); });
      el.append(s);
    }
    if (!p.runs.length) { el.classList.add('od-empty'); el.append(document.createElement('br')); }
    into.append(el);
  };
  for (const b of parsed.blocks) {
    if (b.table) {
      const wrap = document.createElement('div');
      wrap.className = 'od-table-wrap';
      const table = document.createElement('table');
      table.className = 'od-table';
      const tr = document.createElement('tr');
      for (const c of b.table) { const td = document.createElement('td'); for (const p of c) paragraph(p, td); if (!td.childNodes.length) td.append(document.createElement('br')); tr.append(td); }
      // consecutive rows share one table
      const prev = root.lastElementChild;
      if (prev && prev.classList.contains('od-table-wrap')) prev.querySelector('table').append(tr);
      else { table.append(tr); wrap.append(table); root.append(wrap); }
    } else if (b.picture) {
      const pic = b.picture;
      if (pic.format && pic.format !== 'unsupported' && pic.hex) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(new Blob([hexToBytes(pic.hex)], { type: pic.format }));
        img.alt = '';
        const wrap = document.createElement('p');
        wrap.append(img);
        root.append(wrap);
      } else {
        unsupported.picture++;
        const p = document.createElement('p');
        p.append(Object.assign(document.createElement('span'), { className: 'od-missing', textContent: t('Picture not shown') }));
        root.append(p);
      }
    } else paragraph(b, root);
  }
  return { root, outline: [], comments: [], unsupported };
}
