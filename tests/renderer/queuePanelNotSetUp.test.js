// @vitest-environment jsdom
// The Queue panel told users to "Add queueUrl and queueSecret to your local
// sidebar-config.json — see queue-bot/SETUP.md" (walkthrough M5, 2026-10-07).

import { describe, it, expect } from 'vitest';
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
