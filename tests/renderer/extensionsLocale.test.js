// @vitest-environment jsdom
//
// Turkish for the extension screens (owner report 2026-11-01: "in the Turkish UI the EXTENSIONS screens are full of English").
// Same rule as setupTourLocale.test.js: every English text these files can draw has a Turkish entry in TABLE.tr of
// js/i18n-ui.js (an exact key, a template key with {1} holes, or a name that reads the same, listed in SAME below).
// Also: a text must never come out half translated, word by word ("Not set" became "Not ayarlandı" through the
// template "{1} set").
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const tr = VexI18nUI.TABLE.tr;
const keys = Object.keys(tr);
const hasTurkish = (s) => VexI18nUI.lookup(s, 'tr') != null;

// Names and key names that read the same in Turkish.
const SAME = new Set([
  'Could not allow it:', 'Invalid url pattern \'', 'Can now read more:', 'Can now read less:', 'N free articles',
  'The download matched the digest GitHub published for it.', 'GitHub published no digest for this file, so the download could not be checked against one.',
  'Unused \' + this.UNUSED_DAYS + \'+ days',
  'Vex', 'Chrome', 'Chrome Web Store', 'Google', 'Firefox', 'Dark Reader', 'Stylus', 'Violentmonkey', 'Ghostery', 'Tampermonkey',
  'uBlock Origin', 'uBlock Origin Lite', 'CRX', 'ZIP', 'Escape', 'Control', 'Shift', 'Meta', 'Enter', 'Hepsi', 'Discord', 'Claude',
  'Spotify', 'Prime / Netflix', 'Roblox', 'GitHub Pulse', 'Cineverse+', 'Return YouTube Dislike', 'Ambient Light for YouTube',
  'Extension shortcut capture keep-alive',
]);

function literals(src) {
  const out = new Map();
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const lines = src.split('\n');
  const add = (raw, index, end, html, forced) => {
    const flat = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&amp;/g, '&').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”');
    const s = html ? flat.trim() : flat.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (s.length < 3 || out.has(s)) return;
    const line = lineOf(index);
    const text = lines[line - 1];
    if (/throw new Error|console\.|VexProblems|\.note\(|^\s*\/\//.test(text)) return;
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
      if (/\$\{/.test(x)) x.split(/\$\{[^}]*\}/).forEach((p, i) => add(p, m.index, m.index + m[0].length, true, i === 0 ? 'head' : 'tail'));
      else add(x, m.index, m.index + m[0].length, true);
    }
    for (const a of body.matchAll(/(?:title|aria-label|placeholder)="([^"$]*)"/g)) add(a[1], m.index, m.index + m[0].length);
    const head = body.match(/^([^<>$]+)</); if (head) add(head[1], m.index, m.index + m[0].length, true);
    const tail = body.match(/>([^<>$]+)$/); if (tail) add(tail[1], m.index, m.index + m[0].length, true);
  }
  return out;
}

function readable(s, html) {
  if (html && /\s/.test(s) && /[a-z]{3}/.test(s) && !/[;{}=<>]|^https?:|window\.|\) \+ /.test(s)) return true;
  if (!/^[A-Z0-9]/.test(s)) return false;
  if (!/[a-z]{3}/.test(s)) return false;
  if (/[;{}=<>\\]|^https?:|^[a-z-]+\(|\.(?:js|css|png|svg)$|^\w+\.\w+$/.test(s)) return false;
  if (!/\s/.test(s) && /[a-z][A-Z]/.test(s)) return false;
  if (/^\d[\d.,]*$/.test(s)) return false;
  if (/^(?:var|calc|color-mix|rgba?)\(/.test(s)) return false;
  return true;
}

function missingIn(file) {
  const src = fs.readFileSync(path.join(JS, file), 'utf8').replace(/\r\n/g, '\n');
  // the second argument of VexI18n's t('id', 'English') is translated through its ID key (js/i18n.js)
  const idFallback = new Set([...src.matchAll(/\b(?:tt|t|_t)\(\s*'[\w.]+'\s*,\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'")));
  const gaps = [];
  for (const [s, info] of literals(src)) {
    if (!readable(s, info.html) || SAME.has(s) || idFallback.has(s)) continue;
    if (info.fragment === 'head') { if (keys.some((k) => k.startsWith(s))) continue; }
    else if (info.fragment === 'tail') { if (keys.some((k) => k.includes(s))) continue; }
    else if (hasTurkish(s)) continue;
    gaps.push(info.line + ': ' + s);
  }
  return gaps;
}

const FILES = [
  'ext-debug-bar.js', 'ext-menu-model.js', 'ext-sidepanel.js', 'ext-ui.js', 'extension-audit-view.js', 'extension-catalog.js',
  'extension-diff.js', 'extension-store.js', 'extensions-menu.js', 'extensions-settings.js',
  'read-free.js', 'web-store.js', 'web-store-link.js',
];

describe('Turkish for the extension screens', () => {
  for (const f of FILES) {
    it(f + ': every text it can draw has a Turkish entry', () => {
      const gaps = missingIn(f);
      expect(gaps, 'Add these to TABLE.tr in js/i18n-ui.js (the block "extensions screens (agent)"):\n' + gaps.join('\n')).toEqual([]);
    });
  }
});

// Texts these files put together at run time, as the screen then holds them (the static scan sees only the pieces).
describe('Turkish for the texts the extension screens build at run time', () => {
  const BUILT = [
    'What will not work in Vex (6)', 'What it is allowed to do (2)', 'Runs in: browsing tabs (a generic extension: one copy per panel otherwise)',
    'Runs in: browsing tabs + Discord, Claude', 'Can read and change pages on a.com, b.com and 3 more', 'Can read and change pages on a.com',
    'Sites it names: a.com, b.com', 'Sites: *://*.x.com/*, <all_urls>', 'Sites: a.com, b.com and 4 more', 'Request rules: 3 active.',
    'Request rules: 3 active, checked 120 requests at about 0.012 ms each.', 'Unused 30+ days', 'Last used 3 h ago', 'Updated 5 days ago',
    'Updated 5 days ago · Last used 3 h ago', '2 permissions, none of them sensitive', 'Installed Dark Reader v4.9.1',
    'Installed Dark Reader v4.9.1 — still switched off', 'Installed Dark Reader v4.9.1 — it loads when Vex restarts normally',
    'Installed: Stylus v2.4.14 — still switched off', 'Updated Stylus from v1 to v2 — still switched off', 'Reinstalled Stylus v2',
    'Last checked 3 min ago. Every extension is up to date.', 'Last checked just now. Updated: Stylus 1 → 2. Waiting for your approval: Dark Reader.',
    'Not checked yet: the first check runs two minutes after Vex starts, then every six hours.',
    'Not checked: Vex is offline. Not checked yet: the first check runs two minutes after Vex starts, then every six hours.',
    'Updated automatically from v1 to v2 on 11/1/2026.', 'Version 4.9 asks for more than this one:', 'Update "Stylus"?', 'Replace "Stylus"?', 'Add "Stylus"?',
    'Install an older "Stylus"?', 'Vex cannot install Stylus', 'Paused 2 extensions and made a rule for example.com', '3 extensions can read example.com',
    'Pause extensions on example.com', 'Now can: Read your browsing history', 'Can now read more: no pages to every page you open',
    'Version 1.2 from a .zip file (a.zip), not signed, so Vex cannot tell who made it.',
    'Version 1.2 from the Chrome Web Store. Its signatures, the developer\'s and the store\'s, check out.',
    'Version 1.2: a package its developer signed themselves (a.crx), id abc. The signature checks out, so it has not been changed since it was signed, but no store has looked at it.',
    'This is an older version (1.0) than the one installed (1.2). Its settings are kept, but an older version may not read what the newer one saved.',
    'It cannot use recently closed tabs (sessions), reading text aloud (tts): Vex does not have those for extensions.',
    'It cannot use printers (printerProvider): Vex does not have that for extensions.',
    'It can read your history, bookmarks (private, container and Tor browsing excluded) but cannot add, change or delete any, and is not told when they change.',
    'Could not install: The Chrome Web Store has no extension with that id. It may have been removed from the store, or it is not public.',
    'Install failed: Could not reach Google\'s extension server: net::ERR_X', 'Can read Discord pages and cookies, which include the sign-in that proves it is you. An extension that can read a Discord page can read what you type and see there.',
    'From its publisher\'s GitHub releases (0xmortuex/RoSuite, v1.2). Vex keeps it up to date from there. The download matched the digest GitHub published for it. These releases are not signed or reviewed by any store.',
  ];
  it('every one of them has a whole Turkish text, with no English left in it', () => {
    const bad = [];
    for (const s of BUILT) {
      const hit = VexI18nUI.lookup(s, 'tr');
      if (hit == null) { bad.push('no entry: ' + s); continue; }
      const eng = hit.replace(/\([A-Za-z]+\)/g, '').match(/\b(?:the|not|your|you|with|from|this|that|are|will|and|for|is|can|its|it|to|of|on|an|or|when|than|but|so|ago|read|more|used|none)\b/gi);
      if (eng) bad.push('half translated (' + eng.join(', ') + '): ' + hit);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

// "Not set" was drawn "Not ayarlandı": the template "{1} set" took "Not" for a name and left it in English. A negation is never a hole,
// and a hole never swallows two sentences or a " — " clause (owner report 2026-11-01).
describe('no text is half translated, word by word', () => {
  it('"Not set" reads "Ayarlanmadı", and "Not" alone is never taken for the {1} of a template', () => {
    expect(VexI18nUI.lookup('Not set', 'tr')).toBe('Ayarlanmadı');
    for (const key of keys.filter((k) => /^\{1\} [a-z]/.test(k))) {
      for (const word of ['Not', 'No', 'Never', 'None']) {
        const probe = key.replace(/\{1\}/, word).replace(/\{\d\}/g, '1');
        const hit = VexI18nUI.lookup(probe, 'tr');
        if (hit == null) continue;
        // the only way it may resolve is an entry of its own, whose Turkish does not keep the English word
        expect(new RegExp('\\b' + word + '\\b').test(hit), probe + ' => ' + hit).toBe(false);
      }
    }
  });

  it('a template is not tried on a text that holds two sentences or a clause after a dash', () => {
    expect(VexI18nUI.lookup('Installed Stylus v2 — a clause with no entry of its own', 'tr')).toBeNull();
    expect(VexI18nUI.lookup('Last checked 3 min ago. A sentence with no entry of its own.', 'tr')).toBeNull();
  });

  it('a text of several sentences is translated only when every sentence is', () => {
    expect(VexI18nUI.lookup('Every extension is up to date. Every extension is up to date.', 'tr')).toBe('Tüm uzantılar güncel. Tüm uzantılar güncel.');
    expect(VexI18nUI.lookup('Every extension is up to date. Nothing else to say about it.', 'tr')).toBeNull();
  });

  // The whole renderer: any text that reaches Turkish through a template or a rule must not keep an English function word.
  it('no literal of the renderer comes out with English function words left in its Turkish', () => {
    const found = [];
    const eng = /\b(?:the|not|your|you|with|from|this|that|are|will|and|for|is|its|to|of|or|when|than|but|so)\b/i;
    for (const f of fs.readdirSync(JS).filter((n) => n.endsWith('.js') && n !== 'i18n-ui.js' && n !== 'i18n.js')) {
      let src;
      try { src = fs.readFileSync(path.join(JS, f), 'utf8').replace(/\r\n/g, '\n'); } catch { continue; }
      for (const [s, info] of literals(src)) {
        if (!readable(s, info.html) || tr[s] != null || s.length > 200 || info.fragment || /[\s:(]$/.test(s)) continue;
        const hit = VexI18nUI.lookup(s, 'tr');
        if (hit != null && eng.test(hit.replace(/\([^)]*\)|"[^"]*"|“[^”]*”/g, ''))) found.push(f + ':' + info.line + ': ' + s + '  =>  ' + hit);
      }
    }
    if (process.env.VEX_HALF_REPORT) fs.writeFileSync(process.env.VEX_HALF_REPORT, found.join('\n'));
    expect(found.length, 'Half-translated by a template:\n' + found.join('\n')).toBeLessThanOrEqual(HALF_BASELINE);
  });
});
// Two older pieces of the unit-calculator pack ("From 80 to 100 is an increase of 25%") still go through the template "From {1} to {2}": the count may only go down.
const HALF_BASELINE = 2;
