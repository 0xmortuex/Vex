// main.js used to read and JSON.parse the ~2.5 MB vex-persist.json twice, synchronously, before the app was ready (once for
// Memory Saver, once for smooth scrolling). It is now read and parsed once (src/main/boot-persist.js) and shared, with the
// same results as before in every case.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const nodeFs = require('fs');
const os = require('os');
const path = require('path');
const { readBootPersist, memorySaverOn, smoothScrollChoice } = require('../../src/main/boot-persist.js');

let dir;
beforeEach(() => { dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-boot-')); });
afterEach(() => { nodeFs.rmSync(dir, { recursive: true, force: true }); });
const put = (text) => nodeFs.writeFileSync(path.join(dir, 'vex-persist.json'), text);

// The two blocks exactly as main.js had them, as the reference to compare with.
function oldMemorySaver() {
  let v = false;
  try {
    const j = JSON.parse(nodeFs.readFileSync(path.join(dir, 'vex-persist.json'), 'utf-8'));
    v = j['vex.memorySaver'] === '1' || j['vex.memorySaver'] === 1;
  } catch { /* the original swallowed everything here */ }
  return v;
}
function oldSmooth() {
  const out = { off: false, warning: null };
  try {
    const j = JSON.parse(nodeFs.readFileSync(path.join(dir, 'vex-persist.json'), 'utf-8'));
    if (j['vex.smoothScroll'] === 'off') out.off = true;
  } catch (err) { if (!err || err.code !== 'ENOENT') out.warning = '[Startup] could not read the smooth scrolling choice: ' + (err && err.message); }
  return out;
}
const newBoth = () => { const boot = readBootPersist({ fs: nodeFs, path, userData: dir }); return { memory: memorySaverOn(boot), smooth: smoothScrollChoice(boot) }; };

describe('one read, the same answers', () => {
  const cases = {
    'no file': null,
    'memory saver on (string)': JSON.stringify({ 'vex.memorySaver': '1' }),
    'memory saver on (number)': JSON.stringify({ 'vex.memorySaver': 1 }),
    'memory saver off': JSON.stringify({ 'vex.memorySaver': '0' }),
    'smooth scrolling off': JSON.stringify({ 'vex.smoothScroll': 'off' }),
    'smooth scrolling on': JSON.stringify({ 'vex.smoothScroll': 'on' }),
    'both set': JSON.stringify({ 'vex.memorySaver': '1', 'vex.smoothScroll': 'off', 'vex.other': 'x'.repeat(1000) }),
    'empty object': '{}',
    'not JSON (an encrypted or damaged file)': '\u0001\u0002 not json',
    'empty file': '',
    'null': 'null',
    'an array': '[1,2]',
  };
  for (const [name, text] of Object.entries(cases)) {
    it(name, () => {
      if (text !== null) put(text);
      const got = newBoth();
      expect(got.memory).toBe(oldMemorySaver());
      expect(got.smooth).toEqual(oldSmooth());
    });
  }

  it('reads and parses the file ONCE for both switches (it was twice)', () => {
    put(JSON.stringify({ 'vex.memorySaver': '1', 'vex.smoothScroll': 'off', 'vex.big': 'y'.repeat(2.5 * 1024 * 1024) }));
    const reads = vi.spyOn(nodeFs, 'readFileSync');
    const parses = vi.spyOn(JSON, 'parse');
    try {
      const got = newBoth();
      expect(got.memory).toBe(true);
      expect(got.smooth.off).toBe(true);
      expect(reads.mock.calls.filter(c => String(c[0]).endsWith('vex-persist.json'))).toHaveLength(1);
      expect(parses).toHaveBeenCalledTimes(1);
    } finally { reads.mockRestore(); parses.mockRestore(); }
  });

  it('a missing file is silent for smooth scrolling and a damaged one is a warning', () => {
    expect(newBoth().smooth).toEqual({ off: false, warning: null });
    put('{ nope');
    expect(newBoth().smooth.warning).toMatch(/^\[Startup\] could not read the smooth scrolling choice: /);
  });

  it('needs its arguments', () => {
    expect(() => readBootPersist({})).toThrow(/needs fs, path/);
  });
});

describe('main.js uses it', () => {
  const src = nodeFs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
  const start = src.indexOf("require('./main/boot-persist')");
  const end = src.indexOf("app.commandLine.appendSwitch('disable-features'");

  it('the start-up part before the feature switches reads the persist file once, through boot-persist', () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const part = src.slice(start - 200, end);
    expect(part.match(/readBootPersist\(/g)).toHaveLength(1);
    expect(part).not.toMatch(/vex-persist\.json/);
    expect(part).not.toMatch(/JSON\.parse/);
  });

  it('no other JSON.parse of vex-persist.json remains ahead of the ready event', () => {
    const before = src.slice(0, src.indexOf('app.whenReady')).split(String.fromCharCode(10)).filter(l => !/^\s*\/\//.test(l)).join(String.fromCharCode(10));
    expect(before).not.toMatch(/vex-persist\.json/);   // only boot-persist.js names the file before the app is ready
  });
});
