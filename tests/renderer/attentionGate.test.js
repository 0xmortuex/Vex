// @vitest-environment jsdom
//
// The Attention Budget (T0-019), the one attention state (T0-028) and the
// Attention Inbox with its never-again verbs (T0-022):
// js/attention-state.js, js/vex-attention.js, js/attention-inbox.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const path = require('path');
const JS = path.resolve(__dirname, '../../src/renderer/js');
const fresh = (rel) => { const p = path.join(JS, rel); delete require.cache[require.resolve(p)]; return require(p); };

const NAMES = ['AttentionState', 'VexAttention', 'AttentionInbox', 'GameMode', 'GameSession', 'MeetingMode', 'FocusMode', 'FocusFlows', 'ThemeAuto', 'VexProblems'];
let A, S, I, now;

function load(keepStorage) {
  S = fresh('attention-state.js').AttentionState; globalThis.AttentionState = S;
  I = fresh('attention-inbox.js').AttentionInbox; globalThis.AttentionInbox = I;
  A = fresh('vex-attention.js').VexAttention; globalThis.VexAttention = A;
  now = 1_700_000_000_000;
  A._now = () => now;
  I._now = () => now;
  S._now = () => now;
  if (!keepStorage) A.reset();
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="btn-attention" hidden></button>';
  for (const n of NAMES) delete globalThis[n];
  delete window.vex;
  load();
});
afterEach(() => { vi.restoreAllMocks(); });

const req = (over = {}) => A.request({ feature: 'backup', urgency: 'useful', id: 'x', title: 'Back up?', ...over });

describe('one attention state', () => {
  it('is not quiet when nothing is going on', () => {
    expect(S.get()).toEqual({ quiet: false, reason: '', until: 0, sources: [] });
  });

  it('combines game, meeting, focus, wind-down and the quiet switch into one answer, strongest first', () => {
    globalThis.FocusMode = { active: true, until: now + 600000 };
    localStorage.setItem('vex.fun.quiet', '1');
    let s = S.get();
    expect(s.quiet).toBe(true);
    expect(s.reason).toBe('focus');
    expect(s.until).toBe(now + 600000);
    expect(s.sources.map(x => x.id)).toEqual(['focus', 'quiet-switch']);
    globalThis.MeetingMode = { active: () => true };
    expect(S.get().reason).toBe('meeting');
    globalThis.GameMode = { gaming: true };
    s = S.get();
    expect(s.reason).toBe('game');
    expect(s.sources.map(x => x.id)).toEqual(['game', 'meeting', 'focus', 'quiet-switch']);
  });

  it('sees a Focus flow and a running wind-down with the time it ends', () => {
    globalThis.FocusFlows = { _active: { flow: { id: 'f' } } };
    expect(S.get().reason).toBe('focus');
    delete globalThis.FocusFlows;
    const end = now + 3600000;
    globalThis.ThemeAuto = {
      windNow: () => 0.5, windState: () => ({ start: '22:00', end: '06:00' }), parseHM: () => 0, windEndMs: () => end, _clock: () => new Date(now),
    };
    expect(S.get()).toMatchObject({ quiet: true, reason: 'wind-down', until: end });
  });

  it('reads quiet hours from the main process, cached, and says when they end', async () => {
    const get = vi.fn().mockResolvedValue({ enabled: true, inWindow: true, end: '07:00' });
    window.vex = { quiet: { get } };
    expect(S.get().quiet).toBe(false);        // first look starts the read
    await Promise.resolve(); await Promise.resolve(); await new Promise(r => setTimeout(r, 0));
    const s = S.get();
    expect(s.reason).toBe('quiet-hours');
    expect(s.until).toBeGreaterThan(now);
    S.get(); S.get();
    expect(get).toHaveBeenCalledTimes(1);     // cached for QUIET_HOURS_TTL_MS
  });

  it('reports a source it cannot read instead of hiding it, and does not stay quiet because of it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.MeetingMode = { active: () => { throw new Error('boom'); } };
    expect(S.get().quiet).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it('publishes a change once, to the document and to the main process', () => {
    const state = vi.fn().mockResolvedValue({});
    window.vex = { attention: { state } };
    const seen = [];
    document.addEventListener('vex:attention-state', (e) => seen.push(e.detail.reason));
    globalThis.GameMode = { gaming: true };
    S.changed(); S.changed();
    expect(seen).toEqual(['game']);
    expect(state).toHaveBeenCalledTimes(1);
    expect(state).toHaveBeenCalledWith({ quiet: true, reason: 'game', until: 0 });
  });
});

describe('the Attention Budget', () => {
  it('lets critical and asked through at any moment, and never counts them', () => {
    globalThis.GameMode = { gaming: true };
    for (let i = 0; i < 20; i++) {
      expect(A.request({ feature: 'reminders', urgency: 'critical', id: i }).route).toBe('toast');
      expect(A.request({ feature: 'button', urgency: 'asked', id: i }).route).toBe('toast');
    }
    expect(A.denied()).toEqual([]);
  });

  it('puts a useful request in the inbox while it is a bad moment, and drops an ambient one', () => {
    globalThis.GameMode = { gaming: true };
    const u = req();
    expect(u).toMatchObject({ allow: false, route: 'inbox', reason: 'quiet: game' });
    expect(I.list().map(r => r.title)).toEqual(['Back up?']);
    const a = A.request({ feature: 'medal', urgency: 'ambient', id: 'm', title: 'Medal' });
    expect(a).toMatchObject({ allow: false, route: 'drop' });
    expect(I.count()).toBe(1);
    expect(A.denied().map(d => d.feature)).toEqual(['medal', 'backup']);
  });

  it('allows three non-urgent toasts an hour and twelve a day; the rest wait quietly', () => {
    const ok = [];
    for (let i = 0; i < 5; i++) { ok.push(req({ feature: 'f' + i, id: 'a' }).route); now += 61 * 1000; }
    expect(ok).toEqual(['toast', 'toast', 'toast', 'inbox', 'inbox']);
    expect(A.denied()[0].reason).toBe('hourly limit');
    now += 61 * 60 * 1000;
    expect(req({ feature: 'g', id: 'b' }).route).toBe('toast');
    // The daily cap: twelve in a day in all.
    A.HOUR_CAP = 99;
    let passed = 4;                          // three above + the one just now
    for (let i = 0; i < 20; i++) { if (req({ feature: 'h' + i, id: 'c' }).route === 'toast') passed++; now += 61 * 1000; }
    expect(passed).toBe(12);
    expect(A.denied()[0].reason).toBe('daily limit');
    now += 24 * 3600 * 1000 + 1000;
    expect(req({ feature: 'new', id: 'd' }).route).toBe('toast');
  });

  it('keeps the counts across a restart', () => {
    for (let i = 0; i < 3; i++) req({ feature: 'f' + i });
    load(true);                               // a restart: memory is fresh, storage is not
    expect(req({ feature: 'later' }).route).toBe('inbox');
  });

  it('does not say the same thing twice within ten minutes', () => {
    expect(req().route).toBe('toast');
    expect(req().route).toBe('drop');
    expect(A.denied()).toEqual([]);           // a repeat is not worth listing
    now += 11 * 60 * 1000;
    expect(req().route).toBe('toast');
  });

  it('Never for this feature stops it for good, Show less allows one a day, both can be undone', () => {
    I.add({ feature: 'backup', label: 'Backup reminder', id: 'a', title: 'one' });
    I.add({ feature: 'tabs', label: 'Tab cleanup', id: 'a', title: 'two' });
    const [tabs, backup] = I.list();
    expect(I.never(backup.id)).toBe(true);
    expect(A.isMuted('backup')).toBe(true);
    expect(I.list().map(r => r.feature)).toEqual(['tabs']);          // all of that feature's rows go
    expect(req().route).toBe('drop');
    expect(A.suggest({ feature: 'backup', id: 'z', title: 'again' })).toBe(false);
    expect(A.denied()[0]).toMatchObject({ feature: 'backup', reason: 'muted' });
    expect(I.showLess(tabs.id)).toBe(true);
    expect(A.isLess('tabs')).toBe(true);
    expect(A.request({ feature: 'tabs', urgency: 'useful', id: '1', title: 't' }).route).toBe('toast');
    now += 11 * 60 * 1000;
    expect(A.request({ feature: 'tabs', urgency: 'useful', id: '2', title: 't2' }).route).toBe('inbox');
    expect(A.unmute('backup')).toBe(true);
    expect(A.more('tabs')).toBe(true);
    expect(req({ id: 'fresh' }).route).toBe('toast');
  });

  it('still answers the older gate(kind, id) call the same way', () => {
    A.HOUR_CAP = 99; A.DAY_CAP = 99;
    expect(A.gate('level-up', '3')).toBe(true);
    expect(A.gate('level-up', '3')).toBe(false);
    globalThis.GameMode = { gaming: true };
    expect(A.gate('medal', 'x')).toBe(false);
    expect(A.gate('snooze-due', 'x')).toBe(true);        // something the person asked for
    expect(() => A.gate('', 'x')).toThrow();
  });

  it('refuses a request that is not in a class', () => {
    expect(() => A.request({ feature: 'x', urgency: 'loud' })).toThrow(/Urgency/);
    expect(() => A.request({ feature: '', urgency: 'useful' })).toThrow();
  });
});

describe('Windows toasts raised from the window', () => {
  it('passes the urgency to main and waits in the inbox when main held it back', async () => {
    const notify = vi.fn().mockResolvedValue({ ok: false, suppressed: true, reason: 'hourly limit' });
    window.vex = { notify };
    const r = await A.osNotify({ feature: 'free-games', label: 'Free games', urgency: 'useful', id: 'g', title: 'Free to keep', body: 'Game' });
    expect(notify).toHaveBeenCalledWith('Free to keep', 'Game', { urgency: 'useful', feature: 'free-games', id: 'g' });
    expect(r.suppressed).toBe(true);
    expect(I.list()[0]).toMatchObject({ feature: 'free-games', title: 'Free to keep' });
  });

  it('never reaches Windows for a muted feature', async () => {
    const notify = vi.fn().mockResolvedValue({ ok: true });
    window.vex = { notify };
    A.mute('live-channels');
    const r = await A.osNotify({ feature: 'live-channels', urgency: 'useful', id: 'a', title: 'X is live' });
    expect(notify).not.toHaveBeenCalled();
    expect(r).toMatchObject({ suppressed: true, reason: 'muted' });
    expect(I.count()).toBe(0);
  });

  it('says so when there is no Windows bridge, and raises a bridge failure', async () => {
    expect(await A.osNotify({ feature: 'x', urgency: 'useful', title: 't' })).toMatchObject({ ok: false });
    window.vex = { notify: vi.fn().mockRejectedValue(new Error('Windows refused')) };
    await expect(A.osNotify({ feature: 'x', urgency: 'useful', title: 't' })).rejects.toThrow('Windows refused');
  });
});

describe('the Attention Inbox', () => {
  it('keeps rows across a restart, one per feature and id', () => {
    I.add({ feature: 'backup', id: 'due', title: 'Back up?', action: { label: 'Export now', key: 'export' } });
    I.add({ feature: 'backup', id: 'due', title: 'Back up? (again)' });
    expect(I.count()).toBe(1);
    load(true);
    expect(I.list()[0]).toMatchObject({ feature: 'backup', title: 'Back up? (again)' });
  });

  it('runs a row\'s button through the feature\'s handler and removes the row', () => {
    const fn = vi.fn().mockReturnValue('done');
    I.handle('backup', fn);
    I.add({ feature: 'backup', id: 'due', title: 'Back up?', action: { label: 'Export now', key: 'export' } });
    const id = I.list()[0].id;
    expect(I.run(id)).toBe('done');
    expect(fn).toHaveBeenCalledWith('export', expect.objectContaining({ feature: 'backup' }));
    expect(I.count()).toBe(0);
    I.add({ feature: 'orphan', title: 'x', action: { label: 'Go', key: 'go' } });
    expect(() => I.run(I.list()[0].id)).toThrow(/not loaded/);
  });

  it('holds at most 50 rows and refuses a row with no title', () => {
    for (let i = 0; i < 60; i++) I.add({ feature: 'f' + i, title: 't' + i });
    expect(I.count()).toBe(50);
    expect(() => I.add({ feature: 'f', title: '  ' })).toThrow();
  });

  it('shows the bell only while it holds something, and its dot gives way at three other dots', () => {
    const bell = document.getElementById('btn-attention');
    I.refresh();
    expect(bell.hidden).toBe(true);
    I.add({ feature: 'backup', title: 'Back up?' });
    expect(bell.hidden).toBe(false);
    expect(bell.querySelector('.attention-dot')).not.toBeNull();
    for (let i = 0; i < 3; i++) { const d = document.createElement('span'); d.setAttribute('data-vex-dot', 'panel'); document.body.appendChild(d); }
    I.refresh();
    expect(bell.querySelector('.attention-dot')).toBeNull();
    expect(bell.hidden).toBe(false);          // the list is still there, only the dot gave way
  });

  it('takes the dot away once the list has been opened, and brings it back only for something new', () => {
    const bell = document.getElementById('btn-attention');
    let t = 1000;
    I._now = () => t;
    I.add({ feature: 'recall', title: 'You searched this earlier today' });
    expect(bell.querySelector('.attention-dot')).not.toBeNull();
    t = 2000;
    I.open();
    I.close();
    expect(bell.hidden).toBe(false);          // still listed
    expect(bell.querySelector('.attention-dot')).toBeNull();
    t = 3000;
    I.add({ feature: 'backup', title: 'Back up?' });
    expect(bell.querySelector('.attention-dot')).not.toBeNull();
    delete I._now;
  });

  it('opens a list with Dismiss, Show less and Never for this feature on every row', () => {
    I.add({ feature: 'backup', title: 'Back up?', action: { label: 'Export now', key: 'export' } });
    I.open();
    const labels = Array.from(document.querySelectorAll('#attention-inbox-pop button')).map(b => b.textContent);
    expect(labels).toEqual(['Export now', 'Dismiss', 'Show less', 'Never for this feature']);
    document.querySelector('#attention-inbox-pop button[title="Remove this one"]').click();
    expect(I.count()).toBe(0);
    I.close();
  });

  it('adds nothing while the inbox is switched off', () => {
    I.setEnabled(false);
    expect(I.add({ feature: 'backup', title: 'Back up?' })).toBe(false);
    expect(I.dotVisible()).toBe(false);
  });
});

describe('VexAttention.toast (Wave 6, T0-019)', () => {
  it('shows the toast and returns it when the gate lets the message through', () => {
    window.showToast = vi.fn(() => 'el');
    const t = A.toast({ feature: 'connection', urgency: 'asked', id: 'o' }, 'Back online', 'success', 3000, { a: 1 });
    expect(window.showToast).toHaveBeenCalledWith('Back online', 'success', 3000, { a: 1 });
    expect(t).toBe('el');
  });
  it('shows nothing, and returns null, while the moment is quiet', () => {
    window.showToast = vi.fn(() => 'el');
    localStorage.setItem('vex.fun.quiet', '1');
    const t = A.toast({ feature: 'connection', urgency: 'ambient', id: 'o' }, 'Back online', 'success');
    expect(window.showToast).not.toHaveBeenCalled();
    expect(t).toBe(null);
  });
  it('says so when there is no toast system, instead of dropping the message', () => {
    delete window.showToast;
    expect(() => A.toast({ feature: 'connection', urgency: 'asked', id: 'o' }, 'x')).toThrow(/toast system is not loaded/);
  });
});
