// @vitest-environment jsdom
// The Queue panel told users to "Add queueUrl and queueSecret to your local
// sidebar-config.json — see queue-bot/SETUP.md" (walkthrough M5, 2026-10-07).

import { describe, it, expect, vi } from 'vitest';
import { QueuePanel } from '../../src/renderer/js/queue-panel.js';

describe('Queue panel that is not set up', () => {
  it('says so in plain words, with no file names or setting keys', async () => {
    document.body.innerHTML = '<div id="queue-panel-list"></div>';
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    await QueuePanel.refresh();
    const text = document.getElementById('queue-panel-list').textContent;
    expect(text).toMatch(/not set up/);
    expect(text).not.toMatch(/queueUrl|queueSecret|sidebar-config|SETUP\.md/);
  });
});

describe('Queue setup guide', () => {
  const list = () => document.getElementById('queue-panel-list');
  const stub = (save) => { window.vex = { saveQueueConfig: save }; };

  it('lists the steps, opens the guide in a tab, and has the two fields', async () => {
    document.body.innerHTML = '<div id="queue-panel-list"></div>';
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    await QueuePanel.refresh();
    expect(list().querySelectorAll('ol li').length).toBe(QueuePanel.SETUP_STEPS.length);
    expect(list().querySelectorAll('input').length).toBe(2);
    const createTab = vi.fn();
    globalThis.TabManager = { createTab };
    try {
      [...list().querySelectorAll('button')].find(b => /step-by-step/.test(b.textContent)).click();
      expect(createTab).toHaveBeenCalledWith(QueuePanel.GUIDE_URL, true);
    } finally { delete globalThis.TabManager; }
  });

  it('saves the address and secret, then shows the queue', async () => {
    document.body.innerHTML = '<div id="queue-panel-list"></div>';
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    await QueuePanel.refresh();
    const save = vi.fn(async (c) => c);
    stub(save);
    const refresh = vi.spyOn(QueuePanel, 'refresh').mockResolvedValue();
    const [url, secret] = list().querySelectorAll('input');
    url.value = 'https://queue-bot.me.workers.dev'; secret.value = 'abcdefgh1234';
    list().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(save).toHaveBeenCalledWith({ queueUrl: 'https://queue-bot.me.workers.dev', queueSecret: 'abcdefgh1234' });
    expect(QueuePanel.config.queueUrl).toBe('https://queue-bot.me.workers.dev');
    expect(refresh).toHaveBeenCalled();
    refresh.mockRestore();
    delete window.vex;
  });

  it('says why when saving is refused, without the Electron wrapper', async () => {
    document.body.innerHTML = '<div id="queue-panel-list"></div>';
    QueuePanel.config = { queueUrl: '', queueSecret: '' };
    await QueuePanel.refresh();
    stub(async () => { throw new Error("Error invoking remote method 'sidebar-config:set-queue': Error: The queue address has to start with https://"); });
    list().querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 0));
    expect(list().querySelector('[role=status]').textContent).toBe('The queue address has to start with https://');
    delete window.vex;
  });
});
