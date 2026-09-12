// @vitest-environment jsdom
//
// Vex's modules are declared as top-level `const` in classic scripts. That
// makes them visible to other classic scripts as bare identifiers, but it does
// NOT make them properties of `window` — a lexical global is not a window
// property. So `window.SidebarManager?.showPanel?.('notes')` is always
// undefined, optional chaining swallows it, and nothing happens.
//
// That is exactly what broke "All Sticky Notes": the panel never opened, and
// because the helper still returned true, the modal fallback never ran either.
// Clicking it — from Ctrl+K or from Discover — did nothing whatsoever, with no
// error to notice.
//
// This guards the pattern rather than the one instance.

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');

// Names a module publishes on window explicitly (window.X = X).
function publishedOnWindow() {
  const published = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/window\.([A-Z][A-Za-z0-9_]*)\s*=\s*[A-Za-z_]/g)) published.add(m[1]);
  }
  return published;
}

// Names declared as a bare top-level const.
function lexicalGlobals() {
  const declared = new Set();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/^const ([A-Z][A-Za-z0-9_]*)\s*=/gm)) declared.add(m[1]);
  }
  return declared;
}

describe('reaching a module through window.*', () => {
  const published = publishedOnWindow();
  const lexical = lexicalGlobals();

  it('no module is used as window.X unless it is actually put there', () => {
    const offenders = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(/window\.([A-Z][A-Za-z0-9_]*)\s*(?:\?\.|\.[a-z])/g)) {
          const name = m[1];
          // Only our own modules matter; browser globals (CSS, HTMLInputElement) are real.
          if (!lexical.has(name)) continue;
          if (published.has(name)) continue;
          // A guarded read that falls back to the bare identifier is fine —
          // email-code-autofill does this deliberately and documents why.
          if (/typeof\s+[A-Z][A-Za-z0-9_]*\s*!==\s*'undefined'/.test(line)) continue;
          offenders.push(`${file}:${i + 1}  window.${name} — declared as a bare const, so this is always undefined`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    // Walks every source file, so it is I/O-bound and slower than the 5s
    // default once the whole suite runs in parallel.
  }, 30000);

  it('the two modules this caught are reached without window', () => {
    const notes = fs.readFileSync(path.join(dir, 'notes-panel.js'), 'utf8');
    const persona = fs.readFileSync(path.join(dir, 'persona-switch.js'), 'utf8');
    expect(notes).toMatch(/typeof SidebarManager !== 'undefined'/);
    expect(persona).toMatch(/typeof CommandBar !== 'undefined'/);
  });

  it('openStickySection only claims success when the panel is really shown', () => {
    const notes = fs.readFileSync(path.join(dir, 'notes-panel.js'), 'utf8');
    const start = notes.indexOf('  openStickySection() {');
    const fn = notes.slice(start, start + 700);
    // Returning a bare `true` is what stopped StickyNotes.list() falling back.
    expect(fn).toMatch(/return getComputedStyle\(panel\)\.display !== 'none'/);
    expect(fn).not.toMatch(/\n\s*return true;/);
  });
});
