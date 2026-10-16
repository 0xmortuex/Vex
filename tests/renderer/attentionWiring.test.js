// @vitest-environment jsdom
//
// The call sites that now go through the Attention Budget (T0-019, T0-022): the
// update notifier, the evening tab cleanup, the routine offer, the backup nudge,
// AI News and the Windows-toast senders. The gate itself is in attentionGate.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fs = require('fs');
const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };
const src = (rel) => fs.readFileSync(path.join(JS, rel), 'utf8');

let A, I, S;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-attention" hidden></button>';
  for (const n of ['GameMode', 'TabManager', 'VexAttention', 'AttentionInbox', 'AttentionState']) delete globalThis[n];
  S = fresh('attention-state.js').AttentionState; globalThis.AttentionState = S;
  I = fresh('attention-inbox.js').AttentionInbox; globalThis.AttentionInbox = I;
  A = fresh('vex-attention.js').VexAttention; globalThis.VexAttention = A;
  A.reset();
  window.showToast = vi.fn();
  globalThis.VexProblems = { note: vi.fn() };
});

describe('the update notifier', () => {
  const update = { ok: true, hasUpdate: true, latest: '9.9.9', current: '9.9.8' };

  it('opens the cover at a good moment', () => {
    require('../../src/renderer/js/vex-utils.js');
    const { UpdateNotifier } = fresh('update-notifier.js');
    UpdateNotifier.showCover = vi.fn();
    UpdateNotifier.announce(update);
    expect(UpdateNotifier.showCover).toHaveBeenCalledWith(update);
  });

  it('waits in the inbox while a game is running, and the inbox button opens the cover', () => {
    require('../../src/renderer/js/vex-utils.js');
    const { UpdateNotifier } = fresh('update-notifier.js');
    UpdateNotifier.showCover = vi.fn();
    globalThis.GameMode = { gaming: true };
    UpdateNotifier.announce(update);
    expect(UpdateNotifier.showCover).not.toHaveBeenCalled();
    expect(I.list()[0]).toMatchObject({ feature: 'update', title: 'Vex 9.9.9 is available' });
    I.run(I.list()[0].id);
    expect(UpdateNotifier.showCover).toHaveBeenCalledWith(update);
  });

  it('both automatic checks go through announce()', () => {
    const s = src('update-notifier.js');
    expect(s.match(/this\.announce\(r\)/g)).toHaveLength(2);
    expect(s).not.toMatch(/shouldAnnounce\(r\)\) this\.showCover/);
  });
});

describe('the evening tab cleanup', () => {
  it('leaves a suggestion in the inbox instead of opening a card, and Review opens the card', () => {
    const { TabCleanup } = fresh('tab-cleanup.js');
    const old = Date.now() - 10 * 86400000;
    globalThis.TabManager = { activeTabId: 'a', tabs: [
      { id: 'a', url: 'https://a.example/', _lastActive: Date.now() },
      { id: 'b', url: 'https://b.example/', title: 'B', _lastActive: old },
    ] };
    TabCleanup.showCard = vi.fn();
    globalThis.VexJobs = { every: () => ({ stop() {} }) };
    TabCleanup.start();                                   // registers the inbox button's handler (and needs VexJobs)
    const evening = new Date(); evening.setHours(23, 0, 0, 0);
    const items = TabCleanup.tick(evening.getTime());
    expect(items).toHaveLength(1);
    expect(TabCleanup.showCard).not.toHaveBeenCalled();
    expect(I.list()[0]).toMatchObject({ feature: 'tab-cleanup', title: 'Tidy 1 tab?' });
    I.run(I.list()[0].id);
    expect(TabCleanup.showCard).toHaveBeenCalledTimes(1);
  });
});

describe('the other senders', () => {
  it('the backup nudge, routine offer and AI News go through the gate, not straight to a toast', () => {
    expect(src('memory-tools.js')).toMatch(/VexAttention\.suggest\(\{ feature: 'backup'/);
    expect(src('routine-detect.js')).toMatch(/VexAttention\.suggest\(\{ feature: 'routine'/);
    const news = src('ai-news.js');
    expect(news).toMatch(/_attend\(item\)\)\s*continue/);
    expect(news).toMatch(/res\.suppressed/);
  });

  it('Windows toasts from free games, live channels, GitHub watch and handoff say they are useful, not urgent', () => {
    for (const [f, feature] of [['free-games.js', 'free-games'], ['live-channels.js', 'live-channels'], ['github-watch.js', 'github-watch'], ['handoff.js', 'handoff']]) {
      expect(src(f), f).toMatch(new RegExp("osNotify\\(\\{ feature: '" + feature + "'[^}]*urgency: 'useful'"));
    }
  });

  it('news toasts are useful and reminders are critical in the main process', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toMatch(/kind: 'news', urgency: 'useful', feature: 'ai-news'/);
    const { createNotifyGate } = require('../../src/main/notify.js');
    expect(createNotifyGate({ show: async () => ({}) }).classify({ kind: 'reminder' })).toBe('critical');
  });

  it('panel unread badges count as dots, so the bell gives way at three', () => {
    expect(src('panel-badges.js')).toContain("b.setAttribute('data-vex-dot', 'panel')");
  });

  it('Focus, meetings, flows and the wind-down tell the attention state when they change', () => {
    expect(src('focus-mode.js').match(/AttentionState\.changed\(\)/g)).toHaveLength(2);
    expect(src('meeting-mode.js').match(/AttentionState\.changed\(\)/g)).toHaveLength(2);
    expect(src('focus-flows.js').match(/AttentionState\.changed\(\)/g)).toHaveLength(2);
    expect(src('theme-auto.js')).toMatch(/AttentionState\.changed\(\)/);
  });
});
