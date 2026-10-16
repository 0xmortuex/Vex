// T3-105 (the photo preparer's two dialogs) and T3-121 (clear the clipboard only if it still holds
// the text a page put there), plus the policy of every channel the Tier 3 security helpers added.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pp = require('../../src/main/photo-prep.js');
const { createSecretClipboard, registerSecretClipboard } = require('../../src/main/secret-clipboard.js');
const read = (...p) => fs.readFileSync(path.resolve(__dirname, '../..', ...p), 'utf8');

describe('photo preparer dialogs', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-photo-'));
  it('open: reads the one chosen picture and returns its bytes and type; a cancel returns canceled', async () => {
    const dir = tmp();
    const file = path.join(dir, 'me.JPG');
    fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
    try {
      const dialog = { showOpenDialog: async (_w, o) => { expect(o.properties).toEqual(['openFile']); return { canceled: false, filePaths: [file] }; } };
      const r = await pp.openPicture({ dialog, win: null });
      expect(r).toMatchObject({ ok: true, name: 'me.JPG', mime: 'image/jpeg' });
      expect([...r.bytes]).toEqual([1, 2, 3, 4]);
      expect(await pp.openPicture({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } })).toEqual({ ok: true, canceled: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('open: refuses a file that is not a picture and one that is too large', async () => {
    const dir = tmp();
    const txt = path.join(dir, 'a.txt');
    fs.writeFileSync(txt, 'x');
    try {
      await expect(pp.openPicture({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [txt] }) } })).rejects.toThrow(/not a picture/);
      const big = path.join(dir, 'b.png');
      fs.writeFileSync(big, 'x');
      const fsMod = { promises: { ...fs.promises, stat: async () => ({ isFile: () => true, size: pp.MAX_INPUT_BYTES + 1 }) } };
      await expect(pp.openPicture({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [big] }) }, fsMod })).rejects.toThrow(/larger than/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('save: writes a NEW file the person chose, only a picture extension, never the original', async () => {
    const dir = tmp();
    try {
      const out = path.join(dir, 'new.jpg');
      let asked;
      const dialog = { showSaveDialog: async (_w, o) => { asked = o; return { canceled: false, filePath: out }; } };
      const r = await pp.savePicture({ dialog, win: null, bytes: new Uint8Array([9, 8, 7]), suggestedName: 'a/b:c.jpg' });
      expect(r).toEqual({ ok: true, path: out, bytes: 3 });
      expect(asked.defaultPath).toBe('a_b_c.jpg');
      expect([...fs.readFileSync(out)]).toEqual([9, 8, 7]);
      // typed another extension in the dialog: refused, nothing written
      const evil = path.join(dir, 'x.exe');
      await expect(pp.savePicture({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: evil }) }, bytes: new Uint8Array([1]), suggestedName: 'p.jpg' })).rejects.toThrow(/\.jpg or \.png/);
      expect(fs.existsSync(evil)).toBe(false);
      await expect(pp.savePicture({ dialog, bytes: new Uint8Array(0), suggestedName: 'p.jpg' })).rejects.toThrow(/no picture/);
      await expect(pp.savePicture({ dialog, bytes: new Uint8Array([1]), suggestedName: 'script.bat' })).rejects.toThrow(/\.jpg or \.png/);
      expect(await pp.savePicture({ dialog: { showSaveDialog: async () => ({ canceled: true }) }, bytes: new Uint8Array([1]), suggestedName: 'p.png' })).toEqual({ ok: true, canceled: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('has no network code', () => {
    const src = read('src', 'main', 'photo-prep.js');
    for (const bad of ['fetch(', 'net.', 'http', 'XMLHttpRequest', 'child_process']) expect(src.includes(bad), bad).toBe(false);
  });
});

describe('clipboard clear-if', () => {
  function fake(initial) {
    let text = initial;
    return { clipboard: { writeText: (t) => { text = t; }, readText: () => text, clear: () => { text = ''; } }, get: () => text };
  }
  it('empties the clipboard only when it still holds exactly that text', () => {
    const f = fake('powershell -w hidden iex (irm x)');
    const s = createSecretClipboard({ clipboard: f.clipboard });
    expect(s.clearIf('something else')).toBe(false);
    expect(f.get()).toBe('powershell -w hidden iex (irm x)');
    expect(s.clearIf('powershell -w hidden iex (irm x)')).toBe(true);
    expect(f.get()).toBe('');
    expect(() => s.clearIf('')).toThrow(/nothing to compare/);
  });
  it('a read that fails raises instead of pretending it was cleared', () => {
    const s = createSecretClipboard({ clipboard: { writeText() {}, readText() { throw new Error('denied'); }, clear() {} } });
    expect(() => s.clearIf('x')).toThrow(/denied/);
  });
  it('registers clipboard:clear-if', () => {
    const handlers = new Map();
    const f = fake('abc');
    registerSecretClipboard({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, clipboard: f.clipboard, app: null });
    expect(handlers.get('clipboard:clear-if')({}, 'abc')).toEqual({ ok: true, cleared: true });
  });
});

describe('channels added by the Tier 3 security helpers', () => {
  const CHANNELS = ['open-guest-window', 'clipboard:clear-if', 'startup:list', 'applock:make-record', 'applock:stores', 'applock:reset', 'applock:lock-on-minimize', 'photoprep:open', 'photoprep:save'];
  const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
  const policySrc = read('src', 'main', 'ipc-policy.js');
  const PRIVATE_DISABLED = eval(policySrc.match(/const PRIVATE_DISABLED = (\/.*\/);/)[1]); // eslint-disable-line no-eval
  const { schemas, validate } = require('../../src/main/ipc-schemas.js');
  const preload = read('src', 'preload.js');
  const main = [read('src', 'main.js'), ...fs.readdirSync(path.resolve(__dirname, '../../src/main')).filter(f => f.endsWith('.js')).map(f => read('src', 'main', f))].join('\n');

  it('each has a schema, a preload entry and a handler, and only Vex\'s own window may use it', () => {
    for (const c of CHANNELS) {
      expect(schemas.has(c), c + ' schema').toBe(true);
      expect(new RegExp("ipcRenderer\\.(?:invoke|send)\\('" + c.replace(/[:-]/g, (m) => '\\' + m) + "'").test(preload), c + ' preload').toBe(true);
      expect(new RegExp("ipcMain\\.(?:handle|on)\\('" + c.replace(/[:-]/g, (m) => '\\' + m) + "'").test(main), c + ' handler').toBe(true);
      expect(UI_ONLY_CHANNELS.has(c), c + ' ui-only').toBe(true);
    }
  });
  it('the ones that read the machine or change the lock are closed in a private window', () => {
    for (const c of ['startup:list', 'applock:make-record', 'applock:stores', 'applock:reset', 'applock:lock-on-minimize', 'photoprep:open', 'photoprep:save']) expect(PRIVATE_DISABLED.test(c), c).toBe(true);
    // a guest window may open another guest window, as a private window may open a private one
    expect(PRIVATE_DISABLED.test('open-guest-window')).toBe(false);
  });
  it('no channel is handled twice', () => {
    for (const c of CHANNELS) expect((main.match(new RegExp("ipcMain\\.(?:handle|on)\\('" + c.replace(/[:-]/g, (m) => '\\' + m) + "'", 'g')) || []).length, c).toBe(1);
  });
  it('payloads are checked', () => {
    expect(() => validate('startup:list', [])).not.toThrow();
    expect(() => validate('startup:list', ['x'])).toThrow(/Invalid payload/);
    expect(() => validate('applock:reset', ['ERASE SECURE DATA'])).not.toThrow();
    expect(() => validate('applock:reset', [5])).toThrow(/Invalid payload/);
    expect(() => validate('applock:lock-on-minimize', ['yes'])).toThrow(/Invalid payload/);
    expect(() => validate('clipboard:clear-if', [''])).toThrow(/Invalid payload/);
    expect(() => validate('clipboard:clear-if', ['x'.repeat(4001)])).toThrow(/Invalid payload/);
    expect(() => validate('photoprep:save', [new Uint8Array([1]), 'a.jpg'])).not.toThrow();
    expect(() => validate('photoprep:save', ['text', 'a.jpg'])).toThrow(/Invalid payload/);
    expect(() => validate('open-guest-window', [])).not.toThrow();
    expect(() => validate('vex-lock:verify', ['a passphrase longer than twelve'])).not.toThrow();
  });
});
