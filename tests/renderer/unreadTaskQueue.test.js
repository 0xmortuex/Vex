// @vitest-environment jsdom
//
// T3-021, Wave 5: "Also add each task to my Queue". The Vex side is built and tested against a local
// stand-in; the deployed queue-bot has no add route yet (docs/queue-bot-add-endpoint.md).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let UT, calls, status;

beforeEach(() => {
  localStorage.clear();
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  UT = fresh('unread-task.js').UnreadTask;
  globalThis.UnreadTask = UT;
  const q = fresh('queue-panel.js');
  globalThis.QueuePanel = q.QueuePanel;
  globalThis.buildQueueUrl = q.buildQueueUrl;
  QueuePanel.config = { queueUrl: 'https://queue.example.workers.dev/', queueSecret: 's3cret' };
  globalThis.OpenTasks = { add: vi.fn(() => ({ id: 'n1' })) };
  window.showToast = vi.fn();
  calls = []; status = 201;
  window.VexNet = { fetch: vi.fn(async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status }; }) };
});

describe('the Queue as a second place for the task', () => {
  it('is off until switched on: only the To-do line is written, nothing is sent', async () => {
    const r = UT.add({ text: 'Reply to Ayse', source: 'Discord' });
    expect(r.queued).toBeNull();
    expect(OpenTasks.add).toHaveBeenCalledTimes(1);
    expect(window.VexNet.fetch).not.toHaveBeenCalled();
  });
  it('when on, the same line goes to POST /queue of the configured address, with the secret in the query only', async () => {
    UT.setQueue(true);
    const r = UT.add({ text: 'Reply to Ayse', source: 'Discord' });
    expect(await r.queued).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://queue.example.workers.dev/queue?secret=s3cret');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(calls[0].init.body);
    expect(body.source).toBe('vex');
    expect(body.text).toBe(OpenTasks.add.mock.calls[0][0]);
  });
  it('writes the To-do line first, so a refusal loses nothing, and says what to do', async () => {
    UT.setQueue(true);
    status = 404;
    const r = UT.add({ text: 'Reply to Ayse' });
    expect(await r.queued).toBe(false);
    expect(OpenTasks.add).toHaveBeenCalledTimes(1);
    expect(window.showToast.mock.calls[0][0]).toMatch(/in your To-do note, but not in the Queue: Your queue bot has no way to add items yet/);
    expect(window.showToast.mock.calls[0][1]).toBe('error');
  });
  it('names a wrong secret and any other refusal', async () => {
    status = 403;
    await expect(UT.toQueue('x')).rejects.toThrow(/refused the secret/);
    status = 500;
    await expect(UT.toQueue('x')).rejects.toThrow(/answered 500/);
  });
  it('raises when the Queue is not set up on this computer', async () => {
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    window.vex = { getSidebarConfig: vi.fn(async () => ({})) };
    await expect(UT.toQueue('x')).rejects.toThrow(/not set up/);
    expect(window.VexNet.fetch).not.toHaveBeenCalled();
    delete window.vex;
  });
  it('reads the address from the local config when the panel has not yet', async () => {
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    window.vex = { getSidebarConfig: vi.fn(async () => ({ queueUrl: 'https://q.example/', queueSecret: 'k' })) };
    await UT.toQueue('hello');
    expect(calls[0].url).toBe('https://q.example/queue?secret=k');
    delete window.vex;
  });
  it('the queue switch is part of the saved preferences and survives a reload', () => {
    UT.setQueue(true);
    expect(fresh('unread-task.js').UnreadTask.queueOn()).toBe(true);
    UT.setQueue(false);
    expect(UT.queueOn()).toBe(false);
  });
});
