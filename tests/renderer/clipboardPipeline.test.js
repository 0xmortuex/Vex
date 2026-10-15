// @vitest-environment jsdom
//
// Clipboard pipeline: chain text transforms with named presets, only on an
// explicit action, never reading the clipboard in the background.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { VexModuleCommands } = require('../../src/renderer/js/settings-groups.js');
globalThis.VexModuleCommands = VexModuleCommands;
const { ClipboardPipeline: CP } = require('../../src/renderer/js/clipboard-pipeline.js');

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.showToast = vi.fn();
  window.VexTabPolicy = { canReadWebview: () => true };
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => 'SECRET FROM ANOTHER APP') } });
  delete globalThis.TabManager;
  delete globalThis.WebviewManager;
});

describe('transforms', () => {
  it('strips tracking parameters and keeps real ones', () => {
    const t = 'See https://shop.example/p?id=7&utm_source=news&utm_medium=email&fbclid=abc#top, and https://a.example/x?gclid=1.';
    expect(CP.run(t, ['strip-tracking'])).toBe('See https://shop.example/p?id=7#top, and https://a.example/x.');
  });

  it('leaves text with no addresses, and addresses with no tracking, untouched', () => {
    expect(CP.run('plain words', ['strip-tracking'])).toBe('plain words');
    expect(CP.run('https://a.example/?q=1', ['strip-tracking'])).toBe('https://a.example/?q=1');
  });

  it('converts bullets, numbering and bare addresses to markdown', () => {
    const out = CP.run('• first\n• second\n1) one\n2) two\nsee https://a.example/x.\n\n\n\nend', ['to-markdown']);
    expect(out).toBe('- first\n- second\n1. one\n2. two\nsee <https://a.example/x>.\n\nend');
  });

  it('title-cases without breaking addresses or small words', () => {
    expect(CP.run('the lord OF the rings via https://Example.com/A', ['title-case'])).toBe('The Lord of the Rings via https://Example.com/A');
  });

  it('trims lines and the ends', () => {
    expect(CP.run('\n\n  a  \n\tb\t\n\n', ['trim'])).toBe('a\nb');
  });

  it('removes duplicate and empty lines in order', () => {
    expect(CP.run('a\nb\na\n\nc\nb', ['dedupe-lines', 'remove-empty-lines'])).toBe('a\nb\nc');
  });

  it('chains steps in the order given', () => {
    expect(CP.run('  hello   world  ', ['collapse-spaces', 'trim', 'uppercase'])).toBe('HELLO WORLD');
  });

  it('an unknown step is an error, not a skip', () => {
    expect(() => CP.run('x', ['strip-tracking', 'rm-rf'])).toThrow(/Unknown step/);
    expect(() => CP.run('x', ['constructor'])).toThrow(/Unknown step/);
    expect(() => CP.run('x'.repeat(CP.MAX_TEXT + 1), ['trim'])).toThrow(/longer/);
  });
});

describe('presets', () => {
  it('ships built-in presets and saves, updates and deletes your own', () => {
    expect(CP.presets().map(p => p.name)).toEqual(expect.arrayContaining(['Clean link', 'Tidy list']));
    const id = CP.savePreset('Shout', ['trim', 'uppercase']);
    expect(CP.presets().find(p => p.id === id).steps).toEqual(['trim', 'uppercase']);
    expect(CP.savePreset('shout', ['uppercase'])).toBe(id);          // same name updates
    expect(CP.presets().find(p => p.id === id).steps).toEqual(['uppercase']);
    CP.deletePreset(id);
    expect(CP.presets().some(p => p.id === id)).toBe(false);
  });

  it('refuses an empty name, no steps, unknown steps and a built-in name', () => {
    expect(() => CP.savePreset('', ['trim'])).toThrow(/name/);
    expect(() => CP.savePreset('X', [])).toThrow(/at least one/);
    expect(() => CP.savePreset('X', ['nope'])).toThrow(/known steps/);
    expect(() => CP.savePreset('Clean link', ['trim'])).toThrow(/built-in/);
  });

  it('stores only names and steps, never text', () => {
    CP.run('my secret text', ['trim']);
    CP.savePreset('P', ['trim']);
    expect(localStorage.getItem(CP.KEY)).not.toContain('secret');
  });

  it('drops damaged stored presets', () => {
    localStorage.setItem(CP.KEY, JSON.stringify([{ id: 'cp_abc1', name: 'ok', steps: ['trim'] }, { id: 'x', name: 'bad id', steps: ['trim'] }, { id: 'cp_abc2', name: 'bad step', steps: ['evil'] }]));
    expect(CP.presets().filter(p => !p.builtin).map(p => p.name)).toEqual(['ok']);
  });
});

describe('only on explicit action', () => {
  function pageWith(selection, canRead = true) {
    const wv = { executeJavaScript: vi.fn(async () => selection), getAttribute: () => 'persist:main' };
    globalThis.TabManager = { getActiveTab: () => ({ id: 't1', url: 'https://a.example' }) };
    globalThis.WebviewManager = { webviews: new Map([['t1', wv]]) };
    window.VexTabPolicy = { canReadWebview: () => canRead };
    return wv;
  }

  it('a preset runs on the page selection and copies the result', async () => {
    pageWith('https://a.example/p?utm_source=x');
    const out = await CP.runPresetOnSelection('builtin-clean-link');
    expect(out).toBe('https://a.example/p');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://a.example/p');
  });

  it('does not read the selection of a private, Tor or routed tab', async () => {
    const wv = pageWith('secret', false);
    await expect(CP.pageSelection()).rejects.toThrow(/private, Tor or routed/);
    expect(wv.executeJavaScript).not.toHaveBeenCalled();
  });

  it('never reads the system clipboard, opening the dialog or running a preset', async () => {
    pageWith('a  b');
    CP.open();
    document.querySelector('#cp-preset').value = 'builtin-tidy-list';
    document.querySelector('#cp-preset').dispatchEvent(new Event('change'));
    document.querySelector('#cp-in').value = 'x\nx';
    document.querySelector('#cp-in').dispatchEvent(new Event('input'));
    expect(document.querySelector('#cp-out').value).toBe('x');
    await CP.runPresetOnSelection('builtin-tidy-list');
    expect(navigator.clipboard.readText).not.toHaveBeenCalled();
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/renderer/js/clipboard-pipeline.js'), 'utf8');
    expect(src).not.toMatch(/clipboard\.readText|readText\(|setInterval|clipboard\.read\(/);
  });

  it('registers Ctrl+K entries for the dialog and each preset', () => {
    globalThis.CommandBar = { commands: [] };
    CP._registerCommands();
    const ids = CommandBar.commands.map(c => c.id);
    expect(ids).toContain('clippipe:open');
    expect(ids).toContain('clippipe:run:builtin-clean-link');
    delete globalThis.CommandBar;
  });
});
