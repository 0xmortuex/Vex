// @vitest-environment jsdom
//
// "Do it" on the phone: Gemma 4 calls the agent's tools itself through
// LiteRT-LM, with no worker. What is pinned down: it is chosen when it should
// be (and only a model that can use tools is), every step still goes through
// the chrome's own risk check, and the loop is bounded.
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
  normal: () => tabs.filter(tab => !tab.incognito),
  active: () => tabs.find(tab => tab.id === activeId) || null,
  activeId: () => activeId,
  create: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  navigate: vi.fn(async () => {})
};
// extract_elements, the risk check's description of a target, and a click.
window.VexBridge = {
  evaluate: vi.fn(async (id, script) => {
    if (script.includes('data-vex-id') && script.includes('querySelectorAll')) {
      return { result: JSON.stringify([{ selector: '[data-vex-id="vex-0"]', tag: 'button', text: 'Next page' }]) };
    }
    if (script.includes('node.click()')) return { result: '"clicked"' };
    return { result: JSON.stringify({ found: true, tag: 'button', text: target.text, submits: false }) };
  })
};
let target = { text: 'Next page' };
window.VexReader = { pageText: vi.fn(async () => 'The page, as text.') };
window.VexUI = { renderToolbar: vi.fn(), confirm: vi.fn(async () => true), toast: vi.fn() };
window.VexAI = { configured: vi.fn(async () => false), ask: vi.fn() };

// The model: whatever script a test gives it, calling the declared tools.
let script = async () => 'Done.';
const used = [];
const local = {
  state: { supported: true, models: { 'gemma-4-E2B-it.litertlm': 1 } },
  mode: () => store.mode || 'prefer',
  refresh: async () => local.state,
  chosenModel: () => store.chosen || 'gemma-4-E2B-it.litertlm',
  model: name => ({
    'gemma-4-E2B-it.litertlm': gemma4, 'gemma3-1b-it-int4.litertlm': gemma3
  })[name] || null,
  modelsFor: task => (task === 'agent' ? [gemma4] : [gemma4, gemma3]),
  fileOf: entry => (local.state.models[entry.name] !== undefined ? entry.name : ''),
  use: vi.fn(async (purpose, options) => { used.push([purpose, options]); }),
  generate: vi.fn(async () => script(used.at(-1)[1].onTool)),
  stop: vi.fn()
};
const gemma4 = { id: 'gemma4-e2b', name: 'gemma-4-E2B-it.litertlm', tasks: ['chat', 'agent'] };
const gemma3 = { id: 'gemma3-1b', name: 'gemma3-1b-it-int4.litertlm', tasks: ['chat'] };
window.VexLocalAI = local;

const { VexAgent } = require('../../mobile/www/js/agent.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  tabs = [{ id: 't1', url: 'https://shop.example/', title: 'A shop' }];
  activeId = 't1';
  local.state.models = { 'gemma-4-E2B-it.litertlm': 1 };
  target = { text: 'Next page' };
  used.length = 0;
  window.VexAI.configured.mockResolvedValue(false);
  window.VexUI.confirm.mockClear().mockResolvedValue(true);
  window.VexAI.ask.mockClear();
  script = async () => 'Done.';
});

describe('where “Do it” runs', () => {
  it('on the phone with Gemma 4 and no worker', async () => {
    expect(await VexAgent.where()).toBe('device');
  });

  it('on the worker when on-device AI is off and there is one', async () => {
    store.mode = 'off';
    window.VexAI.configured.mockResolvedValue(true);
    expect(await VexAgent.where()).toBe('worker');
  });

  it('nowhere with only a model that cannot use tools, and says which one can', async () => {
    store.mode = 'only';
    local.state.models = { 'gemma3-1b-it-int4.litertlm': 1 };
    expect(await VexAgent.where()).toBe(null);
    await expect(VexAgent.pursue('click next')).rejects.toThrow(/Gemma 4/);
  });
});

describe('the loop, on the phone', () => {
  it('declares the agent’s tools to the model, with schemas, and runs what it calls', async () => {
    script = async onTool => {
      const found = await onTool('extract_elements', {});
      expect(found.result).toContain('vex-0');
      expect(await onTool('click', { selector: '[data-vex-id="vex-0"]' })).toEqual({ result: 'clicked' });
      return 'Clicked “Next page”.';
    };
    const steps = [];
    const outcome = await VexAgent.pursue('click next page', step => steps.push(step));
    expect(outcome.summary).toBe('Clicked “Next page”.');
    const [purpose, options] = used[0];
    expect(purpose).toBe('agent-browser');
    expect(options.tools.map(tool => tool.name)).not.toContain('finish');
    expect(options.tools.find(tool => tool.name === 'click').parameters)
      .toEqual({ type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] });
    expect(steps.filter(step => step.kind === 'step').map(step => step.tool)).toEqual(['extract_elements', 'click']);
    expect(steps.at(-1)).toEqual({ kind: 'done', text: 'Clicked “Next page”.' });
  });

  it('still asks before a button that buys, and tells the model when you say no', async () => {
    target = { text: 'Buy now' };
    window.VexUI.confirm.mockResolvedValue(false);
    let answer;
    script = async onTool => { answer = await onTool('click', { selector: '#buy' }); return 'I did not buy it.'; };
    await VexAgent.pursue('buy it');
    expect(window.VexUI.confirm).toHaveBeenCalledWith(expect.stringMatching(/Buy now/), 'Are you sure?');
    expect(answer).toEqual({ error: 'The person refused that step.' });
  });

  it('stops answering tools after ten steps', async () => {
    let last;
    script = async onTool => {
      for (let i = 0; i < 11; i++) last = await onTool('scroll', { direction: i % 2 ? 'up' : 'down' });
      return 'Scrolled.';
    };
    window.VexBridge.evaluate.mockClear();
    await VexAgent.pursue('scroll around');
    expect(last.error).toMatch(/Step limit/);
  });

  it('works in a private tab, since nothing leaves the phone', async () => {
    tabs = [{ id: 't9', url: 'https://secret.example/', title: 'Secret', incognito: true }];
    activeId = 't9';
    await expect(VexAgent.pursue('read it')).resolves.toEqual({ summary: 'Done.' });
    expect(window.VexAI.ask).not.toHaveBeenCalled();
  });
});

describe('when the model writes a step the engine cannot read', () => {
  // The exact failure seen on a Galaxy S25 with Gemma 4 E2B.
  const GARBLED = 'Status Code: 3. Message: Failed to parse tool calls from code block: '
    + 'call:extract_elements{selector:<|"|>a<|"|>CONTACT US<|"|>}\nfull response: …';

  it('starts again with the steps already done and what was wrong, and finishes', async () => {
    let round = 0;
    const prompts = [];
    local.generate.mockImplementation(async prompt => {
      prompts.push(prompt);
      const onTool = used.at(-1)[1].onTool;
      round++;
      if (round === 1) {
        await onTool('read_page', {});
        throw new Error(GARBLED);
      }
      await onTool('extract_elements', { contains: 'contact' });
      return 'Found the contact link.';
    });
    const steps = [];
    const outcome = await VexAgent.pursue('find the contact page', step => steps.push(step));
    expect(outcome.summary).toBe('Found the contact link.');
    expect(used.map(([purpose, options]) => [purpose, options.fresh])).toEqual([['agent-browser', true], ['agent-browser', true]]);
    expect(prompts[1]).toContain('Steps already done:\n- read_page {} → The page, as text.');
    expect(prompts[1]).toContain('call:extract_elements{selector:"a"CONTACT US"}');
    expect(steps.some(step => step.kind === 'note' && /could not be read/.test(step.text))).toBe(true);
    local.generate.mockImplementation(async () => script(used.at(-1)[1].onTool));
  });

  it('gives up after three unreadable replies, saying what to do', async () => {
    local.generate.mockClear().mockImplementation(async () => { throw new Error(GARBLED); });
    const outcome = await VexAgent.pursue('find the contact page');
    expect(outcome.summary).toMatch(/shorter, more specific request/);
    expect(local.generate).toHaveBeenCalledTimes(3);
    local.generate.mockImplementation(async () => script(used.at(-1)[1].onTool));
  });

  it('reports any other engine failure in one line', async () => {
    local.generate.mockImplementationOnce(async () => { throw new Error('Out of memory\nstack…'); });
    await expect(VexAgent.pursue('anything')).rejects.toThrow(/^The on-device model stopped: Out of memory$/);
  });
});

describe('extract_elements', () => {
  it('can keep only the controls whose text has a word, so the model need not invent a filter', async () => {
    document.body.innerHTML = '<a href="/a">Home</a><a href="/c">CONTACT US</a><button>Contact sales</button><button>Buy</button>';
    // jsdom has no layout and no innerText; a WebView has both.
    for (const node of document.querySelectorAll('a, button')) {
      node.getBoundingClientRect = () => ({ width: 10, height: 10 });
      Object.defineProperty(node, 'innerText', { value: node.textContent });
    }
    let captured = '';
    window.VexBridge.evaluate.mockImplementationOnce(async (id, code) => { captured = code; return { result: '[]' }; });
    script = async onTool => { await onTool('extract_elements', { contains: 'Contact' }); return 'ok'; };
    await VexAgent.pursue('find contact');
    const found = JSON.parse((0, eval)(captured));
    expect(found.map(item => item.text)).toEqual(['CONTACT US', 'Contact sales']);
    const declared = used.at(-1)[1].tools.find(tool => tool.name === 'extract_elements');
    expect(declared.parameters).toEqual({ type: 'object', properties: { contains: { type: 'string' } } });
  });
});
