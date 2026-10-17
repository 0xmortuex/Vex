// T3-120 (Wave 6): "pause one extension on one page" needs Electron to let an extension be limited to, or kept off, a host
// or a tab. It does not. The extensions API of the installed Electron is four calls (get all, get one, load, remove) for a
// whole session, so the pause stays what it is: only the NAMED extensions are switched off, for as long as the site is
// in front (js/extension-diff.js). If a later Electron adds a per-host or per-tab control, this test fails and says so.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const dts = path.resolve(__dirname, '../../node_modules/electron/electron.d.ts');
const have = fs.existsSync(dts);

describe.skipIf(!have)('Electron session extensions API', () => {
  const text = have ? fs.readFileSync(dts, 'utf8') : '';
  const i = text.indexOf('class Extensions extends NodeEventEmitter');
  const body = i < 0 ? '' : text.slice(i, text.indexOf('\n  }', i));
  const methods = [...body.matchAll(/^\s{4}([a-zA-Z]+)\(/gm)].map(m => m[1]).filter(n => !['on', 'off', 'once', 'addListener', 'removeListener'].includes(n));

  it('can read, load and remove an extension for a whole session, and nothing more', () => {
    expect(methods.sort()).toEqual(['getAllExtensions', 'getExtension', 'loadExtension', 'removeExtension']);
  });

  it('loadExtension takes no host or tab restriction', () => {
    const j = text.indexOf('interface LoadExtensionOptions');
    const opts = text.slice(j, text.indexOf('\n  }', j));
    const names = [...opts.matchAll(/^\s{4}([a-zA-Z]+)\??:/gm)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter(n => /host|site|url|match|tab|exclude|block/i.test(n))).toEqual([]);
  });
});
