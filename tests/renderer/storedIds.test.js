// @vitest-environment jsdom
//
// Every list Vex stores — bookmarks, read-later, automations, chains, tools,
// AI memory, MCP servers — deletes an entry by matching its id. Those ids were
// built from the clock alone ('bm' + Date.now()), so two things created in the
// same millisecond shared one, and deleting either removed both. Silent data
// loss, and nothing in the app noticed.

import { describe, it, expect } from 'vitest';

const { vexId } = require('../../src/renderer/js/vex-utils.js');

describe('ids for stored items', () => {
  it('are unique even when generated in the same millisecond', () => {
    const clock = Date.now;
    Date.now = () => 1_700_000_000_000;       // time stands still
    try {
      const ids = new Set();
      for (let i = 0; i < 5000; i++) ids.add(vexId('bm'));
      expect(ids.size, 'ids collided while the clock did not move').toBe(5000);
    } finally { Date.now = clock; }
  });

  it('keep the prefix that says what they are', () => {
    expect(vexId('bm').startsWith('bm')).toBe(true);
    expect(vexId('note_').startsWith('note_')).toBe(true);
  });

  it('are strings, and short enough to store comfortably', () => {
    const id = vexId('x');
    expect(typeof id).toBe('string');
    expect(id.length).toBeLessThan(40);
  });

  it('survives being called with no prefix', () => {
    expect(typeof vexId()).toBe('string');
    expect(vexId().length).toBeGreaterThan(3);
  });
});

describe('no module builds an id from the clock alone', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');

  it('every stored-item id goes through vexId', () => {
    const offenders = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        // `id: 'prefix' + Date.now()` with nothing else mixed in.
        if (/\bid:\s*'[^']*'\s*\+\s*Date\.now\(\)(?:\.toString\(\d+\))?\s*[,}]/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(offenders, 'these ids collide within a millisecond:\n' + offenders.join('\n')).toEqual([]);
  });
});
