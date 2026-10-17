// @vitest-environment jsdom
//
// Wave 5 fold-ins: add every prompt of a pack at once, the student pack's content, the model-fit benchmark on the
// person's own tasks, and warm-model scheduling inside their own windows. Ollama is a stand-in; no model is touched.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };
const nodeRequire = require;

describe('add every prompt of a pack', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    window.showToast = vi.fn();
    globalThis.vexId = (p) => p + Math.random().toString(36).slice(2, 8);
    const { VexSkills } = { VexSkills: fresh('skills.js').VexSkills };
    globalThis.VexSkills = VexSkills;
    VexSkills.skills = [];
    fresh('packs-ui.js');
  });
  const item = (id, prompt = 'Do ' + id + '.') => ({ type: 'skills', id, name: 'Skill ' + id, icon: 'brain', prompt, output: 'text', sites: [] });

  it('adds the ones you do not have, leaves the others, and counts how many differ', () => {
    const packs = window.VexPacks;
    packs._items = [{ packId: 'p', item: item('a') }, { packId: 'p', item: item('b') }, { packId: 'p', item: item('c') }, { packId: 'other', item: item('z') }];
    packs.addSkillToMine('Pack', 'p', packs._items[0].item, { quiet: true });
    VexSkills.skills[0].prompt = 'My own wording.';
    const r = packs.addAllSkills('Pack', 'p');
    expect(r).toEqual({ added: 2, kept: 1, differ: 1 });
    expect(VexSkills.skills.map(s => s.fromPack).sort()).toEqual(['p:a', 'p:b', 'p:c']);
    expect(VexSkills.skills.find(s => s.fromPack === 'p:a').prompt).toBe('My own wording.');
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/Added 2 prompts.*1 were already there, 1 of them worded differently/);
  });
  it('lists the one that cannot be added in the error and still adds the rest', () => {
    const packs = window.VexPacks;
    packs._items = [{ packId: 'p', item: item('good') }, { packId: 'p', item: { ...item('bad'), prompt: 'Do {{shell}}' } }];
    expect(() => packs.addAllSkills('Pack', 'p')).toThrow(/Could not add: Skill bad \(.*Unknown variable/);
    expect(VexSkills.skills.map(s => s.fromPack)).toEqual(['p:good']);
  });
  it('refuses a pack with no prompts', () => {
    window.VexPacks._items = [];
    expect(() => window.VexPacks.addAllSkills('Pack', 'p')).toThrow(/no prompts/);
  });
});

describe('the student discounts and portal recipes pack', () => {
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  const packs = nodeRequire('../../src/main/packs.js');
  const dir = path.join(__dirname, '../../src/main/builtin-packs');
  const parsed = packs.parsePack(fs.readFileSync(path.join(dir, 'vex-builtin.student-portals.vexpack'), 'utf8'), { builtin: true });

  it('is a valid built-in with only fixed https links to public pages', () => {
    const brief = parsed.pack.items.find(i => i.type === 'brief-section');
    const links = brief.blocks.filter(b => b.kind === 'link');
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const l of links) {
      const u = new URL(l.url);
      expect(u.protocol).toBe('https:');
      expect(u.username + u.password).toBe('');
      expect(u.search).toBe('');
    }
    expect(parsed.pack.permissions).toEqual(['opens:links']);
  });
  it('says when it was last checked and tells the reader to verify, in every part', () => {
    const brief = parsed.pack.items.find(i => i.type === 'brief-section');
    expect(brief.blocks[0].text).toMatch(/Last checked 2026-10-17/);
    expect(brief.blocks[0].text).toMatch(/read the page before you apply/);
    const snippets = parsed.pack.items.find(i => i.type === 'snippets');
    expect(snippets.entries).toHaveLength(4);
    for (const e of snippets.entries) {
      expect(e.text).toMatch(/Last checked 2026-10-17/);
      expect(e.text).toMatch(/verify/i);
      expect(e.text.length).toBeLessThanOrEqual(400);
    }
    expect(parsed.pack.description).toMatch(/verify/);
  });
  it('carries no script, no sign-in and no address built from input', () => {
    const text = JSON.stringify(parsed.pack);
    expect(text).not.toMatch(/url-template|\{query\}|password=|token=|javascript:/i);
  });
});

describe('model fit on your own tasks', () => {
  let ModelFit, store;
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    delete globalThis.GameMode; delete globalThis.BatteryMode; delete globalThis.VexJobs;
    ({ ModelFit } = fresh('local-model-tools.js'));
    store = { running: [], unloaded: [], warmed: [] };
    globalThis.Ollama = {
      listModels: vi.fn(async () => [{ name: 'fast:3b', sizeFormatted: '2 GB' }, { name: 'big:14b', sizeFormatted: '9 GB' }, { name: 'nomic-embed-text', sizeFormatted: '0.3 GB' }]),
      running: vi.fn(async () => store.running),
      warm: vi.fn(async (m) => { store.warmed.push(m); return true; }),
      unload: vi.fn(async (m) => { store.unloaded.push(m); return true; }),
      generate: vi.fn(async (m) => (m === 'big:14b' ? 'A long, careful answer. '.repeat(10) : 'Short.')),
    };
    globalThis.AgentModelTest = { EMBED: /embed|bge-|minilm|nomic-embed/i };
  });
  afterEach(() => { delete globalThis.Ollama; delete globalThis.AgentModelTest; });

  it('keeps up to five tasks and rejects bad ones', () => {
    expect(() => ModelFit.addTask('', 'x')).toThrow(/name/);
    expect(() => ModelFit.addTask('A', '')).toThrow(/what the model should be asked/);
    expect(() => ModelFit.addTask('A', 'x'.repeat(1501))).toThrow(/under 1500/);
    for (let i = 0; i < 4; i++) ModelFit.addTask('T' + i, 'prompt ' + i);
    expect(() => ModelFit.addTask('t0', 'p')).toThrow(/already a task/);
    ModelFit.addTask('T4', 'prompt 4');
    expect(() => ModelFit.addTask('T6', 'p')).toThrow(/At most 5/);
  });
  it('skips embedding models, times every answer and unloads what it loaded', async () => {
    ModelFit.addTask('Summary', 'Summarise this.');
    const models = await ModelFit.candidates();
    expect(models.map(m => m.name)).toEqual(['fast:3b', 'big:14b']);
    const rows = await ModelFit.run(models);
    expect(rows.map(r => r.model)).toEqual(['fast:3b', 'big:14b']);
    expect(rows[0].results[0]).toMatchObject({ error: '', answer: 'Short.' });
    expect(store.unloaded.sort()).toEqual(['big:14b', 'fast:3b']);
  });
  it('does not unload a model that was already loaded before it started', async () => {
    store.running = [{ name: 'fast:3b' }];
    ModelFit.addTask('Summary', 'Summarise this.');
    await ModelFit.run(await ModelFit.candidates(['fast:3b', 'big:14b']));
    expect(store.unloaded).toEqual(['big:14b']);
  });
  it('is refused while a game is running, and with no task or no model', async () => {
    ModelFit.addTask('Summary', 'Summarise this.');
    globalThis.GameMode = { gaming: true };
    await expect(ModelFit.run(await ModelFit.candidates())).rejects.toThrow(/a game is running/);
    expect(Ollama.warm).not.toHaveBeenCalled();
    delete globalThis.GameMode;
    await expect(ModelFit.run([])).rejects.toThrow(/at least one model/);
    ModelFit.removeTask(ModelFit.state().tasks[0].id);
    await expect(ModelFit.run(await ModelFit.candidates())).rejects.toThrow(/at least one task/);
  });
  it('a model that fails to load is a row with the reason, not a silent gap', async () => {
    ModelFit.addTask('Summary', 'Summarise this.');
    Ollama.warm.mockRejectedValueOnce(new Error('out of memory'));
    const rows = await ModelFit.run(await ModelFit.candidates());
    expect(rows[0].results[0].error).toMatch(/could not be loaded: out of memory/);
    expect(rows[1].results[0].error).toBe('');
  });
  it('goes through the heavy-job scheduler when there is one, and reports a refusal', async () => {
    ModelFit.addTask('Summary', 'Summarise this.');
    globalThis.VexJobs = { heavy: vi.fn(async () => ({ ran: false, reason: 'memory is low' })) };
    await expect(ModelFit.runOnRequest(await ModelFit.candidates())).rejects.toThrow(/Held back: memory is low/);
    expect(VexJobs.heavy).toHaveBeenCalledWith('Model fit', expect.any(Function), { kind: 'ai-ask', feature: 'local-model-tools' });
    delete globalThis.VexJobs;
  });
  it('ranks by your ratings first, then speed, and advises in plain words', async () => {
    const t = ModelFit.addTask('Summary', 'Summarise this.');
    const rows = await ModelFit.run(await ModelFit.candidates());
    rows[0].results[0].seconds = 1; rows[1].results[0].seconds = 6;
    expect(ModelFit.rank(rows, {}).map(r => r.model)).toEqual(['fast:3b', 'big:14b']);
    ModelFit.rate('big:14b', t.id, 'good'); ModelFit.rate('fast:3b', t.id, 'poor');
    const ratings = ModelFit.state().ratings;
    expect(ModelFit.rank(rows, ratings).map(r => r.model)).toEqual(['big:14b', 'fast:3b']);
    const lines = ModelFit.advice(rows, ratings).join(' ');
    expect(lines).toMatch(/Fastest on your tasks: fast:3b/);
    expect(lines).toMatch(/Best by your ratings: big:14b/);
    expect(lines).toMatch(/big:14b is more than three times slower/);
    expect(() => ModelFit.rate('x', t.id, 'great')).toThrow(/good or poor/);
  });
});

describe('warm model inside your own windows', () => {
  let WarmModel, calls;
  beforeEach(() => {
    localStorage.clear();
    window.showToast = vi.fn();
    for (const g of ['GameMode', 'GameWarmdown', 'BatteryMode', 'VexJobs', 'VexLedger']) delete globalThis[g];
    ({ WarmModel } = fresh('local-model-tools.js'));
    WarmModel._ledgerDay = ''; WarmModel._job = null;
    calls = [];
    globalThis.Ollama = { running: vi.fn(async () => []), warm: vi.fn(async (m, min) => { calls.push([m, min]); return true; }), unload: vi.fn(async () => true) };
    globalThis.AIRouter = { isOllamaAvailable: () => true, getModel: () => 'llama3.2:3b' };
  });
  afterEach(() => { delete globalThis.Ollama; delete globalThis.AIRouter; });
  const at = (day, h, m) => new Date(2026, 9, 12 + day, h, m); // 12 Oct 2026 is a Monday

  it('reads a window the way a person writes it', () => {
    expect(WarmModel.parseWindow('weekdays 09:00-12:00')).toEqual({ days: [1, 2, 3, 4, 5], from: 540, to: 720 });
    expect(WarmModel.parseWindow('mon-wed 14:00-18:30')).toEqual({ days: [1, 2, 3], from: 840, to: 1110 });
    expect(WarmModel.parseWindow('sat,sun 10:00-11:00').days).toEqual([0, 6]);
    expect(WarmModel.parseWindow('fri-mon 08:00-09:00').days).toEqual([0, 1, 5, 6]);
    expect(() => WarmModel.parseWindow('whenever')).toThrow(/Write it like/);
    expect(() => WarmModel.parseWindow('mon 12:00-11:00')).toThrow(/end after it starts/);
    expect(() => WarmModel.parseWindow('funday 09:00-10:00')).toThrow(/not a day/);
    expect(() => WarmModel.parseWindow('mon 25:00-26:00')).toThrow(/not a time/);
    expect(WarmModel.describe({ days: [1, 2, 3, 4, 5], from: 540, to: 720 })).toBe('weekdays 09:00-12:00');
  });
  it('is off by default and does nothing outside a window, whatever the switch says', async () => {
    expect(WarmModel.enabled()).toBe(false);
    expect((await WarmModel.tick(at(0, 10, 0))).action).toBe('idle');
    WarmModel.addWindow('weekdays 09:00-12:00');
    WarmModel.setEnabled(true);
    expect(await WarmModel.tick(at(0, 13, 0))).toMatchObject({ action: 'idle', why: 'outside your windows' });
    expect(await WarmModel.tick(at(5, 10, 0))).toMatchObject({ action: 'idle' });     // Saturday
    expect(calls).toEqual([]);
  });
  it('inside a window it loads the model for the minutes that are left, once', async () => {
    WarmModel.addWindow('weekdays 09:00-12:00');
    WarmModel.setEnabled(true);
    const r = await WarmModel.tick(at(0, 10, 30));
    expect(r).toMatchObject({ action: 'warmed', model: 'llama3.2:3b', minutes: 90 });
    expect(calls).toEqual([['llama3.2:3b', 90]]);
    Ollama.running.mockResolvedValue([{ name: 'llama3.2:3b', expiresAt: new Date(at(0, 12, 0)).toISOString() }]);
    expect((await WarmModel.tick(at(0, 10, 35))).action).toBe('kept');
    expect(calls).toHaveLength(1);
  });
  it('renews when the load is about to lapse inside the window', async () => {
    WarmModel.addWindow('weekdays 09:00-12:00');
    WarmModel.setEnabled(true);
    Ollama.running.mockResolvedValue([{ name: 'llama3.2:3b', expiresAt: new Date(at(0, 10, 33)).toISOString() }]);
    expect((await WarmModel.tick(at(0, 10, 30))).action).toBe('warmed');
  });
  it('holds back during a game, a launcher or battery saving, and says why', async () => {
    WarmModel.addWindow('daily 00:00-23:59');
    WarmModel.setEnabled(true);
    globalThis.GameMode = { gaming: true };
    expect(await WarmModel.tick(at(0, 10, 0))).toMatchObject({ action: 'held', why: 'a game is running' });
    delete globalThis.GameMode;
    globalThis.BatteryMode = { holdingAi: () => true };
    expect(await WarmModel.tick(at(0, 10, 0))).toMatchObject({ action: 'held', why: 'Vex is saving battery' });
    delete globalThis.BatteryMode;
    expect(calls).toEqual([]);
  });
  it('says nothing is warmed when Ollama is not running, and raises when no model is chosen', async () => {
    WarmModel.addWindow('daily 00:00-23:59');
    WarmModel.setEnabled(true);
    AIRouter.isOllamaAvailable = () => false;
    expect(await WarmModel.tick(at(0, 10, 0))).toMatchObject({ action: 'idle', why: 'Ollama is not running' });
    AIRouter.isOllamaAvailable = () => true; AIRouter.getModel = () => '';
    await expect(WarmModel.tick(at(0, 10, 0))).rejects.toThrow(/no local model chosen/);
  });
  it('writes one Ledger line a day with an undo that unloads the model', async () => {
    const lines = [];
    globalThis.VexLedger = { note: (l) => lines.push(l), registerUndo: vi.fn(), registerStop: vi.fn() };
    WarmModel.addWindow('daily 00:00-23:59');
    WarmModel.setEnabled(true);
    await WarmModel.tick(at(0, 10, 0));
    await WarmModel.tick(at(0, 10, 10));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ feature: 'local-model-tools', undo: { kind: 'warm-unload', model: 'llama3.2:3b' } });
    delete globalThis.VexLedger;
  });
  it('the background job exists only while the switch is on', () => {
    const stop = vi.fn();
    globalThis.VexJobs = { every: vi.fn(() => ({ stop })) };
    WarmModel.addWindow('weekdays 09:00-12:00');
    WarmModel.setEnabled(true);
    expect(VexJobs.every).toHaveBeenCalledWith('Warm model', 300000, expect.any(Function), { when: 'background', feature: 'local-model-tools' });
    WarmModel.setEnabled(false);
    expect(stop).toHaveBeenCalled();
    delete globalThis.VexJobs;
  });
});
