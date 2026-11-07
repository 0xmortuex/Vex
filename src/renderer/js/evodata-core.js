// === Datasets kept from page tables: the pure part ==============================
//
// Nothing here touches the disk, the DOM or the network: it is plain functions on plain values, so every cap and rule
// can be tested on its own. Main (src/main/evodata-datasets-store.js) keeps the files and the window
// (js/kept-datasets.js) draws the screens; both load this one file.
//
//   datasets   50 of them, 5,000 rows and 5 MB each. A full dataset REFUSES more rows; it never drops old ones.
//
// A spreadsheet runs a cell that starts with = + - or @ as a formula, so a CSV export puts a quote mark in front of
// any such cell (csvCell); a plain number such as -12.5 is left alone because it is not a formula.
(function (root) {
  'use strict';

  const LIMITS = { datasets: 50, rows: 5000, bytes: 5 * 1024 * 1024, cell: 2000, columns: 100, nameChars: 80 };

  const str = (v) => String(v == null ? '' : v);
  const clipTo = (v, n) => str(v).slice(0, n);
  const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const DOTLESS = new RegExp(String.fromCharCode(0x131), 'g');
  // Turkish-aware key for "is this the same value": case (I and i, dotted and dotless), spaces.
  function key(v) {
    return str(v).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  }
  // For search when VexTr is not around (tests, main): the folding VexTr.fold does, in short: case, accents, dotless i.
  function fold(v) {
    return str(v).normalize('NFD').replace(MARKS, '').toLocaleLowerCase('tr-TR').replace(DOTLESS, 'i');
  }

  // ---- numbers -------------------------------------------------------------------
  // "1,234.56", "1.234,56", "12,50", "45%" -> a number, or null when it is not one.
  // A lone separator followed by exactly three digits (and not a leading zero) is read as thousands
  // ("1.234" is 1234); anything else with a lone separator is a decimal point ("12,5" is 12.5). Repeated separators
  // must be proper thousands groups, so a date such as 12.05.2024 is not a number.
  function parseNumber(v) {
    let s = str(v).trim();
    if (!s || s.length > 40) return null;
    s = s.replace(/[\s\xa0$%]/g, '').replace(/[€\xa3₺\xa5]/g, '').replace(/(?:TL|TRY|USD|EUR|GBP)$/i, '');
    if (!/^[+-]?[\d.,]*\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;
    const sign = s[0] === '-' ? -1 : 1;
    s = s.replace(/^[+-]/, '');
    const dots = (s.match(/\./g) || []).length, commas = (s.match(/,/g) || []).length;
    const groups = (text, sep) => new RegExp('^\\d{1,3}(?:\\' + sep + '\\d{3})*$').test(text);
    let digits;
    if (dots && commas) {
      // Both: the last one is the decimal point, the other must be proper thousands groups ("1.234,56").
      const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      const thousands = dec === '.' ? ',' : '.';
      const at = s.lastIndexOf(dec);
      const whole = s.slice(0, at), frac = s.slice(at + 1);
      if (!groups(whole, thousands) || !/^\d+$/.test(frac)) return null;
      digits = whole.split(thousands).join('') + '.' + frac;
    } else if (dots + commas > 1) {
      const sep = dots ? '.' : ',';
      if (!groups(s, sep)) return null;
      digits = s.split(sep).join('');
    } else if (dots + commas === 1) {
      const sep = dots ? '.' : ',';
      const [before, after] = s.split(sep);
      const thousands = after.length === 3 && before.length >= 1 && before.length <= 3 && before[0] !== '0';
      digits = thousands ? before + after : before + '.' + after;
    } else digits = s;
    const n = Number(digits);
    return Number.isFinite(n) ? sign * n : null;
  }

  // ---- datasets ------------------------------------------------------------------
  function cleanCell(c) {
    return clipTo(str(c).replace(/\s+/g, ' ').trim(), LIMITS.cell);
  }

  // The rows a page gave, made safe to keep: an array of arrays of short strings, at most `columns` wide.
  function cleanRows(rows) {
    if (!Array.isArray(rows)) throw new Error('There are no rows to keep');
    return rows.filter(Array.isArray).map(r => r.slice(0, LIMITS.columns).map(cleanCell));
  }

  function rowBytes(row) { return JSON.stringify(row).length + 1; }

  // Is the first row a header? Only when every cell has words (no blanks, no repeats, no numbers) and a body follows.
  function looksLikeHeader(first, rest) {
    if (!first || !first.length || !rest.length) return false;
    if (first.some(c => cleanCell(c) === '')) return false;
    if (new Set(first.map(key)).size !== first.length) return false;
    return !first.some(c => parseNumber(c) !== null);
  }

  // Column names that are never blank and never repeat ("Price", "Price (2)").
  function uniqueNames(names, width) {
    const seen = new Set(), out = [];
    for (let i = 0; i < width; i++) {
      const base = cleanCell(names[i] == null ? '' : names[i]).slice(0, LIMITS.nameChars) || 'Column ' + (i + 1);
      let name = base, n = 2;
      while (seen.has(key(name))) name = base + ' (' + n++ + ')';
      seen.add(key(name));
      out.push(name);
    }
    return out;
  }

  const fit = (row, width) => (row.length >= width ? row.slice(0, width) : row.concat(Array(width - row.length).fill('')));

  function columnType(values) {
    const filled = values.filter(v => v !== '');
    return filled.length && filled.every(v => parseNumber(v) !== null) ? 'number' : 'text';
  }

  // rows (as read from a page) -> { columns: [{ name, type }], body: rows of exactly columns.length strings, header }.
  // header: 'auto' (decide from the first row), true or false.
  function inferColumns(rows, { header = 'auto' } = {}) {
    const all = cleanRows(rows);
    if (!all.length) throw new Error('There are no rows to keep');
    const width = Math.max(1, all.reduce((w, r) => Math.max(w, r.length), 0));
    const padded = all.map(r => fit(r, width));
    const useHeader = header === 'auto' ? looksLikeHeader(padded[0], padded.slice(1)) : header === true;
    const names = uniqueNames(useHeader ? padded[0] : [], width);
    const body = useHeader ? padded.slice(1) : padded;
    const columns = names.map((name, i) => ({ name, type: columnType(body.map(r => r[i])) }));
    return { columns, body, header: useHeader };
  }

  function keyIndex(columns, keyColumn) {
    if (keyColumn == null || keyColumn === '') return -1;
    const k = key(keyColumn);
    const i = columns.findIndex(c => key(c.name) === k);
    if (i < 0) throw new Error('There is no column called "' + clipTo(keyColumn, 80) + '"');
    return i;
  }

  function datasetBytes(dataset) {
    let n = 0;
    for (const r of dataset.rows) n += rowBytes(r);
    return n;
  }

  // Keep only the rows that fit under the row and byte caps. -> { rows, dropped }
  function fitCaps(existingRows, existingBytes, incoming) {
    const rows = [];
    let bytes = existingBytes;
    let dropped = 0;
    for (const r of incoming) {
      const b = rowBytes(r);
      if (existingRows + rows.length >= LIMITS.rows || bytes + b > LIMITS.bytes) { dropped++; continue; }
      rows.push(r); bytes += b;
    }
    return { rows, dropped };
  }

  // The identity of a row for the de-dupe: its key cell, or (no key column) the whole row. A blank key cell has no
  // identity (null): such rows are always added, because nothing says they are the same row.
  function rowIdentity(row, k) {
    if (k >= 0) { const v = key(row[k]); return v === '' ? null : v; }
    return row.map(key).join('\x01');
  }

  // The page a dataset came from, as an address without a sign-in part or a #fragment (or '' when it is not a web address).
  function cleanUrl(url) {
    let u;
    try { u = new URL(str(url)); } catch { return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.username = ''; u.password = ''; u.hash = '';
    return u.href.slice(0, 500);
  }

  // A new dataset from a page's rows. Throws on a name that is empty and on a key column that does not exist.
  // allowEmpty: a dataset that starts with only its header (the one a page watch fills).
  // -> { dataset, duplicates, capped }
  function createDataset({ name, rows, header = 'auto', keyColumn = null, source = null, watchId = null, allowEmpty = false, id, now = Date.now() }) {
    const title = clipTo(str(name).replace(/\s+/g, ' ').trim(), LIMITS.nameChars);
    if (!title) throw new Error('A dataset needs a name');
    const { columns, body } = inferColumns(rows, { header });
    const k = keyIndex(columns, keyColumn);
    // The same de-dupe as an append, so a table that lists a row twice is kept once.
    const seen = new Set(), unique = [];
    for (const r of body) {
      const identity = rowIdentity(r, k);
      if (identity !== null) { if (seen.has(identity)) continue; seen.add(identity); }
      unique.push(r);
    }
    const fitted = fitCaps(0, 0, unique);
    if (!fitted.rows.length && !(allowEmpty && !body.length)) throw new Error('That table is too large to keep (a dataset holds at most ' + LIMITS.rows + ' rows and 5 MB)');
    const src = source && typeof source === 'object' ? { url: cleanUrl(source.url), title: clipTo(source.title, 200) } : null;
    const dataset = {
      v: 1, id: str(id), name: title, columns, keyColumn: k >= 0 ? columns[k].name : null,
      rows: fitted.rows, source: src, watchId: watchId ? clipTo(watchId, 80) : null,
      createdAt: now, updatedAt: now,
    };
    return { dataset, duplicates: body.length - unique.length, capped: fitted.dropped };
  }

  // Add rows to a dataset. Pure: returns a new dataset. Rows whose key is already there are skipped, the
  // page's header row is skipped when it comes again, and a full dataset refuses the rest (`capped`).
  // keyColumn: undefined keeps the dataset's own key; a name sets it; '' or null clears it (whole-row de-dupe).
  // -> { dataset, added, skipped, capped }
  function appendRows(dataset, rows, { keyColumn, now = Date.now() } = {}) {
    const cols = dataset.columns;
    const width = cols.length;
    let k = keyIndex(cols, dataset.keyColumn);
    let keyName = dataset.keyColumn || null;
    if (keyColumn !== undefined) { k = keyIndex(cols, keyColumn); keyName = k >= 0 ? cols[k].name : null; }
    const incoming = cleanRows(rows).map(r => fit(r, width));
    const headerKey = cols.map(c => key(c.name)).join('\x01');
    const seen = new Set();
    for (const r of dataset.rows) { const i = rowIdentity(r, k); if (i !== null) seen.add(i); }
    const fresh = [];
    let skipped = 0;
    for (const r of incoming) {
      if (r.map(key).join('\x01') === headerKey) { skipped++; continue; }
      const i = rowIdentity(r, k);
      if (i !== null) { if (seen.has(i)) { skipped++; continue; } seen.add(i); }
      fresh.push(r);
    }
    const fitted = fitCaps(dataset.rows.length, datasetBytes(dataset), fresh);
    const next = { ...dataset, keyColumn: keyName, rows: dataset.rows.concat(fitted.rows), updatedAt: now };
    next.columns = cols.map((c, i) => ({ name: c.name, type: columnType(next.rows.map(r => r[i])) }));
    return { dataset: next, added: fitted.rows.length, skipped, capped: fitted.dropped };
  }

  // ---- exports -------------------------------------------------------------------
  const FORMULA_START = /^[=+\-@\t\r]/;
  const PLAIN_NUMBER = /^[+-]?\d[\d.,]*$/;
  // One CSV field. A cell that a spreadsheet would run as a formula gets a leading ' (the OWASP advice), then the
  // field is quoted when it holds the delimiter, a quote or a line break.
  function csvCell(v, delimiter = ',') {
    let s = str(v);
    if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
    return s.includes(delimiter) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // delimiter ',' or ';' (Excel on a Turkish Windows reads ; as the column break). Lines end \r\n. No BOM here.
  function toCsv(columns, rows, { delimiter = ',' } = {}) {
    if (delimiter !== ',' && delimiter !== ';') throw new Error('The delimiter is a comma or a semicolon');
    const line = (cells) => cells.map(c => csvCell(c, delimiter)).join(delimiter);
    return [line(columns.map(c => c.name))].concat(rows.map(line)).join('\r\n') + '\r\n';
  }
  // What goes in the file: UTF-8 with a byte-order mark (written as U+FEFF), so Excel reads Turkish letters right.
  function toCsvFile(columns, rows, opts) { return String.fromCharCode(0xFEFF) + toCsv(columns, rows, opts); }

  function toJson(dataset, now = Date.now()) {
    const names = dataset.columns.map(c => c.name);
    return JSON.stringify({
      name: dataset.name, source: dataset.source, exportedAt: new Date(now).toISOString(), columns: dataset.columns,
      rows: dataset.rows.map(r => Object.fromEntries(names.map((n, i) => [n, r[i]]))),
    }, null, 2);
  }

  // ---- viewing: filter and sort (the window passes VexTr's fold and compare) --------
  // -> row indexes into dataset.rows, in display order. A blank always sorts last, whichever way it goes.
  function view(dataset, { filter = '', sortColumn = -1, descending = false, foldFn = fold, compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0) } = {}) {
    const terms = foldFn(filter).split(/\s+/).filter(Boolean);
    let idx = dataset.rows.map((_, i) => i);
    if (terms.length) {
      idx = idx.filter(i => { const hay = foldFn(dataset.rows[i].join(' ')); return terms.every(t => hay.includes(t)); });
    }
    if (sortColumn >= 0 && sortColumn < dataset.columns.length) {
      const numeric = dataset.columns[sortColumn].type === 'number';
      const val = (i) => dataset.rows[i][sortColumn];
      idx.sort((a, b) => {
        const x = val(a), y = val(b);
        if (x === '' && y === '') return a - b;
        if (x === '') return 1;
        if (y === '') return -1;
        const c = numeric ? (parseNumber(x) || 0) - (parseNumber(y) || 0) : compare(x, y);
        return (descending ? -c : c) || a - b;
      });
    }
    return idx;
  }

  const api = {
    LIMITS, key, fold, parseNumber, cleanRows, looksLikeHeader, uniqueNames, inferColumns, columnType,
    createDataset, appendRows, datasetBytes, rowIdentity, csvCell, toCsv, toCsvFile, toJson, view,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VexEvoCore = api;
})(typeof window !== 'undefined' ? window : null);
