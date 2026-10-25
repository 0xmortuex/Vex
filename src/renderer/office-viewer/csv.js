// A comma, semicolon or tab separated text read into the same sheet model a workbook gives, so the grid shows it. Quoted values,
// doubled quotes and line breaks inside quotes are understood; a value that is only a plain number is a number.

export function detectDelimiter(text) {
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 8);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = head.map((l) => l.split(d).length - 1).filter((n, i) => i < head.length && head[i] !== '');
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.every((n) => n === counts[0]);
    const score = counts[0] + (consistent ? 1000 : 0);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

const MAX_CELLS = 1200000;
export function parseCsv(text, delimiter) {
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [], field = '', quoted = false, i = 0, cells = 0, truncated = false, maxCol = 0, started = false;
  const n = text.length;
  const push = () => {
    row.push(field); field = '';
  };
  const endRow = () => {
    push();
    if (row.length === 1 && row[0] === '' && !started) { row = []; return; }
    const r = row.map((v) => {
      if (v === '') return null;
      if (/^-?\d{1,15}(?:\.\d+)?$/.test(v) && !/^0\d/.test(v)) return [Number(v), 'n', 0];
      return [v, 's', 0];
    });
    maxCol = Math.max(maxCol, r.length);
    cells += r.length;
    rows.push(r);
    row = [];
    started = false;
  };
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; started = true; i++; continue; }
    if (ch === d) { push(); started = true; i++; continue; }
    if (ch === '\r') { i++; if (text[i] === '\n') i++; endRow(); if (cells >= MAX_CELLS) { truncated = true; break; } continue; }
    if (ch === '\n') { i++; endRow(); if (cells >= MAX_CELLS) { truncated = true; break; } continue; }
    field += ch; started = true; i++;
  }
  if (!truncated && (field !== '' || row.length)) endRow();
  for (const r of rows) for (let c = 0; c < r.length; c++) if (r[c] === undefined) r[c] = null;
  return {
    delimiter: d,
    sheet: { rows, colWidths: {}, rowHeights: {}, hiddenCols: [], hiddenRows: [], merges: [], freeze: { rows: 0, cols: 0 }, filter: null, maxRow: rows.length, maxCol, cells, truncated, defaultCol: null, defaultRow: null },
  };
}
