// Native messaging (src/main/extension-native.js), 2026-10-28: how the Claude extension talks to Claude Code, against a fake program.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const { createExtensionNative, createReader, frame, commandFor, parseRegQuery, MSG } = createRequire(import.meta.url)('../../src/main/extension-native.js');
const EXT = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
const ORIGIN = 'chrome-extension://' + EXT + '/';
const HOST = 'com.anthropic.claude_code_browser_extension';

let children, events, allow, manifest, native;
function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough(); c.stdout = new PassThrough(); c.stderr = new PassThrough();
  c.written = [];
  c.stdin.on('data', (d) => c.written.push(d));
  c.killed = false;
  c.kill = vi.fn(() => { c.killed = true; });
  children.push(c);
  return c;
}
const say = (child, obj) => child.stdout.write(frame(obj));
const tick = () => new Promise(r => setImmediate(r));
const spawn = vi.fn((cmd, args, opts) => fakeChild());

beforeEach(() => {
  children = []; events = []; allow = true; spawn.mockClear();
  manifest = { name: HOST, type: 'stdio', path: 'C:\\Users\\x\\host.bat', allowed_origins: [ORIGIN] };
  native = createExtensionNative({
    spawn,
    findManifest: async (name) => (name === HOST ? { file: 'C:\\Users\\x\\m.json', manifest } : null),
    allowed: () => allow,
    emit: (ses, extId, type, args) => events.push([type, ...args]),
  });
});
const connect = (over = {}) => native.connect({ ses: {}, key: 'p|' + EXT, extId: EXT, folder: 'claude', portId: 'p1', name: HOST, ...over });

describe('frames', () => {
  it('a message is its length (4 bytes, little-endian) and its JSON', () => {
    const f = frame({ a: 1 });
    expect(f.readUInt32LE(0)).toBe(7);
    expect(f.subarray(4).toString()).toBe('{"a":1}');
  });
  it('the reader joins pieces and splits several messages, and stops at a frame over 1 MiB', () => {
    const got = []; const errs = [];
    const r = createReader((m) => got.push(m), (e) => errs.push(e));
    const both = Buffer.concat([frame({ n: 1 }), frame({ n: 2 })]);
    r.push(both.subarray(0, 5)); r.push(both.subarray(5));
    expect(got).toEqual([{ n: 1 }, { n: 2 }]);
    const head = Buffer.alloc(4); head.writeUInt32LE(1024 * 1024 + 1, 0);
    r.push(head);
    expect(errs).toEqual([MSG.tooBig]);
    r.push(frame({ n: 3 }));
    expect(got.length).toBe(2);
  });
  it('a frame that is not JSON ends it', () => {
    const errs = [];
    const r = createReader(() => {}, (e) => errs.push(e));
    const bad = Buffer.from('nope'); const head = Buffer.alloc(4); head.writeUInt32LE(bad.length, 0);
    r.push(Buffer.concat([head, bad]));
    expect(errs.length).toBe(1);
  });
});

describe('the command line', () => {
  it('a .bat runs through cmd.exe with the origin as its argument; an .exe runs as itself', () => {
    expect(commandFor('C:\\h\\run.bat', ORIGIN, 'cmd.exe')).toEqual({ cmd: 'cmd.exe', args: ['/d', '/s', '/c', '""C:\\h\\run.bat" "' + ORIGIN + '""'], verbatim: true });
    expect(commandFor('C:\\h\\run.exe', ORIGIN)).toEqual({ cmd: 'C:\\h\\run.exe', args: [ORIGIN], verbatim: false });
  });
  it('a .bat path with shell characters is refused', () => {
    expect(() => commandFor('C:\\h\\a&calc.bat', ORIGIN)).toThrow(MSG.forbidden);
  });
  it('reads the manifest path out of reg query', () => {
    expect(parseRegQuery('\r\nHKEY_CURRENT_USER\\Software\\X\r\n    (Default)    REG_SZ    C:\\a b\\m.json\r\n')).toBe('C:\\a b\\m.json');
    expect(parseRegQuery('')).toBe(null);
  });
});

describe('connectNative', () => {
  it('starts the host with the extension\'s origin, relays what it says and what the extension sends', async () => {
    expect(await connect()).toBe(true);
    expect(spawn.mock.calls[0][1].join(' ')).toContain(ORIGIN);
    say(children[0], { type: 'pong' });
    await tick();
    expect(events).toEqual([['native.onMessage', 'p1', { type: 'pong' }]]);
    native.send({ key: 'p|' + EXT, portId: 'p1', message: { type: 'ping' } });
    expect(Buffer.concat(children[0].written).subarray(4).toString()).toBe('{"type":"ping"}');
  });
  it('the host exiting tells the extension, once', async () => {
    await connect();
    children[0].emit('exit', 0);
    children[0].emit('exit', 0);
    expect(events).toEqual([['native.onDisconnect', 'p1', null]]);
    expect(() => native.send({ key: 'p|' + EXT, portId: 'p1', message: 1 })).toThrow(MSG.closed);
  });
  it('a message over 1 MiB from the host ends the port in Chrome\'s words', async () => {
    await connect();
    const head = Buffer.alloc(4); head.writeUInt32LE(2 * 1024 * 1024, 0);
    children[0].stdout.write(head);
    await tick();
    expect(events).toEqual([['native.onDisconnect', 'p1', MSG.tooBig]]);
    expect(children[0].killed).toBe(true);
  });
  it('disconnect from the extension stops the host and does not call it back', async () => {
    await connect();
    native.disconnect({ key: 'p|' + EXT, portId: 'p1' });
    expect(children[0].killed).toBe(true);
    children[0].emit('exit', 0);
    expect(events).toEqual([]);
  });
  it('a host that is not registered, or not for this extension, is refused in Chrome\'s words, and nothing is started', async () => {
    expect(await connect({ name: 'com.nobody.here' })).toBe(false);
    manifest.allowed_origins = ['chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'];
    expect(await connect({ portId: 'p2' })).toBe(false);
    expect(events).toEqual([['native.onDisconnect', 'p1', MSG.notFound], ['native.onDisconnect', 'p2', MSG.forbidden]]);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('a bad name never reaches the registry, and the switch off starts nothing', async () => {
    expect(await connect({ name: '..\\evil' })).toBe(false);
    allow = false;
    expect(await connect({ portId: 'p2' })).toBe(false);
    expect(events.map(e => e[2])).toEqual([MSG.invalidName, MSG.denied]);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('a manifest that is not stdio, or whose name differs, is not used', async () => {
    manifest.type = 'pipe';
    expect(await connect()).toBe(false);
    manifest.type = 'stdio'; manifest.name = 'other';
    expect(await connect({ portId: 'p2' })).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('stop({ folder }) lets go of every host of that extension and tells it', async () => {
    manifest.allowed_origins.push('chrome-extension://' + 'x'.repeat(32) + '/');
    await connect(); await connect({ portId: 'p2' }); await connect({ portId: 'p3', folder: 'other', extId: 'x'.repeat(32), key: 'p|x' });
    expect(native.stop({ folder: 'claude' })).toBe(2);
    expect(children[0].killed && children[1].killed).toBe(true);
    expect(native.count()).toBe(1);
  });
});

describe('sendNativeMessage', () => {
  it('one message out, the first one back, and the host is stopped', async () => {
    const p = native.sendOnce({ extId: EXT, folder: 'claude', name: HOST, message: { hi: 1 } });
    await tick();
    expect(Buffer.concat(children[0].written).subarray(4).toString()).toBe('{"hi":1}');
    say(children[0], { ok: true });
    expect(await p).toEqual({ ok: true });
    expect(children[0].killed).toBe(true);
  });
  it('a host that exits without answering is an error', async () => {
    const p = native.sendOnce({ extId: EXT, folder: 'claude', name: HOST, message: 1 });
    await tick();
    children[0].emit('exit', 1);
    await expect(p).rejects.toThrow(MSG.exited);
  });
  it('refused when the switch is off', async () => {
    allow = false;
    await expect(native.sendOnce({ extId: EXT, folder: 'claude', name: HOST, message: 1 })).rejects.toThrow('Allow it to talk to programs');
  });
});
