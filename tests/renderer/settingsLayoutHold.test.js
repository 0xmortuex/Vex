// @vitest-environment jsdom
// While Settings draws its sections the placement of the blocks waits, and happens once at the end.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { SettingsUI } = await import('../../src/renderer/js/settings-ui.js');

let blocks;
beforeEach(() => {
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  blocks = vi.spyOn(SettingsUI, '_layoutBlocks').mockReturnValue(false);
  blocks.mockClear();
  SettingsUI._held = 0; SettingsUI._owed = false;
});

const root = () => document.querySelector('.settings-content');

describe('SettingsUI.holdLayout', () => {
  it('places the blocks as before when nothing is held', () => {
    SettingsUI._layout(root());
    SettingsUI._layout(root());
    expect(blocks).toHaveBeenCalledTimes(2);
  });

  it('skips every placement while held, and does one when it is let go of', () => {
    const release = SettingsUI.holdLayout();
    for (let i = 0; i < 30; i++) expect(SettingsUI._layout(root(), { keepCols: true })).toBe(false);
    expect(blocks).not.toHaveBeenCalled();
    release();
    expect(blocks).toHaveBeenCalledTimes(1);
  });

  it('does nothing at the end when nobody asked, and letting go twice is harmless', () => {
    const release = SettingsUI.holdLayout();
    release();
    release();
    expect(blocks).not.toHaveBeenCalled();
    expect(SettingsUI._held).toBe(0);
  });

  it('places again a frame later while the layout says it is not done (a new menu or column count)', async () => {
    blocks.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const release = SettingsUI.holdLayout();
    SettingsUI._layout(root());
    release();
    expect(blocks).toHaveBeenCalledTimes(1);
    await new Promise(r => requestAnimationFrame(() => r()));
    await new Promise(r => requestAnimationFrame(() => r()));
    await new Promise(r => requestAnimationFrame(() => r()));
    expect(blocks).toHaveBeenCalledTimes(3);
  });

  it('nested holds place once, when the last one is let go of', () => {
    const a = SettingsUI.holdLayout();
    const b = SettingsUI.holdLayout();
    SettingsUI._layout(root());
    a();
    expect(blocks).not.toHaveBeenCalled();
    b();
    expect(blocks).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsUI.enhanceIfChanged', () => {
  const page = (labels) => {
    document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"><h2>Settings</h2>' +
      labels.map((t, i) => `<div class="setting-group" id="g${i}"><div class="setting-label"><strong>${t}</strong></div></div>`).join('') + '</div></div>';
  };
  it('enhances the first time, and not again while the sections and the language are the same', () => {
    page(['General', 'Privacy & Security']);
    const enhance = vi.spyOn(SettingsUI, 'enhance');
    SettingsUI._seen = undefined;
    expect(SettingsUI.enhanceIfChanged()).toBe(true);
    expect(SettingsUI.enhanceIfChanged()).toBe(false);
    expect(enhance).toHaveBeenCalledTimes(1);
  });
  it('enhances again when a section appeared, was hidden, or the language changed', () => {
    page(['General', 'Privacy & Security']);
    SettingsUI._seen = undefined;
    SettingsUI.enhanceIfChanged();
    document.querySelector('.settings-content').insertAdjacentHTML('beforeend', '<div class="setting-group" id="late"><div class="setting-label"><strong>About</strong></div></div>');
    expect(SettingsUI.enhanceIfChanged()).toBe(true);                       // a section appeared
    document.getElementById('g1').style.display = 'none';
    expect(SettingsUI.enhanceIfChanged()).toBe(true);                       // one was hidden
    expect(SettingsUI.enhanceIfChanged()).toBe(false);
    globalThis.VexI18nUI = { locale: () => 'tr', english: (el) => el.textContent, lookup: () => null };
    try { expect(SettingsUI.enhanceIfChanged()).toBe(true); } finally { delete globalThis.VexI18nUI; }   // the language changed
  });
});
