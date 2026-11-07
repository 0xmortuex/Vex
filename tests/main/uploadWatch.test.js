// @vitest-environment node
import { describe, it, expect } from 'vitest';
const { createUploadWatch, watched, label } = require('../../src/main/upload-watch');

function fixture() {
  let t = 0;
  const timers = [];
  const lines = [];
  const watch = createUploadWatch({
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimer: (h) => { h.cleared = true; },
    log: (l) => lines.push(l),
    waitMs: 20000,
  });
  const fire = () => timers.filter(h => !h.cleared).forEach(h => { h.cleared = true; h.fn(); });
  return { watch, lines, fire, advance: (ms) => { t += ms; } };
}

describe('upload watch', () => {
  it('watches uploads only', () => {
    expect(watched({ url: 'https://discord-attachments-uploads-prd.storage.googleapis.com/x', method: 'PUT' })).toBeTruthy();
    expect(watched({ url: 'https://discord.com/api/v9/channels/123456789/attachments', method: 'POST' })).toBeTruthy();
    expect(watched({ url: 'https://discord.com/api/v9/users/@me', method: 'GET' })).toBeNull();
    expect(watched({ url: 'https://example.com/upload', method: 'POST' })).toBeNull();
    expect(watched({ url: 'https://discord.com.evil.test/x', method: 'POST' })).toBeNull();
  });
  it('hides ids in the label', () => {
    expect(label(new URL('https://discord.com/api/v9/channels/123456789/attachments'), 'POST')).toBe('POST discord.com/api/v9/channels/#/attachments');
  });
  it('says the hook did not answer when it never calls back', () => {
    const f = fixture();
    f.watch.wrap({ id: 1, url: 'https://discord.com/api/v9/channels/123456789/attachments', method: 'POST' }, 'persist:main', () => {});
    f.advance(20000); f.fire();
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toContain('has NOT answered');
  });
  it('says the network is waiting when the hook answered', () => {
    const f = fixture();
    const cb = f.watch.wrap({ id: 2, url: 'https://discord-attachments-uploads-prd.storage.googleapis.com/a', method: 'PUT' }, 'persist:main', () => 'ok');
    expect(cb({ cancel: false })).toBe('ok');
    f.advance(20000); f.fire();
    expect(f.lines[0]).toContain('had answered');
  });
  it('is silent for a quick, ordinary finish and leaves other requests alone', () => {
    const f = fixture();
    const orig = () => {};
    expect(f.watch.wrap({ id: 3, url: 'https://example.com/', method: 'GET' }, 't', orig)).toBe(orig);
    f.watch.wrap({ id: 4, url: 'https://discord.com/api/v9/x', method: 'POST' }, 't', () => {});
    f.advance(500);
    expect(f.watch.done({ id: 4 }, 'completed 200')).toBe(true);
    expect(f.lines).toHaveLength(0);
    expect(f.watch.openCount()).toBe(0);
  });
  it('logs a failure', () => {
    const f = fixture();
    f.watch.wrap({ id: 5, url: 'https://discord.com/api/v9/x', method: 'POST' }, 't', () => {});
    f.watch.done({ id: 5 }, 'error net::ERR_CONNECTION_RESET');
    expect(f.lines[0]).toContain('ERR_CONNECTION_RESET');
  });
});
