// @vitest-environment jsdom
//
// The reading digest (js/reading-digest.js): the Read Later pile summarised by
// the local AI. The risks are privacy ones before they are quality ones — an
// article's text reaching the cloud the user did not allow, or a page saved
// from a private or Tor tab being fetched at all — then the cost: summarising
// an unchanged article again on every build.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { VexIcons } = require('../../src/renderer/js/vex-icons.js');
globalThis.VexIcons = VexIcons; window.VexIcons = VexIcons;

const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };

function loadRouter() { return fresh('../../src/renderer/js/ai-router.js').AIRouter; }
function loadDigest() {
  globalThis.Scheduler = fresh('../../src/renderer/js/scheduler.js');
  return fresh('../../src/renderer/js/reading-digest.js').ReadingDigest;
}

const PAGES = {
  'https://news.example/a': { title: 'Page A', text: 'Alpha article text. '.repeat(20) },
  'https://news.example/b': { title: 'Page B', text: 'Bravo article text. '.repeat(20) },
  'https://news.example/c': { title: 'Page C', text: 'Charlie article text. '.repeat(20) },
};

function readLater(items) {
  globalThis.ReadLater = {
    items, unread() { return this.items.filter(i => !i.read).length; },
    tab: () => 'digest', showTab: vi.fn(), renderPanel: vi.fn(), open: vi.fn(),
  };
}

let fetched;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  window.escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.showToast = vi.fn();
  globalThis.VexJobs = { every: () => ({ stop: () => {} }) };
  delete window.VexTabPolicy;
  fetched = [];
  globalThis.AgentTools = {
    readUrl: vi.fn(async (url) => {
      fetched.push(url);
      if (!PAGES[url]) throw new Error('HTTP 404 from news.example');
      return { url, ...PAGES[url] };
    }),
  };
  globalThis.TabManager = { mayAskSiteForIcon: () => true, createTab: vi.fn() };
  readLater([
    { id: 'a', url: 'https://news.example/a', title: 'Page A', at: 1, read: false },
    { id: 'b', url: 'https://news.example/b', title: 'Page B', at: 2, read: false },
    { id: 'gone', url: 'https://news.example/missing', title: 'Missing page', at: 3, read: false },
    { id: 'tor', url: 'https://secret.onion.example/x', title: 'Saved from Tor', at: 4, read: false, ownSession: true },
    { id: 'done', url: 'https://news.example/c', title: 'Already read', at: 5, read: true },
  ]);
});

afterEach(() => {
  for (const k of ['AIRouter', 'Ollama', 'AgentTools', 'ReadLater', 'TabManager', 'Scheduler', 'VexFeeds', 'VexToday', 'SettingsUI', 'SidebarManager']) delete globalThis[k];
  delete window.VexConfig; delete window.vex;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- routing --
describe('where the digest is sent', () => {
  let generate, cloudFetch;
  beforeEach(() => {
    generate = vi.fn(async () => '{"summary":"s","why":"w","topic":"t"}');
    globalThis.Ollama = { ping: vi.fn(async () => true), getBaseUrl: () => 'http://127.0.0.1:1', generate, listModels: async () => [], show: async () => ({}) };
    cloudFetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: '{"summary":"cloud"}' }) }));
    window.VexConfig = { aiWorkerUrl: () => 'https://worker.example', fetchAI: cloudFetch };
  });

  it('stays local by default even with a cloud AI Worker set up', async () => {
    const R = loadRouter();
    await R.init();
    expect(R.getRoutingPrefs().digest).toBe('local');
    expect(await R.resolveBackend('digest')).toBe('local');
    await R.callAI('digest', { message: 'x' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(cloudFetch).not.toHaveBeenCalled();
  });

  it('with Ollama down it refuses instead of sending the text to the cloud', async () => {
    globalThis.Ollama.ping = vi.fn(async () => false);
    const R = loadRouter();
    await R.init();
    expect(await R.resolveBackend('digest')).toBe('skip');
    await expect(R.callAI('digest', { message: 'x' })).rejects.toThrow(/Ollama isn't running/);
    expect(cloudFetch).not.toHaveBeenCalled();
  });

  it('a local failure does not fall back to the cloud', async () => {
    generate.mockRejectedValueOnce(new Error('model crashed'));
    const R = loadRouter();
    await R.init();
    await expect(R.callAI('digest', { message: 'x' })).rejects.toThrow(/Not falling back to cloud/);
    expect(cloudFetch).not.toHaveBeenCalled();
  });

  it('goes to the cloud only when the user allows it: Always cloud, or Auto/Cloud for the digest', async () => {
    let R = loadRouter();
    await R.init();
    R.setForceCloud(true);
    expect(await R.resolveBackend('digest')).toBe('cloud');
    R.setForceCloud(false);
    R.setRoutingPrefs({ digest: 'auto' });
    expect(await R.resolveBackend('digest')).toBe('cloud');
    // An older saved routing map without "digest" still gets the local default.
    localStorage.setItem('vex.aiRouting', JSON.stringify({ chat: 'cloud', summarize: 'cloud' }));
    R = loadRouter();
    await R.init();
    expect(await R.resolveBackend('digest')).toBe('local');
  });

  it('asks the local model with the digest prompt in JSON, and a persona does not replace it', async () => {
    const R = loadRouter();
    await R.init();
    await R.callAI('digest', { message: 'the article', persona: { systemPrompt: 'Talk like a pirate' } });
    const [, prompt, opts] = generate.mock.calls[0];
    expect(prompt).toContain('the article');
    expect(opts.format).toBe('json');
    expect(opts.systemPrompt).toMatch(/reading digest/);
    expect(opts.systemPrompt).not.toMatch(/pirate/);
  });
});

// --------------------------------------------------------------- building --
describe('making the digest', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    globalThis.AIRouter = {
      resolveBackend: vi.fn(async () => 'local'),
      cloudWorkerUrl: () => '',
      getRoutingPrefs: () => ({ digest: 'local' }),
      callAI: vi.fn(async (feature, req) => {
        calls.push({ feature, req });
        const title = /Title: (.*)/.exec(req.message)[1];
        return { result: JSON.stringify({ summary: 'About ' + title + '.', why: 'It matters.', topic: 'News' }), backend: 'local', model: 'stub-model' };
      }),
    };
  });

  it('summarises each unread article from its own text, and never fetches or sends a Tor-saved one', async () => {
    const D = loadDigest();
    const d = await D.build();
    expect(calls.every(c => c.feature === 'digest')).toBe(true);
    expect(calls.map(c => /Title: (.*)/.exec(c.req.message)[1]).sort()).toEqual(['Page A', 'Page B']);
    expect(calls[0].req.message).toContain('article text.');
    expect(fetched).not.toContain('https://secret.onion.example/x');
    expect(calls.some(c => c.req.message.includes('secret'))).toBe(false);
    const byId = Object.fromEntries(d.items.map(i => [i.id, i]));
    expect(byId.a.summary).toBe('About Page A.');
    expect(byId.a.why).toBe('It matters.');
    expect(byId.tor.skipped).toMatch(/private, Tor or container/);
    expect(byId.gone.error).toMatch(/Could not load the page: HTTP 404/);
    expect(byId.done).toBeUndefined();
    expect(d.calls).toBe(2);
    expect(JSON.parse(localStorage.getItem('vex.readingDigest')).items).toHaveLength(4);
  });

  it('a site with a route of its own is not fetched from here', async () => {
    globalThis.TabManager.mayAskSiteForIcon = (url) => !url.includes('/b');
    const D = loadDigest();
    const d = await D.build();
    expect(fetched).not.toContain('https://news.example/b');
    expect(d.items.find(i => i.id === 'b').skipped).toMatch(/route of its own/);
  });

  it('an unchanged article is not summarised again; a changed one is', async () => {
    const D = loadDigest();
    await D.build();
    expect(calls).toHaveLength(2);
    const again = await D.build();
    expect(calls).toHaveLength(2);
    expect(again.calls).toBe(0);
    expect(again.model).toBe('stub-model');   // still says which model wrote it
    expect(again.items.find(i => i.id === 'a')).toMatchObject({ summary: 'About Page A.', cached: true });
    PAGES['https://news.example/a'] = { title: 'Page A', text: 'Alpha, rewritten. '.repeat(20) };
    const third = await D.build();
    expect(third.calls).toBe(1);
    PAGES['https://news.example/a'] = { title: 'Page A', text: 'Alpha article text. '.repeat(20) };
  });

  it('a page that stops loading keeps its earlier summary, marked as such', async () => {
    const D = loadDigest();
    await D.build();
    const saved = PAGES['https://news.example/b'];
    delete PAGES['https://news.example/b'];
    const d = await D.build();
    const b = d.items.find(i => i.id === 'b');
    expect(b.error).toMatch(/Could not load/);
    expect(b.summary).toBe('About Page B.');
    expect(b.staleAt).toBeTruthy();
    PAGES['https://news.example/b'] = saved;
  });

  it('a page with almost no text is reported, not summarised', async () => {
    PAGES['https://news.example/a'].text = 'Loading…';
    const D = loadDigest();
    const d = await D.build();
    expect(d.items.find(i => i.id === 'a').error).toMatch(/almost no readable text/);
    expect(calls.map(c => c.req.message).join()).not.toContain('Loading…');
    PAGES['https://news.example/a'].text = 'Alpha article text. '.repeat(20);
  });

  it('one AI failure is that article\'s failure, not the whole digest\'s', async () => {
    let n = 0;
    globalThis.AIRouter.callAI = vi.fn(async () => { if (n++ === 0) throw new Error('model crashed'); return { result: '{"summary":"Fine."}', backend: 'local' }; });
    const D = loadDigest();
    const d = await D.build();
    expect(d.items.filter(i => /could not summarise it: model crashed/.test(i.error || ''))).toHaveLength(1);
    expect(d.items.filter(i => i.summary === 'Fine.')).toHaveLength(1);
  });

  it('two clicks make one digest', async () => {
    const D = loadDigest();
    const [x, y] = await Promise.all([D.build(), D.build()]);
    expect(x).toBe(y);
    expect(calls).toHaveLength(2);
  });

  it('with no AI it says so plainly, offers the AI settings, and reads nothing', async () => {
    globalThis.AIRouter.resolveBackend = vi.fn(async () => 'skip');
    globalThis.SettingsUI = { openSection: vi.fn() };
    const D = loadDigest();
    const err = await D.build().catch(e => e);
    expect(err.noAi).toBe(true);
    expect(err.message).toMatch(/Ollama is not running/);
    expect(fetched).toEqual([]);
    const body = document.createElement('div');
    D.render(body);
    expect(body.textContent).toMatch(/No local AI is answering/);
    body.querySelector('#rd-ai-settings').click();
    expect(SettingsUI.openSection).toHaveBeenCalledWith('ai-mode-radio');
  });

  it('cloud chosen but no Worker and no Ollama counts as no AI', async () => {
    globalThis.AIRouter.resolveBackend = vi.fn(async () => 'cloud');
    const D = loadDigest();
    await expect(D.build()).rejects.toThrow(/No AI is set up/);
  });

  it('an empty pile is said, not sent', async () => {
    readLater([]);
    const D = loadDigest();
    await expect(D.build()).rejects.toThrow(/Nothing in Read Later/);
    expect(globalThis.AIRouter.resolveBackend).not.toHaveBeenCalled();
  });

  it('is never made in a private window, and shows nothing there', async () => {
    const D = loadDigest();
    await D.build();
    window.VexTabPolicy = { isPrivateWindow: true };
    calls.length = 0;
    await expect(D.build()).rejects.toThrow(/private window/);
    expect(calls).toHaveLength(0);
    expect(D.card()).toBe(null);
    const body = document.createElement('div');
    D.render(body);
    expect(body.textContent).toMatch(/not made in a private window/);
    expect(body.querySelector('#rd-build')).toBe(null);
  });

  it('lists what is new in the feeds as links, with no AI', async () => {
    globalThis.VexFeeds = { feeds: [{ url: 'f' }], fetchAll: async () => ({ items: [{ title: 'Feed item', link: 'https://feed.example/1', src: 'Feed', at: Date.now() }], errors: [] }) };
    const D = loadDigest();
    const d = await D.build();
    expect(d.feeds).toEqual([{ title: 'Feed item', url: 'https://feed.example/1', src: 'Feed' }]);
    expect(calls.some(c => c.req.message.includes('Feed item'))).toBe(false);
  });

  it('renders the summaries, why they matter, and opens an article from Read Later', async () => {
    const D = loadDigest();
    await D.build();
    const body = document.createElement('div');
    D.render(body);
    expect(body.textContent).toContain('About Page A.');
    expect(body.textContent).toContain('Why it may matter: It matters.');
    expect(body.textContent).toContain('Not summarised');
    expect(body.textContent).toMatch(/HTTP 404/);
    body.querySelector('[data-open="a"]').click();
    expect(ReadLater.open).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
});

// ------------------------------------------------------------ small parts --
describe('reading the reply', () => {
  const D = () => loadDigest();
  it('takes the JSON asked for', () => {
    expect(D().parseSummary('{"summary":" Two  lines. ","why":"Because.","topic":"AI"}')).toEqual({ summary: 'Two lines.', why: 'Because.', topic: 'AI' });
  });
  it('unwraps a chat {"reply"} and a code fence', () => {
    expect(D().parseSummary('{"reply":"{\\"summary\\":\\"Inner.\\"}"}').summary).toBe('Inner.');
    expect(D().parseSummary('```json\n{"summary":"Fenced."}\n```').summary).toBe('Fenced.');
  });
  it('plain sentences from a small model become the summary', () => {
    expect(D().parseSummary('It is about cats.')).toEqual({ summary: 'It is about cats.', why: '', topic: '' });
  });
  it('an empty reply or one with no summary is a failure', () => {
    expect(() => D().parseSummary('')).toThrow(/empty/);
    expect(() => D().parseSummary('{"why":"x"}')).toThrow(/no summary/);
  });
});

describe('grouping by topic', () => {
  const item = (id, topic) => ({ id, url: 'https://x/' + id, title: id, summary: 's', topic });
  it('a few articles stay one list', () => {
    expect(loadDigest().groups([item('1', 'AI'), item('2', 'AI')])).toEqual([{ topic: null, items: [item('1', 'AI'), item('2', 'AI')] }]);
  });
  it('many go under their shared topics, the rest under More', () => {
    const g = loadDigest().groups([item('1', 'AI'), item('2', 'ai'), item('3', 'Space'), item('4', 'Space'), item('5', 'Food'), { id: '6', title: '6', error: 'x' }]);
    expect(g.map(x => [x.topic, x.items.map(i => i.id)])).toEqual([['AI', ['1', '2']], ['Space', ['3', '4']], ['More', ['5']]]);
  });
});

describe('the New Tab card', () => {
  it('shows today\'s digest only, and not when switched off', () => {
    const D = loadDigest();
    const now = Date.now();
    localStorage.setItem(D.KEY, JSON.stringify({ at: now, day: D._day(now), items: [{ id: 'a', url: 'https://a', title: 'A', summary: 'x'.repeat(400) }, { id: 'b', url: 'https://b', title: 'B', error: 'no' }] }));
    const card = D.card(now);
    expect(card.count).toBe(1);
    expect(card.items[0].summary.length).toBeLessThanOrEqual(240);
    expect(D.card(now + 2 * 86400000)).toBe(null);
    globalThis.VexToday = { refresh: vi.fn() };
    D.setShowOnNewTab(false);
    expect(D.card(now)).toBe(null);
    expect(VexToday.refresh).toHaveBeenCalled();
  });

  it('rides in the Today snapshot the start page reads', async () => {
    const D = loadDigest();
    globalThis.ReadingDigest = D;
    const now = Date.now();
    localStorage.setItem(D.KEY, JSON.stringify({ at: now, day: D._day(now), items: [{ id: 'a', url: 'https://a', title: 'A', summary: 'Sum.' }] }));
    readLater([
      { id: 'a', url: 'https://a', title: 'A', at: now - 1000, read: false },
      { id: 'z', url: 'https://z', title: 'Z', at: now - 1000, read: false },
    ]);
    const { VexToday } = fresh('../../src/renderer/js/today.js');
    const snap = await VexToday.build();
    expect(snap.digest.items[0]).toEqual({ title: 'A', url: 'https://a', summary: 'Sum.' });
    // Already in the card, so not listed again as "Saved" under it.
    expect(snap.saved.map(s => s.url)).toEqual(['https://z']);
    delete globalThis.ReadingDigest;
  });
});

describe('the morning digest', () => {
  it('is off until turned on; on is one daily scheduled task, off removes it', () => {
    const D = loadDigest();
    expect(D.morningTask()).toBe(null);
    const t = D.setMorning(true, '07:30');
    expect(t.action.type).toBe('readingDigest');
    expect(t.schedule).toMatchObject({ type: 'daily', time: '07:30' });
    expect(t.notifyOnComplete).toBe(false);
    D.setMorning(true, '06:45');
    expect(Scheduler.getAllTasks()).toHaveLength(1);
    expect(D.morningTask().schedule.time).toBe('06:45');
    D.setMorning(false);
    expect(Scheduler.getAllTasks()).toHaveLength(0);
  });

  it('the scheduled run makes the digest and notifies through the main process', async () => {
    const D = loadDigest();
    globalThis.ReadingDigest = D;
    window.vex = { notify: vi.fn(async () => true) };
    vi.spyOn(D, 'build').mockResolvedValue({ items: [{ summary: 'a' }, { summary: 'b' }, { error: 'x' }, { skipped: 'tor' }] });
    const out = await Scheduler.ACTIONS.readingDigest.run({});
    expect(out).toMatch(/^2 articles summarised, 1 could not be read, 1 kept private\./);
    expect(window.vex.notify).toHaveBeenCalledWith('Your reading digest is ready', out);
    delete globalThis.ReadingDigest;
  });
});

describe('the Library tab', () => {
  it('Digest is a tab of its own and is remembered', () => {
    globalThis.SidebarManager = { hideActivePanel: vi.fn() };
    window.CollectionStore = { save: (k, b, n) => n };
    const { ReadLater } = fresh('../../src/renderer/js/readlater.js');
    const D = loadDigest();
    globalThis.ReadingDigest = D;
    document.body.innerHTML = '<div id="panel-library"></div>';
    ReadLater.items = [];
    ReadLater.showTab('digest');
    expect(ReadLater.tab()).toBe('digest');
    const panel = document.getElementById('panel-library');
    expect(panel.querySelector('[data-tab="digest"]').classList.contains('on')).toBe(true);
    expect(panel.querySelector('#rd-build')).not.toBe(null);
    localStorage.setItem('vex.libraryTab', 'nonsense');
    expect(ReadLater.tab()).toBe('saved');
    delete globalThis.ReadingDigest;
  });
});
