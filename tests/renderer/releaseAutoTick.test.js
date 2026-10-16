// @vitest-environment jsdom
//
// T2-008: the release check ticks an item by itself only when it SAW the item opened (a command ran,
// a feature or its Settings section opened), and never an item only a person can judge.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
let V;
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  delete require.cache[require.resolve(JS + 'release-checklist.js')];
  ({ VexReleaseChecklist: V } = require(JS + 'release-checklist.js'));
  globalThis.VexReleaseChecklist = V;
  window.vex = { getAppVersion: async () => '9.9.9', getReleaseNotes: async () => ({ version: 'v9.9.9', name: 'Test', body: BODY }) };
});

const BODY = [
  '### New',
  '- **Archive library:** Ctrl+K › "Archive This Page" keeps a self-contained copy.',
  '- **AI news (Settings › AI News):** Vex tells you about new stories.',
  '- **Patch radar:** give a game a patch notes page.',
  '',
  '### Fixed',
  '- **Discord screen sharing no longer fails.** The share picker refused your choice.',
].join('\n');

describe('which items may be ticked by the app', () => {
  it('marks a fix and an item with nowhere to go as manual only', () => {
    const items = V.parse(BODY);
    const by = Object.fromEntries(items.map(i => [i.title, i.manual]));
    expect(by['Archive library']).toBe(false);
    expect(by['AI news']).toBe(false);
    expect(by['Patch radar']).toBe(true);
    expect(by['Discord screen sharing no longer fails']).toBe(true);
  });
  it('refuses to auto-tick a manual-only item', () => {
    const manual = V.parse(BODY).find(i => i.manual);
    expect(() => V.autoTick('9.9.9', manual, 'command')).toThrow(/only be ticked by you/);
    expect(V.autoTicked('9.9.9')).toEqual({});
  });
});

describe('a command ran', () => {
  it('ticks the item that names it, case-insensitively, and only that one', async () => {
    expect(await V.noteCommand('archive this page')).toBe(true);
    const seen = V.autoTicked('9.9.9');
    expect(Object.keys(seen)).toEqual(['archive-library']);
    expect(seen['archive-library'].how).toBe('command');
  });
  it('ignores a command no item names, and does nothing when the check is switched off', async () => {
    expect(await V.noteCommand('Open History')).toBe(false);
    V.setEnabled(false);
    expect(await V.noteCommand('Archive This Page')).toBe(false);
  });
  it('says once, not on every command, when the version has no CHANGELOG entry', async () => {
    window.vex.getReleaseNotes = async () => null;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await V.noteCommand('x')).toBe(false);
    expect(await V.noteCommand('y')).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe('progress and the copied checklist', () => {
  it('counts an auto-tick as done but says how many were only opened', async () => {
    await V.noteCommand('Archive This Page');
    const list = await V.current();
    expect(V.progress('9.9.9', list.items)).toEqual({ done: 1, total: 4, auto: 1 });
    V.setTick('9.9.9', 'archive-library', true);
    expect(V.progress('9.9.9', list.items).auto).toBe(0);
  });
  it('writes an opened item as ticked with the words that you have not checked it', async () => {
    await V.noteCommand('Archive This Page');
    const list = await V.current();
    const md = V.markdownOf(list, V.ticked('9.9.9'), V.autoTicked('9.9.9'));
    expect(md).toMatch(/- \[x\] \*\*Archive library\*\* \(opened; not checked by you\)/);
  });
  it('clearAuto removes a mark (unticking the box)', async () => {
    await V.noteCommand('Archive This Page');
    V.clearAuto('9.9.9', 'archive-library');
    expect(V.autoTicked('9.9.9')).toEqual({});
  });
});
