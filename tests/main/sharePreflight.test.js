// T0-014: a refused screen share says why.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const { explain, preflight, createShareLog, requesterIdentity, requesterChange, hostOf, REASONS } = require('../../src/main/share-preflight.js');

describe('current main-frame identity', () => {
  const fixture = () => {
    const frame = { detached: true, origin: 'https://discord.com', frameToken: 'document-a', processId: 30, isDestroyed: () => false };
    const contents = { mainFrame: frame, isDestroyed: () => false };
    return { frame, contents, identity: requesterIdentity(frame, contents) };
  };
  it('accepts a stale detached flag only for the exact live primary document', () => {
    const { frame, identity } = fixture();
    expect(identity).not.toBeNull();
    expect(requesterChange(frame, 'https://discord.com/', identity)).toBeNull();
    expect(requesterChange(frame, 'https://discord.com/')).toBe('frame-detached');
    expect(requesterChange(frame, 'https://other.test/', identity)).toBe('origin-changed');
  });
  it.each(['token', 'process', 'main', 'destroyed', 'closed'])('rejects a changed %s even on the same origin', kind => {
    const { frame, contents, identity } = fixture();
    if (kind === 'token') frame.frameToken = 'document-b';
    if (kind === 'process') frame.processId++;
    if (kind === 'main') contents.mainFrame = { ...frame };
    if (kind === 'destroyed') frame.isDestroyed = () => true;
    if (kind === 'closed') contents.isDestroyed = () => true;
    expect(requesterChange(frame, 'https://discord.com/', identity)).toBe('frame-detached');
  });
  it('does not adopt the containing page for a detached child frame', () => {
    const { frame, contents } = fixture();
    contents.mainFrame = { ...frame };
    expect(requesterIdentity(frame, contents)).toBeNull();
    expect(requesterChange(frame, 'https://discord.com/')).toBe('frame-detached');
  });
});

describe('explain', () => {
  it('names the site and offers the fix for a saved Block', () => {
    const e = explain('permission-denied', { host: 'discord.com' });
    expect(e.message).toMatch(/blocked for discord\.com/);
    expect(e.fix).toEqual({ id: 'allow-screen-share', label: 'Allow screen sharing here' });
  });
  it('throws for a reason it does not know instead of inventing one', () => {
    expect(() => explain('because')).toThrow(/Not a known screen-share reason/);
  });
  it('every reason says something in plain words', () => {
    for (const code of Object.keys(REASONS)) {
      const e = explain(code, { host: 'example.com', error: 'x' });
      expect(e.message.length).toBeGreaterThan(15);
      expect(e.message).not.toMatch(/undefined|\[object/);
    }
  });
});

describe('preflight', () => {
  const base = { url: 'https://discord.com/channels/1', saved: null, paranoid: false, tor: false, sourcesCount: 2, capturerError: '' };
  it('passes when nothing is in the way', () => {
    const r = preflight(base);
    expect(r.ok).toBe(true);
    expect(r.refusal).toBeNull();
    expect(r.checks.every(c => c.ok)).toBe(true);
  });
  it('reports a saved Block first, with the fix', () => {
    const r = preflight({ ...base, saved: 'deny' });
    expect(r.ok).toBe(false);
    expect(r.refusal.code).toBe('permission-denied');
    expect(r.refusal.fix.id).toBe('allow-screen-share');
  });
  it('reports paranoid mode, a Tor tab and an insecure page', () => {
    expect(preflight({ ...base, paranoid: true }).refusal.code).toBe('paranoid-mode');
    expect(preflight({ ...base, tor: true }).refusal.code).toBe('tor-tab');
    expect(preflight({ ...base, url: 'http://discord.com/' }).refusal.code).toBe('insecure-page');
    expect(preflight({ ...base, url: 'about:blank' }).refusal.code).toBe('insecure-page');
  });
  it('reports Windows listing no screens, or failing to list them', () => {
    expect(preflight({ ...base, sourcesCount: 0 }).refusal.code).toBe('no-sources');
    const r = preflight({ ...base, sourcesCount: 0, capturerError: 'Could not start capture' });
    expect(r.refusal.code).toBe('capturer-error');
    expect(r.refusal.message).toMatch(/Could not start capture/);
  });
  it('lists every check, not only the first failure', () => {
    const r = preflight({ ...base, saved: 'deny', paranoid: true });
    expect(r.checks.filter(c => !c.ok).length).toBe(2);
    expect(r.refusal.code).toBe('paranoid-mode');
  });
  it('skips the Windows check when the list was not asked for', () => {
    const r = preflight({ ...base, sourcesCount: null });
    expect(r.checks.find(c => c.id === 'sources')).toBeUndefined();
  });
});

describe('requesterChange (what the v22.22.1 same-site rule decides)', () => {
  it('accepts a live inherited-origin frame even with an empty or about:blank URL', () => {
    for (const url of ['', 'about:blank', 'about:srcdoc']) {
      const frame = { detached: false, url, origin: 'https://discord.com' };
      expect(requesterChange(frame, 'https://discord.com/')).toBeNull();
      expect(hostOf(frame)).toBe('discord.com');
    }
  });
  it('allows same-origin route changes but refuses opaque and cross-origin frames', () => {
    expect(requesterChange({ url: 'https://discord.com/b' }, 'https://discord.com/a')).toBeNull();
    expect(requesterChange({ origin: 'null', url: 'https://discord.com/a' }, 'https://discord.com/')).toBe('origin-unavailable');
    expect(requesterChange({ origin: 'https://evil.test', url: '' }, 'https://discord.com/')).toBe('origin-changed');
    expect(requesterChange({ detached: true, origin: 'https://discord.com' }, 'https://discord.com/')).toBe('frame-detached');
  });
  it('does not misreport an unreadable frame as closed', () => {
    expect(requesterChange({ get origin() { throw new Error('unreadable'); } }, 'https://discord.com/')).toBe('frame-unreadable');
  });
  it('tells a detached frame, a frame on another site and a missing frame apart', () => {
    expect(requesterChange(null, 'https://discord.com/a')).toBe('no-frame');
    expect(requesterChange({ detached: true, url: 'https://discord.com/a' }, 'https://discord.com/a')).toBe('frame-detached');
    expect(requesterChange({ detached: false, url: 'https://evil.test/a' }, 'https://discord.com/a')).toBe('origin-changed');
  });
  it('hostOf names the frame\'s site, and nothing for a detached one', () => {
    expect(hostOf({ detached: false, url: 'https://discord.com/x' })).toBe('discord.com');
    expect(hostOf({ detached: true, url: 'https://discord.com/x' })).toBe('');
  });
});

describe('the refusal log', () => {
  it('keeps host and reason only, newest first, bounded', () => {
    const log = createShareLog(3);
    for (let i = 0; i < 5; i++) log.record(i % 2 ? 'pick-timeout' : 'no-sources', { host: 'h' + i });
    const list = log.list();
    expect(list.length).toBe(3);
    expect(list[0].host).toBe('h4');
    expect(Object.keys(list[0]).sort()).toEqual(['code', 'host', 'message', 't']);
    expect(log.counts()).toEqual({ 'pick-timeout': 1, 'no-sources': 2 });
  });
});

describe('main.js leaves no refusal unexplained', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/main.js'), 'utf8');
  const start = src.indexOf('function wireDisplayMediaOnSession');
  const end = src.indexOf("ipcMain.handle('screen-share:get-quality'");
  const block = src.slice(start, end);
  it('each way the request handler can give up records its reason', () => {
    for (const code of ['no-sources', 'pick-timeout', 'capturer-error', 'not-in-a-tab']) expect(block).toContain("'" + code + "'");
    expect(block).toContain('requesterChange(');
  });
  it('the pick answers with the reason and the fix', () => {
    expect(block).toMatch(/refuse\('request-expired'/);
    expect(block).toMatch(/refuse\('source-gone'/);
    expect(block).toMatch(/refuse\('start-failed'/);
  });
});

describe('ByeDPI and the session partition (T0-014)', () => {
  const base = { url: 'https://discord.com/channels/1', saved: null, paranoid: false, tor: false, partition: 'persist:discord', partitionWired: true, byedpiRunning: false };
  it('a Strong bypass carrying a Discord page is a warning with a fix, not a refusal', () => {
    const r = preflight({ ...base, byedpiRunning: true });
    expect(r.refusal).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: 'byedpi-on', fix: { id: 'open-bypass-settings' } });
    expect(r.checks.find(c => c.id === 'byedpi').ok).toBe(false);
  });
  it('ByeDPI running does not matter for a page it is not carrying', () => {
    const r = preflight({ ...base, url: 'https://meet.example.com/', partition: 'persist:main', byedpiRunning: true });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('a Discord page in a normal tab is carried too', () => {
    expect(preflight({ ...base, partition: 'persist:main', byedpiRunning: true }).warnings).toHaveLength(1);
  });
  it('a session without the picker attached refuses, with the partition named', () => {
    const r = preflight({ ...base, partitionWired: false });
    expect(r.refusal.code).toBe('partition-unwired');
    expect(r.checks.find(c => c.id === 'partition').ok).toBe(false);
  });
  it('localhost over http counts as secure; other http pages do not', () => {
    expect(preflight({ ...base, url: 'http://localhost:3000/' }).refusal).toBeNull();
    expect(preflight({ ...base, url: 'http://example.com/' }).refusal.code).toBe('insecure-page');
  });
  it('main.js runs the preflight before every picker, not only from Ctrl+K', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
    const handler = src.slice(src.indexOf('ses.setDisplayMediaRequestHandler('), src.indexOf('desktopCapturer.getSources({ types: [\'screen\', \'window\'], thumbnailSize: { width: 320'));
    expect(handler).toMatch(/_sharePreflight\.preflight\(_shareFacts\(requestingContents\)\)/);
    expect(handler).toMatch(/pre\.refusal/);
    expect(src).toMatch(/_byedpiRunning = \(\) => _byedpi\.isRunning\(\)/);
  });
});
