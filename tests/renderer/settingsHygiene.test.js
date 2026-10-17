// Settings hygiene for the 2026-10 modules: every group a module injects at run
// time lands in a named category chip (not "Other"), the new chips have a Turkish
// name, no two modules own the same preference, and the script tags are in a
// valid order. Static: it reads the sources, as the other source-shape tests do.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const RJS = path.join(ROOT, 'src/renderer/js');
const read = (p) => fs.readFileSync(p, 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory()
    ? walk(path.join(dir, e.name))
    : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : [])));
}

const ui = read(path.join(RJS, 'settings-ui.js'));
const catsSrc = ui.slice(ui.indexOf('CATS: ['), ui.indexOf('// How a group\'s one chip'));
const CATS = [...catsSrc.matchAll(/\{ name: '([^']+)'[^}]*match: \[([^\]]*)\]/g)]
  .map(m => ({ name: m[1], match: [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]) }));
const catOf = (heading) => {
  const t = heading.toLowerCase();
  for (const c of CATS) if (c.match.some(m => t.includes(m))) return c.name;
  return 'Other';
};

// Headings of the groups modules add themselves (the same shapes SettingsUI
// reads). Headings of the static page are not new and are not scanned here.
function headings() {
  const out = new Map();
  const add = (h, f) => { if (h && h.length <= 120 && !/[`$]\{/.test(h)) out.set(h.trim(), path.basename(f)); };
  for (const f of walk(RJS)) {
    const s = read(f);
    for (const m of s.matchAll(/class="setting-label"[^>]*>([^<$]{3,100})</g)) add(m[1], f);
    for (const m of s.matchAll(/(?:VexSettingsGroups\.register|VexSettingGroup\.add|\.group)\(\{[^}]*?title:\s*'([^']+)'/g)) add(m[1], f);
    for (const m of s.matchAll(/(?:label|title)\.textContent = '([^']+)'/g)) add(m[1], f);
  }
  return out;
}

// Headings that were already "Other" before the 2026-10 modules (found by
// running this scan on main); listed so the scan keeps its edge: a NEW group
// that lands in "Other" fails.
const BASELINE_OTHER = new Set(['Web search']);

describe('settings groups', () => {
  it('every group a module injects lands in a named chip', () => {
    const lost = [...headings()].filter(([h]) => catOf(h) === 'Other' && !BASELINE_OTHER.has(h)).map(([h, f]) => h + ' (' + f + ')');
    expect(lost, 'groups with no chip: ' + lost.join('; ')).toEqual([]);
  });

  it('the chips added for the new features have Turkish names', () => {
    const tr = read(path.join(RJS, 'i18n-ui.js'));
    for (const chip of ['Play', 'Focus OS', 'Knowledge', 'Vex health']) {
      expect(CATS.some(c => c.name === chip), chip + ' chip').toBe(true);
      expect(tr.includes("'" + chip + "':"), 'Turkish for ' + chip).toBe(true);
    }
  });

  it('Focus OS sorts before Focus, so its heading is not swallowed by "focus"', () => {
    const names = CATS.map(c => c.name);
    expect(names.indexOf('Focus OS')).toBeLessThan(names.indexOf('Focus'));
    expect(catOf('Focus OS (goals and work blocks)')).toBe('Focus OS');
  });
});

describe('preferences', () => {
  it('no two new modules own the same storage key (shared reads are fine; shared definitions are not)', () => {
    const defs = new Map();
    for (const f of walk(RJS)) {
      const s = read(f);
      for (const m of s.matchAll(/\b[A-Z_]*KEY[A-Z_]*\s*:\s*'(vex\.[A-Za-z0-9._-]+)'/g)) {
        (defs.get(m[1]) || defs.set(m[1], new Set()).get(m[1])).add(path.basename(f));
      }
    }
    // Keys a module declares as its own: any key declared as an owned KEY in
    // two different files is a collision, except the listed shared stores.
    // Reviewed: the six brief extras share one record by design; the notes store is
    // written by the notes panel and the weekly note and read by time travel; the
    // mail headers are read (not written) by renewals and universal search; the
    // archived tabs list is the read-later and tab-snooze handover; the breach-check switch is owned
    // and written by Password Health, and only read by the weekly re-check in safe-web-extras.js.
    const SHARED = new Set(['vex.briefExtras', 'vex.notes', 'vex.mailHeaders', 'vex.archivedTabs', 'vex.breachCheck']);
    const clash = [...defs].filter(([k, v]) => v.size > 1 && !SHARED.has(k)).map(([k, v]) => k + ' <- ' + [...v].join(', '));
    expect(clash).toEqual([]);
  });
});

describe('script order in index.html', () => {
  const html = read(path.join(ROOT, 'src/renderer/index.html'));
  const order = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]);
  const at = (f) => order.indexOf(f);
  // Modules that load after start-up (js/lazy-boot.js LATE_MODULES) are in the window, after every blocking script.
  const late = [...read(path.join(RJS, 'lazy-boot.js')).matchAll(/src: 'js\/([^']+)'/g)].map(m => m[1]);
  const inWindow = (f) => at(f) >= 0 || late.includes(f);

  it('has no script twice', () => {
    expect(order.filter((f, i) => order.indexOf(f) !== i)).toEqual([]);
  });

  it('puts foundations before their consumers', () => {
    const pairs = [
      ['living-core.js', 'tab-personality.js'], ['living-core.js', 'seasonal-worlds.js'], ['living-core.js', 'weather-layer.js'],
      ['living-core.js', 'focus-scenes.js'], ['living-core.js', 'sticker-sheet.js'],
      ['vex-medals.js', 'vex-medals-catalog.js'], ['vex-medals.js', 'fun/fun-core.js'], ['vex-medals-catalog.js', 'fun/levels.js'],
      ['vex-defaults.js', 'sleep-consent.js'], ['vex-defaults.js', 'vex-playfulness.js'], ['attention-state.js', 'vex-attention.js'], ['vex-attention.js', 'attention-inbox.js'],
      ['vex-settings-groups.js', 'vex-playfulness.js'], ['vex-settings-groups.js', 'newtab-slots.js'],
      ['vex-playfulness.js', 'app.js'], ['newtab-slots.js', 'app.js'],
      ['vex-attention.js', 'vex-medals.js'], ['fun/fun-core.js', 'fun/levels.js'], ['fun/fun-core.js', 'fun/vex-pet.js'],
      ['vex-usage.js', 'vex-usage-registry.js'],
      ['vex-fun.js', 'vex-sounds.js'], ['vex-usage-registry.js', 'app.js'], ['vex-integration.js', 'app.js'],
      ['packs-ui.js', 'packs-consumers.js'], ['packs-consumers.js', 'app.js'], ['brief-integration.js', 'vex-integration.js'],
    ];
    const bad = pairs.filter(([a, b]) => at(a) < 0 || at(b) < 0 || at(a) > at(b)).map(([a, b]) => a + ' before ' + b);
    expect(bad).toEqual([]);
  });

  it('every new feature module that is not loaded by the start page is in the main window', () => {
    const start = read(path.join(ROOT, 'src/renderer/start.html'));
    const new26 = ['living-core.js', 'tab-personality.js', 'seasonal-worlds.js', 'weather-layer.js', 'focus-scenes.js', 'sticker-sheet.js',
      'fun/fun-core.js', 'fun/levels.js', 'fun/discovery-log.js', 'fun/daily-challenge.js', 'fun/vex-pet.js', 'fun/fun-settings.js',
      'vex-attention.js', 'vex-integration.js', 'vex-usage-registry.js', 'packs-consumers.js'];
    expect(new26.filter(f => !inWindow(f) && !start.includes('js/' + f))).toEqual([]);
  });
});

describe('where a module puts its Settings group', () => {
  it('inside .settings-content, never as another child of the panel (it became a third flex column and squeezed Settings)', () => {
    const bad = [];
    for (const f of walk(RJS)) {
      const s = read(f);
      if (!/getElementById\('panel-settings'\)/.test(s)) continue;
      if (/\|\|\s*panel\)\.appendChild\(/.test(s) && !/querySelector\('\.settings-content'\)\s*\|\|\s*panel\)\.appendChild\(/.test(s)) bad.push(path.basename(f));
      if (/querySelector\('\.panel-content'\)\s*\|\|\s*panel/.test(s)) bad.push(path.basename(f) + ' (.panel-content)');
    }
    expect(bad).toEqual([]);
  });
});

describe('groups that other helpers add', () => {
  it('the daily-batch groups are in a chip too', () => {
    for (const h of ['New tab by time of day', 'Why a tab is open', 'Repeated searches', 'Shopping comparison']) {
      expect(catOf(h), h).not.toBe('Other');
    }
  });
});

describe('category chips', () => {
  it('scroll to the first section that is shown, not to a switched-off one (check:ui settings-nav-mark)', () => {
    expect(ui).toMatch(/target\.getClientRects\(\)\.length \? target : Array\.from\(root\.children\)/);
  });
});
