// An .xlsx workbook read into a plain data model. Runs inside the viewer's worker (no DOM there), so it reads the XML with
// small scanners instead of a DOM parser. Plain script: the worker loads it with importScripts, the tests require it.
//
// Nothing here evaluates a formula. A cell shows the result the file saved with it; the formula text is kept beside it for the
// "show formulas" switch. Nothing here follows a link or runs a macro (a macro-enabled workbook is read like any other and
// the viewer says it has macros it will not run).
//
// Model of one sheet:
//   { rows: [ [cell|null, ...] | undefined, ... ],   // rows[r][c] ; cell = [value, type, style, formula]
//     type: 'n' number | 's' text | 'b' boolean | 'e' error ; style: index into workbook.styles
//     colWidths: { [c]: px }, rowHeights: { [r]: px }, hiddenCols: [c], hiddenRows: [r], merges: [{r1,c1,r2,c2}],
//     freeze: { rows, cols }, filter: 'A1:D10' | null, maxRow, maxCol, cells, truncated }
(function (root) {
  'use strict';

  const MAX_CELLS = 1200000;
  const MAX_COLS = 16384;

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function unescapeXml(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
      return ENT[e.toLowerCase()];
    }).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
  }

  function attrs(str) {
    const out = {};
    const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(str))) out[m[1]] = unescapeXml(m[2] != null ? m[2] : m[3]);
    return out;
  }

  const colToIndex = (letters) => { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64); return n - 1; };
  const indexToCol = (c) => { let s = ''; c += 1; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  function parseRef(ref) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref || '');
    return m ? { r: parseInt(m[2], 10) - 1, c: colToIndex(m[1].toUpperCase()) } : null;
  }
  function parseRange(ref) {
    const [a, b] = String(ref || '').split(':');
    const p = parseRef(a), q = b ? parseRef(b) : p;
    return p && q ? { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) } : null;
  }

  // ---- the shared strings ---------------------------------------------------
  function parseSharedStrings(xml) {
    const out = [];
    if (!xml) return out;
    const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
    let m;
    while ((m = re.exec(xml))) {
      const inner = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
      let text = '';
      const t = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
      let k;
      while ((k = t.exec(inner))) text += k[1] || '';
      out.push(unescapeXml(text));
    }
    return out;
  }

  // ---- styles ---------------------------------------------------------------
  const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
  const INDEXED = { 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 14: 'FF00FF', 15: '00FFFF', 64: '000000' };
  function tint(hex, amount) {
    const n = parseInt(hex, 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount));
    return ch.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }
  function colorOf(a) {
    if (!a) return null;
    if (a.rgb && /^[0-9a-f]{8}$/i.test(a.rgb)) return a.rgb.slice(2).toLowerCase();
    if (a.rgb && /^[0-9a-f]{6}$/i.test(a.rgb)) return a.rgb.toLowerCase();
    if (a.theme != null && THEME[+a.theme]) { const base = THEME[+a.theme]; return (a.tint ? tint(base, +a.tint) : base).toLowerCase(); }
    if (a.indexed != null && INDEXED[+a.indexed]) return INDEXED[+a.indexed].toLowerCase();
    return null;
  }
  function blocks(xml, tag) {
    const out = [];
    const re = new RegExp('<' + tag + '\\b([^>]*?)(?:/>|>([\\s\\S]*?)</' + tag + '>)', 'g');
    let m;
    while ((m = re.exec(xml))) out.push({ a: attrs(m[1]), body: m[2] || '' });
    return out;
  }
  function section(xml, tag) {
    const m = new RegExp('<' + tag + '\\b[^>]*?(?:/>|>([\\s\\S]*?)</' + tag + '>)').exec(xml);
    return m ? m[1] || '' : '';
  }
  function parseStyles(xml) {
    const out = { styles: [{}], formats: {} };
    if (!xml) return out;
    for (const f of blocks(section(xml, 'numFmts'), 'numFmt')) out.formats[f.a.numFmtId] = f.a.formatCode;
    const fonts = blocks(section(xml, 'fonts'), 'font').map((f) => {
      const color = /<color\b([^>]*)\/?>/.exec(f.body);
      return { b: /<b\b(?![a-z])(?![^>]*val="(?:0|false)")/.test(f.body), i: /<i\b(?![a-z])(?![^>]*val="(?:0|false)")/.test(f.body), u: /<u\b/.test(f.body), color: color ? colorOf(attrs(color[1])) : null };
    });
    const fills = blocks(section(xml, 'fills'), 'fill').map((f) => {
      const pat = /<patternFill\b([^>]*)>/.exec(f.body);
      if (!pat || attrs(pat[1]).patternType !== 'solid') return null;
      const fg = /<fgColor\b([^>]*)\/?>/.exec(f.body);
      return fg ? colorOf(attrs(fg[1])) : null;
    });
    const seen = new Map();
    out.styles = [];
    for (const xf of blocks(section(xml, 'cellXfs'), 'xf')) {
      const font = fonts[+xf.a.fontId] || {};
      const al = /<alignment\b([^>]*)\/?>/.exec(xf.body);
      const align = al ? attrs(al[1]) : {};
      const s = {};
      const id = +xf.a.numFmtId || 0;
      if (id) s.nf = Object.prototype.hasOwnProperty.call(out.formats, id) ? out.formats[id] : id;
      if (font.b) s.b = 1;
      if (font.i) s.i = 1;
      if (font.u) s.u = 1;
      if (font.color && font.color !== '000000') s.color = font.color;
      const fill = fills[+xf.a.fillId];
      if (fill && fill !== 'ffffff') s.fill = fill;
      if (align.horizontal && align.horizontal !== 'general') s.al = align.horizontal;
      if (align.wrapText === '1' || align.wrapText === 'true') s.wrap = 1;
      const key = JSON.stringify(s);
      if (!seen.has(key)) seen.set(key, seen.size);
      out.styles.push(s);
    }
    if (!out.styles.length) out.styles.push({});
    return out;
  }

  // ---- shared formulas: the child shows the master's text moved by its offset ----
  function shiftFormula(formula, dr, dc) {
    if (!dr && !dc) return formula;
    let out = '', i = 0;
    while (i < formula.length) {
      const ch = formula[i];
      if (ch === '"' || ch === "'") {
        const q = ch;
        let j = i + 1;
        while (j < formula.length && !(formula[j] === q && formula[j + 1] !== q)) j += formula[j] === q ? 2 : 1;
        out += formula.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/.exec(formula.slice(i, i + 12));
      const prev = i > 0 ? formula[i - 1] : '';
      if (m && !/[A-Za-z0-9_.]/.test(prev)) {
        let col = colToIndex(m[2]), row = parseInt(m[4], 10);
        if (!m[1]) col += dc;
        if (!m[3]) row += dr;
        out += m[1] + (col >= 0 ? indexToCol(col) : '#REF!') + m[3] + (row >= 1 ? row : '#REF!');
        i += m[0].length;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  // ---- workbook -------------------------------------------------------------
  // zip: { has(name), text(name) } . Returns { sheets: [{ name, path, state }], date1904, sharedCount, styles, macros }
  function parseWorkbook(zip) {
    const wbXml = zip.text('xl/workbook.xml');
    if (!wbXml) throw Object.assign(new Error('This package has no workbook'), { code: 'corrupt' });
    const rels = {};
    const relsXml = zip.text('xl/_rels/workbook.xml.rels') || '';
    for (const r of blocks(relsXml, 'Relationship')) {
      let target = r.a.Target || '';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      rels[r.a.Id] = target.replace(/[^/]+\/\.\.\//g, '');
    }
    const sheets = [];
    for (const s of blocks(section(wbXml, 'sheets'), 'sheet')) {
      const path = rels[s.a['r:id']];
      if (path) sheets.push({ name: s.a.name || 'Sheet' + (sheets.length + 1), path, state: s.a.state || 'visible' });
    }
    const pr = /<workbookPr\b([^>]*)\/?>/.exec(wbXml);
    const date1904 = !!(pr && /date1904="(?:1|true)"/.test(pr[1]));
    const st = parseStyles(zip.text('xl/styles.xml'));
    return { sheets, date1904, styles: st.styles, macros: zip.has('xl/vbaProject.bin') };
  }

  // ---- one sheet --------------------------------------------------------------
  function parseSheet(xml, shared) {
    const sheet = {
      rows: [], colWidths: {}, rowHeights: {}, hiddenCols: [], hiddenRows: [], merges: [], freeze: { rows: 0, cols: 0 },
      filter: null, maxRow: 0, maxCol: 0, cells: 0, truncated: false, defaultCol: null, defaultRow: null,
    };
    const fmt = /<sheetFormatPr\b([^>]*)\/?>/.exec(xml);
    if (fmt) {
      const a = attrs(fmt[1]);
      if (a.defaultColWidth) sheet.defaultCol = Math.round(+a.defaultColWidth * 7 + 5);
      if (a.defaultRowHeight) sheet.defaultRow = Math.round(+a.defaultRowHeight * 4 / 3);
    }
    for (const c of blocks(section(xml, 'cols'), 'col')) {
      const min = (+c.a.min || 1) - 1, max = Math.min((+c.a.max || min + 1) - 1, MAX_COLS - 1);
      const w = c.a.width != null ? Math.round(+c.a.width * 7 + 5) : null;
      for (let k = min; k <= max && k - min < 2000; k++) {
        if (w != null) sheet.colWidths[k] = w;
        if (c.a.hidden === '1' || c.a.hidden === 'true') sheet.hiddenCols.push(k);
      }
    }
    const pane = /<pane\b([^>]*)\/?>/.exec(xml);
    if (pane) {
      const a = attrs(pane[1]);
      if (a.state === 'frozen' || a.state === 'frozenSplit') sheet.freeze = { rows: Math.round(+a.ySplit || 0), cols: Math.round(+a.xSplit || 0) };
    }
    for (const m of blocks(section(xml, 'mergeCells'), 'mergeCell')) { const r = parseRange(m.a.ref); if (r && (r.r2 > r.r1 || r.c2 > r.c1)) sheet.merges.push(r); }
    const af = /<autoFilter\b([^>]*)\/?>/.exec(xml);
    if (af) sheet.filter = attrs(af[1]).ref || null;

    const shares = new Map();     // si -> { f, r, c }
    const data = section(xml, 'sheetData');
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rm, autoRow = 0;
    while ((rm = rowRe.exec(data))) {
      const ra = attrs(rm[1]);
      const r = ra.r ? parseInt(ra.r, 10) - 1 : autoRow;
      autoRow = r + 1;
      if (ra.ht && (ra.customHeight === '1' || ra.customHeight === 'true' || +ra.ht > 0)) sheet.rowHeights[r] = Math.round(+ra.ht * 4 / 3);
      if (ra.hidden === '1' || ra.hidden === 'true') sheet.hiddenRows.push(r);
      if (!rm[2]) continue;
      if (sheet.truncated) continue;
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm, autoCol = 0, row = null;
      while ((cm = cellRe.exec(rm[2]))) {
        const ca = attrs(cm[1]);
        let c;
        if (ca.r) { const p = parseRef(ca.r); c = p ? p.c : autoCol; } else c = autoCol;
        autoCol = c + 1;
        if (c >= MAX_COLS) continue;
        const body = cm[2] || '';
        let v = null, f;
        const vm = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(body);
        const raw = vm ? unescapeXml(vm[1] || '') : null;
        const t = ca.t || 'n';
        let type = 'n';
        if (t === 's') { v = raw != null ? shared[+raw] : ''; type = 's'; if (v == null) v = ''; }
        else if (t === 'str') { v = raw == null ? '' : raw; type = 's'; }
        else if (t === 'inlineStr') {
          let text = '';
          const tt = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
          let k;
          while ((k = tt.exec(body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')))) text += k[1] || '';
          v = unescapeXml(text); type = 's';
        } else if (t === 'b') { v = raw === '1' || raw === 'true'; type = 'b'; }
        else if (t === 'e') { v = raw || '#VALUE!'; type = 'e'; }
        else if (t === 'd') { v = raw; type = 's'; }
        else if (raw != null && raw !== '') { v = Number(raw); if (!Number.isFinite(v)) { v = raw; type = 's'; } }
        const fm = /<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
        if (fm) {
          const fa = attrs(fm[1]);
          let text = fm[2] != null ? unescapeXml(fm[2]) : '';
          if (fa.t === 'shared' && fa.si != null) {
            if (text) shares.set(fa.si, { f: text, r, c });
            else if (shares.has(fa.si)) { const base = shares.get(fa.si); text = shiftFormula(base.f, r - base.r, c - base.c); }
          }
          if (text) f = text;
        }
        if (v === null && !f && ca.s == null) continue;
        if (v === null && !f) { /* a styled empty cell: kept for its fill */ }
        if (!row) { row = sheet.rows[r] || (sheet.rows[r] = []); }
        const cell = [v, type, ca.s != null ? +ca.s : 0];
        if (f) cell.push(f);
        row[c] = cell;
        if (v !== null || f) { sheet.cells++; if (r + 1 > sheet.maxRow) sheet.maxRow = r + 1; if (c + 1 > sheet.maxCol) sheet.maxCol = c + 1; }
        else if (c + 1 > sheet.maxCol && ca.s != null) { sheet.maxCol = Math.max(sheet.maxCol, c + 1); if (r + 1 > sheet.maxRow) sheet.maxRow = r + 1; }
        if (sheet.cells >= MAX_CELLS) { sheet.truncated = true; break; }
      }
    }
    // Holes in a row become null so the page can index it freely.
    for (const row of sheet.rows) if (row) for (let c = 0; c < row.length; c++) if (row[c] === undefined) row[c] = null;
    return sheet;
  }

  const api = { parseWorkbook, parseSheet, parseSharedStrings, parseStyles, shiftFormula, unescapeXml, attrs, indexToCol, colToIndex, parseRef, parseRange, MAX_CELLS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OfficeXlsx = api;
})(typeof self !== 'undefined' ? self : globalThis);
