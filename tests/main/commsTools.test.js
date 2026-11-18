// Wave 3, community and chat tools, main process: the owner's own announcement webhook (T3-050)
// and the Vencord bridge file receiver (T3-005). Tested against a stand-in fetch and a temp folder.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../../src/main/comms-tools.js');

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/' + 'A'.repeat(40);

function memStore() {
  const files = new Map();
  return {
    files,
    async read(file, fallback) { return files.has(file) ? JSON.parse(JSON.stringify(files.get(file))) : fallback(); },
    async write(file, value) { files.set(file, JSON.parse(JSON.stringify(value))); },
    async clear(file) { files.delete(file); },
  };
}

let dir, store, calls, respond, picked, asked, answer;
function make(over = {}) {
  return T.createCommsTools({
    secretStore: store, webhookFile: 'hook.enc',
    fetch: async (url, init) => { calls.push({ url, init }); return respond(url, init); },
    confirm: async (q) => { asked.push(q); return answer; }, now: () => 1_700_000_000_000, ...over,
  });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-comms-'));
  store = memStore(); calls = []; picked = null; asked = []; answer = true;
  respond = () => ({ status: 204 });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('T3-050 webhook', () => {
  it('accepts only a Discord webhook address, and never hands it back', async () => {
    const c = make();
    await expect(c.webhookSet('https://evil.example/api/webhooks/1/2')).rejects.toThrow(/not a Discord webhook/);
    await expect(c.webhookSet('http://discord.com/api/webhooks/123456789012345678/' + 'A'.repeat(40))).rejects.toThrow();
    const r = await c.webhookSet(HOOK);
    expect(r).toEqual({ ok: true, has: true, label: 'Discord webhook ending 5678' });
    const st = await c.webhookStatus();
    expect(st.has).toBe(true);
    expect(JSON.stringify(st)).not.toContain('AAAA');
    expect(JSON.stringify(r)).not.toContain('AAAA');
  });

  it('posts exactly the payload the window shows, with no pings unless asked', async () => {
    const c = make();
    await c.webhookSet(HOOK);
    const res = await c.webhookSend({ content: 'Patch 1.2 is out' });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(HOOK);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.body).toBe(T.buildPayload('Patch 1.2 is out', false));
    expect(JSON.parse(calls[0].init.body)).toEqual({ content: 'Patch 1.2 is out', allowed_mentions: { parse: [] } });
    await c.webhookSend({ content: 'hi @everyone', allowEveryone: true });
    expect(JSON.parse(calls[1].init.body).allowed_mentions.parse).toEqual(['everyone']);
  });

  it('a post that pings everyone is confirmed by main: host only, first 200 characters, refused when declined', async () => {
    const c = make();
    await c.webhookSet(HOOK);
    answer = false;
    await expect(c.webhookSend({ content: 'x'.repeat(300), allowEveryone: true })).rejects.toThrow(/cancelled/);
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(1);
    expect(asked[0].message).toContain('discord.com');
    expect(asked[0].message).not.toContain('AAAA');
    expect(asked[0].message).not.toContain('/api/webhooks');
    expect(asked[0].message).toContain('x'.repeat(200));
    expect(asked[0].message).not.toContain('x'.repeat(201));
    answer = true;
    await c.webhookSend({ content: 'hello', allowEveryone: true });
    expect(calls).toHaveLength(1);
  });

  it('a plain post is not asked about again (the window already showed it)', async () => {
    const c = make();
    await c.webhookSet(HOOK);
    await c.webhookSend({ content: 'hello' });
    expect(asked).toHaveLength(0);
  });

  it('refuses to be made without a confirm box', () => {
    expect(() => make({ confirm: undefined })).toThrow(/confirm box/);
  });

  it('the window builds the same body as main (so the confirm shows the truth)', () => {
    globalThis.CommsStore = require('../../src/renderer/js/comms-store.js').CommsStore;
    const { AnnounceComposer } = require('../../src/renderer/js/announce-composer.js');
    for (const [text, every] of [['hello', false], ['two\nlines "quoted" \\ back', true], ['unicode: ğüşiöç', false]]) {
      expect(AnnounceComposer.payloadText(text, every)).toBe(T.buildPayload(text, every));
    }
  });

  it('refuses nothing-to-send, too long, no webhook, and does not send in those cases', async () => {
    const c = make();
    await expect(c.webhookSend({ content: 'x' })).rejects.toThrow(/no webhook/);
    await c.webhookSet(HOOK);
    await expect(c.webhookSend({ content: '   ' })).rejects.toThrow(/nothing to post/);
    await expect(c.webhookSend({ content: 'x'.repeat(2001) })).rejects.toThrow(/2000/);
    expect(calls).toHaveLength(0);
  });

  it('reports a failed post without leaking the address', async () => {
    const c = make();
    await c.webhookSet(HOOK);
    respond = () => { throw new Error('connect ECONNREFUSED ' + HOOK); };
    let err;
    try { await c.webhookSend({ content: 'x' }); } catch (e) { err = e; }
    expect(err.message).toMatch(/could not be reached/);
    expect(err.message).not.toContain(HOOK);
    expect(err.message).not.toContain('AAAA');
    respond = () => ({ status: 404 });
    await expect(c.webhookSend({ content: 'x' })).rejects.toThrow(/no longer accepts/);
    respond = () => ({ status: 429 });
    await expect(c.webhookSend({ content: 'x' })).rejects.toThrow(/wait/);
    respond = () => ({ status: 500 });
    await expect(c.webhookSend({ content: 'x' })).rejects.toThrow(/500/);
  });

  it('clearing removes it', async () => {
    const c = make();
    await c.webhookSet(HOOK);
    await c.webhookClear();
    expect((await c.webhookStatus()).has).toBe(false);
  });
});
