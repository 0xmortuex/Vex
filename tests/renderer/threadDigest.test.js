// @vitest-environment jsdom
//
// T2-031: js/thread-digest.js remembers what was read per address (fingerprints only)
// and digests only the new paragraphs, through the long-document engine.
import { describe, it, expect, beforeEach } from 'vitest';

const { VexLongDoc } = require('../../src/renderer/js/longdoc-engine.js');
globalThis.VexLongDoc = VexLongDoc;
const { VexThreadDigest: T } = require('../../src/renderer/js/thread-digest.js');

beforeEach(() => { localStorage.clear(); delete globalThis.GameMode; });

const THREAD = 'Alice: we should ship on Friday.\n\nBob: agreed, but who writes the notes?\n\nCarol: I will.';
const call = async () => '{"reply":"Decisions:\\n- ship Friday\\nOpen questions:\\n- none\\nWhat is new:\\n- Carol writes notes"}';

describe('addresses and paragraphs', () => {
  it('forgets the query and fragment', () => {
    expect(T.keyOf('https://github.com/a/b/issues/3?x=1#c5')).toBe('https://github.com/a/b/issues/3');
    expect(() => T.keyOf('file:///x')).toThrow(/web address/);
  });
  it('splits paragraphs, or lines when there are no blank lines', () => {
    expect(T.blocks(THREAD)).toHaveLength(3);
    expect(T.blocks('one\ntwo\nthree')).toHaveLength(3);
  });
  it('finds the private hosts', () => {
    expect(T.isPrivateHost('https://discord.com/channels/1/2')).toBe(true);
    expect(T.isPrivateHost('https://mail.google.com/mail/u/0')).toBe(true);
    expect(T.isPrivateHost('https://github.com/a/b')).toBe(false);
  });
});

describe('since I last read', () => {
  it('summarises everything the first time, then only what is new', async () => {
    const key = T.keyOf('https://example.com/thread/1');
    const prompts = [];
    const spy = async (p) => { prompts.push(p); return call(); };
    const first = await T.digest(THREAD, key, { call: spy });
    expect(first.first).toBe(true);
    expect(first.newCount).toBe(3);
    expect(first.sections.decisions).toEqual(['ship Friday']);
    expect(first.sections.fresh).toEqual(['Carol writes notes']);
    const again = await T.digest(THREAD, key, { call: spy });
    expect(again.empty).toBe(true);
    const grown = await T.digest(THREAD + '\n\nDave: one more thing about the logo.', key, { call: spy });
    expect(grown.newCount).toBe(1);
    expect(prompts[prompts.length - 1]).toContain('Dave');
    expect(prompts[prompts.length - 1]).not.toContain('Alice');
  });
  it('stores fingerprints, never the text', async () => {
    await T.digest(THREAD, 'https://example.com/t', { call });
    const raw = localStorage.getItem('vex.threadDigest');
    expect(raw).not.toContain('Alice');
    expect(JSON.parse(raw)['https://example.com/t'].hashes).toHaveLength(3);
  });
  it('does not mark anything read when the digest fails', async () => {
    await expect(T.digest(THREAD, 'https://example.com/f', { call: async () => { throw new Error('down'); } })).rejects.toThrow(/down/);
    expect(T.record('https://example.com/f')).toBeNull();
  });
  it('forget removes one or all', async () => {
    await T.digest(THREAD, 'k1', { call });
    await T.digest(THREAD, 'k2', { call });
    T.forget('k1');
    expect(T.count()).toBe(1);
    T.forget(null);
    expect(T.count()).toBe(0);
  });
  it('keeps at most 200 addresses', () => {
    for (let i = 0; i < 205; i++) T.markRead('k' + i, [{ h: 'a' + i }], i + 1);
    expect(T.count()).toBe(200);
    expect(T.record('k0')).toBeNull();
  });
  it('a damaged record raises, it is not replaced silently', () => {
    localStorage.setItem('vex.threadDigest', '{oops');
    expect(() => T.count()).toThrow(/damaged/);
  });
  it('is off when switched off', async () => {
    T.setEnabled(false);
    await expect(T.digest(THREAD, 'k', { call })).rejects.toThrow(/switched off/);
  });
});

describe('parseSections', () => {
  it('reads the three headings and does not take a news sentence for a heading', () => {
    const s = T.parseSections('Decisions:\n- a\n- b\nOpen questions:\n1. who?\nWhat is new:\n- New feature shipped\nNew logo looks good');
    expect(s.decisions).toEqual(['a', 'b']);
    expect(s.questions).toEqual(['who?']);
    expect(s.fresh).toEqual(['New feature shipped', 'New logo looks good']);
  });
});
