// @vitest-environment jsdom
//
// The shared rules of the living layers: off by default, a quiet gate that
// stops everything, and no frame scheduled while nothing is looking.

import { describe, it, expect, vi, beforeEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { VexLiving } = require('../../src/renderer/js/living-core.js');

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; document.body.className = ''; });

describe('settings', () => {
  it('every feature is off by default and the master switch allows', () => {
    const d = VexLiving.read();
    expect(d.animations).toBe(true);
    expect(d.tabPersonality).toBe(false);
    expect(d.tabDailyGlow).toBe(false);
    expect(d.world).toBe('off');
    expect(d.weatherLayer).toBe(false);
    expect(d.scene).toBe('off');
    expect(d.sceneWithFocus).toBe(false);
    expect(d.stickers).toBe(false);
  });

  it('rejects an unknown key or a wrong value instead of ignoring it', () => {
    expect(() => VexLiving.write({ nope: true })).toThrow(/Unknown living setting/);
    expect(() => VexLiving.write({ world: 'lava' })).toThrow(/one of/);
    expect(() => VexLiving.write({ tabPersonality: 'yes' })).toThrow(/true or false/);
    expect(() => VexLiving.write({ sceneVolume: 'loud' })).toThrow(/number/);
  });

  it('round-trips, clamps volume and survives corrupt storage', () => {
    expect(VexLiving.write({ world: 'snow', sceneVolume: 4 })).toBe(true);
    const r = VexLiving.read();
    expect(r.world).toBe('snow');
    expect(r.sceneVolume).toBe(1);
    localStorage.setItem('vex.living', '{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(VexLiving.read().world).toBe('off');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reports a refused write instead of claiming it saved', () => {
    const bad = { getItem: () => null, setItem() { throw new Error('quota'); } };
    expect(VexLiving.write({ world: 'snow' }, bad)).toBe(false);
  });
});

describe('the quiet gate', () => {
  const ok = { settings: { animations: true } };
  it('allows when nothing says otherwise', () => expect(VexLiving.quietReason(ok)).toBe(''));
  it('the master switch stops everything', () => expect(VexLiving.quietReason({ settings: { animations: false } })).toBe('animations-off'));
  it('Game mode stops everything', () => expect(VexLiving.quietReason({ ...ok, gameActive: true })).toBe('game-mode'));
  it('a hidden window stops, still-while-gaming and reduced motion stop softly', () => {
    expect(VexLiving.quietReason({ ...ok, hidden: true })).toBe('hidden');
    expect(VexLiving.quietReason({ ...ok, stillWhileGaming: true })).toBe('still');
    expect(VexLiving.quietReason({ ...ok, reducedMotion: true })).toBe('reduced-motion');
    expect(VexLiving.isHardStop('hidden')).toBe(true);
    expect(VexLiving.isHardStop('reduced-motion')).toBe(false);
  });
  it('reads reduce-motion and the gaming-still class from the page', () => {
    document.documentElement.setAttribute('data-reduce-motion', '');
    expect(VexLiving.readEnv().reducedMotion).toBe(true);
    document.documentElement.removeAttribute('data-reduce-motion');
    document.body.classList.add('vex-gaming-still');
    expect(VexLiving.readEnv().stillWhileGaming).toBe(true);
  });
});

describe('the frame loop schedules nothing while quiet', () => {
  function rig(envObj, fps) {
    const frames = [];
    let id = 0;
    const draws = [];
    const loop = VexLiving.createLoop({
      fps: fps || 30,
      raf: (f) => { frames.push(f); return ++id; },
      caf: () => { frames.length = 0; },
      now: () => 0,
      env: () => envObj,
      draw: (dt, still) => draws.push({ dt, still })
    });
    return { loop, frames, draws, envObj };
  }

  it('runs: one frame request is pending, a draw schedules the next', () => {
    const r = rig({ settings: { animations: true } });
    r.loop.start();
    expect(r.loop.snapshot().scheduled).toBe(true);
    r.frames.shift()(100);
    expect(r.draws.length).toBe(1);
    expect(r.draws[0].still).toBe(false);
    expect(r.frames.length).toBe(1);
  });

  it('a hidden or Game-mode layer has no frame request at all and paints nothing', () => {
    for (const patch of [{ hidden: true }, { gameActive: true }, { settings: { animations: false } }]) {
      const r = rig({ settings: { animations: true }, ...patch });
      expect(r.loop.start()).not.toBe('');
      expect(r.frames.length).toBe(0);
      expect(r.draws.length).toBe(0);
      expect(r.loop.snapshot().scheduled).toBe(false);
    }
  });

  it('reduced motion paints exactly one still frame and then idles', () => {
    const r = rig({ settings: { animations: true }, reducedMotion: true });
    r.loop.start();
    r.loop.evaluate(); r.loop.evaluate();
    expect(r.draws).toEqual([{ dt: 0, still: true }]);
    expect(r.frames.length).toBe(0);
  });

  it('goes idle when the page hides and wakes when it shows again', () => {
    const r = rig({ settings: { animations: true } });
    r.loop.start();
    expect(r.loop.snapshot().scheduled).toBe(true);
    r.envObj.hidden = true;
    r.loop.evaluate();
    expect(r.loop.snapshot().scheduled).toBe(false);
    r.envObj.hidden = false;
    r.loop.evaluate();
    expect(r.loop.snapshot().scheduled).toBe(true);
  });

  it('caps the frame rate: frames inside the gap are skipped', () => {
    const r = rig({ settings: { animations: true } }, 10);    // 100 ms gap
    r.loop.start();
    r.frames.shift()(1000);
    r.frames.shift()(1030);
    r.frames.shift()(1060);
    r.frames.shift()(1110);
    expect(r.draws.length).toBe(2);
  });

  it('stop() cancels the pending frame', () => {
    const r = rig({ settings: { animations: true } });
    r.loop.start(); r.loop.stop();
    expect(r.loop.snapshot().scheduled).toBe(false);
  });
});

describe('particles and the seeded generator', () => {
  it('is deterministic per seed', () => {
    const a = VexLiving.rng(7), b = VexLiving.rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('a field has a fixed pool that never grows', () => {
    const f = VexLiving.createField({ count: 12, seed: 3, w: 100, h: 100, init: (r) => ({ y: r() }), step: (p, dt) => { p.y += dt; } });
    f.step(0.1); f.step(0.1);
    expect(f.parts.length).toBe(12);
  });
});

describe('Settings group', () => {
  it('is built at runtime from registered rows, only for known keys', () => {
    document.body.innerHTML = '<div class="settings-content"></div>';
    VexLiving._rows.length = 0;
    expect(() => VexLiving.registerSettings([{ key: 'bogus', label: 'x', type: 'toggle' }])).toThrow(/unknown key/);
    VexLiving.registerSettings([{ key: 'tabPersonality', label: 'Tab moves', type: 'toggle' }]);
    const g = document.getElementById('living-settings');
    expect(g).toBeTruthy();
    const box = g.querySelector('input[type=checkbox]');
    expect(box.checked).toBe(false);
    box.checked = true; box.dispatchEvent(new Event('change'));
    expect(VexLiving.read().tabPersonality).toBe(true);
    VexLiving.registerSettings([{ key: 'tabPersonality', label: 'Tab moves', type: 'toggle' }]);
    expect(g.querySelectorAll('.living-row').length).toBe(1);
  });
});

describe('living.css cannot shift a tab', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'css', 'living.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const ALLOWED = new Set(['transform', 'transform-origin', 'filter', 'opacity', 'animation', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-fill-mode', 'animation-iteration-count']);

  it('tab rules and keyframes only use transform, filter, opacity and animation', () => {
    const blocks = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(stripped))) blocks.push({ sel: m[1].trim(), body: m[2] });
    // keyframe steps are blocks whose selector is a percentage list
    const tabish = blocks.filter(b => /vex-tp|^\d+%|^from|^to|^0%/.test(b.sel) && !/@keyframes/.test(b.sel) || /^\d+%(,\s*\d+%)*$/.test(b.sel));
    expect(tabish.length).toBeGreaterThan(10);
    for (const b of tabish) {
      for (const decl of b.body.split(';').map(s => s.trim()).filter(Boolean)) {
        const prop = decl.split(':')[0].trim();
        expect(ALLOWED.has(prop), b.sel + ' uses ' + prop).toBe(true);
      }
    }
  });

  it('honours reduced motion and the gaming-still class', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/vex-gaming-still/);
    expect(css).toMatch(/data-reduce-motion/);
  });
});
