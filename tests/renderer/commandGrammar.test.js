// @vitest-environment jsdom
//
// T2-041: the grammar of Ctrl+K commands and the shortcut table, enforced on the
// real source so a new command or key cannot clash with an old one.
// The rules: docs/COMMAND-GRAMMAR.md, js/command-grammar.js.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');

const { CommandGrammar: G } = require('../../src/renderer/js/command-grammar.js');
const ShortcutsRegistry = require('../../src/renderer/js/shortcuts-registry.js');
const { PAGE_FIRST } = require('../../src/main/guest-shortcuts.js');

const JS = path.resolve(__dirname, '../../src/renderer/js');
const STR = "'((?:[^'\\\\]|\\\\.)*)'";
const unescape = (s) => s.replace(/\\(.)/g, '$1');

// Every { id: '...', label: '...' } in command.js and every registerCommand({ id, label }) elsewhere.
function commands() {
  const out = [];
  const shapes = [new RegExp("\\{ id: " + STR + ", label: " + STR + "(?:, hint: " + STR + ")?", 'g')];
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    if (f !== 'command.js' && !/registerCommand\(/.test(src)) continue;
    for (const re of shapes) {
      for (const m of src.matchAll(re)) {
        // command.js: every entry. Other files: only those inside a registerCommand call.
        if (f !== 'command.js') {
          const before = src.slice(Math.max(0, m.index - 40), m.index);
          if (!/registerCommand\(\s*$/.test(before)) continue;
        }
        out.push({ id: unescape(m[1]), label: unescape(m[2]), hint: m[3] == null ? undefined : unescape(m[3]), file: f });
      }
    }
  }
  return out;
}

const all = commands();

describe('the commands read from the source', () => {
  it('finds the command list (a regex that finds nothing would pass every rule below)', () => {
    expect(all.length).toBeGreaterThan(250);
  });

  it('every id and label follows the grammar', () => {
    const problems = all.flatMap(c => G.lintCommand(c).map(p => c.file + ': ' + p));
    expect(problems).toEqual([]);
  });

  it('no id and no label is used twice', () => {
    expect(G.lintUnique(all)).toEqual([]);
  });
});

describe('shortcuts', () => {
  const defaults = ShortcutsRegistry.getAllShortcuts();

  it('the registry exposes its defaults', () => {
    expect(defaults && Object.keys(defaults).length).toBeGreaterThan(50);
  });

  it('no key is on two actions, none is malformed, and a key a page gets first is fixed', () => {
    const ids = new Set(all.map(c => c.id));
    expect(G.lintShortcuts(defaults, PAGE_FIRST, ids)).toEqual([]);
  });

  it('the lint itself catches a duplicate, a key a page gets first and a missing command', () => {
    const bad = {
      a: { default: 'Ctrl+Alt+Q', label: 'A' }, b: { default: 'Ctrl+Alt+Q', label: 'B' },
      c: { default: 'Ctrl+B', label: 'C' }, d: { default: 'Ctrl+Alt+Z', label: 'D', cmd: 'nope' },
      e: { default: 'Alt+Ctrl+Y', label: 'E' },
    };
    const found = G.lintShortcuts(bad, PAGE_FIRST, new Set(['x']));
    expect(found.some(p => /Ctrl\+Alt\+Q is on both/.test(p))).toBe(true);
    expect(found.some(p => /Ctrl\+B.*a page gets first/.test(p))).toBe(true);
    expect(found.some(p => /command "nope"/.test(p))).toBe(true);
    expect(found.some(p => /not Ctrl\+Alt\+Shift\+Key/.test(p))).toBe(true);
  });
});

describe('prefixes', () => {
  it('are single symbols and listed once', () => {
    expect(G.lintPrefixes()).toEqual([]);
    expect(G.PREFIXES.map(p => p.char)).toEqual(expect.arrayContaining(['>', '@']));
  });
});

describe('the lint on bad commands', () => {
  it('names each problem', () => {
    expect(G.lintCommand({ id: 'Bad_Id', label: 'x' }).length).toBeGreaterThan(1);
    expect(G.lintCommand({ id: 'ok', label: 'Ends with a stop.' })).toEqual(['the label "Ends with a stop." ends with a full stop']);
    expect(G.lintCommand({ id: 'ok', label: 'Has \u{1F600} emoji' }).join()).toMatch(/emoji/);
    expect(G.lintCommand({ id: 'ok', label: 'Fine', hint: 'Fine too' })).toEqual([]);
    expect(G.lintUnique([{ id: 'a', label: 'Same' }, { id: 'b', label: 'same' }])).toHaveLength(1);
  });
});
