// Page-preload behaviour fixed in the 2026-09-29 sweep, run from the preload's
// own source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(path.join(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');

// The snippet matcher: from its TOKEN pattern to the end of match().
function snippetMatcher(snippets) {
  const start = SRC.indexOf('  const TOKEN = /');
  const end = SRC.indexOf('\n  }\n', SRC.indexOf('  function match(before) {', start)) + 4;
  // eslint-disable-next-line no-new-func
  return new Function('snippets', SRC.slice(start, end) + '\nreturn match;')(snippets);
}

describe('snippets expand only as a whole word', () => {
  const match = snippetMatcher([{ abbr: 'ty', text: 'thank you' }, { abbr: ';sig', text: 'Fadi' }, { abbr: ';sig2', text: 'F.' }]);

  it('"ty" on its own expands, inside "party" it does not', () => {
    expect(match('thanks, ty').snippet.text).toBe('thank you');
    expect(match('party')).toBe(null);
  });

  it('an abbreviation that starts with punctuation may follow a word, longest first', () => {
    expect(match('regards;sig').snippet.text).toBe('Fadi');
    expect(match('x ;sig2').snippet.text).toBe('F.');
  });
});

describe("keys a page may use first", () => {
  it('are watched after the page has had them, and reported only if left alone', () => {
    const block = SRC.slice(SRC.indexOf("// === Vex's keys a page may use first ==="));
    expect(block).toMatch(/setTimeout\(function \(\) \{\s*if \(!e\.defaultPrevented\) ipc\.send\('guest:page-shortcut'/);
  });
});
