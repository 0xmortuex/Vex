// @vitest-environment jsdom
//
// The assistant client. It talks to a worker the user deploys themselves, so
// the things worth pinning down are all about what leaves the phone: that a
// request carries the token and the desktop app's request shape, that a
// private tab's page text is never attached, and that failures come back as
// sentences a person can act on rather than stack traces.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
const secrets = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};
window.VexBridge = {
  vaultGet: async key => secrets[key] || '',
  vaultSet: async (key, value) => { secrets[key] = value; }
};
window.VexReader = { pageText: vi.fn(async () => 'The page, as text.') };
window.VexTabStore = { active: () => activeTab };
let activeTab = null;

const { VexAI } = require('../../mobile/www/js/ai.js');

function workerReplies(payload, ok = true, status = 200) {
  window.fetch = vi.fn(async () => ({
    ok, status,
    json: async () => payload
  }));
}

beforeEach(async () => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(secrets)) delete secrets[key];
  VexAI.clear();
  activeTab = { id: 't1', url: 'https://example.com/story', title: 'A story', incognito: false };
  await VexAI.setWorkerUrl('https://worker.example.workers.dev');
  await VexAI.setToken('t'.repeat(32));
  window.VexReader.pageText.mockClear();
});

describe('configuration', () => {
  it('needs both a URL and a token', async () => {
    expect(await VexAI.configured()).toBe(true);
    await VexAI.setToken('');
    expect(await VexAI.configured()).toBe(false);
  });

  it('refuses a worker URL that is not https', async () => {
    await expect(VexAI.setWorkerUrl('http://worker.example')).rejects.toThrow(/https/);
  });

  it('refuses a token that is obviously not one', async () => {
    await expect(VexAI.setToken('short')).rejects.toThrow(/24/);
  });

  it('keeps the token out of ordinary settings storage', async () => {
    expect(JSON.stringify(store)).not.toContain('tttt');
  });
});

describe('asking a question', () => {
  it('sends the desktop app’s request shape, with the token', async () => {
    workerReplies({ result: { reply: 'It is about a shipwreck.' } });
    const answer = await VexAI.ask('What is this about?');
    expect(answer).toBe('It is about a shipwreck.');

    const [url, options] = window.fetch.mock.calls[0];
    expect(url).toBe('https://worker.example.workers.dev');
    expect(options.headers.Authorization).toBe('Bearer ' + 't'.repeat(32));
    const body = JSON.parse(options.body);
    expect(body.action).toBe('chat');
    expect(body.message).toBe('What is this about?');
    expect(body.pageContext).toBe('The page, as text.');
    expect(Array.isArray(body.conversationHistory)).toBe(true);
  });

  it('never sends a private tab’s page', async () => {
    activeTab.incognito = true;
    workerReplies({ result: { reply: 'ok' } });
    await VexAI.ask('Hello');
    expect(window.VexReader.pageText).not.toHaveBeenCalled();
    expect(JSON.parse(window.fetch.mock.calls[0][1].body).pageContext).toBe('');
  });

  it('carries what came before, capped, without echoing the new question', async () => {
    workerReplies({ result: { reply: 'answer' } });
    for (let i = 0; i < 10; i++) await VexAI.ask('question ' + i);
    const body = JSON.parse(window.fetch.mock.calls.at(-1)[1].body);
    expect(body.conversationHistory.length).toBeLessThanOrEqual(12);
    // The last thing in the history is the previous answer, and the current
    // question appears once — as `message`.
    expect(body.conversationHistory.at(-1).role).toBe('assistant');
    expect(body.conversationHistory.filter(turn => turn.content === 'question 9')).toHaveLength(0);
    expect(body.message).toBe('question 9');
  });

  it('keeps the exchange for the panel to draw', async () => {
    workerReplies({ result: { reply: 'answer', suggestedFollowUps: ['and then?', 'why?'] } });
    await VexAI.ask('why');
    expect(VexAI.state.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(VexAI.state.messages[1].followUps).toEqual(['and then?', 'why?']);
  });

  it('takes summarize, translate and explain through their own actions', async () => {
    workerReplies({ result: { summary: 'Short version.' } });
    expect(await VexAI.summarize()).toBe('Short version.');
    expect(JSON.parse(window.fetch.mock.calls[0][1].body).action).toBe('summarize');

    workerReplies({ result: { translation: 'Kısa sürüm.' } });
    await VexAI.translate('Turkish');
    const body = JSON.parse(window.fetch.mock.calls[0][1].body);
    expect(body.action).toBe('translate');
    expect(body.targetLanguage).toBe('Turkish');
  });
});

describe('when it goes wrong', () => {
  it('says what to do when nothing is configured', async () => {
    await VexAI.setWorkerUrl('');
    await expect(VexAI.ask('hi')).rejects.toThrow(/Worker URL/);
  });

  it('passes the worker’s own error through', async () => {
    workerReplies({ error: 'Daily AI quota reached' }, false, 429);
    await expect(VexAI.ask('hi')).rejects.toThrow('Daily AI quota reached');
  });

  it('turns a dead connection into a sentence', async () => {
    window.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(VexAI.ask('hi')).rejects.toThrow(/Could not reach/);
  });

  it('records the failure in the log so the panel can show it', async () => {
    workerReplies({ error: 'nope' }, false, 500);
    await VexAI.ask('hi').catch(() => {});
    expect(VexAI.state.messages.at(-1).role).toBe('error');
  });
});
