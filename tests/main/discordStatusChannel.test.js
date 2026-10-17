// T3-062 (Wave 6): the status channel of the Vencord bridge, main process. Vex writes ONE fixed request file
// and reads ONE fixed answer file; a fake plugin in the test plays the owner's Vencord plugin.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../../src/main/comms-tools.js');

let dir, asked, answer, clock;
function make(over = {}) {
  return T.createCommsTools({
    secretStore: { read: async (f, fb) => fb(), write: async () => {}, clear: async () => {} }, webhookFile: 'hook.enc',
    bridgeConfigFile: path.join(dir, 'comms-bridge.json'), fetch: async () => { throw new Error('no network in this test'); },
    pickFolder: async () => dir, confirm: async (q) => { asked.push(q); return answer; }, now: () => clock, ...over,
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-status-'));
  asked = []; answer = true; clock = 1_700_000_000_000;
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const set = (over = {}) => ({ action: 'set', status: 'dnd', text: 'In a game, back later', emoji: 'video_game', expiresAt: clock + 3600000, ...over });
const reqFile = () => path.join(dir, T.STATUS_REQUEST_FILE);

describe('T3-062 status request', () => {
  it('needs a chosen folder first', async () => {
    await expect(make().statusWrite(set())).rejects.toThrow(/No bridge folder/);
  });

  it('writes exactly the validated fields to the one fixed file, atomically, after a main confirm that shows the words', async () => {
    const c = make(); await c.bridgePick();
    const r = await c.statusWrite(set());
    expect(r).toMatchObject({ ok: true, action: 'set' });
    const body = JSON.parse(fs.readFileSync(reqFile(), 'utf8'));
    expect(body).toEqual({ schema: 'vex-status/1', seq: r.seq, requestedAt: clock, action: 'set', status: 'dnd', text: 'In a game, back later', emoji: 'video_game', expiresAt: clock + 3600000 });
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain('In a game, back later');
    expect(asked[0].message).toMatch(/never holds your Discord token/);
    expect(fs.existsSync(reqFile() + '.tmp')).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(['comms-bridge.json', T.STATUS_REQUEST_FILE]);
  });

  it('asks once per run, not for every change, and a "no" writes nothing', async () => {
    answer = false;
    const c = make(); await c.bridgePick();
    await expect(c.statusWrite(set())).rejects.toThrow(/cancelled/);
    expect(fs.existsSync(reqFile())).toBe(false);
    answer = true;
    await c.statusWrite(set());
    await c.statusWrite(set({ text: 'again' }));
    expect(asked).toHaveLength(2);                       // the declined one and the first allowed one
  });

  it('a restore needs no confirm and carries no words', async () => {
    const c = make(); await c.bridgePick();
    await c.statusWrite({ action: 'restore' });
    expect(asked).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(reqFile(), 'utf8'))).toEqual({ schema: 'vex-status/1', seq: clock, requestedAt: clock, action: 'restore' });
  });

  it('numbers requests so that two in the same millisecond differ', async () => {
    const c = make(); await c.bridgePick();
    const a = await c.statusWrite({ action: 'restore' });
    const b = await c.statusWrite({ action: 'restore' });
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it('refuses anything outside the format', async () => {
    const c = make(); await c.bridgePick();
    await expect(c.statusWrite({ action: 'send-message' })).rejects.toThrow(/"set" or "restore"/);
    await expect(c.statusWrite(set({ status: 'streaming' }))).rejects.toThrow(/A Discord status is/);
    await expect(c.statusWrite(set({ emoji: ':video game:' }))).rejects.toThrow(/plain name/);
    await expect(c.statusWrite(set({ text: 'x'.repeat(101) }))).rejects.toThrow(/at most 100/);
    await expect(c.statusWrite(set({ expiresAt: clock - 1 }))).rejects.toThrow(/end time/);
    await expect(c.statusWrite(set({ expiresAt: undefined }))).rejects.toThrow(/end time/);
    await expect(c.statusWrite(set({ expiresAt: clock + 25 * 3600000 }))).rejects.toThrow(/end time/);
    expect(fs.existsSync(reqFile())).toBe(false);
  });

  it('keeps the text on one line', async () => {
    const c = make(); await c.bridgePick();
    await c.statusWrite(set({ text: 'line one\nline two\t3' }));
    expect(JSON.parse(fs.readFileSync(reqFile(), 'utf8')).text).toBe('line one line two 3');
  });

  it('will not write through a link or into a folder of that name', async () => {
    const c = make(); await c.bridgePick();
    fs.mkdirSync(reqFile());
    await expect(c.statusWrite({ action: 'restore' })).rejects.toThrow(/link or a folder/);
  });
});

describe('T3-062 plugin answer', () => {
  const ack = (over = {}) => ({ schema: 'vex-status/1', seq: 5, action: 'set', applied: true, error: '', previous: { status: 'online', text: 'hi', emoji: 'wave' }, ...over });
  const ackFile = () => path.join(dir, T.STATUS_ACK_FILE);

  it('says "not yet" until the plugin writes it, then returns the cleaned answer', async () => {
    const c = make(); await c.bridgePick();
    expect(c.statusAck()).toEqual({ ok: true, found: false });
    fs.writeFileSync(ackFile(), JSON.stringify(ack({ junk: 'x' })));
    expect(c.statusAck()).toEqual({ ok: true, found: true, ack: { seq: 5, applied: true, action: 'set', error: '', previous: { status: 'online', text: 'hi', emoji: 'wave' } } });
  });

  it('refuses a wrong, huge, broken or linked answer instead of guessing', async () => {
    const c = make(); await c.bridgePick();
    fs.writeFileSync(ackFile(), 'nope');
    expect(() => c.statusAck()).toThrow(/not valid JSON/);
    fs.writeFileSync(ackFile(), JSON.stringify({ schema: 'other/1', seq: 1 }));
    expect(() => c.statusAck()).toThrow(/vex-status\/1/);
    fs.writeFileSync(ackFile(), JSON.stringify({ schema: 'vex-status/1' }));
    expect(() => c.statusAck()).toThrow(/match it to a request/);
    fs.writeFileSync(ackFile(), JSON.stringify({ ...ack(), pad: 'x'.repeat(T.STATUS_ACK_FILE.length + 17 * 1024) }));
    expect(() => c.statusAck()).toThrow(/larger than/);
  });

  it('a fake plugin round trip: set, answer, restore, answer', async () => {
    const c = make(); await c.bridgePick();
    let snapshot = { status: 'online', text: '', emoji: '' };
    const plugin = () => {
      const req = JSON.parse(fs.readFileSync(reqFile(), 'utf8'));
      let prev = null; let applied = true; let error = '';
      if (req.action === 'set') prev = snapshot; else if (!snapshot) { applied = false; error = 'nothing to restore'; }
      fs.writeFileSync(ackFile(), JSON.stringify({ schema: 'vex-status/1', seq: req.seq, action: req.action, applied, error, previous: prev }));
    };
    const w = await c.statusWrite(set()); plugin();
    expect(c.statusAck().ack).toMatchObject({ seq: w.seq, applied: true, previous: { status: 'online' } });
    const w2 = await c.statusWrite({ action: 'restore' }); plugin();
    expect(c.statusAck().ack.seq).toBe(w2.seq);
  });
});

describe('T3-062 wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('is registered in main, preload, the schemas and the policy', () => {
    expect(src('src/main.js')).toContain("ipcMain.handle('comms:status-write'");
    expect(src('src/main.js')).toContain("ipcMain.handle('comms:status-ack'");
    expect(src('src/preload.js')).toContain("'comms:status-write'");
    expect(src('src/main/ipc-schemas.js')).toContain("'comms:status-write'");
    expect(src('src/main/ipc-policy.js')).toContain("'comms:status-write'");
  });
  it('the window cannot pick the file name or the folder: no path argument exists', () => {
    const { validatePayload } = require('../../src/main/ipc-policy.js');
    expect(() => validatePayload('comms:status-write', [{ action: 'set', status: 'dnd', file: 'C:/x' }])).not.toThrow();
    expect(() => validatePayload('comms:status-write', [{ action: 'delete' }])).toThrow();
    expect(() => validatePayload('comms:status-write', [{ action: 'set', status: 'bad' }])).toThrow();
  });
});
