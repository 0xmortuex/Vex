// @vitest-environment jsdom
//
// T3-062 (Wave 6): Discord status through the owner's own Vencord plugin. The window module runs against the REAL
// main-process channel (comms-tools.js) in a temp folder; the command file is checked as the plugin would read it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const T = require(path.join(ROOT, 'src/main/comms-tools.js'));

const NAMES = ['CommsStore', 'DiscordStatus', 'VexLedger', 'VexConsent', 'VexAttention', 'AttentionState', 'VexProblems'];
let DS, dir, tools, asked, mainAnswer, problems, confirms, confirmAnswer, clock;

const att = (...ids) => ({ quiet: ids.length > 0, sources: ids.map(id => ({ id, until: id === 'focus' ? clock + 90 * 60000 : 0 })) });
const file = () => path.join(dir, 'vex-status.json');
const read = () => JSON.parse(fs.readFileSync(file(), 'utf8'));

beforeEach(async () => {
  for (const n of NAMES) delete globalThis[n];
  localStorage.clear();
  clock = 1_700_000_000_000;
  asked = []; mainAnswer = true; problems = []; confirms = []; confirmAnswer = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-status-ui-'));
  tools = T.createCommsTools({
    secretStore: { read: async (f, fb) => fb(), write: async () => {}, clear: async () => {} }, webhookFile: 'h.enc',
    bridgeConfigFile: path.join(dir, 'comms-bridge.json'), statusSeqFile: path.join(dir, 'seq.json'), fetch: async () => { throw new Error('no network'); },
    pickFolder: async () => dir, confirm: async (q) => { asked.push(q); return mainAnswer; }, now: () => clock,
  });
  await tools.bridgePick();
  globalThis.VexConsent = fresh('vex-defaults.js').VexConsent;
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  globalThis.VexLedger = fresh('vex-ledger.js').VexLedger;
  globalThis.VexLedger._entries = null; globalThis.VexLedger._undo = new Map();
  globalThis.VexProblems = { note: (...a) => problems.push(a) };
  globalThis.VexAttention = { suggest: vi.fn() };
  DS = fresh('discord-status.js').DiscordStatus;
  DS._now = () => clock;
  window.vex = { commsStatusWrite: (r) => tools.statusWrite(r) };
  window.vexConfirm = async (o) => { confirms.push(o); return confirmAnswer; };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete window.vex; delete window.vexConfirm; });

const settle = () => DS._chain;

describe('T3-062 plugin route', () => {
  it('is OFF by default: a mode start only suggests, and nothing is written', async () => {
    expect(DS.state().apply).toBe(false);
    DS.follow(att('game')); await settle();
    expect(VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(file())).toBe(false);
  });

  it('when on: previews the first change, writes the command, records one ledger line with Undo, and clears at the end', async () => {
    DS.setApply(true);
    expect(DS.follow(att('game'))).toBe('start'); await settle();
    expect(confirms).toHaveLength(1);
    expect(confirms[0].message).toContain('In a game, back later');
    expect(confirms[0].message).toContain('allowStatus');
    expect(asked).toHaveLength(1);                                         // main asked too
    expect(read()).toMatchObject({ schema: 'vex-status/1', action: 'set', text: 'In a game, back later', emojiName: '', expiresAt: clock + 8 * 3600000, issuedAt: clock });
    expect(VexAttention.suggest).not.toHaveBeenCalled();                  // the plugin does it, no copy-yourself suggestion
    let lines = VexLedger.list().filter(e => e.feature === 'discord-status');
    expect(lines).toHaveLength(1);
    expect(lines[0].what).toBe('Asked your Vencord plugin to set your Discord status to "In a game, back later"');
    expect(lines[0].undo).toEqual({ kind: 'discord-status-restore' });
    const seq = read().seq;
    expect(DS.follow(att())).toBe('end'); await settle();
    expect(read()).toMatchObject({ action: 'clear' });
    expect(read().seq).toBeGreaterThan(seq);
    lines = VexLedger.list().filter(e => e.feature === 'discord-status');
    expect(lines.map(l => l.what)[0]).toBe('Asked your Vencord plugin to put your Discord status back');
    expect(problems).toEqual([]);
    expect(DS._applied).toBe(false);
  });

  it('a Focus block sends its end time (plus five minutes) so the status ends by itself', async () => {
    DS.setApply(true);
    DS.follow(att('focus')); await settle();
    expect(read().expiresAt).toBe(clock + 95 * 60000);
    expect(read().text).toMatch(/^Focusing until \d\d:\d\d$/);
    DS.setEmoji('focus', '\u23F3');
  });

  it('asks only the first time; later changes do not ask again, in the window or in main', async () => {
    DS.setApply(true);
    DS.follow(att('game')); await settle(); DS.follow(att()); await settle();
    clock += 1000;
    DS.follow(att('focus')); await settle();
    expect(confirms).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it('says no to the preview: nothing is written and the route switches itself off', async () => {
    DS.setApply(true); confirmAnswer = false;
    DS.follow(att('game')); await settle();
    expect(fs.existsSync(file())).toBe(false);
    expect(DS.state().apply).toBe(false);
    expect(problems[0][1]).toMatch(/Not allowed/);
  });

  it('says no in main: nothing is written, the failure is reported, no ledger line', async () => {
    DS.setApply(true); mainAnswer = false;
    DS.follow(att('game')); await settle();
    expect(fs.existsSync(file())).toBe(false);
    expect(problems[0][1]).toMatch(/cancelled/);
    expect(VexLedger.list()).toHaveLength(0);
  });

  it('a failure to write (no bridge folder) is reported, not hidden', async () => {
    await tools.bridgeForget();
    DS.setApply(true);
    DS.follow(att('game')); await settle();
    expect(problems[0][1]).toMatch(/No bridge folder/);
    expect(VexLedger.list()).toHaveLength(0);
    expect(DS._applied).toBe(false);
  });

  it('ledger Undo asks the plugin to put the status back', async () => {
    DS.setApply(true);
    DS.follow(att('game')); await settle();
    const entry = VexLedger.list()[0];
    expect(VexLedger.canUndo(entry)).toBe(true);
    await VexLedger.undo(entry.id);
    expect(read().action).toBe('clear');
    expect(DS._applied).toBe(false);
  });

  it('switching the feature off while a status is set clears it', async () => {
    DS.setApply(true);
    DS.follow(att('game')); await settle();
    DS.setEnabled(false); await settle();
    expect(read().action).toBe('clear');
  });

  it('keeps the wording rules: an emoji is one unicode emoji', () => {
    expect(DS.state().emojis).toEqual({ game: '', focus: '', back: '' });
    DS.setEmoji('game', '\u{1F3AF}');
    expect(DS.state().emojis.game).toBe('\u{1F3AF}');
    expect(() => DS.setEmoji('game', 'controller')).toThrow(/one unicode emoji/);
  });

  it('holds no token and never touches the Discord page', () => {
    const src = fs.readFileSync(path.join(JS, 'discord-status.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|insertCSS|sendInputEvent|webContents|\.fetch\(|XMLHttpRequest|userSettings|\/users\/@me|authorization/i);
  });
});
