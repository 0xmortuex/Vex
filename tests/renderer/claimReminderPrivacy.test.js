// @vitest-environment jsdom
//
// "Remind me before this ends" saves the page's address in the reminder. The watch templates and the
// page reminders refuse private and Tor tabs; this command did not, so a private tab's address ended up
// in a stored reminder.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JS = '../../src/renderer/js/';
const fresh = (p) => { delete require.cache[require.resolve(JS + p)]; return require(JS + p); };

let made;
beforeEach(() => {
  localStorage.clear();
  window.showToast = vi.fn();
  made = vi.fn(async () => ({ id: 'x' }));
  globalThis.VexQuickReminder = { parseWhen: () => new Date(Date.now() + 10 * 3600000), create: made };
  globalThis.vexPrompt = vi.fn().mockResolvedValueOnce('tomorrow 18:00').mockResolvedValueOnce('2 hours');
  delete window.VexTabPolicy;
});

describe('claimReminder keeps no address from a private or Tor tab', () => {
  for (const partition of ['private:abc-123', 'otr-throwaway-1', 'persist:tor', 'tor:circuit-1']) {
    it('refuses a tab in ' + partition, async () => {
      const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
      globalThis.TabManager = { getActiveTab: () => ({ url: 'https://store.example/deal', title: 'Free game', partition }) };
      await expect(T.claimReminder()).rejects.toThrow(/Private and Tor tabs are not saved/);
      expect(made).not.toHaveBeenCalled();
      expect(globalThis.vexPrompt).not.toHaveBeenCalled();     // refused before anything was asked
    });
  }

  it('refuses in a private window whatever the tab says', async () => {
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    window.VexTabPolicy = { isPrivateWindow: true };
    globalThis.TabManager = { getActiveTab: () => ({ url: 'https://store.example/deal', title: 'Free game' }) };
    await expect(T.claimReminder()).rejects.toThrow(/Private and Tor tabs are not saved/);
    expect(made).not.toHaveBeenCalled();
  });

  it('still works for an ordinary tab and a container tab', async () => {
    const { PageWatchTemplates: T } = fresh('page-watch-templates.js');
    for (const partition of [undefined, 'persist:main', 'persist:container-work']) {
      globalThis.vexPrompt = vi.fn().mockResolvedValueOnce('tomorrow 18:00').mockResolvedValueOnce('2 hours');
      globalThis.TabManager = { getActiveTab: () => ({ url: 'https://store.example/deal', title: 'Free game', partition }) };
      await T.claimReminder();
    }
    expect(made).toHaveBeenCalledTimes(3);
    expect(made.mock.calls[0][2]).toEqual({ url: 'https://store.example/deal' });
  });
});
