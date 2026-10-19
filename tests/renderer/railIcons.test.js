// The rail's icons must be told apart at a glance. A long-time user could not find Settings because its icon was a sun
// (a circle with eight rays, the symbol for brightness), and two pairs looked alike: History and Clock and schedules (both
// clock faces), Privacy and Authenticator (both shields). jsdom cannot judge how an icon looks; this guards what can be
// checked: the gear is a gear in every place it is drawn, and no two rail buttons share a drawing.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const html = fs.readFileSync('src/renderer/index.html', 'utf8');
const rail = {};
for (const m of html.matchAll(/<button class="sidebar-icon"[^>]*data-panel="([^"]+)"[^>]*>\s*(<svg[\s\S]*?<\/svg>)/g)) rail[m[1]] = m[2];
const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/\s+/g, ' ').trim();

const SUN_RAYS = 'M12 2.8v2.6';            // the sun's first ray in the old drawing
const GEAR_TEETH = 'a1.65 1.65 0 0 0';     // the gear's tooth curves

describe('the Settings icon is a gear, not a sun', () => {
  it('in the rail', () => {
    expect(rail.settings).toBeTruthy();
    expect(rail.settings).toContain(GEAR_TEETH);
    expect(rail.settings).not.toContain('M10 2.5V4.5');
  });
  it('in the shared icon library', () => {
    const src = fs.readFileSync('src/renderer/js/vex-icons.js', 'utf8');
    const line = src.split('\n').find(l => /^\s*'settings':/.test(l));
    expect(line).toContain(GEAR_TEETH);
    expect(line).not.toContain(SUN_RAYS);
  });
  it('in the Settings panel\'s own default icon', () => {
    const src = fs.readFileSync('src/renderer/js/settings-ui.js', 'utf8');
    const line = src.split('\n').find(l => /^\s*gear:/.test(l));
    expect(line).toContain(GEAR_TEETH);
    expect(line).not.toContain(SUN_RAYS);
  });
});

describe('no two rail buttons look alike', () => {
  it('has a drawing for every button', () => {
    expect(Object.keys(rail).length).toBeGreaterThan(15);
  });
  it('gives every button its own drawing', () => {
    const seen = new Map();
    for (const [panel, svg] of Object.entries(rail)) {
      const d = inner(svg);
      expect(seen.has(d), panel + ' draws the same as ' + seen.get(d)).toBe(false);
      seen.set(d, panel);
    }
  });
  it('keeps the pairs that used to look alike apart', () => {
    expect(inner(rail.history)).not.toBe(inner(rail.clock));
    expect(inner(rail.privacy)).not.toBe(inner(rail.authenticator));
    expect(rail.authenticator).not.toContain('M12 2l7 3v6');   // no longer a shield
    expect(rail.history).toContain('M3.5 3.6v4.6h4.6');        // a back-arrow on the clock
  });
  it('draws Recall as a search of text, not the zoom-in magnifier it had', () => {
    expect(rail.recall).toContain('M8 9h5M8 12h3.5');
  });
});
