// @vitest-environment jsdom
//
// The start page renders three kinds of string it did not write:
//
//   * shortcut names — which arrive from SHARED setup codes ("copy this code
//     and send it — anyone can paste it into their Vex") and from Vex Sync,
//     so they are not merely your own typing;
//   * your own "My Tools" entries;
//   * GitHub commit messages, straight off the API — anyone who lands a commit
//     in a repo you push can write one.
//
// All three went into innerHTML unescaped. A shortcut named
//   <img src=x onerror="...">
// ran its script on the start page; proved in the real app before fixing.
//
// The same read also found the Recent GitHub Activity widget had never worked
// once: `const ghUser` was declared a second time inside its try block, so the
// fetch above it hit that binding's temporal dead zone and threw straight into
// a catch that said nothing.
//
// start.html is one big document with an inline script, so the escapers are
// pulled out and exercised for real, and the sinks are checked in the source.

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const START = path.join(__dirname, '..', '..', 'src', 'renderer', 'start.html');
const html = fs.readFileSync(START, 'utf8');

// The page's own escapers, lifted out and run.
function loadEscapers() {
  const src = html.slice(html.indexOf('function escHtml('), html.indexOf('// Customizable shortcuts'));
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.escHtml = escHtml; this.escAttr = escAttr;', ctx);
  return ctx;
}

describe('the escapers the page actually uses', () => {
  const { escHtml, escAttr } = loadEscapers();

  it('defuses the payload that really executed', () => {
    const out = escHtml('<img src=x onerror="window.__pwned=1">');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes the ampersand first, so nothing can be double-decoded', () => {
    expect(escHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('closes the quote escape for attribute positions', () => {
    expect(escAttr('" onerror="alert(1)')).not.toContain('"');
    expect(escAttr("' onload='x")).not.toContain("'");
  });

  it('renders harmless text unchanged, and handles nothing at all', () => {
    expect(escHtml('Ataşehir · Istanbul')).toBe('Ataşehir · Istanbul');
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
    expect(escHtml(0)).toBe('0');
  });

  it('actually stops a browser parsing it as markup', () => {
    const el = document.createElement('div');
    el.innerHTML = '<span>' + escHtml('<img src=x onerror="x">') + '</span>';
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
});

describe('every untrusted string on the start page is escaped', () => {
  const sinks = [
    ['a shortcut name (arrives via shared setup codes and sync)', '${escHtml(s.name)}'],
    ['a tool name', '${escHtml(t.name)}'],
    ['a tool description', '${escHtml(t.desc)}'],
    ['a tool icon', '${escHtml(t.icon)}'],
    ['a GitHub commit message', '${escHtml(msg)}'],
    ['a GitHub repo name', '${escHtml(repo)}'],
  ];

  for (const [what, needle] of sinks) {
    it(`escapes ${what}`, () => expect(html).toContain(needle));
  }

  it('never puts the raw field into markup', () => {
    for (const raw of ['${s.name}', '${t.name}', '${t.desc}', '${msg}', '${repo}']) {
      expect(html, raw + ' is interpolated unescaped').not.toContain(raw);
    }
  });

  it('escapes the values put back into the edit form', () => {
    expect(html).toContain('escAttr(existing.name)');
    expect(html).toContain('escAttr(existing.url)');
  });
});

describe('Recent GitHub Activity', () => {
  // Proved with a standalone repro: the duplicate const threw
  // "Cannot access 'ghUser' before initialization" on every single load.
  it('declares ghUser once, so the fetch above it is not in a dead zone', () => {
    const fn = html.slice(html.indexOf('async function loadGitHubActivity()'), html.indexOf('function timeAgo('));
    const declarations = fn.match(/const ghUser\s*=/g) || [];
    expect(declarations, 'a second declaration puts the fetch in its temporal dead zone').toHaveLength(1);
  });

  it('uses ghUser only after it is declared', () => {
    const fn = html.slice(html.indexOf('async function loadGitHubActivity()'), html.indexOf('function timeAgo('));
    expect(fn.indexOf('const ghUser')).toBeLessThan(fn.indexOf('encodeURIComponent(ghUser)'));
  });

  it('says it failed instead of failing silently', () => {
    const fn = html.slice(html.indexOf('async function loadGitHubActivity()'), html.indexOf('function timeAgo('));
    expect(fn).not.toContain('// silently fail');
    expect(fn).toContain('console.warn');
    expect(fn).toContain('Could not load recent activity');
  });
});
