// Reading a folder of recordings. It reads and nothing else, so what matters
// is that it reads the right things: videos only, newest first, one folder
// deep, and a file that vanishes mid-read does not take the list down.
import { describe, it, expect } from 'vitest';
const path = require('path');
const { list, guesses } = require('../../src/main/clips.js');

const entry = (name, isFile = true) => ({ name, isFile: () => isFile, isDirectory: () => !isFile });
const NOW = Date.UTC(2026, 8, 20, 12);

function fakeFs(entries, stats) {
  return {
    readdirSync: () => entries,
    statSync: (full) => {
      const name = path.basename(full);
      if (!(name in stats)) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return stats[name];
    },
  };
}

describe('what is in the folder', () => {
  it('videos only, newest first', () => {
    const fsImpl = fakeFs(
      [entry('old.mp4'), entry('notes.txt'), entry('new.mkv'), entry('subfolder', false)],
      { 'old.mp4': { size: 100, mtimeMs: NOW - 86400000 }, 'new.mkv': { size: 200, mtimeMs: NOW } },
    );
    const out = list('C:/clips', { fsImpl });
    expect(out.map(c => c.name)).toEqual(['new.mkv', 'old.mp4']);
    expect(out[0]).toMatchObject({ bytes: 200, at: NOW });
  });

  it('a file deleted while the folder was being read is skipped', () => {
    const fsImpl = fakeFs([entry('here.mp4'), entry('gone.mp4')], { 'here.mp4': { size: 1, mtimeMs: NOW } });
    expect(list('C:/clips', { fsImpl }).map(c => c.name)).toEqual(['here.mp4']);
  });

  it('a folder of a thousand recordings does not all come back at once', () => {
    const many = Array.from({ length: 400 }, (_, i) => entry('clip' + i + '.mp4'));
    const stats = {};
    many.forEach((e, i) => { stats[e.name] = { size: 1, mtimeMs: NOW - i }; });
    expect(list('C:/clips', { fsImpl: fakeFs(many, stats) }).length).toBeLessThanOrEqual(200);
  });
});

describe('where clips usually are', () => {
  it('offers only the folders that exist', () => {
    const fsImpl = { statSync: (p) => { if (/Videos$/.test(p)) return { isDirectory: () => true }; throw new Error('no'); } };
    const out = guesses('C:/Users/Someone', { fsImpl });
    expect(out).toEqual([path.join('C:/Users/Someone', 'Videos')]);
  });
});
