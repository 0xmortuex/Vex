// @vitest-environment jsdom
//
// Wave 3 (dev-ai): the pure parts of the Cloudflare links, the Roblox id reader, repo skim flags,
// reading triage, "seen before", watch judgement and the API playground's collections / OpenAPI import.
import { beforeEach, describe, expect, it, vi } from 'vitest';
require('../../src/renderer/js/vex-utils.js');
globalThis.VexIcons = require('../../src/renderer/js/vex-icons.js').VexIcons;
const { ApiPlayground: PG } = require('../../src/renderer/js/api-playground.js');
const { CloudflareShortcuts: CF, RobloxResolver: RB, RepoSkim: RS } = require('../../src/renderer/js/dev-shortcuts.js');
const { ReadingTriage: RT, SeenBefore: SB, WatchJudgement: WJ, AiRecipes: AR, AiWords } = require('../../src/renderer/js/ai-judgement.js');
const { WebhookInspector: WI } = require('../../src/renderer/js/local-tools-ui.js');

beforeEach(() => { localStorage.clear(); window.showToast = vi.fn(); window.VexTabPolicy = { isPrivateWindow: false }; });

describe('API playground collections and OpenAPI import', () => {
  it('groups requests, keeps them when a collection is deleted, and drops a stale collection id', () => {
    const c = PG.saveCollection({ id: '', name: 'owner/repo' });
    const id = PG.saveRequest({ name: 'List', method: 'GET', url: 'https://a.com/x', body: '', headers: [], collection: c });
    expect(PG.load().requests.find(r => r.id === id).collection).toBe(c);
    expect(() => PG.saveCollection({ id: '', name: 'OWNER/repo' })).toThrow(/already a collection/);
    PG.deleteCollection(c);
    expect(PG.load().requests.find(r => r.id === id).collection).toBe('');
  });

  it('turns an OpenAPI document into requests with {{variables}} and never invents a body', () => {
    const doc = { openapi: '3.0.0', info: { title: 'Pets' }, servers: [{ url: 'https://api.example.com/v1/' }], paths: {
      '/pets/{petId}': { get: { summary: 'One pet' } },
      '/pets': { post: { operationId: 'addPet', requestBody: { content: { 'application/json': { example: { name: 'Rex' } } } } }, get: {} },
    } };
    const spec = PG.fromOpenApi(doc);
    expect(spec.baseUrl).toBe('https://api.example.com/v1');
    expect(spec.requests.find(r => r.name === 'One pet').url).toBe('{{baseUrl}}/pets/{{petId}}');
    expect(spec.requests.find(r => r.name === 'addPet').body).toContain('"Rex"');
    expect(spec.requests.find(r => r.method === 'GET' && r.url === '{{baseUrl}}/pets').body).toBe('');
    const r = PG.importCollection(spec);
    const st = PG.load();
    expect(r.added).toBe(3);
    expect(st.collections[0].name).toBe('Pets');
    expect(st.envs[0].vars[0]).toEqual({ name: 'baseUrl', value: 'https://api.example.com/v1', secret: false });
    expect(st.activeEnv).toBe('');
  });

  it('reads Swagger 2 and refuses a document that is not one', () => {
    expect(PG.fromOpenApi({ swagger: '2.0', host: 'h.com', basePath: '/api', schemes: ['https'], paths: { '/a': { get: {} } } }).baseUrl).toBe('https://h.com/api');
    expect(() => PG.fromOpenApi({ hello: 1 })).toThrow(/not an OpenAPI/);
  });

  it('imports through the playground sender and says when the document is not JSON', async () => {
    window.vex = { playgroundSend: vi.fn(async () => ({ ok: true, status: 200, size: 5, body: 'openapi: 3', binary: false })) };
    await expect(PG.importOpenApi('https://x.com/openapi.yaml')).rejects.toThrow(/JSON/);
  });
});

describe('Cloudflare shortcuts', () => {
  it('builds dashboard links from a saved account and refuses bad ids', () => {
    const acct = 'a'.repeat(32);
    expect(() => CF.url('home')).toThrow(/account id/);
    expect(() => CF.setAccount('nope')).toThrow(/32/);
    CF.setAccount(acct);
    expect(CF.url('logs', 'vex-sync')).toBe('https://dash.cloudflare.com/' + acct + '/workers/services/view/vex-sync/production/observability/logs');
    expect(() => CF.url('logs', '../x')).toThrow(/worker name/);
    expect(CF.url('kv', 'b'.repeat(32))).toContain('/workers/kv/namespaces/');
  });
});

describe('Roblox resolver', () => {
  it('reads an id or a roblox.com address and nothing else', () => {
    expect(RB.parse('920587237')).toBe('920587237');
    expect(RB.parse('https://www.roblox.com/games/920587237/Adopt-Me')).toBe('920587237');
    expect(RB.parse('https://www.roblox.com/catalog/1234/Hat')).toBe('1234');
    expect(() => RB.parse('https://evil.com/games/1234567')).toThrow(/roblox.com/);
    expect(() => RB.parse('abc')).toThrow(/Paste a Roblox id/);
  });
  it('resolves an asset through the public endpoint only', async () => {
    window.vex = { apiRequest: vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({ Name: 'Cool Hat', AssetTypeId: 8, Creator: { Name: 'Bob' }, IsForSale: true, PriceInRobux: 5 }) })) };
    RB._last = 0; RB.MIN_GAP_MS = 0;
    const r = await RB.resolve('1234');
    expect(r).toMatchObject({ kind: 'asset', name: 'Cool Hat', url: 'https://www.roblox.com/catalog/1234' });
    expect(window.vex.apiRequest.mock.calls[0][0]).toMatchObject({ publicOnly: true });
  });
});

describe('Repo skim', () => {
  it('names the red flags from the facts', () => {
    const f = { license: '', archived: true, pushedAt: '2020-01-01T00:00:00Z', contributors: 1, fork: false, readme: '', installScripts: ['postinstall'], createdAt: '2019-01-01T00:00:00Z' };
    const flags = RS.flags(f, Date.parse('2026-10-01'));
    expect(flags.join('|')).toMatch(/No licence.*Archived.*over a year.*single maintainer.*No README.*postinstall/);
    expect(RS.flags({ license: 'MIT', readme: 'x', pushedAt: '2026-09-30T00:00:00Z', contributors: 3 }, Date.parse('2026-10-01'))).toEqual([]);
  });
  it('parses owner/repo and github addresses', () => {
    expect(RS.parse('https://github.com/0xmortuex/Vex/tree/main').full).toBe('0xmortuex/Vex');
    expect(() => RS.parse('not a repo')).toThrow(/owner\/repo/);
  });
});

describe('Reading triage', () => {
  const now = Date.parse('2026-10-16');
  it('ranks against goals and only suggests drop for old, unrelated items', () => {
    const goals = ['Cloudflare Workers'];
    const a = RT.score({ title: 'Cloudflare Workers KV limits', url: 'https://blog.cloudflare.com/kv', at: now - 86400000, minutes: 5 }, goals, now);
    const b = RT.score({ title: 'Cat pictures', url: 'https://x.com/cats', at: now - 90 * 86400000 }, goals, now);
    const c = RT.score({ title: 'Cat pictures', url: 'https://x.com/cats', at: now - 2 * 86400000 }, goals, now);
    expect(a.verdict).toBe('read now');
    expect(b.verdict).toBe('drop');
    expect(c.verdict).toBe('skim');
    expect(RT.rank([{ title: 'z', url: 'https://z.com', at: now }, { title: 'Cloudflare Workers', url: 'https://c.com', at: now }], goals, now)[0].item.title).toBe('Cloudflare Workers');
  });
  it('says so when there are no goals', () => {
    expect(RT.score({ title: 't', url: 'https://t.com', at: 1 }, [], 2).reason).toMatch(/No goals/);
  });
  it('never changes the queue', () => {
    localStorage.setItem('vex.readLater', JSON.stringify([{ id: '1', url: 'https://a.com', title: 'A', at: 1, read: false }]));
    const before = localStorage.getItem('vex.readLater');
    RT.rank(RT.queue(), ['a']);
    expect(localStorage.getItem('vex.readLater')).toBe(before);
  });
});

describe('Have I seen this before?', () => {
  it('counts earlier visits (not the one happening now) and finds a similar note', () => {
    const now = Date.now();
    const docs = [
      { where: 'history', title: 'Electron security checklist', url: 'https://e.com/sec', at: now - 5 * 86400000, key: SB.canonical('https://e.com/sec'), text: 'Electron security checklist' },
      { where: 'history', title: 'Electron security checklist', url: 'https://e.com/sec?utm_source=x', at: now - 1000, key: SB.canonical('https://e.com/sec'), text: 'Electron security checklist' },
      { where: 'note', title: 'Electron hardening notes', url: '', at: now - 86400000, key: '', text: 'Electron hardening notes contextIsolation sandbox security checklist' },
      { where: 'note', title: 'Groceries', url: '', at: now, key: '', text: 'milk eggs' },
    ];
    const r = SB.find({ url: 'https://e.com/sec', title: 'Electron security checklist', text: 'security checklist sandbox contextIsolation electron' }, docs, now);
    expect(r.same.visits).toBe(1);
    expect(r.similar.map(s => s.title)).toEqual(['Electron hardening notes']);
    expect(r.hint).toMatch(/1 time/);
  });
  it('tokenises without stop words', () => {
    expect(AiWords.tokens('The Electron and the sandbox 2024')).toEqual(['electron', 'sandbox']);
  });
});

describe('Watch judgement', () => {
  it('applies only to a watch with a condition and the switch on', () => {
    window.PageWatch = globalThis.PageWatch = { list: () => [{ id: 'w1' }] };
    expect(WJ.applies({ id: 'w1' })).toBe(false);
    WJ.setCondition('w1', 'only if the price drops');
    expect(WJ.applies({ id: 'w1' })).toBe(true);
    WJ.setEnabled(false);
    expect(WJ.applies({ id: 'w1' })).toBe(false);
  });
  it('announces as usual when the local model cannot be asked (fail open)', async () => {
    globalThis.PageWatch = { list: () => [{ id: 'w1' }] };
    WJ.setCondition('w1', 'price drops');
    const r = await WJ.review({ id: 'w1', title: 'T', url: 'https://t.com' }, { from: 1, to: 2 }, null);
    expect(r.notify).toBe(true);
  });
  it('holds back a change the model says does not matter, and drops a quote it made up', async () => {
    globalThis.PageWatch = { list: () => [{ id: 'w1' }] };
    WJ.setCondition('w1', 'price drops');
    const spy = vi.spyOn(globalThis.AiLocal || require('../../src/renderer/js/ai-judgement.js').AiLocal, 'generate');
    spy.mockResolvedValueOnce('{"matters": false, "why": "an advert changed", "evidence": ""}');
    const held = await WJ.review({ id: 'w1', title: 'T', url: 'https://t.com' }, { why: 'changed' }, { added: ['new advert'], removed: ['old advert'] });
    expect(held.notify).toBe(false);
    expect(WJ.held().length).toBe(1);
    spy.mockResolvedValueOnce('{"matters": true, "why": "price fell", "evidence": "invented quote"}');
    const yes = await WJ.review({ id: 'w1', title: 'T', url: 'https://t.com' }, { why: 'changed' }, { added: ['Price: 5'], removed: ['Price: 9'] });
    expect(yes).toEqual({ notify: true, judged: { why: 'price fell', evidence: '' } });
    spy.mockRestore();
  });
});

describe('AI recipes', () => {
  it('make no reminder for a recipe that fails its checks, and never run by themselves', async () => {
    globalThis.VexSkills = { skills: [{ id: 'sk1', name: 'Digest' }], run: vi.fn() };
    globalThis.VexQuickReminder = { parseWhen: () => new Date(Date.now() + 1000), create: vi.fn(async () => ({ id: 'r1' })), remove: vi.fn() };
    await expect(AR.add({ name: '', skillId: 'sk1' })).rejects.toThrow(/name/);
    await expect(AR.add({ name: 'A', skillId: 'nope' })).rejects.toThrow(/skills/);
    expect(VexQuickReminder.create).not.toHaveBeenCalled();
    const r = await AR.add({ name: 'Digest', skillId: 'sk1', whenText: 'monday 9am', repeat: 'weekly' });
    expect(VexQuickReminder.create.mock.calls[0][0]).toBe('Run recipe: Digest');
    expect(VexSkills.run).not.toHaveBeenCalled();
    expect(AR.forReminder({ id: 'r1' }).id).toBe(r.id);
    expect(AR.forReminder({ message: 'Run recipe: Digest' }).id).toBe(r.id);
    await AR.run(r.id);
    expect(VexSkills.run).toHaveBeenCalledWith('sk1');
  });
});

describe('Webhook inspector window side', () => {
  it('is off by default and replays without the headers the playground refuses or any real address', () => {
    expect(WI.enabled()).toBe(false);
    const p = WI.replayPrefill({ method: 'POST', body: '{}', binary: false, tooLarge: false, headers: [['Host', 'x'], ['Content-Length', '2'], ['X-Sig', 'abc']] });
    expect(p.headers).toEqual([{ name: 'X-Sig', value: 'abc' }]);
    expect(p.url).toMatch(/\.invalid/);
  });
});
