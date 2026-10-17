// T3-062 (Wave 6): the status channel of the Vencord bridge, main process. Vex writes ONE fixed command file
// (vex-status.json, schema vex-status/1) into the bridge folder; a fake plugin below applies the plugin's own rules
// (src/userplugins/vexBridge/statusData.ts in the Vencord clone) to whatever Vex wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../../src/main/comms-tools.js');

let dir, asked, answer, clock;
function make(over = {}) {
  return T.createCommsTools({
    secretStore: { read: async (f, fb) => fb(), write: async () => {}, clear: async () => {} }, webhookFile: 'hook.enc',
    bridgeConfigFile: path.join(dir, 'comms-bridge.json'), statusSeqFile: path.join(dir, 'comms-status-seq.json'),
    fetch: async () => { throw new Error('no network in this test'); },
    pickFolder: async () => dir, confirm: async (q) => { asked.push(q); return answer; }, now: () => clock, ...over,
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-status-'));
  asked = []; answer = true; clock = 1_700_000_000_000;
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const GAME = '\u{1F3AE}';
const set = (over = {}) => ({ action: 'set', text: 'In a game, back later', emojiName: GAME, expiresAt: clock + 3600000, ...over });
const file = () => path.join(dir, 'vex-status.json');
const read = () => JSON.parse(fs.readFileSync(file(), 'utf8'));

// The plugin's parseStatusCommand, as written in statusData.ts.
function pluginParse(raw, now) {
  const o = JSON.parse(raw);
  if (o.schema !== 'vex-status/1') throw new Error('schema');
  if (!Number.isSafeInteger(o.seq) || o.seq < 1) throw new Error('seq');
  if (!Number.isFinite(o.issuedAt)) throw new Error('issuedAt');
  if (now - o.issuedAt > 10 * 60 * 1000) throw new Error('too old');
  if (o.action === 'clear') return o;
  if (o.action !== 'set') throw new Error('action');
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('control');
  if ([...text].length > 128) throw new Error('long');
  if (o.emojiName && !/^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*$/u.test(o.emojiName)) throw new Error('emoji');
  if (!text && !o.emojiName) throw new Error('empty');
  if (o.expiresAt && (o.expiresAt <= now || o.expiresAt - now > 7 * 24 * 3600 * 1000)) throw new Error('expiry');
  return o;
}

describe('T3-062 status command file', () => {
  it('needs a chosen folder first', async () => {
    await expect(make().statusWrite(set())).rejects.toThrow(/No bridge folder/);
  });

  it('writes exactly the plugin contract to vex-status.json, atomically, after a main confirm that shows the words', async () => {
    const c = make(); await c.bridgePick();
    const r = await c.statusWrite(set());
    const body = read();
    expect(body).toEqual({ schema: 'vex-status/1', seq: r.seq, issuedAt: clock, action: 'set', text: 'In a game, back later', emojiName: GAME, expiresAt: clock + 3600000 });
    expect(Number.isInteger(body.seq)).toBe(true);
    expect(() => pluginParse(fs.readFileSync(file(), 'utf8'), clock + 15000)).not.toThrow();   // the plugin accepts it
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain('In a game, back later');
    expect(asked[0].message).toMatch(/allowStatus/);
    expect(asked[0].message).toMatch(/never holds your Discord token/);
    expect(fs.existsSync(file() + '.tmp')).toBe(false);
    expect(fs.readdirSync(dir).sort()).toEqual(['comms-bridge.json', 'comms-status-seq.json', 'vex-status.json']);
  });

  it('seq grows with every command and across a restart of Vex (a new instance on the same profile)', async () => {
    const c = make(); await c.bridgePick();
    const a = await c.statusWrite(set());
    const b = await c.statusWrite({ action: 'clear' });
    expect(b.seq).toBeGreaterThan(a.seq);
    clock -= 10 * 3600 * 1000;                                  // even a clock that went back must not lower the number
    const d = await make().statusWrite({ action: 'clear' });
    expect(d.seq).toBeGreaterThan(b.seq);
  });

  it('a clear needs no confirm and carries no words', async () => {
    const c = make(); await c.bridgePick();
    await c.statusWrite({ action: 'clear' });
    expect(asked).toHaveLength(0);
    expect(read()).toEqual({ schema: 'vex-status/1', seq: read().seq, issuedAt: clock, action: 'clear' });
    expect(() => pluginParse(fs.readFileSync(file(), 'utf8'), clock)).not.toThrow();
  });

  it('asks once per run, a "no" writes nothing', async () => {
    answer = false;
    const c = make(); await c.bridgePick();
    await expect(c.statusWrite(set())).rejects.toThrow(/cancelled/);
    expect(fs.existsSync(file())).toBe(false);
    answer = true;
    await c.statusWrite(set());
    await c.statusWrite(set({ text: 'again' }));
    expect(asked).toHaveLength(2);
  });

  it('refuses anything outside the format, before asking or counting', async () => {
    const c = make(); await c.bridgePick();
    await expect(c.statusWrite({ action: 'restore' })).rejects.toThrow(/"set" or "clear"/);
    await expect(c.statusWrite(set({ text: 'x'.repeat(129) }))).rejects.toThrow(/at most 128/);
    await expect(c.statusWrite(set({ emojiName: 'video_game' }))).rejects.toThrow(/one unicode emoji/);
    await expect(c.statusWrite(set({ text: '', emojiName: '' }))).rejects.toThrow(/text or an emoji/);
    await expect(c.statusWrite(set({ expiresAt: clock - 1 }))).rejects.toThrow(/end time/);
    await expect(c.statusWrite(set({ expiresAt: undefined }))).rejects.toThrow(/end time/);
    await expect(c.statusWrite(set({ expiresAt: clock + 8 * 86400000 }))).rejects.toThrow(/end time/);
    expect(fs.existsSync(file())).toBe(false);
    expect(asked).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'comms-status-seq.json'))).toBe(false);
  });

  it('keeps the text on one line and accepts a text or an emoji alone', async () => {
    const c = make(); await c.bridgePick();
    await c.statusWrite(set({ text: 'line one\nline two\t3' }));
    expect(read().text).toBe('line one line two 3');
    await c.statusWrite(set({ text: '' }));
    expect(read()).toMatchObject({ text: '', emojiName: GAME });
    await c.statusWrite(set({ emojiName: '' }));
    expect(read()).toMatchObject({ emojiName: '' });
  });

  it('will not write through a folder of that name, and fails loudly on a broken counter', async () => {
    const c = make(); await c.bridgePick();
    fs.mkdirSync(file());
    await expect(c.statusWrite({ action: 'clear' })).rejects.toThrow(/link or a folder/);
    fs.rmdirSync(file());
    fs.writeFileSync(path.join(dir, 'comms-status-seq.json'), 'not json');
    await expect(c.statusWrite({ action: 'clear' })).rejects.toThrow(/counter is not readable/);
  });
});

describe('T3-062 wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('is registered in main, preload, the schemas and the policy', () => {
    expect(src('src/main.js')).toContain("ipcMain.handle('comms:status-write'");
    expect(src('src/main.js')).toContain('statusSeqFile');
    expect(src('src/preload.js')).toContain("'comms:status-write'");
    expect(src('src/main/ipc-schemas.js')).toContain("'comms:status-write'");
    expect(src('src/main/ipc-policy.js')).toContain("'comms:status-write'");
  });
  it('the window cannot pick the file name or the folder', () => {
    const { validatePayload } = require('../../src/main/ipc-policy.js');
    expect(() => validatePayload('comms:status-write', [{ action: 'set', text: 'x', expiresAt: 5, file: 'C:/x' }])).not.toThrow();   // an extra field is never used
    expect(() => validatePayload('comms:status-write', [{ action: 'delete' }])).toThrow();
    expect(() => validatePayload('comms:status-write', [{ action: 'restore' }])).toThrow();
  });
});
