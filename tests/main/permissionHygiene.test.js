// T2-084: permission hygiene (src/main/permission-hygiene.js): expiry, pins, the trap guard, the live
// indicator, the Settings summary and the IPC wiring, with stand-ins for Electron.
import { describe, it, expect, vi } from 'vitest';

const H = require('../../src/main/permission-hygiene.js');
const DAY = H.DAY_MS;

const make = (config = {}, extra = {}) => {
  let t = 1_000_000;
  const events = [];
  const h = H.createPermissionHygiene({ now: () => t, emit: (what, p) => events.push([what, p]), ...extra });
  if (config) h.setConfig({ enabled: true, ...config });
  return { h, events, tick: (ms) => { t += ms; }, now: () => t };
};

describe('settings', () => {
  it('starts off', () => {
    const h = H.createPermissionHygiene({});
    expect(h.getConfig().enabled).toBe(false);
    expect(h.expiryFor('https://a.com', 'camera')).toBe(null);
    expect(h.trap({ origin: 'https://a.com', permission: 'notifications', gesture: false })).toBe(null);
  });
  it('refuses a setting that is not a switch or a sensible number of days', () => {
    const h = H.createPermissionHygiene({});
    expect(() => h.setConfig({ expiryDays: 0 })).toThrow(/1 to 365/);
    expect(() => h.setConfig({ expiryDays: 2.5 })).toThrow(/days/);
    expect(() => h.setConfig({ trapGuard: 'yes' })).toThrow(/on or off/);
  });
});

describe('expiry', () => {
  it('gives a kept sensitive permission an end date N days away', () => {
    const { h, now } = make({ expiryDays: 14 });
    expect(h.expiryFor('https://a.com', 'microphone')).toBe(now() + 14 * DAY);
  });
  it('leaves out permissions that do not decay and a switched-off expiry', () => {
    const { h } = make({ expiry: false });
    expect(h.expiryFor('https://a.com', 'camera')).toBe(null);
    const b = make({}).h;
    expect(b.expiryFor('https://a.com', 'popups')).toBe(null);
    expect(b.expiryFor('https://a.com', 'automatic-downloads')).toBe(null);
  });
  it('never ends a pinned site, and the pin covers every container', () => {
    const { h } = make({});
    h.setPinned('https://a.com (in the work container)::camera', true);
    expect(h.isPinned('https://a.com', 'camera')).toBe(true);
    expect(h.expiryFor('https://a.com', 'camera')).toBe(null);
    expect(h.expiryFor('https://a.com', 'microphone')).not.toBe(null);
    h.setPinned('https://a.com::camera', false);
    expect(h.expiryFor('https://a.com', 'camera')).not.toBe(null);
  });
  it('rejects a key without a permission', () => {
    expect(() => make({}).h.setPinned('https://a.com', true)).toThrow(/Not a permission key/);
  });
});

describe('trap guard', () => {
  it('quiets a prompt with no click and lists it', () => {
    const { h, events } = make({});
    const q = h.trap({ origin: 'https://spam.example', permission: 'notifications', gesture: false, contentsId: 7 });
    expect(q).toMatchObject({ origin: 'https://spam.example', permission: 'notifications', contentsId: 7 });
    expect(h.quieted()).toHaveLength(1);
    expect(events[0][0]).toBe('quieted');
  });
  it('lets a prompt that follows a click through, and ignores the camera', () => {
    const { h } = make({});
    expect(h.trap({ origin: 'https://a.com', permission: 'notifications', gesture: true })).toBe(null);
    expect(h.trap({ origin: 'https://a.com', permission: 'camera', gesture: false })).toBe(null);
  });
  it('is off when its switch is off, and keeps only the newest twenty', () => {
    const { h } = make({ trapGuard: false });
    expect(h.trap({ origin: 'https://a.com', permission: 'geolocation', gesture: false })).toBe(null);
    const g = make({}).h;
    for (let i = 0; i < 25; i++) g.trap({ origin: 'https://s' + i + '.com', permission: 'geolocation', gesture: false });
    expect(g.quieted()).toHaveLength(20);
  });
  it('hands out a quieted request once, and says so when it is gone', () => {
    const { h } = make({});
    const q = h.trap({ origin: 'https://a.com', permission: 'notifications', gesture: false });
    expect(h.takeQuieted(q.id).origin).toBe('https://a.com');
    expect(() => h.takeQuieted(q.id)).toThrow(/no longer/);
  });
});

describe('live indicator', () => {
  const page = (id) => { const handlers = {}; return { id, on: (e, f) => { handlers[e] = f; }, once: (e, f) => { handlers[e] = f; }, handlers }; };
  it('records the devices a tab was given and clears them on navigation', () => {
    const { h, events } = make({});
    const p = page(3);
    expect(h.noteUse(p, 'https://meet.example', ['camera', 'microphone'])).toBe(true);
    expect(h.liveFor(3).parts.sort()).toEqual(['camera', 'microphone']);
    p.handlers['did-navigate']();
    expect(h.liveFor(3)).toBe(null);
    expect(events.filter(e => e[0] === 'live').pop()[1].parts).toEqual([]);
  });
  it('ignores permissions that are not a device, and a switched-off indicator', () => {
    const { h } = make({});
    expect(h.noteUse(page(1), 'https://a.com', ['notifications'])).toBe(false);
    const off = make({ indicator: false }).h;
    expect(off.noteUse(page(2), 'https://a.com', ['camera'])).toBe(false);
  });
});

describe('summarize', () => {
  const now = 10 * DAY;
  const decisions = {
    'https://a.com::camera': 'allow', 'https://a.com::microphone': 'allow', 'https://b.com::microphone': 'allow',
    'https://c.com (in the work container)::geolocation': 'allow', 'https://d.com::notifications': 'deny',
    'https://old.com::camera': 'allow', 'https://x.com::popups': 'allow',
    __until__: { 'https://a.com::camera': now + 2 * DAY, 'https://old.com::camera': now - 1, 'https://b.com::microphone': now + 40 * DAY },
  };
  it('counts sites per device, drops what has ended and what does not decay', () => {
    const s = H.summarize(decisions, {}, now);
    expect(s.lines).toContain('2 sites can use your microphone');
    expect(s.lines).toContain('1 site can use your camera');
    expect(s.rows.find(r => r.origin === 'https://old.com')).toBeUndefined();
    expect(s.rows.find(r => r.permission === 'popups')).toBeUndefined();
    expect(s.rows.find(r => r.permission === 'geolocation').where).toBe('in the work container');
  });
  it('lists the grants about to end, not the pinned ones', () => {
    expect(H.summarize(decisions, {}, now).soon.map(r => r.key)).toEqual(['https://a.com::camera']);
    expect(H.summarize(decisions, { 'https://a.com::camera': 1 }, now).soon).toEqual([]);
    expect(H.soonLine(H.summarize(decisions, {}, now).soon[0], now)).toBe('https://a.com can use your camera for 2 more days');
  });
});

describe('IPC', () => {
  const wire = (over = {}) => {
    const { h } = make({});
    const handlers = new Map();
    const ipcMain = { handle: (c, f) => handlers.set(c, f) };
    let decisions = { 'https://a.com::camera': 'allow', __until__: { 'https://a.com::camera': 5 } };
    const setPageDecision = vi.fn(async () => {});
    const page = { reload: vi.fn() };
    const owner = {};
    H.registerPermissionHygiene({
      ipcMain, hygiene: h, loadDecisions: () => JSON.parse(JSON.stringify(decisions)), saveDecisions: async (d) => { decisions = d; }, setPageDecision,
      getContents: (id) => (id === 9 ? page : null), ownerOf: () => owner, now: () => 100, ...over,
    });
    return { h, handlers, get decisions() { return decisions; }, setPageDecision, page };
  };
  it('pins a grant and removes its end date, and unpinning gives it a new one', async () => {
    const w = wire();
    await w.handlers.get('hygiene:perm-pin')({}, 'https://a.com::camera', true);
    expect(w.decisions.__until__).toBeUndefined();
    await w.handlers.get('hygiene:perm-pin')({}, 'https://a.com::camera', false);
    expect(w.decisions.__until__['https://a.com::camera']).toBeGreaterThan(100);
  });
  it('refuses to pin a permission that is no longer saved', async () => {
    await expect(wire().handlers.get('hygiene:perm-pin')({}, 'https://zz.com::camera', true)).rejects.toThrow(/no longer saved/);
  });
  it('allows a quieted request through the tab that asked, and says when the tab is gone', async () => {
    const w = wire();
    const q = w.h.trap({ origin: 'https://s.com', permission: 'notifications', gesture: false, contentsId: 9 });
    await w.handlers.get('hygiene:perm-decide')({ sender: {} }, q.id, 'allow');
    expect(w.setPageDecision).toHaveBeenCalledWith(w.page, 'https://s.com', 'notifications', 'allow');
    const gone = w.h.trap({ origin: 'https://t.com', permission: 'notifications', gesture: false, contentsId: 4 });
    await expect(w.handlers.get('hygiene:perm-decide')({ sender: {} }, gone.id, 'allow')).rejects.toThrow(/closed/);
  });
  it('stops a tab: blocks what it was given and reloads it', async () => {
    const w = wire();
    const p = { id: 9, on() {}, once() {} };
    w.h.noteUse(p, 'https://meet.example', ['camera']);
    const r = await w.handlers.get('hygiene:perm-stop')({ sender: {} }, 9);
    expect(r.blocked).toEqual(['camera']);
    expect(w.setPageDecision).toHaveBeenCalledWith(w.page, 'https://meet.example', 'camera', 'deny');
    expect(w.page.reload).toHaveBeenCalled();
    await expect(w.handlers.get('hygiene:perm-stop')({ sender: {} }, 9)).rejects.toThrow(/Nothing is using/);
  });
  it('refuses another window\'s tab and everything while Vex is locked', async () => {
    const w = wire({ ownerOf: (c) => c });
    await expect(w.handlers.get('hygiene:perm-stop')({ sender: { x: 1 } }, 9)).rejects.toThrow(/another window/);
    const locked = wire({ isLocked: () => true });
    expect(() => locked.handlers.get('hygiene:perm-summary')()).toThrow(/locked/);
  });
});
