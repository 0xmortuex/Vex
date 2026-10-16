// src/main/mru-keys.js (T1-014): Ctrl+Tab by recency, driven from the main process
// because the key-up of Ctrl never reaches the renderer while a page has the focus.
// The sendInputEvent probe (a real Electron webContents) is a live check and not part of this file.
import { describe, it, expect, vi } from 'vitest';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { createMruKeys, isCtrlTab, CHANNEL } = require('../../src/main/mru-keys.js');

const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');
const key = (type, k, mods = {}) => ({ type, key: k, control: false, shift: false, alt: false, meta: false, ...mods });
const ctrlTab = (mods = {}) => key('keyDown', 'Tab', { control: true, ...mods });

function setup(on = true) {
  const state = { on };
  const win = new EventEmitter();
  win.isDestroyed = () => false;
  const sent = [];
  const mru = createMruKeys({ isOn: () => state.on, send: (w, msg) => sent.push(msg) });
  return { state, win, sent, mru };
}

describe('the keys', () => {
  it('Ctrl+Tab steps forward, Ctrl+Shift+Tab back, and neither key-down is swallowed', () => {
    // Swallowing the key-down makes Chromium drop the later key-up of Ctrl, so the cycle
    // would never end (measured with webContents.sendInputEvent; see src/main/mru-keys.js).
    const { win, sent, mru } = setup();
    expect(mru.handle(ctrlTab(), win)).toBe(false);
    expect(mru.handle(ctrlTab({ shift: true }), win)).toBe(false);
    expect(sent).toEqual([{ kind: 'step', dir: 1 }, { kind: 'step', dir: -1 }]);
  });
  it('holding the keys repeats the step', () => {
    const { win, sent, mru } = setup();
    for (let i = 0; i < 3; i++) mru.handle(ctrlTab(), win);
    expect(sent.filter(m => m.kind === 'step')).toHaveLength(3);
  });
  it('commits when Ctrl is released, once', () => {
    const { win, sent, mru } = setup();
    mru.handle(ctrlTab(), win);
    expect(mru.handle(key('keyUp', 'Control'), win)).toBe(false);   // the release itself is not swallowed
    mru.handle(key('keyUp', 'Control'), win);
    expect(sent).toEqual([{ kind: 'step', dir: 1 }, { kind: 'commit' }]);
    expect(mru.running).toBe(false);
  });
  it('treats Meta like Ctrl', () => {
    const { win, sent, mru } = setup();
    expect(mru.handle(key('keyDown', 'Tab', { meta: true }), win)).toBe(false);
    mru.handle(key('keyUp', 'Meta'), win);
    expect(sent.map(m => m.kind)).toEqual(['step', 'commit']);
  });
  it('Escape cancels and is taken; Enter commits and is taken', () => {
    const a = setup();
    a.mru.handle(ctrlTab(), a.win);
    expect(a.mru.handle(key('keyDown', 'Escape'), a.win)).toBe(true);
    expect(a.sent.map(m => m.kind)).toEqual(['step', 'cancel']);
    const b = setup();
    b.mru.handle(ctrlTab(), b.win);
    expect(b.mru.handle(key('keyDown', 'Enter'), b.win)).toBe(true);
    expect(b.sent.map(m => m.kind)).toEqual(['step', 'commit']);
  });
  it('commits when the window loses focus (the key-up would go to another program)', () => {
    const { win, sent, mru } = setup();
    mru.handle(ctrlTab(), win);
    win.emit('blur');
    expect(sent.map(m => m.kind)).toEqual(['step', 'commit']);
    win.emit('blur');
    expect(sent).toHaveLength(2);
  });
  it('does not touch keys when no cycle is running', () => {
    const { win, sent, mru } = setup();
    expect(mru.handle(key('keyDown', 'Escape'), win)).toBe(false);
    expect(mru.handle(key('keyDown', 'Enter'), win)).toBe(false);
    expect(mru.handle(key('keyUp', 'Control'), win)).toBe(false);
    expect(sent).toEqual([]);
  });
  it('leaves Ctrl+Alt+Tab and a plain Tab alone', () => {
    const { win, sent, mru } = setup();
    expect(mru.handle(ctrlTab({ alt: true }), win)).toBe(false);
    expect(mru.handle(key('keyDown', 'Tab'), win)).toBe(false);
    expect(mru.handle(key('keyUp', 'Tab', { control: true }), win)).toBe(false);
    expect(sent).toEqual([]);
  });
  it('a cycle in one window is finished when another window takes the key', () => {
    const a = setup();
    const other = new EventEmitter(); other.isDestroyed = () => false;
    a.mru.handle(ctrlTab(), a.win);
    a.mru.handle(ctrlTab(), other);
    expect(a.sent.map(m => m.kind)).toEqual(['step', 'commit', 'step']);
  });
});

describe('off', () => {
  it('owns no key while off', () => {
    const { win, sent, mru } = setup(false);
    expect(mru.owns(ctrlTab())).toBe(false);
    expect(mru.handle(ctrlTab(), win)).toBe(false);
    expect(sent).toEqual([]);
  });
  it('owns Ctrl+Tab while on, so the other Ctrl+Tab handlers stand aside', () => {
    const { mru } = setup(true);
    expect(mru.owns(ctrlTab())).toBe(true);
    expect(mru.owns(key('keyDown', 'a', { control: true }))).toBe(false);
  });
  it('finishes a cycle where it stands when switched off in the middle', () => {
    const { state, win, sent, mru } = setup();
    mru.handle(ctrlTab(), win);
    state.on = false;
    expect(mru.handle(key('keyUp', 'Control'), win)).toBe(false);
    expect(sent.map(m => m.kind)).toEqual(['step', 'commit']);
  });
  it('stop() cancels a running cycle and does nothing otherwise', () => {
    const { win, sent, mru } = setup();
    expect(mru.stop()).toBe(false);
    mru.handle(ctrlTab(), win);
    expect(mru.stop()).toBe(true);
    expect(sent.map(m => m.kind)).toEqual(['step', 'cancel']);
  });
  it('does not send to a window that is gone', () => {
    const { win, sent, mru } = setup();
    mru.handle(ctrlTab(), win);
    win.isDestroyed = () => true;
    win.emit('blur');
    expect(sent.map(m => m.kind)).toEqual(['step']);
  });
});

describe('the contract', () => {
  it('needs isOn and send', () => {
    expect(() => createMruKeys({})).toThrow(/isOn/);
  });
  it('isCtrlTab', () => {
    expect(isCtrlTab(ctrlTab())).toBe(true);
    expect(isCtrlTab(key('keyUp', 'Tab', { control: true }))).toBe(false);
    expect(isCtrlTab(null)).toBe(false);
    expect(CHANNEL).toBe('tabs:mru-key');
  });
});

describe('the wiring in main.js', () => {
  const main = read('src', 'main.js');
  it('keeps only Escape and Enter from the page, and says why Ctrl+Tab is not kept', () => {
    const src = read('src', 'main', 'mru-keys.js');
    expect(src).toMatch(/THE TRAP/);
    expect(src).toMatch(/return false;\s*\/\/ not swallowed/);
  });
  it('hears every window and page before anything else acts on Ctrl+Tab', () => {
    const win = main.indexOf('function handleWindowKeys');
    const mru = main.indexOf('_mruKeys.handle(input, mruWin)', win);
    const boss = main.indexOf('_windowKeys.isBossKey(input)', win);
    expect(win).toBeGreaterThan(0);
    expect(mru).toBeGreaterThan(win);
    expect(mru).toBeLessThan(boss);
    expect(main).toMatch(/contents\.on\('before-input-event', \(event, input\) => \{ handleWindowKeys\(event, input, contents\); \}\)/);
  });
  it('the old next-tab handler stands aside while it is on', () => {
    const fn = main.indexOf('function handleBrowserShortcut');
    expect(main.indexOf('if (_mruKeys.owns(input)) return false;', fn)).toBeGreaterThan(fn);
  });
  it('is declared before the function that uses it, and the switch starts off', () => {
    expect(main.indexOf('const _mruKeys =')).toBeLessThan(main.indexOf('function handleWindowKeys'));
    expect(main).toMatch(/let _mruKeysOn = false;/);
    expect(main).toMatch(/ipcMain\.on\('tabs:mru-keys', \(_event, on\) => \{\s*_mruKeysOn = on === true;/);
  });
  it('the window can set it and hear it, and only its own window may', () => {
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    const { validatePayload } = require('../../src/main/ipc-policy.js');
    expect(UI_ONLY_CHANNELS.has('tabs:mru-keys')).toBe(true);
    expect(() => validatePayload('tabs:mru-keys', [true])).not.toThrow();
    expect(() => validatePayload('tabs:mru-keys', ['yes'])).toThrow();
    expect(() => validatePayload('tabs:mru-keys', [])).toThrow();
    const preload = read('src', 'preload.js');
    expect(preload).toMatch(/setMruKeys:\s+\(on\) => ipcRenderer\.send\('tabs:mru-keys', on\)/);
    expect(preload).toMatch(/onMruKey:\s+\(callback\) => subscribe\('tabs:mru-key', callback\)/);
  });
});
