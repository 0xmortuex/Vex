// What a viewer page's preload bridge sends must pass the IPC schemas main checks it against. The viewers' own tests checked the schemas and the
// handlers, never the bridge between them: the folder browser's first call (host.list(), which invoked the channel with one undefined
// argument where its schema takes none) was refused in the real app and the page showed "Invalid payload for folderview:list" (2026-10-25).
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { validatePayload } = require('../../src/main/ipc-policy');

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/preload-webview.js'), 'utf8').replace(/\r\n/g, '\n');

// Runs one viewer's block of preload-webview.js (the `if (location.protocol === '<scheme>') { ... return; }` part) against a fake electron and
// returns the bridge object it exposes plus a log of every ipcRenderer.invoke(channel, ...args).
function bridgeOf(scheme) {
  const marker = "location.protocol === '" + scheme + "'";
  const at = SOURCE.indexOf(marker);
  if (at < 0) throw new Error('no preload block for ' + scheme);
  const start = SOURCE.lastIndexOf('if (', at);
  const end = SOURCE.indexOf('  return;\n}\n', start) + '  return;\n}\n'.length;
  const block = SOURCE.slice(start, end);
  const calls = [];
  let exposed = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { exposed = api; } },
    ipcRenderer: { on() {}, send() {}, sendToHost() {}, invoke: (channel, ...args) => { calls.push([channel, args]); return Promise.resolve({}); } },
  };
  const fakeWindow = { addEventListener() {} };
  // eslint-disable-next-line no-new-func
  new Function('require', 'location', 'window', 'console', block)((id) => { if (id !== 'electron') throw new Error('unexpected require ' + id); return electron; }, { protocol: scheme }, fakeWindow, console);
  return { api: exposed, calls };
}

describe('every viewer bridge', () => {
  for (const scheme of ['vex-pdf:', 'vex-image:', 'vex-media:', 'vex-doc:', 'vex-office:', 'vex-files:']) {
    it(scheme + ' calls a channel that takes no argument without one', async () => {
      const { api } = bridgeOf(scheme);
      expect(api && Object.keys(api).length).toBeGreaterThan(0);
      for (const name of Object.keys(api)) {
        if (typeof api[name] !== 'function') continue;
        const { calls, api: fresh } = bridgeOf(scheme);
        try { await fresh[name](); } catch { /* a method that needs an argument may refuse its absence itself */ }
        for (const [channel, args] of calls) {
          let takesNone = true;
          try { validatePayload(channel, []); } catch { takesNone = false; }
          if (takesNone) expect(() => validatePayload(channel, args), scheme + ' ' + name + '() -> ' + channel + ' with ' + JSON.stringify(args)).not.toThrow();
        }
      }
    });
  }
});

describe('the folder browser bridge', () => {
  it('sends only calls the IPC schemas accept', async () => {
    const { api, calls } = bridgeOf('vex-files:');
    expect(api).toBeTruthy();
    // The calls the page makes at start and from its buttons, with the arguments it gives them.
    await api.list();
    await api.ping();
    await api.places();
    await api.plainList();
    await api.openAsFile();
    await api.stat({ names: ['a.txt'] });
    await api.thumb({ name: 'a.png', size: 96 });
    await api.preview({ name: 'a.txt' });
    await api.sizeStart({ name: 'sub' });
    await api.reveal();
    await api.reveal({ name: 'a.txt' });
    await api.mkdir({ name: 'new' });
    await api.rename({ name: 'a.txt', to: 'b.txt' });
    await api.copy({ as: 'path' });
    expect(calls.length).toBeGreaterThan(10);
    for (const [channel, args] of calls) expect(() => validatePayload(channel, args), channel + ' with ' + JSON.stringify(args)).not.toThrow();
  });
});
