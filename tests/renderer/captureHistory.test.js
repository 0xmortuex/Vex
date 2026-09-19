// @vitest-environment jsdom
//
// Which sites used the microphone or camera, and when — never from a private tab.
import { beforeEach, describe, expect, it } from 'vitest';
const { CaptureHistory } = require('../../src/renderer/js/capture-history.js');

const T0 = new Date(2026, 8, 19, 14, 0).getTime();
beforeEach(() => {
  localStorage.clear();
  globalThis.TabManager = { tabs: [
    { id: 1, url: 'https://www.discord.com/channels/1', partition: 'persist:main' },
    { id: 2, url: 'https://secret.example/', partition: 'otr-9' },
  ] };
  window.VexTabPolicy = { canPersist: (t) => String(t.partition).startsWith('persist:') };
});

describe('the record', () => {
  it('one entry per use, from start to stop', () => {
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: true }, T0);
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: true }, T0 + 5);        // a repeat start is the same use
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: false }, T0 + 60000);
    expect(CaptureHistory.list()).toEqual([{ site: 'discord.com', kind: 'mic', start: T0, end: T0 + 60000 }]);
  });

  it('a private tab leaves nothing', () => {
    CaptureHistory.record({ where: 'tab', id: 2, kind: 'camera', active: true }, T0);
    expect(CaptureHistory.list()).toEqual([]);
  });

  it('keeps thirty days', () => {
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: true }, T0);
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: false }, T0 + 1);
    CaptureHistory.record({ where: 'tab', id: 1, kind: 'camera', active: true }, T0 + 31 * 86400000);
    expect(CaptureHistory.list().map(e => e.kind)).toEqual(['camera']);
  });

  it('unreadable history is an error, not silently replaced', () => {
    localStorage.setItem('vex.captureLog', '[{');
    expect(() => CaptureHistory.list()).toThrow(/could not be read/);
  });
});

describe('the summary', () => {
  it('times today, this week, the last time, and whether it is on now', () => {
    for (const [s, e] of [[T0 - 2 * 86400000, T0 - 2 * 86400000 + 1], [T0, T0 + 1], [T0 + 3600000, null]]) {
      CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: true }, s);
      if (e) CaptureHistory.record({ where: 'tab', id: 1, kind: 'mic', active: false }, e);
    }
    const [row] = CaptureHistory.summary(T0 + 3600000 + 10);
    expect(row).toEqual({ site: 'discord.com', kind: 'mic', today: 2, week: 3, last: T0 + 3600000, now: true });
  });
});
