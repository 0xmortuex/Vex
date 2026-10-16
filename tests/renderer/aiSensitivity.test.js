// @vitest-environment node
//
// T1-042: nothing reaches the cloud AI without passing the sensitivity gate,
// and browsing history is local by default (the router used to send history
// search to the cloud).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VexSensitivity } from '../../src/renderer/js/ai-sensitivity.js';

// Real, checksum-valid test numbers (public examples, not anyone's).
const CARD = '4111 1111 1111 1111';
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const TCKN = '10000000146';

async function loadRouter() {
  vi.resetModules();
  const mod = await import('../../src/renderer/js/ai-router.js');
  return mod.AIRouter;
}

let saved;
beforeEach(() => { saved = { window: globalThis.window, Ollama: globalThis.Ollama, VexLedger: globalThis.VexLedger, VexMigrations: globalThis.VexMigrations, localStorage: globalThis.localStorage }; });
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  vi.restoreAllMocks();
});

describe('the scanners', () => {
  it('finds a card number, an IBAN and a TC ID number, and only when the checksum is right', () => {
    const r = VexSensitivity.redact(`pay ${CARD} to ${IBAN} id ${TCKN}`);
    expect(r.text).toBe('pay [card number removed] to [IBAN removed] id [ID number removed]');
    expect(r.found.map(f => f.id).sort()).toEqual(['IBAN', 'ID number', 'card number']);
    // Same shapes, wrong checksum: left alone.
    expect(VexSensitivity.redact('order 4111 1111 1111 1112 shipped').found).toEqual([]);
    expect(VexSensitivity.redact('number 10000000147').found).toEqual([]);
    expect(VexSensitivity.redact('GB82 WEST 1234 5698 7654 33').found).toEqual([]);
  });

  it('finds API keys, private keys, passwords and one-time codes', () => {
    const text = 'key sk-abcdefghijklmnopqrstuvwxyz123456 and ghp_' + 'a'.repeat(36) + ' password: hunter2 Your verification code is 482913. ' + '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----';
    const r = VexSensitivity.redact(text);
    expect(r.text).not.toMatch(/sk-abc|ghp_|hunter2|482913|MIIB/);
    expect(r.found.map(f => f.id).sort()).toEqual(['API key', 'one-time code', 'password', 'private key']);
  });

  it('does not treat ordinary numbers and talk about codes as secrets', () => {
    expect(VexSensitivity.redact('the code 1234 in my function, version 20241016, 12 items').found).toEqual([]);
  });

  it('scans every string in a request, not just the message', () => {
    const found = VexSensitivity.scanSecrets({ message: 'hi', pageContext: { text: 'card ' + CARD }, conversationHistory: [{ role: 'user', content: 'iban ' + IBAN }] });
    expect(found.map(f => f.id).sort()).toEqual(['IBAN', 'card number']);
  });

  it('redactRequest keeps the shape and the non-text fields', () => {
    const signal = new AbortController().signal;
    const out = VexSensitivity.redactRequest({ message: 'my card ' + CARD, n: 3, signal, pageContext: { title: 'x', url: 'https://a.example/' } });
    expect(out.message).toBe('my card [card number removed]');
    expect(out.n).toBe(3);
    expect(out.signal).toBe(signal);
    expect(out.pageContext.url).toBe('https://a.example/');
  });
});

describe('classify and decide', () => {
  it('history is asked about, and a background feature may not ask', () => {
    expect(VexSensitivity.decide('historySearch', { query: 'x', historyEntries: [{ url: 'https://a.example', title: 't' }] }).verdict).toBe('ask');
    expect(VexSensitivity.decide('historyIndex', { pageContext: { text: 'abc' } }).verdict).toBe('refuse');
  });

  it('history is recognised by its entries even under another feature name', () => {
    const d = VexSensitivity.decide('chat', { message: 'q', historyEntries: [{ url: 'https://a.example' }] });
    expect(d.classes.map(c => c.id)).toContain('history');
    expect(d.verdict).toBe('ask');
  });

  it('a vault page and a private tab never go; mail and a bank page ask', () => {
    expect(VexSensitivity.decide('chat', { pageContext: { url: 'https://vault.bitwarden.com/#/vault', text: 'x' } }).verdict).toBe('refuse');
    expect(VexSensitivity.decide('chat', { pageContext: { url: 'vex://vault', text: 'x' } }).verdict).toBe('refuse');
    expect(VexSensitivity.decide('chat', { pageContext: { url: 'https://example.com', text: 'x', private: true } }).verdict).toBe('refuse');
    expect(VexSensitivity.decide('summarize', { pageContext: { url: 'https://mail.google.com/mail/u/0/', text: 'x' } }).verdict).toBe('ask');
    expect(VexSensitivity.decide('summarize', { pageContext: { url: 'https://online.garanti.com.tr/', text: 'x' } }).verdict).toBe('ask');
    expect(VexSensitivity.decide('summarize', { pageContext: { url: 'https://www.paypal.com/myaccount', text: 'x' } }).verdict).toBe('ask');
  });

  it('a secret in the text means a redacted copy, and refuse still wins over redact', () => {
    expect(VexSensitivity.decide('chat', { message: 'my card ' + CARD }).verdict).toBe('redact');
    const both = VexSensitivity.decide('chat', { message: CARD, pageContext: { url: 'https://vault.bitwarden.com/', text: 'x' } });
    expect(both.verdict).toBe('refuse');
  });

  it('an ordinary question and an ordinary page go through untouched', () => {
    expect(VexSensitivity.decide('chat', { message: 'what is a monad?', pageContext: { url: 'https://en.wikipedia.org/wiki/Monad', title: 'Monad', text: 'In functional programming…' } }).verdict).toBe('send');
  });

  it('a private window is a reason only when the request carries pages', () => {
    globalThis.window = { VexTabPolicy: { isPrivateWindow: true } };
    expect(VexSensitivity.decide('chat', { message: 'hello' }).verdict).toBe('send');
    expect(VexSensitivity.decide('chat', { message: 'hello', pageContext: { url: 'https://example.com/', text: 'x' } }).verdict).toBe('refuse');
  });
});

describe('gate', () => {
  it('passes a clean request through unchanged and never asks', async () => {
    const confirm = vi.fn();
    globalThis.window = { vexConfirm: confirm };
    const req = { message: 'hi' };
    const r = await VexSensitivity.gate('chat', req, { canLocal: true });
    expect(r).toEqual({ action: 'send', request: req });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('history: shows what would leave, and "Send once" lets that one request go', async () => {
    const confirm = vi.fn(async () => true);
    globalThis.window = { vexConfirm: confirm };
    const req = { query: 'q', historyEntries: [{ url: 'https://a.example/', title: 'Secret plans', summary: 's' }] };
    const r = await VexSensitivity.gate('historySearch', req, { canLocal: true });
    expect(r.action).toBe('send');
    const arg = confirm.mock.calls[0][0];
    expect(arg.okLabel).toBe('Send once');
    expect(arg.html).toContain('What would leave');
    expect(arg.html).toContain('Secret plans');
    expect(arg.extra.label).toBe('Use the local model');
  });

  it('declining refuses with a vex-sensitive error, "use local" switches backend', async () => {
    globalThis.window = { vexConfirm: vi.fn(async () => false) };
    const req = { historyEntries: [{ url: 'https://a.example/' }] };
    await expect(VexSensitivity.gate('historySearch', req, { canLocal: true })).rejects.toMatchObject({ code: 'vex-sensitive' });
    globalThis.window = { vexConfirm: vi.fn(async (o) => { o.extra.run(); return false; }) };
    expect(await VexSensitivity.gate('historySearch', req, { canLocal: true })).toEqual({ action: 'local' });
  });

  it('a redacted copy is what leaves; the original is untouched', async () => {
    const confirm = vi.fn(async () => true);
    globalThis.window = { vexConfirm: confirm };
    const req = { message: 'my card ' + CARD };
    const r = await VexSensitivity.gate('chat', req, { canLocal: false });
    expect(r.action).toBe('send');
    expect(r.request.message).toBe('my card [card number removed]');
    expect(req.message).toContain('4111');
    expect(confirm.mock.calls[0][0].okLabel).toBe('Send redacted copy');
    expect(confirm.mock.calls[0][0].html).toContain('Redacted copy');
  });

  it('refuse has no dialog: local when there is one, an error when not', async () => {
    const confirm = vi.fn();
    globalThis.window = { vexConfirm: confirm };
    const req = { pageContext: { url: 'https://vault.bitwarden.com/', text: 'x' } };
    expect(await VexSensitivity.gate('chat', req, { canLocal: true })).toEqual({ action: 'local' });
    await expect(VexSensitivity.gate('chat', req, { canLocal: false })).rejects.toMatchObject({ code: 'vex-sensitive' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('with no way to ask, nothing is sent', async () => {
    delete globalThis.window;
    await expect(VexSensitivity.gate('historySearch', { historyEntries: [{ url: 'https://a.example/' }] }, { canLocal: false })).rejects.toMatchObject({ code: 'vex-sensitive' });
  });

  it('writes the decision to the ledger without the content', async () => {
    const note = vi.fn();
    globalThis.VexLedger = { note };
    globalThis.window = { vexConfirm: vi.fn(async () => false) };
    await expect(VexSensitivity.gate('historySearch', { historyEntries: [{ url: 'https://a.example/', title: 'Secret plans' }] }, { canLocal: false })).rejects.toThrow();
    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0][0].feature).toBe('ai-sensitivity');
    expect(JSON.stringify(note.mock.calls[0][0])).not.toContain('Secret plans');
  });
});

describe('AIRouter: history is local by default and the gate sits on every cloud call', () => {
  it('historySearch defaults to local', async () => {
    const AIRouter = await loadRouter();
    expect(AIRouter.getRoutingPrefs().historySearch).toBe('local');
  });

  it('callOn("cloud") (the two-model compare) goes through the gate', async () => {
    globalThis.window = { VexConfig: { aiWorkerUrl: () => 'https://w.example', fetchAI: vi.fn() }, vexConfirm: vi.fn(async () => false) };
    const AIRouter = await loadRouter();
    await expect(AIRouter.callOn('cloud', 'historySearch', { historyEntries: [{ url: 'https://a.example/' }] })).rejects.toMatchObject({ code: 'vex-sensitive' });
    expect(globalThis.window.VexConfig.fetchAI).not.toHaveBeenCalled();
  });

  it('a declined request is not retried on another backend', async () => {
    globalThis.window = { VexConfig: { aiWorkerUrl: () => 'https://w.example', fetchAI: vi.fn() }, vexConfirm: vi.fn(async () => false) };
    globalThis.Ollama = { ping: vi.fn(async () => true), generate: vi.fn(), chat: vi.fn() };
    const AIRouter = await loadRouter();
    AIRouter.setRoutingPrefs({ historySearch: 'cloud' });
    await expect(AIRouter.callAI('historySearch', { query: 'q', historyEntries: [{ url: 'https://a.example/' }] })).rejects.toMatchObject({ code: 'vex-sensitive' });
    expect(globalThis.window.VexConfig.fetchAI).not.toHaveBeenCalled();
    expect(globalThis.Ollama.generate).not.toHaveBeenCalled();
  });

  it('a request reshaped by the Turkish/English profile (Wave 2) still passes the gate before the cloud', async () => {
    const fetchAI = vi.fn();
    globalThis.window = {
      VexConfig: { aiWorkerUrl: () => 'https://w.example', fetchAI }, vexConfirm: vi.fn(async () => false),
      VexLocaleTranslate: { shapeRequest: (feature, req) => ({ ...req, message: String(req.message || '') + ' (answer in Turkish)' }) },
    };
    globalThis.Ollama = { ping: vi.fn(async () => true), generate: vi.fn(), chat: vi.fn() };
    const AIRouter = await loadRouter();
    AIRouter.setRoutingPrefs({ chat: 'cloud' });
    await expect(AIRouter.callAI('chat', { message: 'my card ' + CARD, historyEntries: [{ url: 'https://a.example/' }] })).rejects.toMatchObject({ code: 'vex-sensitive' });
    expect(fetchAI).not.toHaveBeenCalled();
  });

  it('an allowed request reaches the worker and carries the redacted text', async () => {
    const fetchAI = vi.fn(async () => ({ ok: true, json: async () => ({ result: 'ok' }) }));
    globalThis.window = { VexConfig: { aiWorkerUrl: () => 'https://w.example', fetchAI }, vexConfirm: vi.fn(async () => true) };
    const AIRouter = await loadRouter();
    const out = await AIRouter.callOn('cloud', 'chat', { message: 'my card ' + CARD });
    expect(out.backend).toBe('cloud');
    const sent = JSON.parse(fetchAI.mock.calls[0][1].body);
    expect(sent.message).toBe('my card [card number removed]');
  });
});

describe('migrating a saved routing table', () => {
  function withStore(saved) {
    const mem = new Map(saved ? [['vex.aiRouting', JSON.stringify(saved)]] : []);
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    return mem;
  }
  const OLD = { chat: 'auto', summarize: 'auto', translate: 'cloud', explain: 'auto', historyIndex: 'local', historySearch: 'cloud', agent: 'cloud', multiTab: 'cloud', groupTabs: 'auto', digest: 'local' };

  it('a table that is exactly the old defaults moves history search to local', async () => {
    const mem = withStore(OLD);
    const AIRouter = await loadRouter();
    expect(AIRouter.migrateHistoryRouting()).toEqual({ changed: true });
    expect(JSON.parse(mem.get('vex.aiRouting')).historySearch).toBe('local');
    expect(JSON.parse(mem.get('vex.aiRouting')).agent).toBe('cloud');
  });

  it('a table the person changed is left exactly as it is', async () => {
    const mem = withStore({ ...OLD, chat: 'local' });
    const AIRouter = await loadRouter();
    expect(AIRouter.migrateHistoryRouting()).toEqual({ changed: false, kept: true });
    expect(JSON.parse(mem.get('vex.aiRouting')).historySearch).toBe('cloud');
  });

  it('nothing saved, or history already local: nothing to do', async () => {
    withStore(null);
    let AIRouter = await loadRouter();
    expect(AIRouter.migrateHistoryRouting()).toEqual({ changed: false });
    withStore({ ...OLD, historySearch: 'local' });
    AIRouter = await loadRouter();
    expect(AIRouter.migrateHistoryRouting()).toEqual({ changed: false });
  });
});
