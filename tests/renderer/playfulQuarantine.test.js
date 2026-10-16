// @vitest-environment jsdom
//
// The playfulness quarantine (Wave 4, section 11): every fun or ambient module is on the list in
// VexPlayfulness.MODULES, asks the master level (or says why it has no ambient surface), is off in
// Simple mode and Minimal Vex, and makes no sound unless the person switched sound on. A new fun
// module that is not on the list, or is on it without its gate, fails here.
import { describe, it, expect, beforeEach } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const src = (rel) => fs.readFileSync(path.join(JS, rel), 'utf8');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const { VexPlayfulness: P0 } = fresh('vex-playfulness.js');
const MODULES = P0.MODULES;

function walk(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

describe('the list', () => {
  it('names every module the owner listed, once', () => {
    const ids = MODULES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const need of ['medals', 'vex-pet', 'sound-packs', 'mood-themes', 'seasonal-worlds', 'mini-games', 'tab-tetris', 'tab-personality', 'jingle', 'fortune', 'daily-word', 'coop-timer', 'friend-card', 'widgets', 'rabbit-hole', 'time-capsule', 'year-in-vex', 'badges']) {
      expect(ids, need).toContain(need);
    }
  });

  it('points at files that exist and kinds that exist', () => {
    for (const m of MODULES) {
      expect(fs.existsSync(path.join(JS, m.file)), m.id + ' file').toBe(true);
      if (!m.explicit) expect(Object.keys(P0.NEEDS), m.id + ' kind').toContain(m.kind);
    }
  });
});

describe('every module asks the gate', () => {
  for (const m of MODULES.filter(x => !x.explicit)) {
    it(m.id + ' asks for the "' + m.kind + '" kind', () => {
      expect(src(m.file), m.id + ' must contain ' + m.gate + ' (or use ' + m.uses + ')').toContain(m.uses || m.gate);
      const gateFile = m.gateFile || m.file;
      expect(src(gateFile), gateFile + ' must contain ' + m.gate).toContain(m.gateRoot ? m.gateRoot : m.gate);
      if (m.gateRoot) expect(src(m.file)).toContain(m.gate);
    });
  }
});

describe('a module with no ambient surface says so, and proves it', () => {
  for (const m of MODULES.filter(x => x.explicit)) {
    it(m.id + ' makes no sound of its own and registers no Brief or New Tab card', () => {
      expect(typeof m.why).toBe('string');
      expect(m.why.length).toBeGreaterThan(20);
      const text = src(m.file);
      if (m.id !== 'focus-scenes') expect(text).not.toMatch(/AudioContext|new Audio\(/);
      expect(text).not.toMatch(/NewTabSlots\.register\(|VexBrief\.register\(/);
    });
  }
  it('focus scenes never play during Game mode', () => {
    expect(src('focus-scenes.js')).toContain("return 'game-mode'");
  });
});

describe('a new fun module cannot slip past', () => {
  const listed = new Set([...MODULES.map(m => m.file), ...MODULES.map(m => m.gateFile).filter(Boolean), ...P0.FUNCTIONAL_AUDIO]);
  // The shared cores and the code that reads the master level are not fun modules.
  const CORE = new Set(['fun/fun-core.js', 'fun/fun-settings.js', 'vex-fun.js', 'living-core.js', 'vex-playfulness.js', 'vex-expression.js', 'vex-extras.js', 'newtab-slots.js', 'vex-medals-catalog.js', 'vex-medals-profile.js', 'vex-titles.js', 'vex-cosmetics.js', 'vex-unlock.js', 'focus-os.js', 'key-trainer.js', 'on-this-day.js', 'old-bookmark.js', 'speed-run.js', 'vex-integration.js', 'delights.js']);
  const files = walk(JS);

  it('every file that makes a sound is a listed module or listed functional audio', () => {
    const bad = files.filter(f => /AudioContext|new Audio\(|createOscillator/.test(src(f)) && !listed.has(f));
    expect(bad, 'sound outside the list: add it to VexPlayfulness.MODULES (or FUNCTIONAL_AUDIO with a reason)').toEqual([]);
  });

  it('every file that registers a living-layer switch or a Play switch is listed', () => {
    const bad = files.filter(f => /VexLiving\.registerSettings|VexFun\.(switchRow|group)\(|VexProgress\.enabled\(/.test(src(f)) && !listed.has(f) && !CORE.has(f));
    expect(bad, 'a fun switch outside the list').toEqual([]);
  });

  it('every file that signals a medal is a listed module or a known core', () => {
    const bad = files.filter(f => /VexFun\.medal\(|VexProgress\.medal\(|vex:medal-signal/.test(src(f)) && !listed.has(f) && !CORE.has(f));
    expect(bad, 'a medal source outside the list').toEqual([]);
  });
});

describe('Simple mode, Minimal Vex and sound defaults', () => {
  let P;
  beforeEach(() => {
    localStorage.clear();
    for (const n of ['VexDefaults', 'VexMigrations', 'VexPlayfulness', 'AttentionState', 'VexSimpleMode', 'VexMinimalMode']) delete globalThis[n];
    const d = fresh('vex-defaults.js');
    globalThis.VexDefaults = d.VexDefaults; globalThis.VexMigrations = d.VexMigrations;
    globalThis.AttentionState = fresh('attention-state.js').AttentionState;
    P = fresh('vex-playfulness.js').VexPlayfulness; globalThis.VexPlayfulness = P;
  });

  it('allows no playful kind in Simple mode and none in Minimal Vex, whatever level was chosen', () => {
    P.setLevel('full');
    for (const k of Object.keys(P.NEEDS)) expect(P.allowed(k), k).toBe(true);
    globalThis.VexSimpleMode = { isSimple: () => true };
    for (const k of Object.keys(P.NEEDS)) expect(P.allowed(k), 'simple ' + k).toBe(false);
    delete globalThis.VexSimpleMode;
    globalThis.VexMinimalMode = { isOn: () => true };
    for (const k of Object.keys(P.NEEDS)) expect(P.allowed(k), 'minimal ' + k).toBe(false);
  });

  it('the default level is Calm: no sound and no medal or level toast', () => {
    expect(P.chosen()).toBe('calm');
    for (const k of ['sound', 'medal-toast', 'celebrate']) expect(P.allowed(k), k).toBe(false);
    expect(P.allowed('jingle')).toBe(true);            // allowed to ask, but its own slots are off (next test)
  });

  it('every sound switch is off on a profile with nothing saved', () => {
    const { VexFun } = fresh('vex-fun.js');
    expect(VexFun.flag('sounds')).toBe(false);
    for (const k of ['games', 'tetris', 'word', 'sounds']) expect(VexFun.flag(k), k).toBe(false);
    const jingle = src('vex-jingle.js');
    expect(jingle).toMatch(/startup: \{ on: false/);
    expect(jingle).toMatch(/finish: \{ on: false/);
  });

  it('the Little surprises are all off by default', () => {
    const { VexDelights } = fresh('delights.js');
    for (const f of VexDelights.FEATURES) expect(f.def, f.key).toBe(false);
  });
});
