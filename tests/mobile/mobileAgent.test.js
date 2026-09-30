// @vitest-environment jsdom
//
// The agent decides what to do from a model's answer and then does it to your
// browser, so the two things worth pinning down are what it will accept as an
// answer, and that each tool does the one thing it says.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexSearch = {
  prettyHost: url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } },
  toUrl: input => (/^https?:/.test(input) ? input : 'https://' + input),
  searchUrl: query => 'https://duckduckgo.com/?q=' + encodeURIComponent(query)
};

let tabs = [];
let activeId = 't1';
window.VexTabStore = {
  all: () => tabs,
  active: () => tabs.find(tab => tab.id === activeId) || null,
  activeId: () => activeId,
  get: id => tabs.find(tab => tab.id === id) || null,
  create: vi.fn(async url => { tabs.push({ id: 't' + (tabs.length + 1), url, title: '' }); }),
  close: vi.fn(async id => { tabs = tabs.filter(tab => tab.id !== id); }),
  navigate: vi.fn(async (id, url) => { const tab = tabs.find(entry => entry.id === id); if (tab) tab.url = url; })
};
window.VexBridge = { evaluate: vi.fn(async () => ({ result: '"clicked"' })) };
window.VexReader = { pageText: vi.fn(async () => 'The page, as text.') };
window.VexUI = { renderToolbar: vi.fn(), confirm: vi.fn(async () => true), toast: vi.fn() };
window.VexAI = { configured: async () => true, ask: vi.fn() };

const { VexAgent } = require('../../mobile/www/js/agent.js');

beforeEach(() => {
  tabs = [
    { id: 't1', url: 'https://example.com/', title: 'Example' },
    { id: 't2', url: 'https://www.youtube.com/watch?v=1', title: 'A video' },
    { id: 't3', url: 'https://news.example/', title: 'YouTube is discussed here' }
  ];
  activeId = 't1';
  for (const fn of [window.VexTabStore.create, window.VexTabStore.close, window.VexTabStore.navigate,
    window.VexBridge.evaluate, window.VexAI.ask]) fn.mockClear();
});

describe('reading the model’s answer', () => {
  it('takes a plain tool call', () => {
    const call = VexAgent.parseCall('{"thought":"go there","tool":"navigate","parameters":{"url":"https://a.example"},"intent":"action"}');
    expect(call).toMatchObject({ tool: 'navigate', intent: 'action' });
  });

  it('digs the JSON out of a chatty answer', () => {
    const call = VexAgent.parseCall('Sure! Here is the call:\n```json\n{"tool":"finish","parameters":{"summary":"done"}}\n```');
    expect(call.tool).toBe('finish');
  });

  it('refuses anything that is not a tool call', () => {
    expect(VexAgent.parseCall('I cannot help with that')).toBe(null);
    expect(VexAgent.parseCall('{"thought":"no tool here"}')).toBe(null);
    expect(VexAgent.parseCall('')).toBe(null);
    expect(VexAgent.parseCall(null)).toBe(null);
  });
});

describe('the loop', () => {
  function worker(...replies) {
    let step = 0;
    window.VexAI.ask.mockImplementation(async () => replies[Math.min(step++, replies.length - 1)]);
  }

  it('runs a call, feeds the result back, and stops on finish', async () => {
    worker(
      { thought: 'close them', tool: 'close_tabs', parameters: { match: 'youtube' }, intent: 'action' },
      { thought: 'done', tool: 'finish', parameters: { summary: 'Closed 2 tabs' }, intent: 'safe' }
    );
    const steps = [];
    const outcome = await VexAgent.pursue('close every youtube tab', step => steps.push(step));
    expect(outcome.summary).toBe('Closed 2 tabs');
    expect(window.VexTabStore.close).toHaveBeenCalledTimes(2);      // the video and the page that mentions it
    expect(steps.map(step => step.kind)).toContain('result');
    // The second request carries what the first call returned.
    expect(window.VexAI.ask.mock.calls[1][1].extra.lastToolResult).toContain('closed 2 tabs');
  });

  it('asks before anything the model marks risky', async () => {
    window.VexUI.confirm.mockResolvedValueOnce(false);
    worker(
      { thought: 'buy it', tool: 'click', parameters: { selector: '#buy' }, intent: 'risky' },
      { thought: 'done', tool: 'finish', parameters: { summary: 'Stopped' }, intent: 'safe' }
    );
    await VexAgent.pursue('buy the thing');
    expect(window.VexUI.confirm).toHaveBeenCalled();
    expect(window.VexBridge.evaluate).not.toHaveBeenCalled();       // the click never happened
  });

  it('breaks out of a model repeating itself', async () => {
    window.VexAI.ask.mockResolvedValue({ thought: 'again', tool: 'read_page', parameters: {}, intent: 'safe' });
    const steps = [];
    const outcome = await VexAgent.pursue('read it', step => steps.push(step));
    expect(steps.some(step => step.kind === 'note' && /LOOP DETECTED/.test(step.text))).toBe(true);
    expect(outcome.summary).toMatch(/Stopped after/);
  });

  it('gives up rather than working forever', async () => {
    window.VexAI.ask.mockImplementation(async () => ({
      thought: 'scroll', tool: 'scroll', parameters: { direction: Math.random() > 0.5 ? 'down' : 'up' }, intent: 'safe'
    }));
    const outcome = await VexAgent.pursue('scroll for ever');
    expect(outcome.summary).toMatch(/Stopped after 10 steps/);
  });

  it('will not start twice', async () => {
    // Hold the first request open, try to start a second, then let the first
    // finish — a test that leaves the agent running poisons the next one.
    let release;
    window.VexAI.ask.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = VexAgent.pursue('one');
    await new Promise(resolve => setTimeout(resolve, 10));
    await expect(VexAgent.pursue('two')).rejects.toThrow(/already working/);
    release({ tool: 'finish', parameters: { summary: 'ok' }, intent: 'safe' });
    await first;
    expect(VexAgent.running()).toBe(false);
  });

  it('refuses without a worker', async () => {
    window.VexAI.configured = async () => false;
    await expect(VexAgent.pursue('do something')).rejects.toThrow(/Settings/);
    window.VexAI.configured = async () => true;
  });
});

describe('the tools themselves', () => {
  it('describes each one it offers', () => {
    for (const tool of VexAgent.TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.description.length).toBeGreaterThan(8);
      expect(typeof tool.parameters).toBe('object');
    }
    expect(VexAgent.TOOLS.map(tool => tool.name)).toContain('finish');
  });

  it('closes only the tabs that match', async () => {
    window.VexAI.ask.mockResolvedValueOnce({ tool: 'close_tabs', parameters: { match: 'youtube' }, intent: 'action' })
      .mockResolvedValueOnce({ tool: 'finish', parameters: { summary: 'ok' }, intent: 'safe' });
    await VexAgent.pursue('close youtube');
    expect(tabs.map(tab => tab.id)).toEqual(['t1']);
  });

  it('will not close everything when told to match nothing', async () => {
    window.VexAI.ask.mockResolvedValueOnce({ tool: 'close_tabs', parameters: { match: '' }, intent: 'action' })
      .mockResolvedValueOnce({ tool: 'finish', parameters: { summary: 'ok' }, intent: 'safe' });
    await VexAgent.pursue('close things');
    expect(tabs).toHaveLength(3);
  });
});
