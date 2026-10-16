// Audit (2026-10): the "closed windows" list was filtered only on typeof url, so a
// hand-edited window-set.json could make "Reopen closed window" open file: or
// javascript: addresses, or a session that is not kept.
import { describe, it, expect } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWindowSet } = require('../../src/main/window-set.js');

const area = { x: 0, y: 0, width: 1920, height: 1040 };
function withFile(closed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-wsc-'));
  const file = path.join(dir, 'window-set.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, main: null, apps: [], closed }));
  const ws = createWindowSet({ file, fs, getWorkAreas: () => [area], getPrimaryWorkArea: () => area, getPrefs: () => ({ on: true, apps: true }), setTimer: () => 0, clearTimer: () => {} });
  return ws;
}
const good = { url: 'https://a.com/', title: 'A', partition: 'persist:main', bounds: null, closedAt: 1 };

describe('closed windows from a window-set.json', () => {
  it('drops non-web addresses and sessions that are not kept on load', () => {
    const ws = withFile([
      { ...good, url: 'file:///C:/secret.txt' },
      { ...good, url: 'javascript:alert(1)' },
      { ...good, partition: 'private-1' },
      { ...good, partition: 'persist:route-tor' },
      { ...good, partition: undefined },
      good,
    ]);
    expect(ws.closedList().map(c => c.url)).toEqual(['https://a.com/']);
  });

  it('takeClosed never returns an entry that is not http(s) in a kept session', () => {
    const ws = withFile([good]);
    // An entry that got in after load (the list is plain state) is skipped, not opened.
    ws.load().closed.unshift({ ...good, url: 'file:///x' }, { ...good, partition: 'private-2' });
    const c = ws.takeClosed();
    expect(c.url).toBe('https://a.com/');
    expect(ws.takeClosed()).toBe(null);
  });
});
