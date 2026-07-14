// @vitest-environment node
//
// Anti-drift guard for the theme registry: the chrome themes live in
// src/renderer/css/theme-tokens.css + theme-extra.css, but src/renderer/start.html
// (served as a separate document via vex://start) re-inlines every theme's core
// tokens in a <style> block. Those copies have historically drifted. This test
// parses both sources and asserts that every theme's signature tokens
// (--vex-accent and --vex-bg-base) stay identical.
//
// As of this test's creation, ALL theme ids (oxford + 33 dark + custom) are
// present in both sources, so a theme missing from start.html is a hard failure
// (someone added a theme to the CSS registry and forgot the start page).

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSS_FILES = [
  path.join(ROOT, 'src', 'renderer', 'css', 'theme-tokens.css'),
  path.join(ROOT, 'src', 'renderer', 'css', 'theme-extra.css'),
];
const START_HTML = path.join(ROOT, 'src', 'renderer', 'start.html');

const TRACKED_TOKENS = ['--vex-accent', '--vex-bg-base'];

// Matches only standalone theme blocks — `[data-theme="x"] {` with nothing
// between the attribute selector and the brace. Descendant rules like
// `[data-theme="oxford"] h1 { ... }` and the shared dark rule
// `html[data-theme]:not([data-theme="oxford"]) { ... }` do not match.
function parseThemeBlocks(cssText) {
  const themes = new Map();
  const blockRe = /\[data-theme="([\w-]+)"\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(cssText)) !== null) {
    const [, id, body] = m;
    const tokens = {};
    for (const token of TRACKED_TOKENS) {
      const tm = body.match(new RegExp(token.replace(/-/g, '\\-') + ':\\s*([^;]+);'));
      if (tm) tokens[token] = tm[1].trim().toLowerCase().replace(/\s+/g, '');
    }
    if (Object.keys(tokens).length === 0) continue; // e.g. font-only blocks
    themes.set(id, { ...(themes.get(id) || {}), ...tokens });
  }
  return themes;
}

function cssThemes() {
  const merged = new Map();
  for (const file of CSS_FILES) {
    for (const [id, tokens] of parseThemeBlocks(fs.readFileSync(file, 'utf8'))) {
      merged.set(id, { ...(merged.get(id) || {}), ...tokens });
    }
  }
  return merged;
}

function startHtmlThemes() {
  return parseThemeBlocks(fs.readFileSync(START_HTML, 'utf8'));
}

describe('theme registry <-> start.html sync', () => {
  const cssMap = cssThemes();
  const startMap = startHtmlThemes();

  it('parses a sane number of themes from both sources', () => {
    // 35 as of writing: oxford + default + 32 more (incl. custom). A collapse
    // to near-zero means the parser regex broke, not that themes vanished.
    expect(cssMap.size).toBeGreaterThanOrEqual(30);
    expect(startMap.size).toBeGreaterThanOrEqual(30);
  });

  it('every theme in the CSS registry is inlined in start.html', () => {
    const missing = [...cssMap.keys()].filter((id) => !startMap.has(id));
    expect(
      missing,
      `Themes defined in theme-tokens.css/theme-extra.css but missing from ` +
      `start.html's inline <style> block: [${missing.join(', ')}]. ` +
      `Add a [data-theme="..."] block to start.html so the start page matches.`
    ).toEqual([]);
  });

  it('start.html does not carry themes the CSS registry lacks', () => {
    const orphans = [...startMap.keys()].filter((id) => !cssMap.has(id));
    expect(
      orphans,
      `start.html inlines themes that no longer exist in the CSS registry: ` +
      `[${orphans.join(', ')}]. Remove the stale blocks.`
    ).toEqual([]);
  });

  it.each([...cssThemes().keys()].filter((id) => startHtmlThemes().has(id)))(
    'theme "%s" has matching --vex-accent and --vex-bg-base in both sources',
    (id) => {
      const cssTokens = cssThemes().get(id);
      const startTokens = startHtmlThemes().get(id);
      for (const token of TRACKED_TOKENS) {
        expect(
          startTokens[token],
          `${token} for theme "${id}" drifted: CSS registry has ` +
          `"${cssTokens[token]}" but start.html has "${startTokens[token]}"`
        ).toBe(cssTokens[token]);
      }
    }
  );
});
