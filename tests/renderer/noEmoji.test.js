// No emoji anywhere in Vex's UI.
//
// Every icon is drawn by VexIcons (or an inline SVG where VexIcons can't
// reach, e.g. a preload). Emoji render in the system's own colours, ignore
// the theme and the browser looks entirely, and go missing on fonts that
// don't carry them — so a glyph in the UI is a bug, not a style choice.
//
// Three things are deliberately exempt, and each one is listed by file here
// rather than by a loose pattern, so a NEW emoji anywhere fails this test:
//   * Toolbox tools that are ABOUT emoji (a codepoint inspector, an emoji
//     stripper) — their inputs and expected outputs have to contain them;
//   * the table mapping a pre-icons skill's emoji to the icon it became;
//   * the party popper on the "Vex just updated" card, which the product
//     deliberately keeps.
//
// An emoji written as an HTML entity (&#128451;) is still an emoji on screen,
// so entities are decoded before the check — that layer hid a dozen of them.

import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const PICTO = /\p{Extended_Pictographic}/u;

// `↔` and friends are typography, not emoji: they sit inside prose and code
// comments ("group↔stack") and render as text on every platform.
const TYPOGRAPHIC = /[\u2190-\u21FF\u2200-\u22FF]/u;

// &#128512; and &#x1F600; both reach the screen as an emoji.
function decodeEntities(line) {
  return line
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d{1,7});/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return m; } });
}

const ALLOWED = {
  // Tools whose subject matter is emoji: Unicode inspector, escape/unescape,
  // HTML entities, the emoji stripper.
  'renderer/js/toolbox-pack-text.js': Infinity,
  'renderer/js/toolbox-pack-dev-data-web.js': Infinity,
  // VexSkills.LEGACY_ICONS — one line, the migration table.
  'renderer/js/skills.js': 1,
  // The update card's party popper: the one emoji the product keeps.
  'renderer/js/update-notifier.js': 2,
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no emoji in the UI', () => {
  it('every source file is emoji-free, apart from the listed exemptions', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const budget = ALLOWED[rel] ?? 0;
      const hits = [];
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const bare = decodeEntities(line).replace(TYPOGRAPHIC, '');
        if (PICTO.test(bare)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
      if (hits.length > budget) offenders.push(...hits);
    }
    expect(offenders, `use VexIcons.svg(name) instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('knows what an emoji is, so the check above can actually fail', () => {
    expect(PICTO.test('Save \u{1F4BE}')).toBe(true);
    expect(PICTO.test('Save')).toBe(false);
    expect(PICTO.test('group\u2194stack'.replace(TYPOGRAPHIC, ''))).toBe(false);
    expect(PICTO.test(decodeEntities('&#128451;&#65039; Organize'))).toBe(true);
    expect(PICTO.test(decodeEntities('&#9662; arrow'))).toBe(false);
  });
});
