// The viewer's worker: opens the package (a zip), keeps it, hands parts out on request, and reads a workbook's sheets.
// Opening and inflating happen here so a big document never freezes the page. Classic worker (importScripts), served from
// the viewer's own origin; it has no network of its own (the page's policy) and no DOM.
/* global fflate, OfficeZipInfo, OfficeXlsx */
importScripts('/lib/fflate.js', '/app/zipinfo.js', '/app/xlsx-core.js');

let bytes = null;          // the package, as it came
let directory = null;      // OfficeZipInfo.readDirectory result
let names = null;          // Set of part names
let book = null;           // workbook model while a spreadsheet is open
let shared = null;

const utf8 = new TextDecoder('utf-8');

function inflate(want) {
  const filter = (f) => want.has(f.name);
  return fflate.unzipSync(bytes, { filter });
}
const text = (name) => {
  if (!names.has(name)) return '';
  const part = inflate(new Set([name]))[name];
  return part ? utf8.decode(part).replace(/^﻿/, '') : '';
};

function fail(id, error) {
  self.postMessage({ id, ok: false, code: error.code || 'error', error: error.message || String(error) });
}

self.onmessage = (event) => {
  const m = event.data;
  try {
    switch (m.op) {
      case 'open': {
        bytes = new Uint8Array(m.buffer);
        directory = OfficeZipInfo.readDirectory(bytes);
        names = new Set(directory.entries.map((e) => e.name));
        self.postMessage({ id: m.id, ok: true, names: [...names], encrypted: directory.encrypted, total: directory.total });
        break;
      }
      case 'read': {
        // { names: [..], as: 'text' | 'bytes' }  ->  { parts: { name: string | ArrayBuffer } }
        const want = new Set(m.names.filter((n) => names.has(n)));
        const got = want.size ? inflate(want) : {};
        const parts = {}, transfer = [];
        for (const name of want) {
          const u8 = got[name];
          if (!u8) continue;
          if (m.as === 'text') parts[name] = utf8.decode(u8).replace(/^﻿/, '');
          else { const copy = u8.slice().buffer; parts[name] = copy; transfer.push(copy); }
        }
        self.postMessage({ id: m.id, ok: true, parts }, transfer);
        break;
      }
      case 'xlsx-open': {
        const zip = { has: (n) => names.has(n), text };
        book = OfficeXlsx.parseWorkbook(zip);
        shared = OfficeXlsx.parseSharedStrings(text('xl/sharedStrings.xml'));
        const styles = book.styles;
        self.postMessage({ id: m.id, ok: true, sheets: book.sheets, date1904: book.date1904, styles, macros: book.macros });
        break;
      }
      case 'xlsx-sheet': {
        const info = book && book.sheets[m.index];
        if (!info) throw new Error('There is no such sheet');
        const xml = text(info.path);
        if (!xml) throw Object.assign(new Error('The sheet "' + info.name + '" is missing from the file'), { code: 'corrupt' });
        const sheet = OfficeXlsx.parseSheet(xml, shared);
        self.postMessage({ id: m.id, ok: true, sheet });
        break;
      }
      case 'close': {
        bytes = directory = names = book = shared = null;
        self.postMessage({ id: m.id, ok: true });
        break;
      }
      default: throw new Error('Unknown request ' + m.op);
    }
  } catch (error) { fail(m.id, error); }
};
