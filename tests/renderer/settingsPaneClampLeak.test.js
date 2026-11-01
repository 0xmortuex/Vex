// @vitest-environment jsdom
//
// SettingsPane._clamp runs on every refresh (every time Settings opens). It used to add a new "focusin" listener to the section each
// time, and that listener shared a scope with the list it had just found, so every open kept the old personas grid, memory list and
// so on alive: the smoke matrix leak canary read ~1,400 nodes and ~130 listeners per open of AI router / AI memory / Skills.
import { beforeAll, describe, expect, it } from 'vitest';

require('../../src/renderer/js/vex-utils.js');
const { SettingsPane } = require('../../src/renderer/js/settings-pane.js');

describe('SettingsPane._clamp', () => {
  beforeAll(() => {
    Element.prototype.getClientRects = function () { return [{}]; };
  });

  it('waits for focus with ONE listener per section, however often it runs', () => {
    document.body.innerHTML = '<div class="setting-group" id="g"><div id="list">' + '<div class="row">x</div>'.repeat(12) + '</div></div>';
    const g = document.getElementById('g');
    let adds = 0;
    const orig = g.addEventListener.bind(g);
    g.addEventListener = (type, ...rest) => { if (type === 'focusin') adds++; return orig(type, ...rest); };
    // A module draws its list again each time Settings opens: a new list element, so it is clamped anew.
    for (let i = 0; i < 5; i++) {
      g.innerHTML = '<div>' + '<div class="row">x</div>'.repeat(12) + '</div>';
      SettingsPane._clamp([g]);
    }
    expect(g.querySelectorAll('.set-clamp-btn').length).toBe(1);
    expect(adds).toBe(1);
  });

  it('listens again after a focus has opened the list', () => {
    document.body.innerHTML = '<div class="setting-group" id="g"><div id="list">' + '<div class="row">x</div>'.repeat(12) + '</div></div>';
    const g = document.getElementById('g');
    SettingsPane._clamp([g]);
    g.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(g.querySelector('.set-clamp-btn')).toBeNull();
    expect(g.dataset.clampDone).toBe('open');
    expect(g._clampFocusWaiting).toBe(false);
  });
});
