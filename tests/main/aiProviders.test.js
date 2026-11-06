// @vitest-environment node
//
// The AI provider registry (src/main/ai-providers.js): one row of data and one small adapter per kind.
// Request shapes, stream parsing, error mapping, the model list (live, newest first, chat models only)
// and the recommended models are all checked here without a network.
import { describe, it, expect } from 'vitest';

const P = require('../../src/main/ai-providers.js');
const prices = require('../../src/main/ai-prices.js');

const msgs = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello' },
  { role: 'user', content: 'and now?' },
];

describe('the registry', () => {
  it('knows Claude, OpenAI, Gemini, OpenRouter and a custom server', () => {
    expect(P.PROVIDER_IDS).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'custom']);
    expect(P.provider('anthropic').keyUrl).toMatch(/^https:\/\/console\.anthropic\.com/);
    expect(() => P.provider('nope')).toThrow(/Unknown AI provider/);
  });
  it('describe() never carries anything secret', () => {
    for (const id of P.PROVIDER_IDS) expect(Object.keys(P.describe(id)).sort()).toEqual(['defaultBaseUrl', 'id', 'keyHint', 'keyUrl', 'name', 'needsBaseUrl', 'short']);
  });
});

describe('keys and addresses', () => {
  it('accepts one printable token and refuses spaces, short and empty keys', () => {
    expect(P.checkKey('anthropic', '  sk-ant-api03-abcdefghijklmnop  ')).toBe('sk-ant-api03-abcdefghijklmnop');
    expect(() => P.checkKey('openai', 'sk- has space inside xxxxxxxx')).toThrow(/no spaces/);
    expect(() => P.checkKey('openai', 'short')).toThrow(/too short/);
    expect(() => P.checkKey('gemini', '')).toThrow(/Paste your Gemini/);
    expect(() => P.checkKey('openai', 'sk-éééééééééééééééééé')).toThrow(/does not look like/);
    expect(() => P.checkKey('openai', 'k'.repeat(401))).toThrow(/too long/);
  });
  it('a custom server may have no key', () => {
    expect(P.checkKey('custom', '')).toBe('');
    expect(P.checkKey('custom', 'lm-studio')).toBe('lm-studio');
  });
  it('a custom address is https (http only on this computer), without credentials or a query', () => {
    expect(P.checkBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
    expect(P.checkBaseUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1');
    expect(() => P.checkBaseUrl('http://example.com/v1')).toThrow(/https/);
    expect(() => P.checkBaseUrl('https://user:pw@example.com/v1')).toThrow(/user name/);
    expect(() => P.checkBaseUrl('https://example.com/v1?key=abc')).toThrow(/after the \?/);
    expect(() => P.checkBaseUrl('not a url')).toThrow(/not a web address/);
    expect(() => P.checkBaseUrl('')).toThrow(/server address/);
  });
});

describe('the chat request, per provider', () => {
  it('Claude: Messages API, x-api-key, version header, system split out, streaming, no sampling parameters', () => {
    const r = P.chatRequest('anthropic', { key: 'K', model: 'claude-sonnet-5-5', messages: msgs, maxTokens: 900 });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['x-api-key']).toBe('K');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.body).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 900, stream: true, system: 'Be brief.', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'and now?' }] });
    expect(r.body.temperature).toBeUndefined();
  });
  it('Claude: a history that starts with the assistant is trimmed to start with the user', () => {
    const r = P.chatRequest('anthropic', { key: 'K', model: 'm', messages: [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'q' }] });
    expect(r.body.messages).toEqual([{ role: 'user', content: 'q' }]);
  });
  it('OpenAI: chat completions, Bearer, max_completion_tokens, usage in the stream', () => {
    const r = P.chatRequest('openai', { key: 'K', model: 'gpt-x', messages: msgs, maxTokens: 500 });
    expect(r.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(r.headers.Authorization).toBe('Bearer K');
    expect(r.body.max_completion_tokens).toBe(500);
    expect(r.body.max_tokens).toBeUndefined();
    expect(r.body.stream_options).toEqual({ include_usage: true });
    expect(r.body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' });
    expect(r.body.temperature).toBeUndefined();
  });
  it('OpenRouter: the same format with max_tokens', () => {
    const r = P.chatRequest('openrouter', { key: 'K', model: 'anthropic/claude-sonnet-5-5', messages: msgs });
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(r.body.max_tokens).toBe(2000);
    expect(r.body.max_completion_tokens).toBeUndefined();
  });
  it('Custom: its own address, Bearer only when there is a key, no stream_options', () => {
    const a = P.chatRequest('custom', { baseUrl: 'http://localhost:1234/v1', key: '', model: 'local', messages: msgs });
    expect(a.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(a.headers.Authorization).toBeUndefined();
    expect(a.body.stream_options).toBeUndefined();
    expect(P.chatRequest('custom', { baseUrl: 'https://x.example/v1', key: 'K', model: 'm', messages: msgs }).headers.Authorization).toBe('Bearer K');
  });
  it('Gemini: streamGenerateContent over SSE, the key in a header (never in the address), system as systemInstruction', () => {
    const r = P.chatRequest('gemini', { key: 'K', model: 'models/gemini-2.5-pro', messages: msgs, maxTokens: 700 });
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(r.url).not.toContain('K');
    expect(r.headers['x-goog-api-key']).toBe('K');
    expect(r.body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] });
    expect(r.body.contents.map(c => c.role)).toEqual(['user', 'model', 'user']);
    expect(r.body.generationConfig).toEqual({ maxOutputTokens: 700 });
  });
  it('refuses to build a request with no model or nothing to ask', () => {
    expect(() => P.chatRequest('openai', { key: 'K', model: '', messages: msgs })).toThrow(/No model/);
    expect(() => P.chatRequest('anthropic', { key: 'K', model: 'm', messages: [{ role: 'system', content: 's' }] })).toThrow(/nothing to ask/);
  });
  it('a test-only base address replaces the provider address', () => {
    expect(P.chatRequest('anthropic', { baseUrl: 'http://127.0.0.1:9/anthropic', key: 'K', model: 'm', messages: msgs }).url).toBe('http://127.0.0.1:9/anthropic/v1/messages');
  });
});

const sse = (...blocks) => blocks.map(b => (b.event ? 'event: ' + b.event + '\n' : '') + 'data: ' + (typeof b.data === 'string' ? b.data : JSON.stringify(b.data)) + '\n\n').join('');

function run(id, text, split = 7) {
  const parser = P.createStreamParser(id);
  const events = [];
  for (let i = 0; i < text.length; i += split) events.push(...parser.push(text.slice(i, i + split)));
  events.push(...parser.end());
  return events;
}
const textOf = (events) => events.filter(e => e.type === 'delta').map(e => e.text).join('');

describe('stream parsing (cut into odd pieces)', () => {
  it('Claude', () => {
    const body = sse(
      { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 25, output_tokens: 1 } } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } } },
      { event: 'ping', data: { type: 'ping' } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } } },
      { event: 'message_stop', data: { type: 'message_stop' } });
    const ev = run('anthropic', body);
    expect(textOf(ev)).toBe('Hello');
    expect(ev.filter(e => e.type === 'usage')).toEqual([{ type: 'usage', input: 25, output: 1 }, { type: 'usage', output: 12 }]);
    expect(ev.at(-1)).toEqual({ type: 'stop', reason: 'end_turn' });
  });
  it('Claude: an error event in the stream is an error, with the provider\'s words', () => {
    const ev = run('anthropic', sse({ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }));
    expect(ev).toEqual([{ type: 'error', message: 'Overloaded', errorType: 'overloaded_error' }]);
  });
  it('OpenAI-style: deltas, the usage chunk and [DONE]', () => {
    const body = sse(
      { data: { choices: [{ delta: { role: 'assistant', content: '' } }] } },
      { data: { choices: [{ delta: { content: 'Bon' } }] } },
      { data: { choices: [{ delta: { content: 'jour' }, finish_reason: 'stop' }] } },
      { data: { choices: [], usage: { prompt_tokens: 9, completion_tokens: 3 } } },
      { data: '[DONE]' });
    const ev = run('openai', body, 5);
    expect(textOf(ev)).toBe('Bonjour');
    expect(ev).toContainEqual({ type: 'usage', input: 9, output: 3 });
    expect(ev).toContainEqual({ type: 'stop', reason: 'stop' });
  });
  it('Gemini: parts, thoughts are not shown, usage metadata', () => {
    const body = sse(
      { data: { candidates: [{ content: { role: 'model', parts: [{ text: 'secret thinking', thought: true }, { text: 'Merhaba' }] } }] } },
      { data: { candidates: [{ content: { parts: [{ text: ' dunya' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } } });
    const ev = run('gemini', body, 11);
    expect(textOf(ev)).toBe('Merhaba dunya');
    expect(ev).toContainEqual({ type: 'usage', input: 4, output: 2 });
  });
  it('handles CRLF line ends, and an error object on any provider', () => {
    expect(textOf(run('openai', sse({ data: { choices: [{ delta: { content: 'ok' } }] } }).replace(/\n/g, '\r\n')))).toBe('ok');
    expect(run('gemini', sse({ data: { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } } }))[0]).toMatchObject({ type: 'error', message: 'Quota exceeded' });
  });
  it('a block that is not JSON is reported, not swallowed', () => {
    expect(run('openai', 'data: {oops\n\n')[0]).toMatchObject({ type: 'error', errorType: 'bad-stream' });
  });
});

describe('HTTP errors, with the provider\'s real reason', () => {
  const h = (o = {}) => ({ get: (n) => o[n.toLowerCase()] ?? null });
  it('401/403 is a key problem', () => {
    expect(P.mapHttpError(401, JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), h())).toMatchObject({ code: 'invalid-key', status: 401, detail: 'invalid x-api-key' });
    expect(P.mapHttpError(403, '{}', h()).code).toBe('invalid-key');
  });
  it('429 is a rate limit with its Retry-After; a 429 about credit is a quota problem', () => {
    expect(P.mapHttpError(429, '{"error":{"message":"Rate limit reached"}}', h({ 'retry-after': '17' }))).toMatchObject({ code: 'rate-limit', retryAfter: 17 });
    expect(P.mapHttpError(429, '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}', h()).code).toBe('quota');
    expect(P.mapHttpError(402, '{"error":{"message":"Insufficient credits"}}', h()).code).toBe('quota');
    expect(P.mapHttpError(400, '{"error":{"message":"Your credit balance is too low to access the API."}}', h()).code).not.toBe('quota');
  });
  it('a model the key cannot use', () => {
    expect(P.mapHttpError(404, '{"error":{"message":"The model `gpt-9` does not exist"}}', h()).code).toBe('model');
    expect(P.mapHttpError(400, '{"error":{"message":"model: claude-x is not supported"}}', h()).code).toBe('model');
  });
  it('5xx and 529 are the provider being busy; anything else is a bad request', () => {
    expect(P.mapHttpError(529, '{"error":{"message":"Overloaded"}}', h()).code).toBe('overloaded');
    expect(P.mapHttpError(500, 'boom', h()).code).toBe('overloaded');
    expect(P.mapHttpError(422, '{"error":{"message":"bad"}}', h()).code).toBe('bad-request');
  });
  it('plain-text and Gemini-style bodies still give a sentence', () => {
    expect(P.mapHttpError(500, '<html>  Bad   gateway </html>', h()).detail).toBe('<html> Bad gateway </html>');
    expect(P.mapHttpError(400, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }), h()).detail).toMatch(/API key not valid/);
  });
});

describe('the model list: chat models only, newest first', () => {
  it('Claude: all models, by their own dates', () => {
    const list = P.parseModelList('anthropic', { data: [
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-02T00:00:00Z' },
    ] });
    expect(list.map(m => m.id)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5']);
    expect(list[0].name).toBe('Claude Sonnet 5.5');
  });
  it('OpenAI: GPT and o-series only; embeddings, audio, images and moderation are dropped', () => {
    const ids = ['gpt-5', 'gpt-4o', 'o3', 'text-embedding-3-large', 'whisper-1', 'tts-1', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-audio-preview', 'gpt-4o-realtime-preview', 'davinci-002', 'gpt-5-mini'];
    const list = P.parseModelList('openai', { data: ids.map((id, i) => ({ id, created: 1700000000 + i })) });
    expect(list.map(m => m.id).sort()).toEqual(['gpt-4o', 'gpt-5', 'gpt-5-mini', 'o3']);
    expect(list[0].id).toBe('gpt-5-mini');
  });
  it('Gemini: generateContent models only, "models/" removed, newest version first', () => {
    const gen = ['generateContent'];
    const list = P.parseModelList('gemini', { models: [
      { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: gen },
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: gen },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: gen },
      { name: 'models/imagen-3.0-generate-002', supportedGenerationMethods: ['predict'] },
    ] });
    // No dates from Gemini: the version in the id orders them (2.5 before 2.0).
    expect(list.map(m => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']);
  });
  it('OpenRouter: text-output models, newest first', () => {
    const list = P.parseModelList('openrouter', { data: [
      { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', created: 1790000000, architecture: { output_modalities: ['text'] } },
      { id: 'vendor/image-maker', created: 1795000000, architecture: { output_modalities: ['image'] } },
      { id: 'anthropic/claude-haiku-5-5', created: 1791000000, architecture: { output_modalities: ['text'] } },
    ] });
    expect(list.map(m => m.id)).toEqual(['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5']);
  });
  it('Custom: whatever the server lists, without embeddings, de-duplicated', () => {
    const list = P.parseModelList('custom', { data: [{ id: 'llama-3.3-70b' }, { id: 'nomic-embed-text' }, { id: 'llama-3.3-70b' }, { id: 'qwen3' }] });
    expect(list.map(m => m.id).sort()).toEqual(['llama-3.3-70b', 'qwen3']);
  });
  it('a reply that is not a model list is an error', () => {
    expect(() => P.parseModelList('openai', null)).toThrow(/not understood/);
    expect(P.parseModelList('openai', { nothing: 1 })).toEqual([]);
  });
});

describe('the fallback list and the recommended models', () => {
  it('only Claude has a fallback, newest family at the top, and the note says it is a fallback', () => {
    const f = P.fallbackModels('anthropic').map(m => m.id);
    expect(f.slice(0, 4)).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(P.FALLBACK_NOTE).toBe('list unavailable, showing known models');
    for (const id of ['openai', 'gemini', 'openrouter', 'custom']) expect(P.fallbackModels(id)).toEqual([]);
  });
  it('Claude: best Opus 5.5, balanced Sonnet 5.5, fast Haiku 5.5 when listed; Fable only if Opus 5.5 is not', () => {
    const rec = P.recommend('anthropic', P.fallbackModels('anthropic'));
    expect(rec).toEqual({ best: 'claude-opus-5-5', default: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' });
    const noOpus = P.fallbackModels('anthropic').filter(m => m.id !== 'claude-opus-5-5');
    expect(P.recommend('anthropic', noOpus).best).toBe('claude-fable-5-1');
  });
  it('Claude: a list without the 5.5 models falls to the newest of each family, never an invented id', () => {
    const list = [{ id: 'claude-opus-4-8' }, { id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }];
    expect(P.recommend('anthropic', list)).toEqual({ best: 'claude-opus-4-8', default: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5' });
    expect(P.recommend('anthropic', [])).toEqual({ best: null, default: null, fast: null });
  });
  it('OpenAI: newest flagship and newest mini; Gemini: newest pro and flash', () => {
    const o = [{ id: 'gpt-5-mini' }, { id: 'gpt-5' }, { id: 'gpt-4o' }, { id: 'o3' }];
    expect(P.recommend('openai', o)).toEqual({ best: 'gpt-5', default: 'gpt-5', fast: 'gpt-5-mini' });
    const g = [{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }, { id: 'gemini-2.5-flash-lite' }];
    expect(P.recommend('gemini', g)).toEqual({ best: 'gemini-2.5-pro', default: 'gemini-2.5-flash', fast: 'gemini-2.5-flash-lite' });
  });
  it('OpenRouter recommends only Claude models it really lists; custom recommends nothing', () => {
    expect(P.recommend('openrouter', [{ id: 'anthropic/claude-sonnet-5-5' }, { id: 'meta/llama' }])).toEqual({ best: null, default: 'anthropic/claude-sonnet-5-5', fast: null });
    expect(P.recommend('custom', [{ id: 'x' }])).toEqual({ best: null, default: null, fast: null });
  });
});

describe('price estimates', () => {
  it('knows the Claude 5 family and says nothing about models it has no price for', () => {
    expect(prices.priceFor('claude-opus-5-5')).toMatchObject({ inPerM: 4, outPerM: 20, currency: 'USD' });
    expect(prices.priceFor('claude-sonnet-5-5')).toMatchObject({ inPerM: 2, outPerM: 10 });
    expect(prices.priceFor('claude-haiku-5-5')).toMatchObject({ inPerM: 0.1, outPerM: 0.5 });
    expect(prices.priceFor('claude-fable-5-1')).toMatchObject({ inPerM: 10, outPerM: 50 });
    expect(prices.priceFor('claude-sonnet-5-5-20261001')).toMatchObject({ inPerM: 2 });
    expect(prices.priceFor('anthropic/claude-opus-5-5')).toMatchObject({ inPerM: 4 });
  });
  it('unknown is null, never a guess', () => {
    for (const m of ['gpt-5', 'gemini-2.5-pro', 'claude-future-9', 'claude-opus-5-55', '', null]) expect(prices.priceFor(m)).toBeNull();
  });
  it('the table says it is an estimate and when it was written', () => {
    expect(prices.PRICES_NOTE).toMatch(/Estimates/);
    expect(prices.PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
