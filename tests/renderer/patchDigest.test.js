// @vitest-environment jsdom
//
// js/patch-digest.js (T3-007): sentences copied from patch notes that name a watched hero or item.
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.VexMediaKit = require('../../src/renderer/js/media-kit.js').VexMediaKit;
const { VexPatchDigest } = require('../../src/renderer/js/patch-digest.js');

const NOTES = [
  'Patch 14.2 notes',
  'Reaper: Shotgun spread reduced from 5.5 to 5.0 degrees.',
  'Ana: Biotic Grenade cooldown increased by 1 second.',
  'Banana Bread event begins this week.',
  'General: fixed a crash on the main menu.',
  'Reaper: Wraith Form now lasts 3 seconds.',
].join('\n');

beforeEach(() => {
  localStorage.clear();
  delete globalThis.GameSession; delete globalThis.GameMode; delete globalThis.PatchRadar; delete globalThis.AgentTools;
  delete globalThis.PageWatch; delete globalThis.VexAttention; delete globalThis.GameLoadouts;
  VexPatchDigest.setEnabled(true);
  window.showToast = vi.fn();
});

describe('keeping only what names something you watch', () => {
  it('quotes the sentence exactly as written, most-mentioned names first, at most five', () => {
    const d = VexPatchDigest.digest(NOTES, ['Ana', 'Reaper']);
    expect(d[0]).toEqual({ term: 'Reaper', quote: 'Reaper: Shotgun spread reduced from 5.5 to 5.0 degrees.' });
    expect(d.map(b => b.term)).toEqual(['Reaper', 'Ana', 'Reaper']);
    expect(VexPatchDigest.digest(NOTES.repeat(5), ['Reaper', 'Ana'], 5)).toHaveLength(5);
  });
  it('matches a whole name only: Ana is not Banana', () => {
    const d = VexPatchDigest.digest(NOTES, ['Ana']);
    expect(d).toHaveLength(1);
    expect(d[0].quote).toMatch(/^Ana: Biotic/);
  });
  it('says nothing when no watched name appears, and invents nothing', () => {
    expect(VexPatchDigest.digest(NOTES, ['Mercy'])).toEqual([]);
    for (const b of VexPatchDigest.digest(NOTES, ['Reaper', 'Ana'])) expect(NOTES).toContain(b.quote);
  });
  it('shortens a very long sentence with a clear mark and keeps the start verbatim', () => {
    const long = 'Reaper ' + 'x'.repeat(400);
    const q = VexPatchDigest.digest(long, ['Reaper'])[0].quote;
    expect(q.endsWith('...')).toBe(true);
    expect(long.startsWith(q.slice(0, -3))).toBe(true);
  });
});

describe('the watch list', () => {
  it('cleans names: 2 to 40 characters, no duplicates in any case, at most 40', () => {
    expect(VexPatchDigest.cleanTerms('Reaper, reaper; Ana\nShotgun')).toEqual(['Reaper', 'Ana', 'Shotgun']);
    expect(() => VexPatchDigest.cleanTerms('a')).toThrow(/2 to 40/);
    expect(() => VexPatchDigest.cleanTerms(Array.from({ length: 41 }, (_, i) => 'name' + i))).toThrow(/at most 40/i);
  });
  it('adds the names on loadout cards only when allowed and when loadouts exist', () => {
    VexPatchDigest.setTerms('g1', 'Reaper');
    globalThis.GameLoadouts = { forGame: () => [{ items: ['Shotgun - main weapon', 'Ana'] }] };
    expect(VexPatchDigest.termsFor('g1')).toEqual(['Reaper']);
    VexPatchDigest.setUseLoadouts(true);
    expect(VexPatchDigest.termsFor('g1')).toEqual(['Reaper', 'Shotgun', 'Ana']);
  });
  it('reads the newest item of a feed as text', () => {
    const feed = '<rss><channel><item><title>Patch 14.2</title><description><![CDATA[<p>Reaper: more health.</p><p>Ana: less.</p>]]></description></item><item><title>Old</title></item></channel></rss>';
    const text = VexPatchDigest.feedItemText(feed, (h) => ({ text: h.replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '') }));
    expect(text).toContain('Reaper: more health.');
    expect(text).not.toContain('Old');
    expect(VexPatchDigest.feedItemText('<html></html>', () => ({ text: '' }))).toBe('');
  });
});

describe('hearing about a patch', () => {
  const setup = () => {
    globalThis.GameSession = { active: false, games: () => [{ id: 'g1', name: 'Overwatch', exe: 'x.exe' }] };
    globalThis.PatchRadar = { pages: () => [{ watchId: 'w1', url: 'https://example.com/notes' }] };
    globalThis.PageWatch = { refusalFor: () => '' };
    globalThis.AgentTools = { _get: vi.fn(async () => ({ body: NOTES })), htmlToText: (h) => ({ text: h }) };
    VexPatchDigest.setTerms('g1', 'Reaper');
  };
  it('does nothing when switched off or when nothing is watched for the game', () => {
    setup();
    VexPatchDigest.setEnabled(false);
    expect(VexPatchDigest.onPatch({ gameId: 'g1', watchId: 'w1' })).toBe('off');
    VexPatchDigest.setEnabled(true);
    expect(VexPatchDigest.onPatch({ gameId: 'other', watchId: 'w1' })).toBe('nothing-watched');
  });
  it('waits while a game runs and makes the digest, once, after it', async () => {
    setup();
    globalThis.GameSession.active = true;
    expect(VexPatchDigest.onPatch({ gameId: 'g1', watchId: 'w1', title: 'Patch 14.2' })).toBe('waiting');
    expect(globalThis.AgentTools._get).not.toHaveBeenCalled();
    expect(await VexPatchDigest.flush()).toEqual([]);
    globalThis.GameSession.active = false;
    const made = await VexPatchDigest.flush();
    expect(made).toHaveLength(1);
    expect(made[0].bullets.map(b => b.term)).toEqual(['Reaper', 'Reaper']);
    expect(window.showToast).toHaveBeenCalledTimes(1);
    expect(await VexPatchDigest.flush()).toEqual([]);
    expect(VexPatchDigest.digests()).toHaveLength(1);
  });
  it('tells nothing when the patch does not name a watched thing', async () => {
    setup();
    VexPatchDigest.setTerms('g1', 'Mercy');
    expect(await VexPatchDigest.make('g1')).toBeNull();
  });
  it('refuses a page patch radar would not watch', async () => {
    setup();
    globalThis.PageWatch.refusalFor = () => 'Only a web page can be read';
    await expect(VexPatchDigest.make('g1')).rejects.toThrow(/Only a web page/);
  });
  it('names a missing patch notes page instead of guessing', async () => {
    setup();
    globalThis.PatchRadar.pages = () => [];
    await expect(VexPatchDigest.make('g1')).rejects.toThrow(/no patch notes page/);
  });
});
