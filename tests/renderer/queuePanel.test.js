import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  QueuePanel,
  sortQueueItems,
  buildQueueUrl,
  formatTimestamp,
} from '../../src/renderer/js/queue-panel.js';

afterEach(() => {
  delete globalThis.window;
  QueuePanel.config = { queueUrl: '', queueSecret: '' };
  vi.restoreAllMocks();
});

describe('sortQueueItems', () => {
  it('orders pending before done, newest first within each group', () => {
    const items = [
      { id: 'a', status: 'done', timestamp: '2026-05-18T10:00:00.000Z' },
      { id: 'b', status: 'pending', timestamp: '2026-05-18T09:00:00.000Z' },
      { id: 'c', status: 'pending', timestamp: '2026-05-18T11:00:00.000Z' },
      { id: 'd', status: 'done', timestamp: '2026-05-18T12:00:00.000Z' },
    ];
    expect(sortQueueItems(items).map((i) => i.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('does not mutate the input array', () => {
    const items = [
      { id: 'x', status: 'done', timestamp: '2026-05-18T10:00:00.000Z' },
      { id: 'y', status: 'pending', timestamp: '2026-05-18T11:00:00.000Z' },
    ];
    sortQueueItems(items);
    expect(items.map((i) => i.id)).toEqual(['x', 'y']);
  });
});

describe('buildQueueUrl', () => {
  it('joins base, path and secret query param', () => {
    expect(buildQueueUrl('https://q.workers.dev', '/queue', 'abc'))
      .toBe('https://q.workers.dev/queue?secret=abc');
  });

  it('strips a trailing slash from the base', () => {
    expect(buildQueueUrl('https://q.workers.dev/', '/queue', 'abc'))
      .toBe('https://q.workers.dev/queue?secret=abc');
  });

  it('url-encodes the secret', () => {
    expect(buildQueueUrl('https://q', '/queue', 'a b/c'))
      .toBe('https://q/queue?secret=a%20b%2Fc');
  });

  it('handles item action paths', () => {
    expect(buildQueueUrl('https://q', '/queue/123/done', 's'))
      .toBe('https://q/queue/123/done?secret=s');
  });
});

describe('formatTimestamp', () => {
  const now = Date.parse('2026-05-18T12:00:00.000Z');

  it('shows "just now" under a minute', () => {
    expect(formatTimestamp('2026-05-18T11:59:30.000Z', now)).toBe('just now');
  });

  it('shows minutes', () => {
    expect(formatTimestamp('2026-05-18T11:45:00.000Z', now)).toBe('15m ago');
  });

  it('shows hours', () => {
    expect(formatTimestamp('2026-05-18T09:00:00.000Z', now)).toBe('3h ago');
  });

  it('shows days', () => {
    expect(formatTimestamp('2026-05-16T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('returns empty string for an invalid timestamp', () => {
    expect(formatTimestamp('not-a-date', now)).toBe('');
  });
});

describe('QueuePanel.loadConfig / isConfigured', () => {
  it('loads queueUrl and queueSecret from the sidebar config IPC bridge', async () => {
    globalThis.window = {
      vex: {
        getSidebarConfig: async () => ({
          queueUrl: 'https://queue-bot.mortuexhavoc.workers.dev',
          queueSecret: 'secret-123',
        }),
      },
    };
    await QueuePanel.loadConfig();
    expect(QueuePanel.config.queueUrl).toBe('https://queue-bot.mortuexhavoc.workers.dev');
    expect(QueuePanel.config.queueSecret).toBe('secret-123');
    expect(QueuePanel.isConfigured()).toBe(true);
  });

  it('isConfigured is false when either field is missing', async () => {
    globalThis.window = {
      vex: { getSidebarConfig: async () => ({ queueUrl: 'https://q', queueSecret: '' }) },
    };
    await QueuePanel.loadConfig();
    expect(QueuePanel.isConfigured()).toBe(false);
  });

  it('falls back to empty config when no IPC bridge is present', async () => {
    globalThis.window = {};
    await QueuePanel.loadConfig();
    expect(QueuePanel.config).toEqual({ queueUrl: '', queueSecret: '' });
    expect(QueuePanel.isConfigured()).toBe(false);
  });

  it('survives an IPC rejection without throwing', async () => {
    globalThis.window = {
      vex: { getSidebarConfig: async () => { throw new Error('ipc down'); } },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await QueuePanel.loadConfig();
    expect(QueuePanel.isConfigured()).toBe(false);
  });
});
