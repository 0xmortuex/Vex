// The clips list as it is read: when a clip was made, how big it is, and a
// name a person can recognise instead of the recorder's timestamp.
import { describe, it, expect } from 'vitest';
const { ClipsInbox: C } = require('../../src/renderer/js/clips-inbox.js');

const NOW = Date.UTC(2026, 8, 20, 12);

describe('what a clip says about itself', () => {
  it('when it was made, in the words a person uses', () => {
    expect(C.describe({ at: NOW, bytes: 1024 * 1024 }, NOW)).toMatch(/^just now/);
    expect(C.describe({ at: NOW - 60000, bytes: 1024 * 1024 }, NOW)).toMatch(/^a minute ago/);
    expect(C.describe({ at: NOW - 30 * 60000, bytes: 1024 * 1024 }, NOW)).toMatch(/^30 minutes ago/);
    expect(C.describe({ at: NOW - 3600000, bytes: 1024 * 1024 }, NOW)).toMatch(/^an hour ago/);
    expect(C.describe({ at: NOW - 5 * 3600000, bytes: 1024 * 1024 }, NOW)).toMatch(/^5 hours ago/);
    expect(C.describe({ at: NOW - 86400000, bytes: 1024 * 1024 }, NOW)).toMatch(/^yesterday/);
    expect(C.describe({ at: NOW - 3 * 86400000, bytes: 1024 * 1024 }, NOW)).toMatch(/^3 days ago/);
  });

  it('how big it is, in a unit that suits the size', () => {
    expect(C.describe({ at: NOW, bytes: 512 * 1024 * 1024 }, NOW)).toContain('512 MB');
    expect(C.describe({ at: NOW, bytes: 3 * 1024 * 1024 * 1024 }, NOW)).toContain('3.0 GB');
  });

  it('a recorder\u2019s filename is tidied into something readable', () => {
    expect(C.title({ name: 'Replay_2026-09-19_23-41-02.mp4' })).toBe('Replay 2026 09 19 23 41 02');
    expect(C.title({ name: 'valorant-ace.mkv' })).toBe('valorant ace');
    expect(C.title({ name: '.mp4' })).toBe('.mp4');
  });
});
