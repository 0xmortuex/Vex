// @vitest-environment jsdom
//
// The co-op focus timer client, driven through real fetch calls against the
// in-process stand-in for the relay (tests/helpers/coopRelay.js). No outside
// network is used.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';
import { startCoopRelay } from '../helpers/coopRelay.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../..');
const fresh = () => { const r = require.resolve(path.join(ROOT, 'src/renderer/js/coop-timer.js')); delete require.cache[r]; return require(r).CoopTimer; };

let relay, T, confirm;
beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div class="settings-content"><div class="setting-group" id="settings-profiles"></div></div>';
  window.fetch = globalThis.fetch;
  window.showToast = vi.fn();
  confirm = vi.fn(async () => true);
  window.vexConfirm = confirm;
  delete window.FocusMode;
  relay = await startCoopRelay();
  T = fresh();
});
afterEach(async () => { T._reset(); await relay.close(); });

const other = async (code, name) => {
  const r = await fetch(relay.url + '/v1/room/' + code + '/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  return r.json();
};

describe('unavailable until a relay address is set', () => {
  it('has no built-in host, says so, and sends nothing', async () => {
    expect(T.isAvailable()).toBe(false);
    expect(T.relayUrl()).toBe('');
    await expect(T.create('Sam')).rejects.toThrow(/unavailable/i);
    const host = T.mountSettings();
    expect(host.textContent).toMatch(/Unavailable/);
    expect(host.textContent).toMatch(/nothing is sent/i);
    expect(relay.requests.length).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not hardcode any host in its source', () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'src/renderer/js/coop-timer.js'), 'utf8');
    expect(src).not.toMatch(/workers\.dev|mortuex/);
    expect(src.match(/https?:\/\/[^\s'"`)]+/g) || []).toEqual(['https://your-relay.example']);
  });

  it('accepts only https, or http on this computer', () => {
    expect(T.normalizeRelayUrl(' https://a.example/ ')).toBe('https://a.example');
    expect(T.normalizeRelayUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(T.normalizeRelayUrl('')).toBe('');
    for (const bad of ['http://a.example', 'ftp://a.example', 'nonsense', 'https://u:p@a.example', 'https://a.example/?x=1', 'https://a.example/#y']) {
      expect(() => T.normalizeRelayUrl(bad), bad).toThrow();
    }
  });
});

describe('a room', () => {
  beforeEach(() => { T.setRelayUrl(relay.url); });

  it('asks once, saying exactly what is sent, and sends nothing when declined', async () => {
    confirm.mockResolvedValueOnce(false);
    expect(await T.create('Sam')).toBeNull();
    expect(relay.requests.length).toBe(0);
    const opts = confirm.mock.calls[0][0];
    expect(opts.message).toMatch(/room code/);
    expect(opts.message).toMatch(/name you chose/);
    expect(opts.message).toMatch(/start, pause, resume or end/);
    expect(opts.message).toMatch(/Nothing else is sent/);
    expect(opts.message).toContain(relay.url);
    const code = await T.create('Sam');
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await T.leave();
    await T.create('Sam');
    expect(confirm).toHaveBeenCalledTimes(2);   // the declined ask and the accepted one; not asked a third time
  });

  it('shares one timer between two people', async () => {
    const code = await T.create('Sam');
    const b = await other(code, 'Alex');
    expect(b.ok).toBe(true);
    await T.start(25);
    let v = T.view();
    expect(v.inRoom).toBe(true);
    expect(v.status).toBe('running');
    expect(v.durationMs).toBe(25 * 60000);
    expect(v.remainingMs).toBeGreaterThan(24 * 60000);
    expect(v.members.map(m => m.name)).toEqual(['Sam', 'Alex']);

    // Alex pauses; Sam sees it on the next refresh.
    await fetch(`${relay.url}/v1/room/${code}/pause`, { method: 'POST', headers: { authorization: 'Bearer ' + b.secret, 'content-type': 'application/json' }, body: '{}' });
    await T.refresh();
    expect(T.view().status).toBe('paused');
    await T.resume();
    expect(T.view().status).toBe('running');
    await T.end();
    expect(T.view().status).toBe('idle');
  });

  it('sends only the room code, a name and minutes: nothing about browsing', async () => {
    window.TabManager = { getActiveTab: () => ({ url: 'https://secret.example/page', title: 'Private thing' }) };
    const code = await T.create('Sam');
    await T.start(25);
    await T.pause();
    await T.resume();
    await T.refresh();
    await T.leave();
    expect(code).toBeTruthy();
    const wire = JSON.stringify(relay.requests.map(r => [r.method, r.path, r.body]));
    expect(wire).not.toMatch(/secret\.example|Private thing|cookie/i);
    for (const r of relay.requests) {
      expect(r.path).toMatch(/^\/v1\/room(\/[A-Z2-9]{6}(\/(join|start|pause|resume|end|leave))?)?$/);
      if (r.body) expect(Object.keys(JSON.parse(r.body)).every(k => ['name', 'minutes'].includes(k))).toBe(true);
      expect(r.headers.cookie).toBeUndefined();
      expect(r.headers.referer).toBeUndefined();
    }
  });

  it('validates what the person typed before sending', async () => {
    await expect(T.create('   ')).rejects.toThrow(/display name/i);
    await expect(T.join('ab', 'Sam')).rejects.toThrow(/6 letters/);
    await expect(T.join('ABCDEF', '')).rejects.toThrow(/display name/i);
    expect(relay.requests.length).toBe(0);
  });

  it('reports a missing room plainly and does not stay in it', async () => {
    await expect(T.join('ABCDEF', 'Sam')).rejects.toThrow(/No such room/);
    expect(T.view().inRoom).toBe(false);
  });

  it('drops the session when the room is gone', async () => {
    await T.create('Sam');
    relay.env.COOP_ROOMS.objs.clear();
    await expect(T.refresh()).rejects.toMatchObject({ roomClosed: true });
    expect(T.view().inRoom).toBe(false);
  });

  it('is reachable-failure explicit, not silent', async () => {
    T.setRelayUrl('http://127.0.0.1:9');
    await expect(T.create('Sam')).rejects.toThrow(/Could not reach the relay/);
  });

  it('can run Focus mode alongside, only when asked', async () => {
    const fm = { active: false, start: vi.fn(function () { this.active = true; }), stop: vi.fn(function () { this.active = false; }) };
    window.FocusMode = fm;
    await T.create('Sam');
    await T.start(25);
    expect(fm.start).not.toHaveBeenCalled();
    await T.end();

    T.setFocusLinked(true);
    await T.start(25);
    expect(fm.start).toHaveBeenCalledWith(25);
    await T.end();
    expect(fm.stop).toHaveBeenCalledTimes(1);
  });

  it('draws its panel in a module-owned Settings group', async () => {
    const host = T.mountSettings();
    const group = document.getElementById('settings-coop-timer');
    expect(group.nextElementSibling.id).toBe('settings-profiles');
    expect(group.querySelector('.setting-label').textContent).toBe('Co-op focus timer');
    expect(host.textContent).toMatch(/Start a room/);
    await T.create('Sam');
    T.render(host);
    expect(host.textContent).toMatch(/Room code:/);
    expect(host.textContent).toMatch(/Sam \(you\)/);
    expect(host.querySelectorAll('button').length).toBeGreaterThan(1);
  });

  it('is not given a second Settings group if mounted twice', () => {
    T.mountSettings(); T.mountSettings();
    expect(document.querySelectorAll('#settings-coop-timer').length).toBe(1);
  });
});
