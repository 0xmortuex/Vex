// @vitest-environment jsdom
//
// T3-050, Wave 5: a staged post. At its hour a toast offers Review and send; only the confirm's Send
// sends, and nothing goes by itself.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

let AC, notify, sent, confirmAnswer, reminders;
const NOW = new Date(2026, 9, 16, 12, 0).getTime();
const HOUR = 3600 * 1000;

beforeEach(() => {
  localStorage.clear();
  globalThis.CommsStore = fresh('comms-store.js').CommsStore;
  AC = fresh('announce-composer.js').AnnounceComposer;
  AC._now = () => NOW;
  sent = [];
  reminders = [];
  confirmAnswer = true;
  window.vexConfirm = vi.fn(async () => confirmAnswer);
  window.vex = {
    commsWebhookStatus: vi.fn(async () => ({ has: true, label: 'my server' })),
    commsWebhookSend: vi.fn(async (p) => { sent.push(p); return { status: 204 }; }),
  };
  globalThis.VexQuickReminder = { create: vi.fn(async (m, d) => { reminders.push([m, d]); return { id: 'r' }; }) };
  notify = vi.fn((o, show) => { show(); return { route: 'toast' }; });
  globalThis.VexAttention = { notify };
  window.showToast = vi.fn();
});

describe('staging', () => {
  it('keeps the text and a back-up reminder, and sends nothing', async () => {
    const rec = await AC.stage('Release 2', 'Version 2 is out', new Date(NOW + 2 * HOUR));
    expect(AC.staged()).toHaveLength(1);
    expect(rec).toMatchObject({ title: 'Release 2', askedAt: 0 });
    expect(reminders).toHaveLength(1);
    expect(window.vex.commsWebhookSend).not.toHaveBeenCalled();
  });
  it('refuses a time that has passed, an empty text, a text that does not fit and a missing webhook', async () => {
    await expect(AC.stage('x', 'text', new Date(NOW - HOUR))).rejects.toThrow(/still ahead/);
    await expect(AC.stage('x', '   ', new Date(NOW + HOUR))).rejects.toThrow(/Write the announcement/);
    await expect(AC.stage('x', 'a'.repeat(2100), new Date(NOW + HOUR))).rejects.toThrow(/over/);
    window.vex.commsWebhookStatus = vi.fn(async () => ({ has: false }));
    await expect(AC.stage('x', 'text', new Date(NOW + HOUR))).rejects.toThrow(/no webhook saved/);
    expect(AC.staged()).toEqual([]);
  });
  it('keeps at most ten', async () => {
    for (let i = 0; i < 10; i++) await AC.stage('p' + i, 'text ' + i, new Date(NOW + (i + 1) * HOUR));
    await expect(AC.stage('one more', 'text', new Date(NOW + 20 * HOUR))).rejects.toThrow(/At most 10/);
  });
  it('can be removed', async () => {
    const rec = await AC.stage('a', 'text', new Date(NOW + HOUR));
    expect(AC.unstage(rec.id)).toBe(true);
    expect(AC.unstage(rec.id)).toBe(false);
  });
});

describe('the hour', () => {
  it('says Time to post once, through the attention gate as an asked notice, and sends nothing', async () => {
    const rec = await AC.stage('Release 2', 'Version 2 is out', new Date(NOW + HOUR));
    expect(AC.tickStaged(NOW + HOUR - 1000)).toBe(0);
    expect(AC.tickStaged(NOW + HOUR + 1000)).toBe(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ feature: 'announce-composer', urgency: 'asked', action: { key: 'send:' + rec.id } });
    expect(notify.mock.calls[0][0].title).toBe('Time to post: Release 2');
    expect(window.vex.commsWebhookSend).not.toHaveBeenCalled();
    expect(AC.tickStaged(NOW + 2 * HOUR)).toBe(0);                 // once only
    expect(AC.staged()).toHaveLength(1);                           // still waiting, marked as asked
    expect(AC.staged()[0].askedAt).toBeGreaterThan(0);
  });
  it('does nothing while the composer is off, and raises without the attention gate', async () => {
    await AC.stage('a', 'text', new Date(NOW + HOUR));
    AC.setEnabled(false);
    expect(AC.tickStaged(NOW + 2 * HOUR)).toBe(0);
    AC.setEnabled(true);
    delete globalThis.VexAttention;
    expect(() => AC.tickStaged(NOW + 2 * HOUR)).toThrow(/attention gate/);
  });
});

describe('Review and send', () => {
  it('shows the exact message in the confirm, sends only on Send, and then removes the staged post', async () => {
    const rec = await AC.stage('Release 2', 'Version 2 is out', new Date(NOW + HOUR));
    const r = await AC.sendStaged(rec.id);
    expect(r.sent).toBe(true);
    expect(window.vexConfirm.mock.calls[0][0].message).toContain('"content":"Version 2 is out"');
    expect(sent).toHaveLength(1);
    expect(AC.staged()).toEqual([]);
  });
  it('Cancel sends nothing and keeps the staged post', async () => {
    const rec = await AC.stage('Release 2', 'Version 2 is out', new Date(NOW + HOUR));
    confirmAnswer = false;
    expect((await AC.sendStaged(rec.id)).sent).toBe(false);
    expect(sent).toEqual([]);
    expect(AC.staged()).toHaveLength(1);
  });
  it('raises for a staged post that is gone', async () => {
    await expect(AC.sendStaged('st_none')).rejects.toThrow(/gone/);
  });
  it('the toast button runs the same review', async () => {
    const rec = await AC.stage('Release 2', 'Version 2 is out', new Date(NOW + HOUR));
    AC.tickStaged(NOW + HOUR + 1);
    const opts = window.showToast.mock.calls[0][3];
    expect(opts.action.label).toBe('Review and send');
    opts.action.run();
    await new Promise(r => setTimeout(r, 0));
    expect(window.vexConfirm).toHaveBeenCalledTimes(1);
    expect(rec.id).toBeTruthy();
  });
});
