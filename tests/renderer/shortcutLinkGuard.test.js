// A shortcut or tile whose address the saved list rejects makes every later save fail ("Invalid saved URL"), so both
// editors must stop it at the source. The guard in each must agree with js/data-contracts.js, which decides.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const contracts = require('../../src/renderer/js/data-contracts.js');

const GUARD = /\/\^\(https\?\|about\|file\|vex\):\$\/\.test\(new URL\(\w+\)\.protocol\)/;
const SAMPLES = [
  'https://example.com', 'http://example.com/a?b=c', 'about:blank', 'vex://settings', 'file:///C:/start.html',
  'https://my favourite site', 'https://javascript:alert(1)', 'mailto:me@example.com', 'ftp://example.org/file',
  'javascript:alert(1)', 'data:text/html,hi', 'http://', '', 'https://a b.com',
];

describe('shortcut address guards match the saved-list rule', () => {
  for (const [file, label] of [['src/renderer/start.html', 'the New Tab page tile editor'], ['src/renderer/js/gui-style.js', 'the shortcuts bar editor']]) {
    it(label + ' uses the same schemes as data-contracts', () => {
      expect(fs.readFileSync(file, 'utf8')).toMatch(GUARD);
    });
  }
  it('the scheme list in the guard accepts exactly what data-contracts accepts for shortcuts', () => {
    const guard = (u) => { try { return /^(https?|about|file|vex):$/.test(new URL(u).protocol) && u.length <= 8192 && !/[\x00-\x1f]/.test(u); } catch { return false; } };
    for (const s of SAMPLES) expect(guard(s), s).toBe(contracts.url(s, false));
  });
});
