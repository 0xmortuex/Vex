// @vitest-environment jsdom
//
// The icon set, and the rule it exists to enforce: Vex renders icons, not
// emoji. Two halves —
//   (a) every icon NAME the swept files ask for actually resolves, so a typo
//       can't ship a blank square, and
//   (b) those files carry no emoji at all, apart from a short, named list of
//       places where an emoji is the subject matter rather than decoration.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const renderer = path.join(root, 'src/renderer');

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');

// Every file this sweep covers. Others still hold emoji and are handled
// elsewhere; adding a file here is how you opt it in.
const SWEPT = [
  'js/command.js',
  'js/toolbox.js',
  'js/toolbox-packs.js',
  'js/toolbox-pack-text.js',
  'js/toolbox-pack-units-math-science.js',
  'js/toolbox-pack-money-date-health.js',
  'js/toolbox-pack-dev-data-web.js',
  'js/extensions-menu.js',
  'js/extensions-settings.js',
  'js/sidebar.js',
  'js/onboarding.js',
  'js/logins-hub.js',
  'js/focus-flows.js',
  'js/queue-podcast.js',
  'js/master-volume.js',
  'js/container-routing.js',
  'js/tor-session.js',
  'js/webview.js',
  'js/password-health.js',
  'js/vex-icons.js',
  'start.html',
];

// Emoji that are the POINT of the code around them, not decoration: four
// Toolbox tools whose job is inspecting, stripping or escaping emoji, and their
// worked examples. Each entry is a substring of the line it excuses.
const ALLOWED_LINES = [
  // dev-data-web: the character/Unicode inspectors' sample input and results.
  "value: 'A€😀'",
  "'U+0041 · UTF-8 41",
  "value: 'héllo 😀'",
  // text pack: HTML-entity encode/decode, hex-byte decode, the emoji stripper
  // and the escape/unescape tool all take emoji as input or produce it.
  'hearts:',
  'copy: ',
  "{ in: { text: 'F0:9F:98:80', mode: 'decode' }",
  "{ in: { text: 'café 😀', all: true }",
  "{ in: { text: '&lt;p&gt;Caf",
  'Extended_Pictographic',
  "{ in: { text: 'Great job",
  "{ in: { text: '© 2024 Vex",
  "{ in: { text: 'café 😀', mode: 'ascii' }",
  "line('text', 'Characters', '', 'é€😀')",
];

const read = (rel) => fs.readFileSync(path.join(renderer, rel), 'utf8');
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

describe('VexIcons', () => {
  it('draws every icon on the same 24x24 grid, stroked in currentColor', () => {
    expect(VexIcons.names().length).toBeGreaterThan(60);
    for (const name of VexIcons.names()) {
      expect(name, name).toMatch(/^[a-z][a-z0-9-]*$/);
      const svg = VexIcons.svg(name, { size: 18 });
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).toContain('fill="none"');
      expect(svg, name).toContain('width="18" height="18"');
      // Only primitives, and no emoji smuggled in as a glyph.
      expect(PICTOGRAPHIC.test(VexIcons.icons[name]), name).toBe(false);
      expect(VexIcons.icons[name], name).toMatch(/^<(path|circle|rect|ellipse|line|polyline|polygon)\b/);
    }
  });

  it('renders as real SVG in the DOM', () => {
    const host = document.createElement('div');
    host.innerHTML = VexIcons.svg('search');
    const svg = host.firstElementChild;
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelectorAll('circle, path').length).toBeGreaterThan(0);
  });

  it('returns nothing and complains for an unknown name', () => {
    const warned = [];
    const original = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      expect(VexIcons.svg('no-such-icon')).toBe('');
    } finally { console.warn = original; }
    expect(warned.join(' ')).toContain('no-such-icon');
    expect(VexIcons.has('no-such-icon')).toBe(false);
  });

  it('passes non-names through markup() untouched', () => {
    expect(VexIcons.markup('<img src="x.png">')).toBe('<img src="x.png">');
    expect(VexIcons.markup('.*')).toBe('.*');
    expect(VexIcons.markup('search')).toContain('<svg');
    expect(VexIcons.markup(null)).toBe('');
  });
});

describe('the swept UI', () => {
  it('asks only for icon names that exist', () => {
    const asked = new Map();
    for (const rel of SWEPT) {
      const src = read(rel);
      // VexIcons.svg('name'…) and VexIcons.markup('name'…)
      for (const m of src.matchAll(/VexIcons\.(?:svg|markup|has)\(\s*'([a-z][a-z0-9-]*)'/g)) {
        asked.set(m[1], rel);
      }
    }
    // Command-bar entries name their icon directly; Toolbox tools may instead
    // carry typographic text, which the next test covers.
    for (const m of read('js/command.js').matchAll(/icon: '([^']+)'/g)) {
      asked.set(m[1], 'js/command.js');
    }
    expect(asked.size).toBeGreaterThan(50);
    const missing = [...asked].filter(([name]) => !VexIcons.has(name));
    expect(missing.map(([n, f]) => `${n} (${f})`)).toEqual([]);
    // Walks every source file, so it is I/O-bound and slower than the 5s
    // default once the whole suite runs in parallel.
  }, 30000);

  it('gives every command bar entry an icon that resolves', () => {
    const src = read('js/command.js');
    const icons = [...src.matchAll(/\{ id: '[a-z0-9-]+',[^\n]*?icon: '([^']+)'/g)].map(m => m[1]);
    expect(icons.length).toBeGreaterThan(140);
    for (const icon of icons) expect(VexIcons.has(icon), icon).toBe(true);
  });

  it('gives every Toolbox family an icon that resolves', () => {
    const { ToolboxPacks } = require('../../src/renderer/js/toolbox-packs.js');
    const families = Object.entries(ToolboxPacks.FAMILIES);
    expect(families.length).toBeGreaterThan(10);
    for (const [id, fam] of families) {
      expect(fam.label, id).toBeTruthy();
      expect(VexIcons.has(fam.icon), id + ' -> ' + fam.icon).toBe(true);
    }
  });

  it('contains no emoji outside the allowed exceptions', () => {
    const offenders = [];
    for (const rel of SWEPT) {
      read(rel).split(/\r?\n/).forEach((line, i) => {
        if (!PICTOGRAPHIC.test(line)) return;
        if (isComment(line)) return;                       // prose, never rendered
        if (ALLOWED_LINES.some(a => line.includes(a))) return;
        offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders).toEqual([]);
    // Walks every source file, so it is I/O-bound and slower than the 5s
    // default once the whole suite runs in parallel.
  }, 30000);

  it('loads the icon set before anything that draws with it', () => {
    for (const page of ['index.html', 'start.html']) {
      const src = read(page);
      const icons = src.indexOf('js/vex-icons.js');
      expect(icons, page).toBeGreaterThan(-1);
      for (const user of ['js/command.js', 'js/toolbox.js', 'js/sidebar.js']) {
        const at = src.indexOf(user);
        if (at > -1) expect(icons, `${page}: ${user}`).toBeLessThan(at);
      }
    }
  });
});
