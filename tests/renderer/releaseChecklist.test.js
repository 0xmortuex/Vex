// @vitest-environment jsdom
//
// T0-002: the release hand-check list built from a CHANGELOG entry
// (js/release-checklist.js, scripts/release-checklist.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

let V;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="panel-settings"><div class="settings-content"></div></div>';
  vi.resetModules();
  ({ VexReleaseChecklist: V } = fresh(JS + 'release-checklist.js'));
  globalThis.VexReleaseChecklist = V;
});

const BODY = [
  '### New',
  '- **AI news (Settings › AI News, off until you turn it on):** Vex tells you about new AI stories you chose to follow. Pick topics.',
  '- **Archive library:** Ctrl+K › Archive This Page (or right-click › Archive this page) keeps a self-contained copy.',
  '- **Game dossier (off until you turn it on):** while a listed game runs, Vex remembers pages. Ctrl+K › "Open <game>\'s dossier" shows them.',
  '- **Patch radar:** give a game a patch notes page.',
  '',
  '### Fixed',
  '- **Discord screen sharing no longer fails.** Vex\'s share picker refused your choice',
  '  whenever the page address differed.',
].join('\n');

describe('parse', () => {
  it('makes one item per bullet with a do-this and an expect line', () => {
    const items = V.parse(BODY);
    expect(items.map(i => i.title)).toEqual(['AI news', 'Archive library', 'Game dossier (off until you turn it on)', 'Patch radar', 'Discord screen sharing no longer fails']);
    expect(items.map(i => i.section)).toEqual(['New', 'New', 'New', 'New', 'Fixed']);
    for (const i of items) { expect(i.doThis.length).toBeGreaterThan(10); expect(i.expect.length).toBeGreaterThan(5); }
  });
  it('reads a Settings route, a bare Ctrl+K command and a quoted one', () => {
    const [ai, archive, dossier, radar, fixed] = V.parse(BODY);
    expect(ai.route.settings).toEqual(['AI News']);
    expect(ai.doThis).toBe('Open Settings › AI News.');
    expect(archive.route.command).toBe('Archive This Page');
    expect(dossier.route.command).toBe("Open <game>'s dossier");
    expect(radar.route).toEqual({ settings: null, command: null });
    expect(radar.doThis).toMatch(/^Find "Patch radar"/);
    expect(fixed.doThis).toMatch(/^Repeat what used to go wrong\./);
    expect(fixed.expect).toMatch(/^It no longer happens: /);
  });
  it('joins a bullet continued on an indented line', () => {
    const fixed = V.parse(BODY).at(-1);
    expect(fixed.expect).toContain('Vex\'s share picker refused your choice whenever');
  });
  it('gives every item a unique stable id', () => {
    const items = V.parse('- **Same.** a\n- **Same.** b\n- **Same.** c');
    expect(new Set(items.map(i => i.id)).size).toBe(3);
    expect(V.parse(BODY).map(i => i.id)).toEqual(V.parse(BODY).map(i => i.id));
  });
});

describe('real CHANGELOG', () => {
  it('every one of the newest 8 entries yields a non-empty checklist with no empty line', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8').replace(/\r/g, '');
    const entries = [...md.matchAll(/^## (v\d+\.\d+\.\d+)[^\n]*\n([\s\S]*?)(?=^## v|$(?![\s\S]))/gm)].slice(0, 8);
    expect(entries.length).toBe(8);
    for (const [, version, body] of entries) {
      const items = V.parse(body);
      expect(items.length, version).toBeGreaterThan(0);
      for (const i of items) {
        expect(i.title, version).toBeTruthy();
        expect(i.doThis, version + ' ' + i.id).toBeTruthy();
        expect(i.expect, version + ' ' + i.id).toBeTruthy();
      }
    }
  });
});

describe('markdown', () => {
  it('writes a tickable list, with ticks carried over', () => {
    const list = V.build({ version: 'v1.2.3', name: 'v1.2.3 — Test', body: BODY });
    const md = V.markdownOf(list, { 'ai-news': 1 });
    expect(md).toContain('# Release check: v1.2.3');
    expect(md).toContain('- [x] **AI news**');
    expect(md).toContain('- [ ] **Patch radar**');
    expect(md).toContain('  - Do this: Open Settings › AI News.');
  });
  it('refuses an empty entry', () => {
    expect(() => V.build(null)).toThrow(/no CHANGELOG entry/);
    expect(() => V.build({ version: '1.0.0', body: '' })).toThrow();
  });
});

describe('ticks', () => {
  it('are kept per version and removed again', () => {
    V.setTick('1.0.0', 'a', true);
    V.setTick('1.0.0', 'b', true);
    V.setTick('2.0.0', 'a', true);
    expect(Object.keys(V.ticked('1.0.0')).sort()).toEqual(['a', 'b']);
    V.setTick('1.0.0', 'a', false);
    expect(Object.keys(V.ticked('1.0.0'))).toEqual(['b']);
    expect(V.progress('1.0.0', [{ id: 'a' }, { id: 'b' }])).toEqual({ done: 1, total: 2 });
  });
  it('keep only the five newest versions', () => {
    for (const v of ['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5']) V.setTick(v, 'x', true);
    expect(Object.keys(JSON.parse(localStorage.getItem(V.KEY))).sort()).toEqual(['1.0.1', '1.0.2', '1.0.3', '1.0.4', '1.0.5']);
  });
  it('start again, loudly, when the stored value is garbage', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(V.KEY, '{nope');
    expect(V.ticked('1.0.0')).toEqual({});
    expect(err).toHaveBeenCalled();
  });
});

describe('the switch and Try it', () => {
  it('is on until switched off, through the usage record\'s setter', () => {
    expect(V.enabled()).toBe(true);
    V.setEnabled(false);
    expect(V.enabled()).toBe(false);
    V.setEnabled(true);
    expect(V.enabled()).toBe(true);
  });
  it('runs the Ctrl+K command an item names, ignoring case', () => {
    const action = vi.fn();
    globalThis.CommandBar = { commands: [{ id: 'x', label: 'archive this page', action }] };
    const item = V.parse('- **Archive library:** Ctrl+K › Archive This Page (or more) keeps a copy.')[0];
    expect(V.tryIt(item)).toBe('command');
    expect(action).toHaveBeenCalledTimes(1);
    delete globalThis.CommandBar;
  });
  it('answers null when there is nothing to open', () => {
    const item = V.parse('- **Patch radar:** give a game a patch notes page.')[0];
    expect(V.tryIt(item)).toBe(null);
  });
});

describe('the screen', () => {
  it('lists the running version\'s entry with a box and a Try it per item', async () => {
    const { VexSettingsGroups } = fresh(JS + 'vex-settings-groups.js');
    globalThis.VexSettingsGroups = VexSettingsGroups;
    window.vex = { getAppVersion: async () => '1.2.3', getReleaseNotes: async () => ({ version: 'v1.2.3', name: 'v1.2.3 — T', body: BODY }) };
    await V.open();
    const rows = document.querySelectorAll('#vex-release-check [data-item]');
    expect(rows.length).toBe(5);
    expect(rows[0].querySelector('input[type=checkbox]').getAttribute('aria-label')).toBe('Checked: AI news');
    expect(rows[0].textContent).toContain('Do this: Open Settings › AI News.');
    rows[0].querySelector('input').click();
    expect(V.ticked('1.2.3')['ai-news']).toBeTruthy();
    expect(document.querySelector('#vex-release-check').textContent).toContain('1 of 5 ticked');
  });
  it('says plainly when the CHANGELOG has no entry for the running version', async () => {
    const { VexSettingsGroups } = fresh(JS + 'vex-settings-groups.js');
    globalThis.VexSettingsGroups = VexSettingsGroups;
    window.vex = { getAppVersion: async () => '9.9.9', getReleaseNotes: async () => ({ version: 'v1.2.3', name: 'x', body: BODY }) };
    await V.open();
    expect(document.querySelector('#vex-release-check').textContent).toContain('no entry for v9.9.9');
  });
});
