// The data shape of the VexBridge Vencord plugin (tools/vencord-bridge/vexBridge/bridgeData.ts) against the host
// reader in this repository (sanitizeBridge in src/main/comms-tools.js). The plugin itself is built elsewhere.
import { describe, it, expect } from 'vitest';
import { buildBridge, serialise, messageUrl, SCHEMA } from '../../tools/vencord-bridge/vexBridge/bridgeData.ts';

const { sanitizeBridge, LIMITS, MAX_BRIDGE_BYTES } = require('../../src/main/comms-tools');

const msg = (i, extra = {}) => ({ id: String(1000000000000000 + i), author: 'Sam', text: 'hello ' + i, ts: 1760000000000 + i, channelId: '111111111111111111', channelName: 'dev', guildName: 'My Server', guildId: '222222222222222222', ...extra });

describe('what the plugin writes is what Vex reads', () => {
  it('a normal document passes the reader with nothing skipped', () => {
    const doc = buildBridge({ accountName: 'mortuex', now: 1760000009999, mentions: [msg(1), msg(2)], replies: [msg(3)], channels: [{ channelId: '111111111111111111', name: 'dev', guildName: 'My Server', messages: [msg(4), msg(5)] }] });
    const read = sanitizeBridge(JSON.parse(serialise(doc)));
    expect(doc.schema).toBe(SCHEMA);
    expect(read.skipped).toBe(0);
    expect(read.account).toBe('mortuex');
    expect(read.mentions.map(m => m.id)).toEqual([String(1000000000000002), String(1000000000000001)]);
    expect(read.mentions[0].url).toBe('https://discord.com/channels/222222222222222222/111111111111111111/1000000000000002');
    expect(read.channels[0].messages).toHaveLength(2);
  });
  it('writes only discord.com/channels links, @me for a DM, and no link when ids are missing', () => {
    expect(messageUrl(msg(1, { guildId: undefined }))).toContain('/channels/@me/111111111111111111/');
    expect(messageUrl(msg(1, { channelId: '' }))).toBe('');
    expect(messageUrl(msg(1, { id: 'abc' }))).toBe('');
  });
  it('stays inside the limits so the reader counts nothing as skipped', () => {
    const many = Array.from({ length: 300 }, (_, i) => msg(i));
    const channels = Array.from({ length: 25 }, (_, c) => ({ channelId: String(100000 + c), name: 'c' + c, messages: many.slice(0, 150) }));
    const doc = buildBridge({ accountName: 'x', now: 1, mentions: many, replies: many, channels });
    expect(doc.mentions).toHaveLength(LIMITS.mentions);
    expect(doc.channels).toHaveLength(LIMITS.channels);
    expect(doc.channels[0].messages).toHaveLength(LIMITS.perChannel);
    expect(sanitizeBridge(JSON.parse(serialise(doc))).skipped).toBe(0);
  });
  it('drops entries the reader would drop, cuts long text to one line, and orders newest first', () => {
    const doc = buildBridge({ accountName: 'x', now: 1, mentions: [msg(1, { text: '   ' }), msg(2, { id: '' }), msg(3, { ts: NaN }), msg(4, { text: 'a\n\nb ' + 'z'.repeat(5000) }), msg(5)], replies: [], channels: [] });
    expect(doc.mentions.map(m => m.id)).toEqual([String(1000000000000005), String(1000000000000004)]);
    expect(doc.mentions[1].text.length).toBe(2000);
    expect(doc.mentions[1].text.startsWith('a b ')).toBe(true);
    expect(sanitizeBridge(doc).skipped).toBe(0);
  });
  it('a document too big for 1 MB is shrunk, never written cut, and never over what Vex accepts', () => {
    const fat = Array.from({ length: 200 }, (_, i) => msg(i, { text: 'w'.repeat(2000) }));
    const channels = Array.from({ length: 20 }, (_, c) => ({ channelId: String(100000 + c), name: 'c', messages: fat.slice(0, 100) }));
    const text = serialise(buildBridge({ accountName: 'x', now: 1, mentions: fat, replies: fat, channels }));
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_BRIDGE_BYTES);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(() => serialise(buildBridge({ accountName: 'x', now: 1, mentions: fat, replies: [], channels: [] }), 100)).toThrow(/1 MB/);
  });
});
