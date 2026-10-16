// @vitest-environment jsdom
//
// T3-053: Turkish completeness of what the person reads first.
//
// Every Settings heading, every Settings chip (category) and every Ctrl+K command label must
// have a Turkish entry in TABLE.tr of js/i18n-ui.js, or sit in tests/renderer/l10nBaseline.json.
// That file is the documented allowlist: strings that were English before this test existed,
// and strings Vex deliberately leaves as they are (names such as "MCP"). It may only SHRINK:
//
//   - a new heading / chip / command with no Turkish entry fails the test ("add it to TABLE.tr");
//   - a baseline entry that has since been translated fails too ("remove it from the baseline").
//
// The missing count is printed with every run. To regenerate the baseline after a merge brings
// in features from other branches (the integrator does this once), run:
//     $env:VEX_L10N_WRITE = '1'; pnpm vitest run tests/renderer/localeCompleteness.test.js
//
// What is scanned: headings = <label class="setting-label"> in index.html and the title of every
// VexSettingsGroups.register({...}); chips = SettingsUI.CATS names and their short names;
// commands = the label of every entry in command.js and of every VexExtras.registerCommand.
// Static scan of the source, so it needs no running app. A label built at run time, or put
// together from pieces, is not seen; those stay English until someone lists them here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..');
const JS = path.join(ROOT, 'src', 'renderer', 'js');
const BASELINE = path.join(__dirname, 'l10nBaseline.json');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { SettingsUI } = require('../../src/renderer/js/settings-ui.js');

// Brand names and acronyms that read the same in Turkish.
const SAME_IN_TURKISH = new Set(['MCP', 'AI', 'GitHub', 'Vex', 'WebGPU']);

function unescape1(s) { return s.replace(/\\'/g, "'").trim(); }

function collect() {
  const found = new Map();      // "kind|label" -> where
  const add = (kind, label, where) => {
    const t = unescape1(label);
    if (t.length < 2) return;
    const k = kind + '|' + t;
    if (!found.has(k)) found.set(k, where);
  };
  const html = fs.readFileSync(path.join(ROOT, 'src/renderer/index.html'), 'utf8');
  for (const m of html.matchAll(/<label[^>]*class="[^"]*setting-label[^"]*"[^>]*>([\s\S]*?)<\/label>/g)) {
    add('heading', m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' '), 'index.html');
  }
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    for (const m of src.matchAll(/VexSettingsGroups\.register\(\{[^}]*?title:\s*'((?:[^'\\]|\\.)*)'/g)) add('heading', m[1], f);
    for (const m of src.matchAll(/registerCommand\(\{[^}]*?label:\s*'((?:[^'\\]|\\.)*)'/g)) add('command', m[1], f);
    if (f === 'command.js') for (const m of src.matchAll(/\{\s*id:\s*'[^']+',\s*label:\s*'((?:[^'\\]|\\.)*)'/g)) add('command', m[1], f);
  }
  // commands registered from a list of objects: { id: '...', label: '...' } in study-extras.js and friends
  for (const f of fs.readdirSync(JS).filter(n => n.endsWith('.js') && n !== 'command.js')) {
    const src = fs.readFileSync(path.join(JS, f), 'utf8');
    if (!/commands\(\)\s*\{/.test(src)) continue;
    for (const m of src.matchAll(/\{\s*id:\s*'[^']+',\s*label:\s*'((?:[^'\\]|\\.)*)'/g)) add('command', m[1], f);
  }
  for (const c of SettingsUI.CATS) { add('chip', c.name, 'settings-ui.js'); if (c.short) add('chip', c.short, 'settings-ui.js'); }
  return found;
}

const tr = VexI18nUI.TABLE.tr;
const translated = (label) => tr[label] != null || SAME_IN_TURKISH.has(label);

describe('T3-053 Turkish completeness of headings, chips and commands', () => {
  const found = collect();
  const missing = [...found.keys()].filter(k => !translated(k.slice(k.indexOf('|') + 1))).sort();

  it('the scan sees the labels (a broken scan would pass everything)', () => {
    const kinds = { heading: 0, chip: 0, command: 0 };
    for (const k of found.keys()) kinds[k.split('|')[0]]++;
    expect(kinds.heading).toBeGreaterThan(60);
    expect(kinds.chip).toBeGreaterThan(30);
    expect(kinds.command).toBeGreaterThan(250);
  });

  it('reports the missing count', () => {
    // eslint-disable-next-line no-console
    console.log('[l10n] ' + missing.length + ' of ' + found.size + ' headings, chips and commands have no Turkish entry (' + JSON.stringify(
      missing.reduce((o, k) => { const kind = k.split('|')[0]; o[kind] = (o[kind] || 0) + 1; return o; }, {})) + ')');
    expect(missing.length).toBeLessThanOrEqual(found.size);
  });

  it('no new heading, chip or command is left without Turkish', () => {
    if (process.env.VEX_L10N_WRITE) {
      fs.writeFileSync(BASELINE, JSON.stringify({
        note: 'Allowlist for tests/renderer/localeCompleteness.test.js: headings, chips and commands that had no Turkish entry in js/i18n-ui.js when the test was written. It may only shrink: translate one, then delete it here.',
        untranslated: missing,
      }, null, 1) + '\n');
    }
    const base = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).untranslated);
    const fresh = missing.filter(k => !base.has(k));
    expect(fresh, 'Add these to TABLE.tr in js/i18n-ui.js (or, for a name that reads the same, to SAME_IN_TURKISH in this test):\n' + fresh.join('\n')).toEqual([]);
  });

  it('the baseline only shrinks: translated entries are removed from it', () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).untranslated;
    const stale = base.filter(k => !missing.includes(k));
    expect(stale, 'These now have Turkish (or no longer exist): remove them from tests/renderer/l10nBaseline.json\n' + stale.join('\n')).toEqual([]);
  });

  it('every study helper heading and command from Wave 3 is translated, none on the allowlist', () => {
    const wave3 = ['Study helpers', 'Glossary', 'Find terms on this page', 'Study time', 'Cheat sheet from highlights', 'Check a draft', 'Syllabus coverage', 'Source check (rough)', 'MUN toolkit', 'Motion wording', 'Speech timer', 'Turkish helpers'];
    for (const l of wave3) expect(tr[l], l).toBeTruthy();
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).untranslated;
    for (const l of wave3) expect(base.some(k => k.endsWith('|' + l)), l).toBe(false);
  });

  it('the strings added with this test are not in TABLE.tr twice (the second would silently win)', () => {
    // Nine older keys ("Delete", "Remove", "Today" ...) are in the table twice already; only the
    // block that came with this test is held to it.
    const src = fs.readFileSync(path.join(JS, 'i18n-ui.js'), 'utf8');
    const body = src.slice(src.indexOf('tr: {'));
    const mark = body.indexOf('Settings headings and Ctrl+K commands added in Waves 0-3');
    expect(mark).toBeGreaterThan(0);
    const keys = (s) => [...s.matchAll(/'((?:[^'\\]|\\.)*)':\s*'/g)].map(m => m[1]);
    const mine = new Set(keys(body.slice(mark)));
    const all = keys(body);
    const dup = [...mine].filter(k => all.filter(x => x === k).length > 1);
    expect(dup).toEqual([]);
  });

  it('a Turkish translation never leaves a {} placeholder out', () => {
    for (const [en, t] of Object.entries(tr)) {
      const a = (en.match(/\{\}/g) || []).length, b = (t.match(/\{\}/g) || []).length;
      expect(b, en).toBe(a);
    }
  });
});
