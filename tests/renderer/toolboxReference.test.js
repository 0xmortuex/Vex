// The written reference panel for pack tools.
//
// It lives apart from the packs (js/toolbox-reference.js, keyed by tool id), so
// the thing most likely to rot is the link between the two: an id renamed in a
// pack leaves an entry here pointing at nothing, and it fails silently — the
// panel just shows less. These tests keep the keys honest and the shape valid.
const fs = require('fs');
const path = require('path');
import { describe, it, expect } from 'vitest';

const SRC = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');

function loadModule(file) {
  const mod = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(SRC, file), 'utf8'))(mod, mod.exports);
  return mod.exports;
}

function allPackTools() {
  return fs.readdirSync(SRC)
    .filter(f => /^toolbox-pack-.*\.js$/.test(f))
    .flatMap(f => {
      const pack = loadModule(f);
      return (Array.isArray(pack) ? pack : (pack.tools || [])).map(t => ({ ...t, file: f }));
    });
}

const REF = loadModule('toolbox-reference.js');
const TOOLS = allPackTools();

describe('toolbox reference', () => {
  it('loads and exports an object', () => {
    expect(REF && typeof REF).toBe('object');
    expect(Object.keys(REF).length).toBeGreaterThan(250);
  });

  it('every key names a real pack tool', () => {
    const ids = new Set(TOOLS.map(t => t.id));
    const unknown = Object.keys(REF).filter(k => !ids.has(k));
    expect(unknown).toEqual([]);
  });

  it('every pack tool has a reference, here or in its own spec', () => {
    const missing = TOOLS
      .filter(t => !REF[t.id] && !(Array.isArray(t.details) && t.details.length))
      .map(t => `${t.id} (${t.file})`);
    expect(missing).toEqual([]);
  });

  it('every section is a usable shape', () => {
    const bad = [];
    for (const [id, sections] of Object.entries(REF)) {
      if (!Array.isArray(sections) || !sections.length) { bad.push(`${id}: not a non-empty array`); continue; }
      for (const s of sections) {
        if (!s || typeof s.title !== 'string' || !s.title.trim()) { bad.push(`${id}: section without a title`); continue; }
        // A section says something either as prose or as a table, never neither.
        const hasText = typeof s.text === 'string' && s.text.trim().length > 0;
        const hasRows = Array.isArray(s.rows) && s.rows.length > 0;
        if (!hasText && !hasRows) bad.push(`${id} / ${s.title}: empty`);
        if (hasRows && s.rows.some(r => !Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'string' || typeof r[1] !== 'string')) {
          bad.push(`${id} / ${s.title}: a row is not a [string, string] pair`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('says something substantial rather than restating the name', () => {
    const thin = Object.entries(REF)
      .filter(([, sections]) => {
        const words = sections.reduce((n, s) => n + String(s.text || '').split(/\s+/).filter(Boolean).length, 0);
        const rows = sections.reduce((n, s) => n + (s.rows || []).length, 0);
        return words < 25 && rows < 3;
      })
      .map(([id]) => id);
    expect(thin).toEqual([]);
  });

  it('is exposed on window for the renderer to read', () => {
    const code = fs.readFileSync(path.join(SRC, 'toolbox-reference.js'), 'utf8');
    expect(code).toMatch(/window\.VexToolReference\s*=/);
  });

  it('is loaded by index.html before the packs that use it', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html'), 'utf8');
    const ref = html.indexOf('js/toolbox-reference.js');
    const firstPack = html.indexOf('js/toolbox-pack-');
    expect(ref).toBeGreaterThan(-1);
    expect(ref).toBeLessThan(firstPack);
  });
});
