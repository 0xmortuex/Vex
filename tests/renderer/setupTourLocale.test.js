// @vitest-environment jsdom
//
// Turkish for the setup wizard, the tour and the Settings "Use <feature>" switches (owner report 2026-11-01:
// "the setup wizard, the tour and parts of Settings still show English in the Turkish interface").
//
// How a string reaches the screen in Turkish:
//   - the translation observer (js/i18n-ui.js) replaces a text, whole, when it is a key of TABLE.tr, but only
//     inside SCOPES (the wizard's #vex-onboarding, the tour's .vex-tour, dialogs, Settings ...);
//   - a text with a changing part ("Using {1} - Save & continue") is matched by a template key with {1} holes;
//   - the wizard's step titles use ID keys of js/i18n.js through t(key, fallback).
// So the rule here is simple: every English text onboarding.js and tour.js can draw has a Turkish entry, as
// an exact key, a template key or an ID key. A new literal with no entry fails the test: add it to TABLE.tr
// in js/i18n-ui.js (or, for a brand or a key name, to SAME below). Nothing here grows tests/renderer/l10nBaseline.json.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
require('../../src/renderer/js/i18n.js');
const IDS = window.VexI18n.strings;
const tr = VexI18nUI.TABLE.tr;
const keys = Object.keys(tr);
const ID_ENGLISH = new Set(Object.values(IDS.en));

// Read the same way the observer reads them: the whole text, or a template with {1} holes.
const hasTurkish = (s) => VexI18nUI.lookup(s, 'tr') != null;

// Names and key names that read the same in Turkish.
const SAME = new Set([
  'English', 'Escape', 'Tab', 'Enter', 'Vex', 'Google', 'Bing', 'Brave', 'Startpage', 'Ecosia', 'Chrome', 'Firefox', 'Safari',
  'Spotify', 'Netflix', 'Discord', 'Roblox', 'Claude AI', 'Claude', 'JetBrains Mono', 'Outfit', 'Neobrutal', 'Terminal',
  'Internet Explorer · XP', 'Netscape · Windows 98', 'Fluent · Windows 11', 'Cloudflare', 'OpenRouter', 'WhatsApp', 'GitHub',
  'Ollama', 'Vex Classic', 'Windows', 'Ctrl+K',
]);

function literals(src) {
  const out = new Map();
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const lines = src.split('\n');
  const add = (raw, index, end, html, forced) => {
    // A text between tags is looked up as it is (the observer only trims it, so a line break inside it is part of the key).
    const flat = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&amp;/g, '&').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
    const s = html ? flat.trim() : flat.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length < 3 || out.has(s)) return;
    const line = lineOf(index);
    const text = lines[line - 1];
    // a developer message, or a step title/sub-title (checked by their ID keys below)
    if (/throw new Error|console\.|VexProblems|\.note\(|\{ key: '\w+',\s+title:|^\s*\/\//.test(text)) return;
    const next = src.slice(end, end + 6);
    const prev = src.slice(Math.max(0, index - 6), index);
    out.set(s, { html: !!html, line, fragment: forced || (/^\s*\+/.test(next) ? 'head' : /\+\s*['"`]?$/.test(prev) ? 'tail' : null) });
  };
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) add(m[1], m.index, m.index + m[0].length);
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) add(m[1], m.index, m.index + m[0].length);
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    const body = m[1];
    for (const t of body.matchAll(/>([^<>{}]*(?:\$\{[^}]*\}[^<>{}]*)*)</g)) {
      const x = t[1];
      // a text with a changing part ("All of it is ${total} features"): the pieces are checked against the template keys
      if (/\$\{/.test(x)) x.split(/\$\{[^}]*\}/).forEach((p, i) => add(p, m.index, m.index + m[0].length, true, i === 0 ? 'head' : 'tail'));
      else add(x, m.index, m.index + m[0].length, true);
    }
    for (const a of body.matchAll(/(?:title|aria-label|placeholder)="([^"$]*)"/g)) add(a[1], m.index, m.index + m[0].length);
    // text in front of the first tag or after the last one
    const head = body.match(/^([^<>$]+)</); if (head) add(head[1], m.index, m.index + m[0].length, true);
    const tail = body.match(/>([^<>$]+)$/); if (tail) add(tail[1], m.index, m.index + m[0].length, true);
  }
  return out;
}

// Looks like a sentence or a label a person reads, not code, a CSS value, a selector or an id.
function readable(s, html) {
  if (html && /\s/.test(s) && /[a-z]{3}/.test(s) && !/[;{}=<>]|^https?:|^(?:wrangler|ollama) |window\.|\) \+ /.test(s)) return true;   // a text between tags, even when it starts mid-sentence
  if (!/^[A-Z0-9]/.test(s)) return false;
  if (!/[a-z]{3}/.test(s)) return false;
  if (/[;{}=<>\\]|^https?:|^[a-z-]+\(|\.(?:js|css|png|svg)$|^\w+\.\w+$/.test(s)) return false;
  if (!/\s/.test(s) && /[a-z][A-Z]/.test(s)) return false;       // an identifier
  if (/^\d[\d.,]*$/.test(s)) return false;
  if (/^(?:var|calc|color-mix|rgba?)\(/.test(s)) return false;
  return true;
}

function missingIn(file) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8').replace(/\r\n/g, '\n');   // a template literal reads CRLF as LF, so does the page
  // the second argument of t('id', 'English') / tt(...) is translated through its ID key
  const idFallback = new Set([...src.matchAll(/\b(?:tt|t|_t)\(\s*'[\w.]+'\s*,\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")));
  const idKeys = [...src.matchAll(/\b(?:tt|t|_t)\(\s*'([\w.]+)'\s*,\s*'/g)].map((m) => m[1]);
  const gaps = [];
  for (const [s, info] of literals(src)) {
    if (!readable(s, info.html) || SAME.has(s) || idFallback.has(s) || ID_ENGLISH.has(s)) continue;
    if (info.fragment === 'head') { if (keys.some((k) => k.startsWith(s))) continue; }
    else if (info.fragment === 'tail') { if (keys.some((k) => k.includes(s))) continue; }
    else if (hasTurkish(s)) continue;
    gaps.push(info.line + ': ' + s);
  }
  return { gaps, idKeys };
}

describe('Turkish for the setup wizard (js/onboarding.js)', () => {
  const { gaps, idKeys } = missingIn('onboarding.js');

  it('the scan sees the wizard (a broken scan would pass everything)', () => {
    const src = fs.readFileSync(path.join(JS, 'onboarding.js'), 'utf8');
    expect(literals(src).size).toBeGreaterThan(300);
    expect(idKeys.length).toBeGreaterThan(20);
  });

  it('every text the wizard can draw has a Turkish entry', () => {
    expect(gaps, 'Add these to TABLE.tr in js/i18n-ui.js:\n' + gaps.join('\n')).toEqual([]);
  });

  it('every step has a Turkish title and sub-title, and every ID key the wizard asks for has Turkish', () => {
    const src = fs.readFileSync(path.join(JS, 'onboarding.js'), 'utf8');
    const stepKeys = [...src.matchAll(/^\s*(?:\.\.\.\([^\n]*\? \[)?\{ key: '(\w+)',\s+title:/gm)].map((m) => m[1]);
    expect(stepKeys.length).toBeGreaterThan(15);
    for (const k of stepKeys) { expect(IDS.tr[k], k).toBeTruthy(); expect(IDS.tr[k + '.sub'], k + '.sub').toBeTruthy(); }
    const missing = [...new Set(idKeys)].filter((k) => !(k in IDS.tr));
    expect(missing, 'These ID keys have no Turkish in js/i18n.js:\n' + missing.join('\n')).toEqual([]);
  });
});

describe('Turkish for the tour (js/tour.js)', () => {
  const { gaps } = missingIn('tour.js');

  it('every plain text the tour can draw has a Turkish entry', () => {
    expect(gaps, 'Add these to TABLE.tr in js/i18n-ui.js:\n' + gaps.join('\n')).toEqual([]);
  });

  it('every step of the quick tour has a Turkish title and text (the text has markup, so it is a whole-string key)', () => {
    const { VexTour } = require('../../src/renderer/js/tour.js');
    expect(VexTour.steps.length).toBeGreaterThan(8);
    const bad = [];
    for (const s of VexTour.steps) {
      if (!hasTurkish(s.title)) bad.push('title: ' + s.title);
      const body = s.html || s.text;
      if (!hasTurkish(body)) bad.push('text: ' + body);
    }
    expect(bad, 'Add these to TABLE.tr in js/i18n-ui.js:\n' + bad.join('\n')).toEqual([]);
  });

  it('the strings the tour builds at run time have Turkish', () => {
    for (const s of ['Step 3 of 12', 'Start — 14 cards', 'Start — 1 card', '<b>12</b> things in this area.', '<b>1</b> thing in this area.',
      'Tick what you want to be shown. All of it is 410 features — most people take two or three areas at a time.',
      'There is nothing to show for those areas in this window']) expect(hasTurkish(s), s).toBe(true);
  });

  it('the tour draws inside a scope the translation observer reads', () => {
    expect(VexI18nUI.SCOPES).toContain('.vex-tour');
  });
});

describe('Turkish for the full tour and the feature switches (catalogue and manifests)', () => {
  const catalogue = () => {
    const src = fs.readFileSync(path.join(JS, 'feature-catalog.js'), 'utf8');
    return new Function('window', src + '\nreturn VexFeatures;')({});
  };

  it('every area name and blurb, and every feature name and description the full tour reads, has Turkish', () => {
    const F = catalogue();
    const bad = [];
    for (const c of F.CATS) { if (!hasTurkish(c.name)) bad.push(c.name); if (!hasTurkish(c.blurb)) bad.push(c.blurb); }
    for (const f of F.ITEMS) { if (f.name && !hasTurkish(f.name)) bad.push(f.name); if (!hasTurkish(f.what)) bad.push(f.what); }
    expect(bad, 'Add these to TABLE.tr in js/i18n-ui.js:\n' + bad.join('\n')).toEqual([]);
  });

  it('every feature title and group in the manifests has Turkish ("Use <title>" in Settings is built from it)', () => {
    let manifests = [];
    global.VexRegistry = { defineAll(m) { manifests = m; } };
    try { require('../../src/renderer/js/feature-manifests.js'); } finally { delete global.VexRegistry; }
    expect(manifests.length).toBeGreaterThan(200);
    const bad = new Set();
    for (const m of manifests) {
      if (m.title && !hasTurkish(m.title)) bad.add(m.title);
      if (m.group && !hasTurkish(m.group)) bad.add(m.group);
    }
    expect([...bad], 'Add these to TABLE.tr in js/i18n-ui.js:\n' + [...bad].join('\n')).toEqual([]);
  });

  it('the "Use {name}" row and the "{name} is off" toast put the Turkish name in, not the English one', () => {
    const src = fs.readFileSync(path.join(JS, 'feature-switches.js'), 'utf8');
    expect(src).toMatch(/_name\(f\.title\)/);
    expect(src).toMatch(/_name\(row\.title\)/);
    expect(src).not.toMatch(/\.join\(f\.title\)/);
    expect(src).not.toMatch(/\.join\(row\.title\)/);
  });
});
