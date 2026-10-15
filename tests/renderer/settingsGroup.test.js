// @vitest-environment jsdom
//
// A Settings group a module owns: put into the page at runtime, before About,
// in the markup of the hand-written groups; drawn again on refresh.

import { beforeEach, describe, expect, it, vi } from 'vitest';
const { VexSettingsGroup: G } = require('../../src/renderer/js/settings-group.js');

beforeEach(() => {
  G._specs.clear();
  document.body.innerHTML = `<div id="panel-settings"><div class="settings-content">
    <div class="setting-group"><label class="setting-label">General</label></div>
    <div class="setting-group"><label class="setting-label">About</label></div>
  </div></div>`;
});

describe('VexSettingsGroup', () => {
  it('adds a group before About, with the usual markup, and fills it', () => {
    const el = G.add({ id: 'settings-x', title: 'Things', info: 'What they do', build: (b) => b.append(G.toggle('Do it', true, () => {})) });
    const kids = [...document.querySelector('.settings-content').children];
    expect(kids.map(k => k.querySelector('.setting-label').textContent)).toEqual(['General', 'Things', 'About']);
    expect(el.className).toBe('setting-group');
    expect(el.querySelector('.setting-info').textContent).toBe('What they do');
    const box = el.querySelector('input[type=checkbox]');
    expect(box.checked).toBe(true);
    expect(box.getAttribute('aria-label')).toBe('Do it');
  });

  it('refresh draws the same box again, and a toggle reports its change', () => {
    let n = 0;
    const change = vi.fn();
    G.add({ id: 'settings-y', title: 'Y', build: (b) => { n++; b.append(G.toggle('T', false, change)); } });
    G.refresh('settings-y');
    expect(n).toBe(2);
    expect(document.querySelectorAll('#settings-y input').length).toBe(1);
    const input = document.querySelector('#settings-y input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith(true);
  });

  it('says what went wrong in the group instead of leaving it empty', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    G.add({ id: 'settings-z', title: 'Z', build: () => { throw new Error('no data'); } });
    expect(document.getElementById('settings-z').textContent).toMatch(/could not be drawn: no data/);
    spy.mockRestore();
  });

  it('refuses a group with no id or no builder', () => {
    expect(() => G.add({ id: 'Bad Id', title: 'x', build() {} })).toThrow(/id/);
    expect(() => G.add({ id: 'ok', title: '' , build() {} })).toThrow(/title/);
  });
});
