// @vitest-environment jsdom
//
// The AI that stays on the phone. Two backends with one routing decision
// between them, and the decision is the part worth pinning down: an on-device
// model that is off, missing or unloaded must not quietly swallow a question,
// and "on-device only" must not quietly send the page to a server.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
const calls = [];
let statusReply = { supported: true, loaded: false, models: {} };
let nanoReply = { status: 'unavailable' };
let generateReply = { text: 'Answered on the phone.' };
let generateThrows = null;

window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexUI = { toast: vi.fn() };
window.VexBridge = {
  localAI: vi.fn(async (method, args) => {
    calls.push([method, args]);
    if (method === 'status') return statusReply;
    if (method === 'nanoStatus') return nanoReply;
    if (method === 'load') return { loaded: true, model: args.name, backend: args.backend };
    if (method === 'generate') {
      if (generateThrows) throw new Error(generateThrows);
      return generateReply;
    }
    if (method === 'nanoSummarize') return { text: '• A bullet from Nano' };
    return {};
  }),
  onLocalAI: () => () => {}
};

const { VexLocalAI } = require('../../mobile/www/js/local-ai.js');

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  calls.length = 0;
  statusReply = { supported: true, loaded: false, models: {} };
  nanoReply = { status: 'unavailable' };
  generateThrows = null;
  await VexLocalAI.refresh();
});

describe('what it will take on', () => {
  it('is off until you turn it on', async () => {
    statusReply = { supported: true, models: { 'Gemma3-1B-IT.litertlm': 600 } };
    await VexLocalAI.refresh();
    await VexLocalAI.setModel('Gemma3-1B-IT.litertlm');
    expect(VexLocalAI.handles('chat')).toBe(false);
    await VexLocalAI.setMode('prefer');
    expect(VexLocalAI.handles('chat')).toBe(true);
  });

  it('will not take a job without a model on the device', async () => {
    await VexLocalAI.setMode('prefer');
    await VexLocalAI.setModel('Gemma3-1B-IT.litertlm');
    expect(VexLocalAI.ready()).toBe(false);
    expect(VexLocalAI.handles('chat')).toBe(false);
  });

  it('never takes the agent, whatever the setting', async () => {
    statusReply = { supported: true, models: { 'm.litertlm': 1 } };
    await VexLocalAI.refresh();
    await VexLocalAI.setMode('only');
    await VexLocalAI.setModel('m.litertlm');
    expect(VexLocalAI.handles('chat')).toBe(true);
    expect(VexLocalAI.handles('agent')).toBe(false);
    expect(VexLocalAI.CHAT_ACTIONS).not.toContain('agent');
  });

  it('gives Nano only the summaries, and only when it is there', async () => {
    await VexLocalAI.setNano(true);
    expect(VexLocalAI.nanoHandles('summarize')).toBe(false);   // unavailable
    nanoReply = { status: 'available' };
    await VexLocalAI.refreshNano();
    expect(VexLocalAI.nanoHandles('summarize')).toBe(true);
    expect(VexLocalAI.nanoHandles('chat')).toBe(false);
    await VexLocalAI.setNano(false);
    expect(VexLocalAI.nanoHandles('summarize')).toBe(false);
  });
});

describe('the prompts it writes', () => {
  it('asks for bullets when summarising, and carries the page', () => {
    const prompt = VexLocalAI.promptFor('summarize', '', { text: 'A long article about ships.' });
    expect(prompt).toContain('three short bullet');
    expect(prompt).toContain('ships');
  });

  it('names the language when translating', () => {
    const prompt = VexLocalAI.promptFor('translate', '', { text: 'Hello' }, { targetLanguage: 'Turkish' });
    expect(prompt).toContain('Turkish');
  });

  it('explains the selection rather than the page', () => {
    const prompt = VexLocalAI.promptFor('explain', 'Explain this.', { text: 'The whole page' },
      { selectedText: 'tensor parallelism' });
    expect(prompt).toContain('tensor parallelism');
    expect(prompt).not.toContain('The whole page');
  });

  it('truncates the page, because a small model has a small window', () => {
    const prompt = VexLocalAI.promptFor('chat', 'What is this?', { text: 'x'.repeat(10000) });
    expect(prompt.length).toBeLessThan(3000);
  });
});

describe('what the assistant does with it', () => {
  // ai.js is the thing that has to choose. Give it both a worker and a model and
  // check which one a question actually reaches.
  let VexAI;
  const secrets = {};

  beforeEach(async () => {
    window.VexBridge.vaultGet = async key => secrets[key] || '';
    window.VexBridge.vaultSet = async (key, value) => { secrets[key] = value; };
    window.VexReader = { pageText: vi.fn(async () => 'A long article about ships.') };
    window.VexTabStore = { active: () => ({ id: 't1', url: 'https://example.com/', title: 'Ships', incognito: false }) };
    window.VexLocalAI = VexLocalAI;
    ({ VexAI } = require('../../mobile/www/js/ai.js'));
    VexAI.clear();
    await VexAI.setWorkerUrl('https://worker.example.workers.dev');
    await VexAI.setToken('t'.repeat(32));
    window.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ result: { reply: 'From the worker.' } }) }));
    statusReply = { supported: true, models: { 'm.litertlm': 1 } };
    await VexLocalAI.refresh();
    await VexLocalAI.setModel('m.litertlm');
  });

  it('uses the worker while on-device is off', async () => {
    await VexLocalAI.setMode('off');
    expect(await VexAI.ask('Hello')).toBe('From the worker.');
    expect(window.fetch).toHaveBeenCalled();
  });

  it('uses the model once you prefer it, and does not call out', async () => {
    await VexLocalAI.setMode('prefer');
    expect(await VexAI.ask('Hello')).toBe('Answered on the phone.');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the worker when the model fails', async () => {
    await VexLocalAI.setMode('prefer');
    generateThrows = 'out of memory';
    expect(await VexAI.ask('Hello')).toBe('From the worker.');
    expect(window.fetch).toHaveBeenCalled();
  });

  it('refuses rather than falling back when you said on-device only', async () => {
    await VexLocalAI.setMode('only');
    generateThrows = 'out of memory';
    await expect(VexAI.ask('Hello')).rejects.toThrow('out of memory');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('sends a summary to Nano when Nano is on and ready', async () => {
    await VexLocalAI.setMode('off');
    await VexLocalAI.setNano(true);
    nanoReply = { status: 'available' };
    await VexLocalAI.refreshNano();
    expect(await VexAI.summarize()).toContain('Nano');
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('reads a private tab for the model, because the text does not move', async () => {
    window.VexTabStore = { active: () => ({ id: 't1', url: 'https://secret.example/', title: 'Secret', incognito: true }) };
    await VexLocalAI.setMode('prefer');
    expect(await VexAI.ask('What is this?')).toBe('Answered on the phone.');
    expect(window.VexReader.pageText).toHaveBeenCalled();
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('does not read a private tab for the worker', async () => {
    window.VexTabStore = { active: () => ({ id: 't1', url: 'https://secret.example/', title: 'Secret', incognito: true }) };
    await VexLocalAI.setMode('off');
    await VexAI.ask('What is this?');
    expect(window.VexReader.pageText).not.toHaveBeenCalled();
    const body = JSON.parse(window.fetch.mock.calls[0][1].body);
    expect(body.pageContext).toBe('');
  });

  it('never sends a private page to the worker, even after the model fails', async () => {
    window.VexTabStore = { active: () => ({ id: 't1', url: 'https://secret.example/', title: 'Secret', incognito: true }) };
    await VexLocalAI.setMode('prefer');
    generateThrows = 'out of memory';
    expect(await VexAI.ask('What is this?')).toBe('From the worker.');
    // The page WAS read — on-device was going to answer — and must not travel.
    expect(window.VexReader.pageText).toHaveBeenCalled();
    const body = JSON.parse(window.fetch.mock.calls[0][1].body);
    expect(body.pageContext).toBe('');
  });

  it('keeps the agent on the worker even in on-device only', async () => {
    await VexLocalAI.setMode('only');
    await VexAI.ask('step', { action: 'agent' });
    expect(window.fetch).toHaveBeenCalled();
  });
});

describe('loading', () => {
  it('falls back to the CPU when the chosen backend refuses', async () => {
    statusReply = { supported: true, models: { 'm.litertlm': 1 } };
    await VexLocalAI.refresh();
    await VexLocalAI.setModel('m.litertlm');
    await VexLocalAI.setBackend('gpu');
    const original = window.VexBridge.localAI;
    window.VexBridge.localAI = vi.fn(async (method, args) => {
      if (method === 'load' && args.backend === 'gpu') throw new Error('no OpenCL here');
      return original(method, args);
    });
    expect(await VexLocalAI.load()).toBe(true);
    expect(VexLocalAI.chosenBackend()).toBe('cpu');
    window.VexBridge.localAI = original;
  });

  it('reports why it could not load rather than throwing nothing', async () => {
    statusReply = { supported: true, models: { 'm.litertlm': 1 } };
    await VexLocalAI.refresh();
    await VexLocalAI.setModel('m.litertlm');
    await VexLocalAI.setBackend('cpu');
    const original = window.VexBridge.localAI;
    window.VexBridge.localAI = vi.fn(async method => {
      if (method === 'load') throw new Error('the file is truncated');
      return {};
    });
    expect(await VexLocalAI.load()).toBe(false);
    expect(VexLocalAI.state.lastError).toContain('truncated');
    window.VexBridge.localAI = original;
  });
});
