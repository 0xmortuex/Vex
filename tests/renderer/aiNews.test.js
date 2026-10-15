// AI news (js/ai-news.js): the rule engine, quiet hours, caps, the poller's
// state machine and the delivery plan. Pure parts are called directly; the
// poller runs against an injected request, so no network and no window.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { AINews } = require('../../src/renderer/js/ai-news.js');
globalThis.AINews = AINews;   // the panel reads it as a script global

const mk = (o = {}) => ({
  id: 'a1', title: 'OpenAI releases GPT-6', url: 'https://openai.com/n/1', cluster: 'c1', source: 'OpenAI',
  kind: 'model-release', importance: 80, companies: ['OpenAI'], models: ['GPT-6'], topics: ['llm'], summary: 'A new model.', breaking: false, ...o,
});
const item = (o) => AINews.sanitizeItem(mk(o));
const prefs = (o = {}) => AINews.sanitizePrefs({ enabled: true, ...o });
const at = (h, m = 0) => new Date(2026, 9, 15, h, m, 0).getTime();

function feed(items, schema = 'ai-news/1') { return { schema, generatedAt: '2026-10-15T10:00:00Z', items }; }

describe('contract', () => {
  it('refuses another schema, in words', () => {
    expect(() => AINews.validateFeed(feed([mk()], 'ai-news/2'))).toThrow(/ai-news\/2.*ai-news\/1/);
    expect(() => AINews.validateFeed(null)).toThrow();
    expect(() => AINews.validateFeed({ schema: 'ai-news/1' })).toThrow(/no list/);
  });
  it('drops unusable items, keeps the rest, ignores unknown fields', () => {
    const r = AINews.validateFeed(feed([mk(), mk({ id: 'b', url: 'http://x.test/' }), mk({ id: '' }), { ...mk({ id: 'c' }), extra: 1 }]));
    expect(r.items.map(i => i.id)).toEqual(['a1', 'c']);
    expect(r.dropped).toBe(2);
    expect(() => AINews.validateFeed(feed([mk({ url: 'javascript:1' })]))).toThrow(/None of the/);
  });
  it('caps lengths and clamps importance', () => {
    const i = item({ title: 'x'.repeat(900), importance: 900, summary: 'y'.repeat(2000) });
    expect(i.title.length).toBe(200);
    expect(i.importance).toBe(100);
    expect(i.summary.length).toBe(400);
  });
});

describe('rule engine', () => {
  it('mute wins over everything', () => {
    const p = prefs({ mute: { sources: ['openai'] }, follow: { companies: ['OpenAI'] } });
    expect(AINews.evaluate(item(), p).action).toBe('mute');
  });
  it('every mute dimension: topic, company, model, source, keyword', () => {
    for (const mute of [{ topics: ['model-release'] }, { companies: ['openai'] }, { models: ['gpt-6'] }, { sources: ['OpenAI'] }, { keywords: ['gpt-6'] }]) {
      expect(AINews.evaluate(item(), prefs({ mute })).action).toBe('mute');
    }
    expect(AINews.evaluate(item(), prefs({ mute: { keywords: ['sponsored'] } })).action).toBe('keep');
  });
  it('the default rule: a model release from a big lab is told on all channels', () => {
    const v = AINews.evaluate(item(), prefs());
    expect(v.channels).toEqual(['windows', 'toast', 'badge']);
    expect(v.rule.kind).toBe('rule');
    expect(v.why).toMatch(/Model releases from the big labs/);
  });
  it('follow lists promote when no rule matches; the other stories go to the panel only', () => {
    const p = prefs({ rules: [], follow: { topics: ['research'] } });
    const paper = item({ id: 'p', kind: 'paper', companies: [], models: [], title: 'A paper' });
    expect(AINews.evaluate(paper, p).rule.kind).toBe('follow');
    const other = item({ id: 'o', kind: 'opinion', companies: [], models: [], title: 'An opinion' });
    const v = AINews.evaluate(other, p);
    expect(v.channels).toEqual([]);
    expect(v.rule.kind).toBe('default');
    expect(AINews.evaluate(other, prefs({ rules: [], defaultAction: 'badge' })).channels).toEqual(['badge']);
    expect(AINews.evaluate(other, prefs({ rules: [], defaultAction: 'drop' })).action).toBe('drop');
  });
  it('a rule needs all its dimensions, any value within one', () => {
    const r = { id: 'r', name: 'R', enabled: true, channels: ['badge'], match: { companies: ['Meta', 'OpenAI'], minImportance: 90 } };
    expect(AINews.evaluate(item(), prefs({ rules: [r] })).rule.kind).toBe('default');       // importance 80 < 90
    expect(AINews.evaluate(item({ importance: 95 }), prefs({ rules: [r] })).rule.id).toBe('r');
  });
  it('a rule that names nothing matches nothing; a disabled rule is skipped', () => {
    const empty = { id: 'e', name: 'E', enabled: true, channels: ['windows'], match: {} };
    expect(AINews.evaluate(item(), prefs({ rules: [empty] })).rule.kind).toBe('default');
    const off = { id: 'o', name: 'O', enabled: false, channels: ['windows'], match: { kinds: ['model-release'] } };
    expect(AINews.evaluate(item(), prefs({ rules: [off] })).rule.kind).toBe('default');
  });
  it('keywords, models, sources, breaking-only operators', () => {
    const base = { id: 'x', name: 'X', enabled: true, channels: ['toast'] };
    expect(AINews.evaluate(item(), prefs({ rules: [{ ...base, match: { keywords: ['new model'] } }] })).rule.id).toBe('x');
    expect(AINews.evaluate(item(), prefs({ rules: [{ ...base, match: { models: ['GPT-6'] } }] })).rule.id).toBe('x');
    expect(AINews.evaluate(item(), prefs({ rules: [{ ...base, match: { sources: ['openai'] } }] })).rule.id).toBe('x');
    expect(AINews.evaluate(item(), prefs({ rules: [{ ...base, match: { breakingOnly: true } }] })).rule.kind).toBe('default');
    expect(AINews.evaluate(item({ breaking: true }), prefs({ rules: [{ ...base, match: { breakingOnly: true } }] })).rule.id).toBe('x');
  });
  it('topics come from kind, country and language too', () => {
    expect(AINews.topicsOf(item({ country: 'CN', lang: 'zh', topics: ['open-weights'] }))).toEqual(expect.arrayContaining(['china', 'open-source', 'model-release']));
    expect(AINews.topicsOf(item({ lang: 'tr' }))).toContain('turkey');
  });
  it('the importance floor and breaking-only remove the interrupting channels, not the badge', () => {
    const low = item({ importance: 20 });
    const r = { id: 'r', name: 'R', enabled: true, channels: ['windows', 'toast', 'badge'], match: { kinds: ['model-release'] } };
    expect(AINews.evaluate(low, prefs({ rules: [r], minImportance: 40 })).channels).toEqual(['badge']);
    expect(AINews.evaluate(item(), prefs({ rules: [r], breakingOnly: true })).channels).toEqual(['badge']);
    expect(AINews.evaluate(item({ breaking: true }), prefs({ rules: [r], breakingOnly: true })).channels).toEqual(['windows', 'toast', 'badge']);
  });
  it('a global channel switch removes that channel from every rule', () => {
    expect(AINews.evaluate(item(), prefs({ channels: { windows: false } })).channels).toEqual(['toast', 'badge']);
  });
});

describe('quiet hours', () => {
  const qh = { enabled: true, from: '23:00', to: '08:00' };
  it('wraps midnight', () => {
    expect(AINews.inQuietHours(at(23, 30), qh)).toBe(true);
    expect(AINews.inQuietHours(at(2), qh)).toBe(true);
    expect(AINews.inQuietHours(at(7, 59), qh)).toBe(true);
    expect(AINews.inQuietHours(at(8), qh)).toBe(false);
    expect(AINews.inQuietHours(at(12), qh)).toBe(false);
    expect(AINews.inQuietHours(at(22, 59), qh)).toBe(false);
  });
  it('a same-day range, disabled, and from === to', () => {
    expect(AINews.inQuietHours(at(13), { enabled: true, from: '12:00', to: '14:00' })).toBe(true);
    expect(AINews.inQuietHours(at(15), { enabled: true, from: '12:00', to: '14:00' })).toBe(false);
    expect(AINews.inQuietHours(at(2), { ...qh, enabled: false })).toBe(false);
    expect(AINews.inQuietHours(at(2), { enabled: true, from: '08:00', to: '08:00' })).toBe(false);
  });
  it('says when it ends', () => {
    const end = new Date(AINews.quietEndsAt(at(23, 30), qh));
    expect(end.getDate()).toBe(16); expect(end.getHours()).toBe(8);
  });
});

describe('plan: quiet hours, holds, caps', () => {
  const verdicts = (n, over = {}) => Array.from({ length: n }, (_, i) => {
    const it = item({ id: 'i' + i, importance: 90 - i, ...over });
    return { item: it, verdict: AINews.evaluate(it, prefs()) };
  });
  it('under the caps every story is shown one by one', () => {
    const p = AINews.plan(verdicts(2), { now: at(12), prefs: prefs(), held: '' });
    expect(p.windows.length).toBe(2);
    expect(p.toast.length).toBe(2);
    expect(p.badge.length).toBe(2);
    expect(p.summary.count).toBe(0);
  });
  it('quiet hours queue the pop-ups but keep the badge', () => {
    const p = AINews.plan(verdicts(2), { now: at(2), prefs: prefs({ quietHours: { enabled: true } }), held: '' });
    expect(p.windows.length + p.toast.length).toBe(0);
    expect(p.queued.length).toBe(2);
    expect(p.badge.length).toBe(2);
    expect(p.quiet).toBe(true);
  });
  it('a breaking story passes quiet hours only when allowed', () => {
    const v = verdicts(1, { breaking: true });
    const quiet = { enabled: true, allowBreaking: true };
    expect(AINews.plan(v, { now: at(2), prefs: prefs({ quietHours: quiet }), held: '' }).windows.length).toBe(1);
    expect(AINews.plan(v, { now: at(2), prefs: prefs({ quietHours: { enabled: true } }), held: '' }).windows.length).toBe(0);
  });
  it('a running game queues too', () => {
    const p = AINews.plan(verdicts(1), { now: at(12), prefs: prefs(), held: 'a game is running' });
    expect(p.queued.length).toBe(1);
    expect(p.windows.length).toBe(0);
  });
  it('the hourly cap turns the rest into ONE summary, best first', () => {
    const p = AINews.plan(verdicts(7), { now: at(12), prefs: prefs({ caps: { windowsPerHour: 2, toastPerHour: 20, catchUpMax: 30 } }), held: '', sentWindows: 0 });
    expect(p.windows.map(w => w.item.id)).toEqual(['i0', 'i1']);
    expect(p.toast.length).toBe(7);          // the in-Vex pop-up has its own cap
    const q = AINews.plan(verdicts(7), { now: at(12), prefs: prefs({ caps: { windowsPerHour: 2, toastPerHour: 2, catchUpMax: 30 } }), held: '' });
    expect(q.summary.count).toBe(5);
    expect(q.summary.items.length).toBe(3);
  });
  it('already sent this hour counts against the cap', () => {
    const p = AINews.plan(verdicts(1), { now: at(12), prefs: prefs({ caps: { windowsPerHour: 4, toastPerHour: 8, catchUpMax: 5 } }), held: '', sentWindows: 4, sentToast: 8 });
    expect(p.summary.count).toBe(1);
  });
  it('the catch-up cap limits one batch', () => {
    const p = AINews.plan(verdicts(8), { now: at(12), prefs: prefs({ caps: { windowsPerHour: 60, toastPerHour: 120, catchUpMax: 5 } }), held: '' });
    expect(p.windows.length).toBe(5);
    expect(p.summary.count).toBe(3);
  });
  it('digest-only items are neither shown nor queued', () => {
    const r = { id: 'd', name: 'D', enabled: true, channels: ['digest'], match: { kinds: ['paper'] } };
    const it = item({ id: 'pp', kind: 'paper' });
    const p = AINews.plan([{ item: it, verdict: AINews.evaluate(it, prefs({ rules: [r] })) }], { now: at(12), prefs: prefs(), held: '' });
    expect(p.digest).toEqual(['pp']);
    expect(p.windows.length + p.queued.length).toBe(0);
  });
});

describe('poller', () => {
  let store, calls, answers, shown, sent;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    AINews._state = null;
    calls = []; answers = []; shown = []; sent = [];
    AINews._io = {
      request: async (o) => { calls.push(o); const a = answers.shift(); if (!a) throw new Error('no answer queued'); return a; },
      notify: async (p) => { sent.push(p); },
      toast: (t, k, ms, o) => { shown.push({ t, k, o }); },
      gaming: () => false,
    };
    AINews.setPrefs({ enabled: true });
  });
  const ok = (items, headers = { etag: '"v1"' }) => ({ ok: true, status: 200, headers, body: JSON.stringify(feed(items)) });
  const T = 1_000_000_000_000;

  it('first poll is a silent baseline; the second tells one matching story', async () => {
    answers.push(ok([mk({ id: 'old' })]));
    const a = await AINews.poll({ now: T });
    expect(a.status).toBe('ok');
    expect(a.baseline).toBe(true);
    expect(sent.length + shown.length).toBe(0);
    expect(AINews.unseenCount()).toBe(0);
    answers.push(ok([mk({ id: 'old' }), mk({ id: 'new', title: 'Anthropic ships a model', companies: ['Anthropic'], cluster: 'c2' })]));
    const b = await AINews.poll({ now: T + 20 * 60000 });
    expect(b.delivered).toBeGreaterThan(0);
    expect(sent.length).toBe(1);
    expect(sent[0].tag).toBe('news-new');
    expect(sent[0].url).toBe('https://openai.com/n/1');
    expect(shown.some(s => /Anthropic ships/.test(s.t))).toBe(true);
    expect(AINews.unseenCount()).toBe(1);
  });
  it('sends If-None-Match after the baseline and handles 304', async () => {
    answers.push(ok([mk()]));
    await AINews.poll({ now: T });
    answers.push({ ok: true, status: 304, headers: {}, body: '' });
    const r = await AINews.poll({ now: T + 16 * 60000 });
    expect(calls[1].headers['If-None-Match']).toBe('"v1"');
    expect(r.status).toBe('not-modified');
    expect(AINews.state().error).toBe('');
  });
  it('the same item on a later 200 is deduplicated', async () => {
    answers.push(ok([mk()]));
    await AINews.poll({ now: T });
    answers.push(ok([mk(), mk({ id: 'n2', cluster: 'c9' })]));
    await AINews.poll({ now: T + 20 * 60000 });
    const before = sent.length;
    answers.push(ok([mk(), mk({ id: 'n2', cluster: 'c9' })]));
    await AINews.poll({ now: T + 40 * 60000 });
    expect(sent.length).toBe(before);
  });
  it('a muted item is silent and not kept', async () => {
    answers.push(ok([mk()]));
    await AINews.poll({ now: T });
    AINews.setPrefs({ mute: { sources: ['Spam Daily'] } });
    answers.push(ok([mk(), mk({ id: 'm', source: 'Spam Daily', cluster: 'm' })]));
    const r = await AINews.poll({ now: T + 20 * 60000 });
    expect(r.muted).toBe(1);
    expect(sent.length).toBe(0);
    expect(AINews.get('m')).toBeNull();
  });
  it('another source for the same cluster is kept but not told again', async () => {
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'a', cluster: 'cc' }), mk({ id: 'b', cluster: 'cc', source: 'TechCrunch', importance: 50 })]));
    const r = await AINews.poll({ now: T + 20 * 60000 });
    expect(r.duplicates).toBe(1);
    expect(sent.length).toBe(1);
    expect(AINews.get('b').duplicate).toBe(true);
  });
  it('quiet hours: silent, queued, then one line when they end', async () => {
    AINews.setPrefs({ quietHours: { enabled: true, from: '23:00', to: '08:00' } });
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: at(1) });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'a', cluster: 'a' }), mk({ id: 'b', cluster: 'b' })]));
    const r = await AINews.poll({ now: at(2) });
    expect(r.queued).toBe(2);
    expect(sent.length).toBe(0);
    expect(AINews.unseenCount()).toBe(2);
    await AINews.flushQueue(at(8, 1));
    expect(sent.length).toBe(1);
    expect(sent[0].title).toMatch(/2 new stories/);
    expect(sent[0].url).toBeUndefined();
  });
  it('a game holds delivery; the queue is told after', async () => {
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    AINews._io.gaming = () => true;
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'g', cluster: 'g' })]));
    await AINews.poll({ now: T + 20 * 60000 });
    expect(sent.length).toBe(0);
    expect(await AINews.flushQueue(T + 21 * 60000)).toBe(0);
    AINews._io.gaming = () => false;
    expect(await AINews.flushQueue(T + 22 * 60000)).toBe(1);
    expect(sent.length).toBe(1);
  });
  it('bad JSON, a schema mismatch and 404 back off, double, and tell nothing', async () => {
    answers.push({ ok: true, status: 200, headers: {}, body: '{nope' });
    const a = await AINews.poll({ now: T });
    expect(a.error).toMatch(/not valid JSON/);
    const w1 = AINews.state().nextPollAt - T;
    answers.push({ ok: true, status: 200, headers: {}, body: JSON.stringify(feed([mk()], 'ai-news/2')) });
    const b = await AINews.poll({ now: AINews.state().nextPollAt });
    expect(b.error).toMatch(/schema/);
    expect(AINews.state().nextPollAt - (T + w1)).toBeGreaterThan(w1);
    answers.push({ ok: true, status: 404, headers: {}, body: '' });
    const c = await AINews.poll({ now: AINews.state().nextPollAt });
    expect(c.error).toMatch(/404/);
    expect(AINews.state().failures).toBe(3);
    expect(sent.length + shown.length).toBe(0);
    expect(AINews.status(T).level).toBe('error');
  });
  it('backoff is capped at six hours and waiting is reported', async () => {
    expect(AINews.backoffMs(15, 0)).toBe(15 * 60000);
    expect(AINews.backoffMs(15, 2)).toBe(60 * 60000);
    expect(AINews.backoffMs(15, 20)).toBe(6 * 3600000);
    answers.push({ ok: false, error: 'offline' });
    await AINews.poll({ now: T });
    expect((await AINews.poll({ now: T + 1000 })).status).toBe('waiting');
  });
  it('off does nothing; a bad address is refused', async () => {
    AINews.setPrefs({ enabled: false });
    expect((await AINews.poll({ now: T })).status).toBe('off');
    expect(calls.length).toBe(0);
    expect(() => AINews.setPrefs({ feedUrl: 'http://example.com/news.json' })).toThrow(/https/);
    expect(() => AINews.setPrefs({ feedUrl: 'http://127.0.0.1:9/news.json' })).not.toThrow();
    expect(() => AINews.setPrefs({ feedUrl: 'https://user:pw@example.com/' })).toThrow(/login/);
  });
  it('a refused Windows toast is never silent: a pop-up with the reason', async () => {
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    AINews._io.notify = async () => { throw new Error('Windows refused the notification: blocked'); };
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'n', cluster: 'n' })]));
    await AINews.poll({ now: T + 20 * 60000 });
    expect(shown.some(s => /Windows did not show/.test(s.t) && s.k === 'error')).toBe(true);
    expect(AINews.status(T + 21 * 60000).text).toMatch(/Windows did not show/);
  });
  it('digest: due once a day after the chosen time, one line', async () => {
    AINews.setPrefs({ digest: { enabled: true, at: '08:30' } });
    expect(AINews.digestDue(at(8), AINews.prefs())).toBe(false);
    expect(AINews.digestDue(at(9), AINews.prefs())).toBe(true);
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: at(7) });
    AINews.setPrefs({ rules: [{ id: 'd', name: 'D', channels: ['digest'], match: { kinds: ['paper'] } }] });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'p1', kind: 'paper', cluster: 'p1' }), mk({ id: 'p2', kind: 'paper', cluster: 'p2' })]));
    await AINews.poll({ now: at(7, 30) });
    expect(sent.length).toBe(0);
    expect(await AINews.sendDigest(at(9))).toBe(2);
    expect(sent[0].title).toMatch(/2 new stories/);
    expect(AINews.digestDue(at(10), AINews.prefs())).toBe(false);
  });
  it('opening marks read and clears the badge; muting a source is undoable', async () => {
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'n', cluster: 'n' })]));
    await AINews.poll({ now: T + 20 * 60000 });
    const tabs = [];
    globalThis.TabManager = { createTab: (u) => tabs.push(u) };
    expect(AINews.openItem('n')).toBe(true);
    expect(AINews.openItem('n')).toBe(false);        // the click arrived twice
    expect(tabs).toEqual(['https://openai.com/n/1']);
    expect(AINews.unseenCount()).toBe(0);
    AINews.muteSource('OpenAI');
    expect(AINews.prefs().mute.sources).toEqual(['OpenAI']);
    shown.at(-1).o.actions[0].run();
    expect(AINews.prefs().mute.sources).toEqual([]);
    delete globalThis.TabManager;
  });
  it('the test notification uses the real path with a title that says so', async () => {
    await AINews.sendTest();
    expect(sent[0].title).toBe('AI News test');
    expect(sent[0].tag).toBe('news-test');
  });
  it('bounded: more than 300 stories trims the read, oldest first', async () => {
    const many = Array.from({ length: 320 }, (_, i) => mk({ id: 'b' + i, cluster: 'b' + i }));
    answers.push(ok(many));
    await AINews.poll({ now: T });
    expect(Object.keys(AINews.state().items).length).toBe(300);
  });
});

describe('toast payload validation (main side)', () => {
  const { validateNewsToast, createUrlTable } = require('../../src/main/news-toast.js');
  const base = { title: 'T', body: 'b', tag: 'news-abc', url: 'https://example.com/a' };
  it('accepts a good payload', () => {
    expect(validateNewsToast(base).url).toBe('https://example.com/a');
    expect(validateNewsToast({ title: 'T', tag: 'news-x' }).url).toBeNull();
  });
  it('refuses non-https, logins, other schemes, bad tags and oversized text', () => {
    for (const url of ['http://example.com/', 'javascript:alert(1)', 'file:///c:/x', 'vex://open/a', 'https://u:p@example.com/', 'https://' + 'a'.repeat(2100) + '.com']) {
      expect(() => validateNewsToast({ ...base, url })).toThrow();
    }
    expect(() => validateNewsToast({ ...base, tag: 'r123' })).toThrow(/tag/);
    expect(() => validateNewsToast({ ...base, tag: 'news-a b' })).toThrow(/tag/);
    expect(() => validateNewsToast({ ...base, title: 'x'.repeat(121) })).toThrow(/title/);
    expect(() => validateNewsToast({ ...base, body: 'x'.repeat(401) })).toThrow(/text/);
    expect(() => validateNewsToast({ ...base, title: ' ' })).toThrow();
  });
  it('the schema agrees', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('news:notify', [base])).not.toThrow();
    expect(() => validate('news:notify', [{ ...base, url: 'http://example.com' }])).toThrow(/Invalid payload/);
    expect(() => validate('news:notify', [{ ...base, title: 'x'.repeat(121) }])).toThrow(/Invalid payload/);
    expect(() => validate('news:notify', [{ ...base, tag: 'abc' }])).toThrow(/Invalid payload/);
  });
  it('the url table is bounded and only for the news channel (UI only, private windows blocked)', () => {
    const t = createUrlTable(2);
    t.set('news-a', 'https://a/'); t.set('news-b', 'https://b/'); t.set('news-c', 'https://c/');
    expect(t.get('news-a')).toBeNull();
    expect(t.get('news-c')).toBe('https://c/');
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    expect(UI_ONLY_CHANNELS.has('news:notify')).toBe(true);
    const policy = require('fs').readFileSync(require('path').join(__dirname, '../../src/main/ipc-policy.js'), 'utf8');
    expect(policy).toMatch(/PRIVATE_DISABLED = [^\n]*\|news:\|/);
  });
});

describe('notify toast xml', () => {
  const { createNotifier } = require('../../src/main/notify.js');
  const n = createNotifier({ Notification: class { static isSupported() { return true; } } });
  it('a news toast has Open and Mute this source, no snooze, not an alarm', () => {
    const xml = n.toastXml({ title: 'T', body: 'b', tag: 'news-x', kind: 'news' });
    expect(xml).toContain('vex://news-open/news-x');
    expect(xml).toContain('Mute this source');
    expect(xml).not.toContain('Snooze');
    expect(xml).not.toContain('scenario="reminder"');
  });
  it('a reminder toast is unchanged', () => {
    const xml = n.toastXml({ title: 'T', body: 'b', tag: 'r1' });
    expect(xml).toContain('Snooze 9 min');
    expect(xml).toContain('scenario="reminder"');
  });
  it('escapes feed text', () => {
    expect(n.toastXml({ title: '<b>&"', body: '', tag: 'news-x', kind: 'news' })).toContain('&lt;b&gt;&amp;&quot;');
  });
});

describe('badge and panel logic', () => {
  it('groups by day then cluster, best first, and filters', () => {
    const { AINewsUI } = require('../../src/renderer/js/ai-news-ui.js');
    const day = new Date(2026, 9, 15, 12).getTime();
    const items = [
      { ...item({ id: 'a', cluster: 'k', importance: 50, source: 'B' }), publishedAt: day, firstSeenAt: day, read: false },
      { ...item({ id: 'b', cluster: 'k', importance: 70, source: 'A' }), publishedAt: day, firstSeenAt: day, read: true },
      { ...item({ id: 'c', cluster: 'z', importance: 10, kind: 'paper', source: 'A', title: 'Paper' }), publishedAt: day - 86400000, firstSeenAt: day, read: false },
    ];
    const g = AINewsUI.group(items);
    expect(g.length).toBe(2);
    expect(g[0].groups.length).toBe(1);
    expect(g[0].groups[0].main.id).toBe('b');
    expect(g[0].groups[0].others.map(o => o.id)).toEqual(['a']);
    expect(AINewsUI.filterItems(items, { unreadOnly: true }).map(i => i.id)).toEqual(['a', 'c']);
    expect(AINewsUI.filterItems(items, { topic: 'research' }).map(i => i.id)).toEqual(['c']);
    expect(AINewsUI.filterItems(items, { source: 'A' }).map(i => i.id)).toEqual(['b', 'c']);
    expect(AINewsUI.filterItems(items, { q: 'paper' }).map(i => i.id)).toEqual(['c']);
  });
});

describe('language filter', () => {
  let store, answers, sent, shown;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
    AINews._state = null;
    answers = []; sent = []; shown = [];
    AINews._io = {
      request: async () => { const a = answers.shift(); if (!a) throw new Error('no answer queued'); return a; },
      notify: async (p) => { sent.push(p); },
      toast: (t) => { shown.push(t); },
      gaming: () => false,
    };
    AINews.setPrefs({ enabled: true });
  });
  const ok = (items) => ({ ok: true, status: 200, headers: { etag: '"v"' }, body: JSON.stringify(feed(items)) });
  const T = 1_000_000_000_000;

  it('keeps English only by default, matching on the primary subtag', () => {
    const p = AINews.prefs();
    expect(p.languages).toEqual(['en']);
    expect(AINews.languageWanted(item({ lang: 'en' }), p)).toBe(true);
    expect(AINews.languageWanted(item({ lang: 'en-GB' }), p)).toBe(true);
    expect(AINews.languageWanted(item({ lang: 'tr' }), p)).toBe(false);
    const zh = prefs({ languages: ['zh'] });
    expect(AINews.languageWanted(item({ lang: 'zh-CN' }), zh)).toBe(true);
    expect(AINews.languageWanted(item({ lang: 'en' }), zh)).toBe(false);
  });
  it('a story with no language counts as English', () => {
    expect(AINews.languageWanted(item({ lang: '' }), prefs())).toBe(true);
    expect(AINews.languageWanted(item({}), prefs())).toBe(true);
    expect(AINews.languageWanted(item({}), prefs({ languages: ['tr'] }))).toBe(false);
    expect(AINews.languageWanted(item({}), prefs({ unknownLanguage: 'exclude' }))).toBe(false);
  });
  it('"other" matches any code the settings do not list', () => {
    const p = prefs({ languages: ['en', 'other'] });
    expect(AINews.languageWanted(item({ lang: 'de' }), p)).toBe(true);
    expect(AINews.languageWanted(item({ lang: 'tr' }), p)).toBe(false);
  });
  it('old stored prefs without languages get English', () => {
    store[AINews.PREFS_KEY] = JSON.stringify({ v: 1, enabled: true });
    expect(AINews.prefs().languages).toEqual(['en']);
    expect(AINews.sanitizePrefs({ languages: [] }).languages).toEqual(['en']);
    expect(AINews.sanitizePrefs({ languages: ['TR-tr', 'x', 5] }).languages).toEqual(['tr']);
  });
  it('refuses a patch that leaves no language', () => {
    expect(() => AINews.setPrefs({ languages: [] })).toThrow(/at least one language/);
    expect(AINews.prefs().languages).toEqual(['en']);
  });
  it('filtered items never reach the store, rules, queue or badge, and are counted', async () => {
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'tr1', lang: 'tr', cluster: 'x1' }), mk({ id: 'zh1', lang: 'zh', cluster: 'x2' }), mk({ id: 'en1', lang: 'en', cluster: 'x3' })]));
    const spy = vi.spyOn(AINews, 'evaluate');
    const r = await AINews.poll({ now: T + 20 * 60000 });
    expect(r.filteredLanguage).toBe(2);
    expect(spy.mock.calls.map(c => c[0].id)).toEqual(['en1']);
    spy.mockRestore();
    expect(AINews.get('tr1')).toBeNull();
    expect(AINews.get('zh1')).toBeNull();
    expect(AINews.get('en1')).not.toBeNull();
    expect(AINews.unseenCount()).toBe(1);
    expect(sent.length).toBe(1);
    expect(AINews.state().filteredLanguage).toBe(2);
  });
  it('the baseline does not store filtered items either', async () => {
    answers.push(ok([mk({ id: 'a' }), mk({ id: 'b', lang: 'tr', cluster: 'b' })]));
    const r = await AINews.poll({ now: T });
    expect(r.baseline).toBe(true);
    expect(r.filteredLanguage).toBe(1);
    expect(AINews.get('b')).toBeNull();
  });
  it('stored stories in an unwanted language are removed when prefs are saved', async () => {
    AINews.setPrefs({ languages: ['en', 'tr'] });
    answers.push(ok([mk({ id: 'z' })]));
    await AINews.poll({ now: T });
    answers.push(ok([mk({ id: 'z' }), mk({ id: 'tr1', lang: 'tr', cluster: 'x1' }), mk({ id: 'en1', cluster: 'x3' })]));
    await AINews.poll({ now: T + 20 * 60000 });
    expect(AINews.get('tr1')).not.toBeNull();
    AINews.state().queue.push('tr1'); AINews.state().digest.push('tr1');
    AINews.setPrefs({ languages: ['en'] });
    expect(AINews.get('tr1')).toBeNull();
    expect(AINews.get('en1')).not.toBeNull();
    expect(AINews.state().queue).not.toContain('tr1');
    expect(AINews.state().digest).not.toContain('tr1');
    expect(AINews.state().languageRemoved).toBe(1);
    expect(AINews.status().text).toMatch(/1 held story in a language you did not choose removed/);
  });
});
