// @vitest-environment jsdom
// T3-002 (Wave 6): a text clip kept with the capture box's hotkey has no page; the page that was in front in
// Vex is recorded as its source (main keeps the entry, the window knows the tab) and kept under Sources.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createCaptureInbox } = require('../../src/main/capture-inbox.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
const { TextClips: TC } = require('../../src/renderer/js/text-clips.js');

function inbox(clock = { t: 1_000_000 }) {
  const files = new Map();
  const fsImpl = {
    readFileSync: (f) => { if (!files.has(f)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; } return files.get(f); },
    writeFileSync: (f, d) => files.set(f, d), renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }, mkdirSync() {},
  };
  return { box: createCaptureInbox({ file: '/x/clips.json', fsImpl, now: () => clock.t }), clock };
}

describe('main: stamping a clip entry', () => {
  it('attaches the page once, with no credentials or fragment, and only to a fresh clip', () => {
    const { box, clock } = inbox();
    const { entry } = box.add('mitochondria is the powerhouse', { source: 'capture' });
    const s = box.stamp(entry.id, { url: 'https://user:pw@en.wikipedia.org/wiki/Mitochondrion#History', title: '  Mitochondrion  - Wikipedia ' });
    expect(s.from).toEqual({ url: 'https://en.wikipedia.org/wiki/Mitochondrion', title: 'Mitochondrion - Wikipedia' });
    expect(box.stamp(entry.id, { url: 'https://other.example/' })).toBe(null);                       // already stamped
    expect(box.list()[0].from.url).toBe('https://en.wikipedia.org/wiki/Mitochondrion');
    const second = box.add('later clip', { source: 'capture' }).entry;
    clock.t += 5 * 60000;
    expect(box.stamp(second.id, { url: 'https://a.test/' })).toBe(null);                              // too old to be "the page in front"
    expect(box.stamp('nope', { url: 'https://a.test/' })).toBe(null);
  });
  it('refuses an address that is not a web page, and a stamp with no address', () => {
    const { box } = inbox();
    const { entry } = box.add('x', {});
    expect(() => box.stamp(entry.id, { url: 'file:///C:/secret.txt' })).toThrow(/Only a web page/);
    expect(() => box.stamp(entry.id, { url: 'not a url' })).toThrow(/not valid/);
    expect(box.stamp(entry.id, {})).toBe(null);
  });
  it('is a bounded, UI-only channel', () => {
    expect(() => validate('clips-inbox:stamp', ['cl_abc', { url: 'https://a.test/', title: 't' }])).not.toThrow();
    expect(() => validate('clips-inbox:stamp', ['cl_abc', { url: 'x'.repeat(2000) }])).toThrow(/Invalid payload/);
    expect(() => validate('clips-inbox:stamp', [5, { url: 'https://a.test/' }])).toThrow(/Invalid payload/);
    expect(() => validate('clips-inbox:stamp', ['cl_abc', {}])).toThrow(/Invalid payload/);
    expect(UI_ONLY_CHANNELS.has('clips-inbox:stamp')).toBe(true);
  });
});

describe('window: the stamp comes from the tab in front', () => {
  let prefs;
  beforeEach(() => {
    localStorage.clear();
    prefs = { enabled: true, autoStamp: true };
    window.vex = { clipsInboxStamp: vi.fn(async () => ({ ok: true, stamped: true })), clipsInboxList: vi.fn(async () => ({ ok: true, items: [{ id: 'cl_1', text: 'a kept line', at: Date.now() }] })) };
    globalThis.VexSources = { prefs: () => prefs, sourceTab: vi.fn(async () => ({ url: 'https://en.wikipedia.org/wiki/X', title: 'X' })), keepPassage: vi.fn(async () => ({})) };
  });

  it('does nothing until the Sources auto-stamp switch is on, or when Sources are off', async () => {
    prefs = { enabled: true, autoStamp: false };
    expect(await TC.stampNew({ id: 'cl_1', source: 'capture' })).toBe(null);
    prefs = { enabled: false, autoStamp: true };
    expect(await TC.stampNew({ id: 'cl_1', source: 'capture' })).toBe(null);
    expect(window.vex.clipsInboxStamp).not.toHaveBeenCalled();
    expect(VexSources.sourceTab).not.toHaveBeenCalled();
  });

  it('stamps a captured clip with the page and keeps the page as a source', async () => {
    const meta = await TC.stampNew({ id: 'cl_1', source: 'capture' });
    expect(meta).toEqual({ url: 'https://en.wikipedia.org/wiki/X', title: 'X' });
    expect(window.vex.clipsInboxStamp).toHaveBeenCalledWith('cl_1', meta);
    expect(VexSources.keepPassage).toHaveBeenCalledWith({ text: 'a kept line', kind: 'clip' });
  });

  it('ignores clips that were not just captured, and stamps nothing when no ordinary page is in front', async () => {
    expect(await TC.stampNew({ id: 'cl_1', source: 'stamp' })).toBe(null);
    expect(await TC.stampNew(undefined)).toBe(null);
    VexSources.sourceTab = vi.fn(async () => ({ reason: 'Sources are not kept from private and Tor tabs' }));
    expect(await TC.stampNew({ id: 'cl_1', source: 'capture' })).toBe(null);
    expect(window.vex.clipsInboxStamp).not.toHaveBeenCalled();
  });

  it('does not keep a source when main refused the stamp (already stamped or too old)', async () => {
    window.vex.clipsInboxStamp = vi.fn(async () => ({ ok: true, stamped: false }));
    expect(await TC.stampNew({ id: 'cl_1', source: 'capture' })).toBe(null);
    expect(VexSources.keepPassage).not.toHaveBeenCalled();
  });

  it('is inert when Sources is not loaded', async () => {
    delete globalThis.VexSources;
    expect(TC.stampEnabled()).toBe(false);
    expect(await TC.stampNew({ id: 'cl_1', source: 'capture' })).toBe(null);
  });
});
