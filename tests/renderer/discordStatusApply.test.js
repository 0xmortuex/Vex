// @vitest-environment jsdom
//
// T3-062 (Wave 6): Discord status through the owner's own Vencord plugin. The window module runs against the REAL
// main-process channel (comms-tools.js) in a temp folder, with a fake plugin that answers the request file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const JS = path.join(ROOT, 'src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const T = require(path.join(ROOT, 'src/main/comms-tools.js'));

const NAMES = ['CommsStore', 'DiscordStatus', 'VexLedger', 'VexConsent', 'VexAttention', 'AttentionState', 'VexProblems'];
let DS, dir, tools, asked, mainAnswer, pluginMode, problems, confirms, confirmAnswer, clock;

const att = (...ids) => ({ quiet: ids.length > 0, sources: ids.map(id => ({ id, until: id === 'focus' ? clock + 90 * 60000 : 0 })) });

beforeEach(async () => {
  for (const n of NAMES) delete globalThis[n];
  localStorage.clear();
  clock = 1_700_000_000_000;
  asked = []; mainAnswer = true; pluginMode = 'ok'; problems = []; confirms = []; confirmAnswer = true;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-status-ui-'));
  tools = T.createCommsTools({
    secretStore: { read: async (f, fb) => fb(), write: async () => {}, clear: async () => {} }, webhookFile: 'h.enc',
    bridgeConfigFile: path.join(dir, 'comms-bridge.json'), fetch: async () => { throw new Error('no network'); },
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
  DS._sleep = async () => { await plugin(); };
  DS.ACK_WAIT = { tries: 3, everyMs: 0 };
  window.vex = { commsStatusWrite: (r) => tools.statusWrite(r), commsStatusAck: async () => tools.statusAck() };
  window.vexConfirm = async (o) => { confirms.push(o); return confirmAnswer; };
  // The plugin answers on the first look after the request, so the ack is read in the second round.
  snapshot = { status: 'online', text: 'hello', emoji: 'wave' };
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete window.vex; delete window.vexConfirm; });

let snapshot;
async function plugin() {
  const rf = path.join(dir, T.STATUS_REQUEST_FILE);
  if (pluginMode === 'silent' || !fs.existsSync(rf)) return;
  const req = JSON.parse(fs.readFileSync(rf, 'utf8'));
  const af = path.join(dir, T.STATUS_ACK_FILE);
  if (fs.existsSync(af) && JSON.parse(fs.readFileSync(af, 'utf8')).seq === req.seq) return;
  if (pluginMode === 'refuse') return fs.writeFileSync(af, JSON.stringify({ schema: 'vex-status/1', seq: req.seq, action: req.action, applied: false, error: 'Discord is not ready', previous: null }));
  fs.writeFileSync(af, JSON.stringify({ schema: 'vex-status/1', seq: req.seq, action: req.action, applied: true, error: '', previous: req.action === 'set' ? snapshot : null }));
}
const settle = () => DS._chain;

describe('T3-062 plugin route', () => {
  it('is OFF by default: a mode start only suggests, and nothing is written', async () => {
    expect(DS.state().apply).toBe(false);
    DS.follow(att('game')); await settle();
    expect(VexAttention.suggest).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dir, T.STATUS_REQUEST_FILE))).toBe(false);
  });

  it('when on: previews the first change, sets it, records one ledger line with Undo, and restores at the end', async () => {
    DS.setApply(true);
    expect(DS.follow(att('game'))).toBe('start'); await settle();
    expect(confirms).toHaveLength(1);
    expect(confirms[0].message).toContain('In a game, back later');
    expect(asked).toHaveLength(1);                                         // main asked too
    const req = JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8'));
    expect(req).toMatchObject({ action: 'set', status: 'dnd', text: 'In a game, back later', emoji: 'video_game' });
    expect(req.expiresAt).toBe(clock + 8 * 3600000);
    expect(VexAttention.suggest).not.toHaveBeenCalled();                  // the plugin does it, no copy-yourself suggestion
    let lines = VexLedger.list().filter(e => e.feature === 'discord-status');
    expect(lines).toHaveLength(1);
    expect(lines[0].what).toBe('Set your Discord status to dnd: "In a game, back later"');
    expect(lines[0].undo).toEqual({ kind: 'discord-status-restore' });
    expect(DS.follow(att())).toBe('end'); await settle();
    expect(JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8')).action).toBe('restore');
    lines = VexLedger.list().filter(e => e.feature === 'discord-status');
    expect(lines.map(l => l.what)).toEqual(['Put your Discord status back', 'Set your Discord status to dnd: "In a game, back later"']);
    expect(problems).toEqual([]);
    expect(DS._applied).toBe(false);
  });

  it('a Focus block sends its end time (plus five minutes) so the plugin restores by itself', async () => {
    DS.setApply(true);
    DS.follow(att('focus')); await settle();
    const req = JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8'));
    expect(req.expiresAt).toBe(clock + 95 * 60000);
    expect(req.text).toMatch(/^Focusing until \d\d:\d\d$/);
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
    expect(fs.existsSync(path.join(dir, T.STATUS_REQUEST_FILE))).toBe(false);
    expect(DS.state().apply).toBe(false);
    expect(problems[0][1]).toMatch(/Not allowed/);
  });

  it('says no in main: nothing is written, the failure is reported, no ledger line', async () => {
    DS.setApply(true); mainAnswer = false;
    DS.follow(att('game')); await settle();
    expect(fs.existsSync(path.join(dir, T.STATUS_REQUEST_FILE))).toBe(false);
    expect(problems[0][1]).toMatch(/cancelled/);
    expect(VexLedger.list()).toHaveLength(0);
  });

  it('a plugin that refuses is reported with its reason and nothing is claimed as set', async () => {
    DS.setApply(true); pluginMode = 'refuse';
    DS.follow(att('game')); await settle();
    expect(problems[0][1]).toMatch(/did not set it: Discord is not ready/);
    expect(VexLedger.list()).toHaveLength(0);
    expect(DS._applied).toBe(false);
  });

  it('a silent plugin is reported, the ledger says it only asked, and the end time still protects the status', async () => {
    DS.setApply(true); pluginMode = 'silent';
    DS.follow(att('game')); await settle();
    expect(problems[0][1]).toMatch(/has not answered/);
    const l = VexLedger.list().filter(e => e.feature === 'discord-status');
    expect(l[0].what).toMatch(/^Asked your plugin to set/);
    expect(DS._applied).toBe(true);                                        // so the restore is still sent later
    pluginMode = 'ok';
    DS.follow(att()); await settle();
    expect(JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8')).action).toBe('restore');
  });

  it('ledger Undo asks the plugin to put the status back', async () => {
    DS.setApply(true);
    DS.follow(att('game')); await settle();
    const entry = VexLedger.list()[0];
    expect(VexLedger.canUndo(entry)).toBe(true);
    await VexLedger.undo(entry.id);
    expect(JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8')).action).toBe('restore');
    expect(DS._applied).toBe(false);
  });

  it('switching the feature off while a status is set puts it back', async () => {
    DS.setApply(true);
    DS.follow(att('game')); await settle();
    DS.setEnabled(false); await settle();
    expect(JSON.parse(fs.readFileSync(path.join(dir, T.STATUS_REQUEST_FILE), 'utf8')).action).toBe('restore');
  });

  it('keeps the wording rules: an emoji is a plain name', () => {
    expect(DS.state().emojis).toEqual({ game: 'video_game', focus: 'zzz', back: '' });
    DS.setEmoji('game', 'controller');
    expect(DS.state().emojis.game).toBe('controller');
    expect(() => DS.setEmoji('game', ':bad:')).toThrow(/plain name/);
  });

  it('holds no token and never touches the Discord page', () => {
    const src = fs.readFileSync(path.join(JS, 'discord-status.js'), 'utf8');
    expect(src).not.toMatch(/executeJavaScript|insertCSS|sendInputEvent|webContents|\.fetch\(|XMLHttpRequest|userSettings|\/users\/@me|authorization/i);
  });
});
