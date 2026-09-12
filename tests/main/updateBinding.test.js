// @vitest-environment node
//
// The bridge between electron-updater and the window. Small, but everything
// the user sees about updating comes through it, and it had no tests.

import { describe, it, expect, vi } from 'vitest';

const { bindUpdater } = require('../../src/main/updates.js');

function fakeUpdater() {
  const listeners = {};
  return {
    listeners,
    on: (event, fn) => { (listeners[event] ??= []).push(fn); },
    removeListener: (event, fn) => { listeners[event] = (listeners[event] || []).filter(f => f !== fn); },
    emit: (event, value) => (listeners[event] || []).forEach(fn => fn(value)),
    count: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
  };
}

function bind(windowState = {}) {
  const updater = fakeUpdater();
  const sent = [];
  const win = {
    isDestroyed: () => !!windowState.destroyed,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
  const unbind = bindUpdater(updater, () => (windowState.missing ? null : win));
  return { updater, sent, unbind, windowState };
}

describe('how it is configured', () => {
  it('never downloads behind your back, but does install on quit', () => {
    const updater = fakeUpdater();
    bindUpdater(updater, () => null);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('does nothing at all when there is no updater', () => {
    const off = bindUpdater(null, () => null);
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('what reaches the window', () => {
  it('passes on a new version with its notes', () => {
    const { updater, sent } = bind();
    updater.emit('update-available', { version: '9.9.9', releaseNotes: 'notes', extra: 'dropped' });
    expect(sent[0]).toEqual({ channel: 'update-available', payload: { version: '9.9.9', releaseNotes: 'notes' } });
  });

  it('rounds download progress rather than showing 12.3456%', () => {
    const { updater, sent } = bind();
    updater.emit('download-progress', { percent: 12.3456, transferred: 5, total: 10 });
    expect(sent[0].payload).toEqual({ percent: 12, transferred: 5, total: 10 });
  });

  it('reports being up to date, a finished download, and an error', () => {
    const { updater, sent } = bind();
    updater.emit('update-not-available', {});
    updater.emit('update-downloaded', { version: '1.2.3' });
    updater.emit('error', new Error('network is down'));
    expect(sent.map(s => s.channel)).toEqual(['update-not-available', 'update-downloaded', 'update-error']);
    expect(sent[1].payload).toEqual({ version: '1.2.3' });
    expect(sent[2].payload).toEqual({ message: 'network is down' });
  });

  // The updater keeps running while windows come and go.
  it('says nothing when the window has gone', () => {
    const { updater, sent, windowState } = bind();
    windowState.destroyed = true;
    updater.emit('update-available', { version: '1' });
    expect(sent).toEqual([]);
  });

  it('says nothing when there is no window yet', () => {
    const { updater, sent, windowState } = bind();
    windowState.missing = true;
    updater.emit('update-not-available', {});
    expect(sent).toEqual([]);
  });
});

describe('unbinding', () => {
  it('removes every listener it added, so a second window does not double up', () => {
    const { updater, unbind } = bind();
    expect(updater.count()).toBe(5);
    unbind();
    expect(updater.count()).toBe(0);
  });

  it('stops delivering once unbound', () => {
    const { updater, sent, unbind } = bind();
    unbind();
    updater.emit('update-available', { version: '1' });
    expect(sent).toEqual([]);
  });
});
