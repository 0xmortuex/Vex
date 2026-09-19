// A renderer call that leaves out an argument its IPC schema requires is
// refused by the main process ("Invalid payload"). "What's new" asked for the
// release notes with no tag — meaning "this version" — the schema required
// one, the refusal was swallowed, and the popup never appeared after an
// update for two weeks. This finds every such call.
import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');
const { schemas, validate } = require('../../src/main/ipc-schemas.js');

const root = path.join(__dirname, '..', '..', 'src');

describe('renderer calls match what their IPC schemas accept', () => {
  it('"What\'s new" may ask for the notes of the running version (no tag)', () => {
    expect(() => validate('updates:notes', [])).not.toThrow();
    expect(() => validate('updates:notes', ['v2.32.31'])).not.toThrow();
    expect(() => validate('updates:notes', [42])).toThrow(/Invalid payload/);
  });

  it('no call leaves out an argument its schema requires', () => {
    const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
    const fns = [...preload.matchAll(/(\w+):\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*ipcRenderer\.(?:invoke|send)\('([^']+)'/g)]
      .map(m => ({ name: m[1], channel: m[3] }));
    const dir = path.join(root, 'renderer', 'js');
    const sources = fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]);
    const wrong = [];
    for (const fn of fns) {
      const checks = schemas.get(fn.channel);
      if (!checks || !checks.length) continue;
      const needsFirst = (() => { try { return !checks[0](undefined); } catch { return true; } })();
      if (!needsFirst) continue;
      const call = new RegExp('vex\\??\\.(?:\\w+\\??\\.)?' + fn.name + '\\??\\.?\\(\\s*\\)', 'g');
      for (const [file, src] of sources) {
        let m;
        while ((m = call.exec(src))) wrong.push(`${file}:${src.slice(0, m.index).split('\n').length}  ${fn.name}() — ${fn.channel} requires an argument`);
      }
    }
    expect(wrong, wrong.join('\n')).toEqual([]);
  });
});
