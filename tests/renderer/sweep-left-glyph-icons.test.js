// No text glyphs standing in for icons.
//
// noEmoji.test.js catches emoji, but the dingbats people reach for as a quick
// close / tick / edit / favourite icon — ✕ ✓ ✗ ✎ ★ ☆ ⚙ ✦ — are not emoji to
// Unicode, so they slipped past it: about sixty close buttons, ticks and
// status lines drew a font glyph instead of a VexIcons SVG (found 2026-09-29).
// A glyph ignores the icon set's stroke, size and theme, and renders
// differently on every font.
//
// The same scan runs for "×" (U+00D7), but only where it stands alone as a
// button's whole label ('×', >×<, &times;) — "2×2 grid", "1.5× speed" and the
// maths in the Toolbox are prose and stay.
//
// Exempt: code comments, and the Toolbox packs, whose tools are ABOUT text
// (an escape tool's examples, a commit linter named with a tick glyph the way
// every Toolbox tool is named with a typographic glyph).

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');

// ▲ ▼ ↺ were the sidebar editor's move/reset buttons (found 2026-09-29).
// ⟳ ↻ were refresh and reset buttons (found 2026-09-29).
const DINGBATS = /[✓✔✕✖✗✘✎✏★☆⚙✦▲▼↺⟳↻]/u;
// A quoted '×' joined onto something with + is a size ("w + '×' + h"), not a label.
const LONE_TIMES = /(?<!\+\s*)(?:'×'|"×")(?!\s*\+)|>\s*×\s*</u;

function decode(line) {
  return line
    .replace(/&times;/g, '×')
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d{1,7});/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return m; } })
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } });
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

function offendingLine(line) {
  if (isComment(line)) return false;
  const bare = decode(line);
  return DINGBATS.test(bare) || LONE_TIMES.test(bare);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no text glyphs used as icons', () => {
  it('every renderer file draws its close / tick / edit / star icons with VexIcons', () => {
    const offenders = [];
    for (const file of walk(RENDERER)) {
      const rel = path.relative(RENDERER, file).split(path.sep).join('/');
      if (/^js\/toolbox-pack-/.test(rel)) continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (offendingLine(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
    expect(offenders, `use VexIcons.svg('x' | 'check' | 'edit' | 'star' | …) instead:\n${offenders.join('\n')}`).toEqual([]);
  }, 30000);

  it('knows a glyph icon from prose, so the check above can fail and does not over-reach', () => {
    expect(offendingLine('<button id="a-close">✕</button>')).toBe(true);
    expect(offendingLine("btn.textContent = 'Done \\u2713';")).toBe(true);
    expect(offendingLine('<span class="check">&#10003;</span>')).toBe(true);
    expect(offendingLine("remove.textContent = '×';")).toBe(true);
    expect(offendingLine('<button aria-label="Close">&times;</button>')).toBe(true);
    expect(offendingLine("section('★ Favorites', favs);")).toBe(true);
    // Prose and maths are fine.
    expect(offendingLine("hint: 'Four tabs in a 2×2 grid'")).toBe(false);
    expect(offendingLine("showToast(rate + '× on this site')")).toBe(false);
    expect(offendingLine("cell.title = img.w + '×' + img.h;")).toBe(false);
    // So are comments that mention a glyph.
    expect(offendingLine('    // a re-render can strand ✕ buttons')).toBe(false);
  });
});
