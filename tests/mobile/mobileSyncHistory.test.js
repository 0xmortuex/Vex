// @vitest-environment jsdom
//
// History through sync. It is the one record that is merged instead of
// overwritten — two devices both browsing is the normal case — and the one most
// worth being able to turn off, so both deserve pinning down. The shape matters
// too: the desktop reads these rows with its own history panel, so they have to
// be the desktop's rows.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
window.VexStore = {
  get: (key, fallback) => (key in store ? store[key] : fallback),
  set: async (key, value) => { store[key] = value; return value; }
};

let recent = [];
const added = [];
window.VexHistory = {
  recent: limit => recent.slice(0, limit),
  addRaw: vi.fn(async entry => { added.push(entry); return entry; })
};
window.VexCollections = {
  bookmarks: { all: () => [] }, sessions: { all: () => [] },
  reading: { all: () => [] }, quick: { all: () => [] }
};
window.VexTabStore = { normal: () => [] };
window.VexBridge = { vaultGet: async () => '', vaultSet: async () => {} };
window.VexDB = { scan: async () => [] };
window.SyncCrypto = { };
window.SyncRecords = { };

const { VexSync } = require('../../mobile/www/js/sync.js');

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  recent = [
    { url: 'https://a.example/', title: 'A', at: Date.parse('2026-10-01T09:00:00Z'), icon: 'data:,' },
    { url: 'https://b.example/', title: 'B', at: Date.parse('2026-10-01T08:00:00Z'), icon: '' }
  ];
  added.length = 0;
  window.VexHistory.addRaw.mockClear();
});

describe('what goes out', () => {
  it('uses the desktop’s own entry shape', () => {
    const [first] = VexSync.historyForSync();
    expect(first).toMatchObject({ url: 'https://a.example/', title: 'A', favicon: 'data:,' });
    expect(first.visitedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(typeof first.id).toBe('string');
  });

  it('gives the same visit the same id every time, so a merge sees one', () => {
    const once = VexSync.historyForSync()[0].id;
    const twice = VexSync.historyForSync()[0].id;
    expect(once).toBe(twice);
  });

  it('sends nothing at all when history sync is off', async () => {
    await VexStore.set('vex.syncHistory', false);
    expect(VexSync.historyForSync()).toBeUndefined();
  });

  it('never sends more than the slice', () => {
    recent = Array.from({ length: 2000 }, (unused, at) => ({
      url: 'https://x.example/' + at, title: 'x', at: 1700000000000 + at
    }));
    expect(VexSync.historyForSync().length).toBeLessThanOrEqual(VexSync.HISTORY_SLICE);
  });
});

describe('what comes in', () => {
  it('adds a visit this device does not have', async () => {
    const count = await VexSync.mergeHistory([
      { url: 'https://new.example/', title: 'New', visitedAt: '2026-10-01T07:00:00Z', favicon: '' }
    ]);
    expect(count).toBe(1);
    expect(added[0]).toMatchObject({ url: 'https://new.example/', title: 'New' });
  });

  it('does not add a visit to the same page in the same hour', async () => {
    const count = await VexSync.mergeHistory([
      { url: 'https://a.example/', title: 'A', visitedAt: '2026-10-01T09:12:00Z' }
    ]);
    expect(count).toBe(0);
    expect(window.VexHistory.addRaw).not.toHaveBeenCalled();
  });

  it('does add the same page visited in a different hour', async () => {
    const count = await VexSync.mergeHistory([
      { url: 'https://a.example/', title: 'A', visitedAt: '2026-10-01T14:00:00Z' }
    ]);
    expect(count).toBe(1);
  });

  it('merges nothing when history sync is off', async () => {
    await VexStore.set('vex.syncHistory', false);
    const count = await VexSync.mergeHistory([
      { url: 'https://new.example/', visitedAt: '2026-10-01T07:00:00Z' }
    ]);
    expect(count).toBe(0);
  });

  it('ignores rows with no url or no time rather than inventing one', async () => {
    const count = await VexSync.mergeHistory([
      { title: 'no url', visitedAt: '2026-10-01T07:00:00Z' },
      { url: 'https://c.example/', title: 'no time' },
      { url: 'https://c.example/', title: 'rubbish time', visitedAt: 'not a date' }
    ]);
    expect(count).toBe(0);
  });

  it('takes nothing from something that is not a list', async () => {
    expect(await VexSync.mergeHistory(undefined)).toBe(0);
    expect(await VexSync.mergeHistory('history')).toBe(0);
  });
});
