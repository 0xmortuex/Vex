// @vitest-environment jsdom
//
// AI Lab: the Gallery's models and features on Vex's engine. What is worth
// pinning down is what a phone cannot show you went wrong — a download URL
// that is not the Gallery's file, an engine reloaded (seconds, a gigabyte)
// when a new conversation would have done, a tool the fine-tuned models were
// never trained on, a tool call that never gets its answer back.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;

const store = {};
const calls = [];
const listeners = new Map();
let statusReply = { supported: true, loaded: false, models: {} };

window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexUI = { toast: vi.fn(), copy: vi.fn(), openUrl: vi.fn() };
window.VexBridge = {
  localAI: vi.fn(async (method, args) => {
    calls.push([method, args]);
    if (method === 'status') return statusReply;
    if (method === 'load') return { loaded: true, model: args.name, backend: args.backend, vision: !!args.vision, audio: !!args.audio };
    if (method === 'reset') return { loaded: true, model: statusReply.model, backend: 'gpu' };
    if (method === 'generate') return { text: 'ok' };
    if (method === 'deviceAction') return { text: 'Did ' + args.name };
    return {};
  }),
  onLocalAI: (event, fn) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  requestPermission: async () => true,
  fetchText: vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
};
const emit = (event, data) => { for (const fn of listeners.get(event) || []) fn(data); };

require('../../mobile/www/js/dom.js');
const { VexLocalAI } = require('../../mobile/www/js/local-ai.js');
window.VexLocalAI = VexLocalAI;
window.VexPanels = { shell: () => document.createElement('div'), top: () => '' };
window.VexSheets = { row: () => document.createElement('div'), choose: vi.fn() };
const { VexLab } = require('../../mobile/www/js/lab.js');

VexLocalAI.bind();

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  calls.length = 0;
  statusReply = { supported: true, loaded: false, models: {} };
  await VexLocalAI.unload();
  await VexLocalAI.refresh();
  calls.length = 0;
});

describe('the catalogue', () => {
  it('has every model in the Gallery’s current list, at its pinned commit', () => {
    const gallery = {
      'gemma-4-E2B-it.litertlm': ['litert-community/gemma-4-E2B-it-litert-lm', '6e5c4f1e395deb959c494953478fa5cec4b8008f', 2588147712],
      'gemma-4-E4B-it.litertlm': ['litert-community/gemma-4-E4B-it-litert-lm', '28299f30ee4d43294517a4ac93abd6163412f07f', 3659530240],
      'gemma-3n-E2B-it-int4.litertlm': ['google/gemma-3n-E2B-it-litert-lm', 'ba9ca88da013b537b6ed38108be609b8db1c3a16', 3655827456],
      'gemma-3n-E4B-it-int4.litertlm': ['google/gemma-3n-E4B-it-litert-lm', '297ed75955702dec3503e00c2c2ecbbf475300bc', 4919541760],
      'gemma3-1b-it-int4.litertlm': ['litert-community/Gemma3-1B-IT', '42d538a932e8d5b12e6b3b455f5572560bd60b2c', 584417280],
      'tiny_garden_q8_ekv1024.litertlm': ['litert-community/functiongemma-270m-ft-tiny-garden', 'c205853ff82da86141a1105faa2344a8b176dfe7', 288964608],
      'mobile_actions_q8_ekv1024.litertlm': ['litert-community/functiongemma-270m-ft-mobile-actions', '38942192c9b723af836d489074823ff33d4a3e7a', 288964608],
      'Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm': ['litert-community/Qwen2.5-1.5B-Instruct', '19edb84c69a0212f29a6ef17ba0d6f278b6a1614', 1597931520],
      'DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm': ['litert-community/DeepSeek-R1-Distill-Qwen-1.5B', 'e34bb88632342d1f9640bad579a45134eb1cf988', 1833451520]
    };
    for (const [file, [repo, commit, bytes]] of Object.entries(gallery)) {
      const entry = VexLocalAI.model(file);
      expect(entry, file).toBeTruthy();
      expect(entry.url).toBe('https://huggingface.co/' + repo + '/resolve/' + commit + '/' + file + '?download=true');
      expect(entry.bytes).toBe(bytes);
    }
    const touch = VexLocalAI.model('interactive_segmentation.task');
    expect(touch.kind).toBe('segmenter');
    expect(touch.url).toBe('https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task');
  });

  it('says which models see, hear and use tools, as the Gallery does', () => {
    expect(VexLocalAI.modelsFor('image').map(entry => entry.id)).toEqual(['gemma4-e2b', 'gemma4-e4b', 'gemma3n-e2b', 'gemma3n-e4b']);
    expect(VexLocalAI.modelsFor('audio').map(entry => entry.id)).toEqual(['gemma4-e2b', 'gemma4-e4b', 'gemma3n-e2b', 'gemma3n-e4b']);
    expect(VexLocalAI.modelsFor('agent').map(entry => entry.id)).toEqual(['gemma4-e2b', 'gemma4-e4b']);
    expect(VexLocalAI.modelsFor('garden').map(entry => entry.id)).toEqual(['tiny-garden']);
    expect(VexLocalAI.modelsFor('actions').map(entry => entry.id)).toEqual(['mobile-actions']);
    expect(VexLocalAI.modelsFor('scrapbook').map(entry => entry.id)).toEqual(['magic-touch']);
  });

  it('finds a model an older Vex saved under its old name', async () => {
    statusReply = { supported: true, models: { 'Gemma3-1B-IT.litertlm': 600 } };
    await VexLocalAI.refresh();
    const entry = VexLocalAI.model('gemma3-1b');
    expect(VexLocalAI.fileOf(entry)).toBe('Gemma3-1B-IT.litertlm');
    expect(VexLocalAI.model('Gemma3-1B-IT.litertlm')).toBe(entry);
  });

  it('sends the Hugging Face token only for a model behind the licence', async () => {
    await VexLocalAI.setHfToken('hf_secret');
    await VexLocalAI.downloadModel(VexLocalAI.model('gemma3-1b'));
    await VexLocalAI.downloadModel(VexLocalAI.model('qwen2.5-1.5b'));
    const downloads = calls.filter(([method]) => method === 'download').map(([, args]) => args);
    expect(downloads[0].headers).toEqual({ Authorization: 'Bearer hf_secret' });
    expect(downloads[1].headers).toEqual({});
  });
});

describe('one engine, many conversations', () => {
  const E2B = 'gemma-4-E2B-it.litertlm';

  beforeEach(async () => {
    statusReply = { supported: true, models: { [E2B]: 2588147712 }, model: E2B };
    await VexLocalAI.refresh();
    calls.length = 0;
  });

  it('loads the image and audio readers only when a feature asks for them', async () => {
    await VexLocalAI.use('image', { model: E2B, vision: true });
    const load = calls.find(([method]) => method === 'load')[1];
    expect(load.vision).toBe(true);
    expect(load.audio).toBe(false);
    expect(load.maxTokens).toBe(4000);
    expect(load.topK).toBe(64);
  });

  it('starts a new conversation, not a reload, when another feature takes the same model', async () => {
    await VexLocalAI.use('image', { model: E2B, vision: true });
    await VexLocalAI.use('chat', { model: E2B, system: 'Be brief.' });
    const methods = calls.map(([method]) => method);
    expect(methods.filter(method => method === 'load')).toHaveLength(1);
    expect(methods.filter(method => method === 'reset')).toHaveLength(1);
    expect(calls.find(([method]) => method === 'reset')[1].system).toBe('Be brief.');
  });

  it('does nothing at all when the same feature asks again', async () => {
    await VexLocalAI.use('chat', { model: E2B });
    calls.length = 0;
    await VexLocalAI.use('chat', { model: E2B });
    expect(calls).toHaveLength(0);
  });

  it('reloads when a feature needs a reader the engine was built without', async () => {
    await VexLocalAI.use('chat', { model: E2B });
    await VexLocalAI.use('audio', { model: E2B, audio: true });
    expect(calls.filter(([method]) => method === 'load')).toHaveLength(2);
    expect(VexLocalAI.state.audio).toBe(true);
  });

  it('declares tools as JSON and hands each call to the feature that declared them', async () => {
    const seen = [];
    await VexLocalAI.use('garden-test', {
      model: E2B, tools: VexLab.GARDEN_TOOLS,
      onTool: async (name, args) => { seen.push([name, args]); return { result: 'success' }; }
    });
    const load = calls.find(([method]) => method === 'load')[1];
    expect(JSON.parse(load.tools).map(tool => tool.name)).toEqual(['water_plots', 'plant_seed', 'harvest_plots']);
    emit('toolCall', { callId: 'tool-1', name: 'plant_seed', args: '{"seed":"rose","plots":[1,2]}' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual([['plant_seed', { seed: 'rose', plots: [1, 2] }]]);
    const answer = calls.find(([method]) => method === 'toolResult')[1];
    expect(answer.callId).toBe('tool-1');
    expect(JSON.parse(answer.result)).toEqual({ result: 'success' });
  });

  it('answers a tool call even when the tool throws, so the model is never left waiting', async () => {
    await VexLocalAI.use('x', { model: E2B, tools: [{ name: 'boom', description: 'b' }], onTool: async () => { throw new Error('no'); } });
    emit('toolCall', { callId: 'tool-9', name: 'boom', args: '{}' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const answer = calls.find(([method]) => method === 'toolResult')[1];
    expect(JSON.parse(answer.result)).toEqual({ error: 'no' });
  });

  it('runs FunctionGemma on the CPU, as the Gallery does', async () => {
    statusReply = { supported: true, models: { 'tiny_garden_q8_ekv1024.litertlm': 1 } };
    await VexLocalAI.refresh();
    calls.length = 0;
    await VexLocalAI.use('garden', { model: 'tiny_garden_q8_ekv1024.litertlm' });
    expect(calls.find(([method]) => method === 'load')[1].backend).toBe('cpu');
  });

  it('refuses to generate for a feature that no longer holds the model', async () => {
    await VexLocalAI.use('image', { model: E2B, vision: true });
    await VexLocalAI.use('chat', { model: E2B });
    await expect(VexLocalAI.generate('hi', { purpose: 'image' })).rejects.toThrow(/Another feature/);
  });

  it('passes pictures and the recorded clip with the prompt', async () => {
    await VexLocalAI.use('image', { model: E2B, vision: true });
    await VexLocalAI.generate('What is this?', { purpose: 'image', images: ['AAAA'], withClip: false });
    const generate = calls.find(([method]) => method === 'generate')[1];
    expect(generate.images).toEqual(['AAAA']);
    expect(generate.withClip).toBe(false);
  });
});

describe('Tiny Garden', () => {
  beforeEach(() => {
    VexLab.garden.plots = Array.from({ length: 9 }, () => ({ seed: '', water: 0 }));
    VexLab.garden.basket = {};
  });

  it('plants, grows with two waterings, and harvests into the basket', () => {
    expect(VexLab.gardenTool('plant_seed', { seed: 'sunflower', plots: [1, 2, 3] }).result).toBe('success');
    VexLab.gardenTool('water_plots', { plots: [1, 2, 3] });
    VexLab.gardenTool('harvest_plots', { plots: [1] });
    expect(VexLab.garden.basket).toEqual({});           // not grown yet
    VexLab.gardenTool('water_plots', { plots: [1, 2] });
    VexLab.gardenTool('harvest_plots', { plots: [1, 2, 3] });
    expect(VexLab.garden.basket).toEqual({ sunflower: 2 });
    expect(VexLab.garden.plots[2].seed).toBe('sunflower');
  });

  it('takes the Gallery’s names for the secret seed, and ignores plots off the grid', () => {
    VexLab.gardenTool('plant_seed', { seed: 'edge gallery', plots: [5, 12, 0] });
    expect(VexLab.garden.plots[4].seed).toBe('secret');
    expect(VexLab.gardenTool('water_plots', { plots: [42] }).result).toBe('failure');
  });

  it('declares exactly the tools FunctionGemma was fine-tuned on', () => {
    const plant = VexLab.GARDEN_TOOLS.find(tool => tool.name === 'plant_seed');
    expect(plant.description).toBe('Plant a seed in one or more garden plots.');
    expect(plant.parameters.properties.plots).toEqual({ type: 'array', items: { type: 'integer' }, description: 'The IDs of the plots to plant a seed in.' });
  });
});

describe('Mobile Actions', () => {
  it('declares the Gallery’s seven functions, snake_cased as LiteRT-LM does', () => {
    expect(VexLab.ACTION_TOOLS.map(tool => tool.name)).toEqual([
      'turn_on_flashlight', 'turn_off_flashlight', 'create_contact', 'send_email',
      'show_location_on_map', 'open_wifi_settings', 'create_calendar_event'
    ]);
    const contact = VexLab.ACTION_TOOLS.find(tool => tool.name === 'create_contact');
    expect(Object.keys(contact.parameters.properties)).toEqual(['first_name', 'last_name', 'phone_number', 'email']);
    expect(VexLab.ACTION_TOOLS[0].parameters).toBeUndefined();
  });
});

describe('Agent Skills', () => {
  it('has a skill for each of the Gallery’s that a browser can run, and some of its own', () => {
    const names = VexLab.SKILLS.map(skill => skill.name);
    for (const name of ['query-wikipedia', 'calculate-hash', 'qr-code', 'send-email', 'create-calendar-event',
      'interactive-map', 'schedule-notification', 'mood-tracker', 'text-spinner', 'kitchen-adventure', 'learn-something-new']) {
      expect(names).toContain(name);
    }
    for (const name of ['open-website', 'search-web', 'read-this-page']) expect(names).toContain(name);
  });

  it('hashes text the way sha256sum does', async () => {
    const skill = VexLab.SKILLS.find(item => item.name === 'calculate-hash');
    const result = await skill.run({ text: 'hello world', algorithm: 'SHA-256' });
    expect(result.hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('asks Wikipedia for the best match and returns its introduction', async () => {
    window.VexBridge.fetchText.mockResolvedValueOnce({
      ok: true, status: 200,
      body: JSON.stringify({ query: { pages: [{ title: 'Albert Einstein', extract: 'A physicist.' }] } })
    });
    const skill = VexLab.SKILLS.find(item => item.name === 'query-wikipedia');
    const result = await skill.run({ topic: 'Albert Einstein', lang: 'en' });
    expect(result).toEqual({ title: 'Albert Einstein', extract: 'A physicist.' });
    const url = window.VexBridge.fetchText.mock.calls.at(-1)[0];
    expect(url.startsWith('https://en.wikipedia.org/w/api.php?')).toBe(true);
    expect(url).toContain('gsrsearch=Albert%20Einstein');
  });

  it('declares load_skill and run_skill', () => {
    expect(VexLab.AGENT_TOOLS.map(tool => tool.name)).toEqual(['load_skill', 'run_skill']);
  });
});
