// Every literal SettingsUI.openSection('<id>') must name an element that Settings really creates.
// A section registered with VexSettingsGroups gets "vex-sg-<id>" when it has build(), "setting-<id>" when it
// has render() (vex-settings-groups.js). A title or a wrong prefix scrolls nowhere and says nothing:
// "Ctrl+K > Study Block" did exactly that.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const JS = path.resolve(__dirname, '../../src/renderer/js');
const HTML = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(JS);
  return out;
}

describe('openSection ids', () => {
  const files = sources();
  const texts = new Map(files.map(f => [f, fs.readFileSync(f, 'utf8')]));

  const valid = new Set([...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const t of texts.values()) {
    for (const m of t.matchAll(/VexSettingsGroups\.register\(\s*\{/g)) {
      const block = t.slice(m.index, m.index + 900);
      const id = /\bid:\s*'([^']+)'/.exec(block);
      if (!id) continue;
      if (/\bbuild\s*:/.test(block)) valid.add('vex-sg-' + id[1]);
      if (/\brender\s*:/.test(block)) valid.add('setting-' + id[1]);
    }
    for (const m of t.matchAll(/\.id\s*=\s*'([^']+)'/g)) valid.add(m[1]);
    for (const m of t.matchAll(/\bid:\s*'((?:settings?)-[^']+)'/g)) valid.add(m[1]);
    for (const m of t.matchAll(/\bID:\s*'([^']+)'/g)) valid.add(m[1]);
  }

  it('finds the calls and the ids it checks against', () => {
    const calls = [...texts.values()].reduce((n, t) => n + [...t.matchAll(/openSection\(\s*'[^']+'/g)].length, 0);
    expect(calls).toBeGreaterThan(30);
    expect(valid.size).toBeGreaterThan(300);
  });

  it('every literal id names an element that exists', () => {
    const bad = [];
    for (const [f, t] of texts) {
      for (const m of t.matchAll(/openSection\(\s*'([^']+)'/g)) {
        if (!valid.has(m[1])) bad.push(path.relative(JS, f) + ": openSection('" + m[1] + "')");
      }
    }
    expect(bad).toEqual([]);
  });

  it('the Study Block command opens its real section', () => {
    expect(texts.get(path.join(JS, 'study-block.js'))).toMatch(/openSection\('vex-sg-study-block'\)/);
  });
});
