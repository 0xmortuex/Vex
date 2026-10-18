// @vitest-environment jsdom
//
// Feature usage hides a Settings section when the features of that section are switched off. It used
// to hide the section when ANY one of them was off, and it matched the heading by prefix, so switching
// off one feature hid the switches of its siblings that were still on, and the group "Holidays" also took
// "Holidays and phrases from packs" with it (and "Play" took "Playfulness").
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
let VexUsage;
const flags = {};

function load() {
  vi.resetModules();
  delete window.__vexUsageQueue;
  VexUsage = fresh('../../src/renderer/js/vex-usage.js').VexUsage;
  globalThis.VexUsage = VexUsage;
}
function register(id, group) {
  flags[id] = true;
  VexUsage.register({ id, title: id, group, keys: [], isEnabled: () => flags[id], disable: () => { flags[id] = false; }, enable: () => { flags[id] = true; } });
}
function section(heading) {
  const g = document.createElement('div');
  g.className = 'setting-group';
  g.innerHTML = '<div class="setting-label">' + heading + '</div>';
  document.querySelector('#panel-settings .settings-content').appendChild(g);
  return g;
}
const hidden = (g) => g.classList.contains('vex-usage-hidden');

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(flags)) delete flags[k];
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  delete globalThis.VexFeatures; delete globalThis.VexUsageCounters; delete globalThis.VexFeatureSheet;
  load();
});

describe('a section shared by several features', () => {
  it('stays while any one of them is on, and goes only when all are off', async () => {
    const s = section('Safer browsing helpers');
    register('qr-verdict', 'Safer browsing helpers');
    register('motw-check', 'Safer browsing helpers');
    await VexUsage.disable('qr-verdict');
    expect(hidden(s)).toBe(false);          // the switch of motw-check, still on, is still reachable
    await VexUsage.disable('motw-check');
    expect(hidden(s)).toBe(true);
    await VexUsage.enable('qr-verdict');
    expect(hidden(s)).toBe(false);          // one is back: the section is back, as it was
  });
});

describe('a heading belongs to the most specific group it starts with', () => {
  it('switching off Holidays does not hide Holidays and phrases from packs', async () => {
    const a = section('Holidays');
    const b = section('Holidays and phrases from packs');
    register('holidays', 'Holidays');
    register('pack-content', 'Holidays and phrases from packs');
    await VexUsage.disable('holidays');
    expect(hidden(a)).toBe(true);
    expect(hidden(b)).toBe(false);
    await VexUsage.enable('holidays');
    await VexUsage.disable('pack-content');
    expect(hidden(a)).toBe(false);
    expect(hidden(b)).toBe(true);
  });
  it('switching off one Play feature does not hide Playfulness', async () => {
    const play = section('Play');
    const fun = section('Playfulness');
    register('play-word', 'Play');
    register('fun-levels', 'Playfulness');
    await VexUsage.disable('play-word');
    expect(hidden(play)).toBe(true);
    expect(hidden(fun)).toBe(false);
  });
});

describe('Minimal mode (forced hidden) follows the same rule', () => {
  it('hides a section only when all of its features are held', () => {
    const s = section('Developer helpers');
    register('a', 'Developer helpers');
    register('b', 'Developer helpers');
    VexUsage.setForcedHidden(['a']);
    expect(hidden(s)).toBe(false);
    VexUsage.setForcedHidden(['a', 'b']);
    expect(hidden(s)).toBe(true);
  });
});
