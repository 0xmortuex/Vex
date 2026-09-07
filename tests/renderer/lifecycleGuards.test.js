// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../src/renderer/js/collection-store.js';

// Background pollers are started from more than one place (panel open, boot,
// re-render). Each relies on a singleton guard to avoid stacking a second
// interval every time. Nothing tested those guards, so a lost guard would show
// up only as gradually rising CPU in a long session.
let intervals;
beforeEach(() => {
  intervals = 0;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(() => { intervals++; return intervals; });
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0);
});
afterEach(() => vi.restoreAllMocks());

describe('background pollers are started once', () => {
  it('QueuePanel.startAutoRefresh', async () => {
    const { QueuePanel } = await import('../../src/renderer/js/queue-panel.js');
    QueuePanel.refreshTimer = null;
    QueuePanel.startAutoRefresh();
    QueuePanel.startAutoRefresh();
    QueuePanel.startAutoRefresh();
    expect(intervals).toBe(1);
  });

  it('PanelBadges.start', async () => {
    await import('../../src/renderer/js/panel-badges.js');
    const badges = window.PanelBadges;
    badges._timer = null;
    badges.start();
    badges.start();
    expect(intervals).toBe(1);
  });

  it('TrackerReceipts.start', async () => {
    await import('../../src/renderer/js/tracker-receipts.js');
    const receipts = window.TrackerReceipts;
    receipts._timer = null;
    vi.spyOn(receipts, 'sample').mockImplementation(() => {});
    receipts.start();
    receipts.start();
    expect(intervals).toBe(1);
  });

  it('Automations.start keeps its two tickers at two', async () => {
    await import('../../src/renderer/js/automations.js');
    const automations = window.Automations;
    automations._started = false;
    automations.start();
    automations.start();
    expect(intervals).toBe(2);
  });

  it('TabArchiver.init, and dispose lets it start again', async () => {
    const { TabArchiver } = await import('../../src/renderer/js/readlater.js');
    globalThis.TabManager = { tabs: [], activeTabId: null };
    TabArchiver._initialized = false;
    TabArchiver.init();
    TabArchiver.init();
    expect(intervals).toBe(1);
    TabArchiver.dispose();
    TabArchiver.init();
    expect(intervals).toBe(2);
    TabArchiver.dispose();
  });
});
