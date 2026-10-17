// The request recorder behind "Copy as request" (src/main/request-recorder.js). Local objects only.
import { describe, it, expect } from 'vitest';

const { createRequestRecorder, SENSITIVE_HEADER, REDACTED } = require('../../src/main/request-recorder');

const req = (extra = {}) => ({ id: 1, webContentsId: 7, method: 'POST', url: 'https://api.example.com/v1/items?q=cats&access_token=abcdefghijklmnopqrstuvwxyz123456', resourceType: 'xhr', ...extra });
const headers = () => ({ Authorization: 'Bearer SECRET-TOKEN-VALUE', Cookie: 'sid=SECRET-COOKIE', 'X-Api-Key': 'SECRET-KEY', 'Content-Type': 'application/json', 'sec-ch-ua': '"x"', 'Accept-Encoding': 'gzip', Accept: '*/*' });

describe('arming', () => {
  it('records nothing until a page is armed, and refuses a page that is not allowed (private, Tor)', () => {
    const r = createRequestRecorder();
    expect(r.recordHeaders(req(), headers())).toBe(false);
    expect(() => r.arm(7, { allowed: false, why: 'Private, Tor and private-window tabs are never recorded' })).toThrow(/never recorded/);
    expect(() => r.arm(7, {})).toThrow();
    expect(() => r.arm(0, { allowed: true })).toThrow(/no page/);
    expect(r.isArmed(7)).toBe(false);
    expect(r.recordHeaders(req(), headers())).toBe(false);
  });
  it('records only the armed page, and stops after five minutes', () => {
    let t = 1000;
    const r = createRequestRecorder({ now: () => t });
    r.arm(7, { allowed: true });
    expect(r.recordHeaders(req({ webContentsId: 8 }), headers())).toBe(false);
    expect(r.recordHeaders(req(), headers())).toBe(true);
    t += 5 * 60 * 1000 + 1;
    expect(r.isArmed(7)).toBe(false);
    expect(r.list(7)).toEqual([]);
    expect(r.recordHeaders(req(), headers())).toBe(false);
  });
  it('disarm forgets the list', () => {
    const r = createRequestRecorder();
    r.arm(7, { allowed: true });
    r.recordHeaders(req(), headers());
    r.disarm(7);
    expect(r.list(7)).toEqual([]);
  });
});

describe('what is kept', () => {
  it('removes authorization, cookies and token headers and the secret address parts as it records, so a secret is never held', () => {
    const r = createRequestRecorder();
    r.arm(7, { allowed: true });
    r.recordHeaders(req(), headers());
    const [rec] = r.list(7);
    const all = JSON.stringify(rec);
    for (const secret of ['SECRET-TOKEN-VALUE', 'SECRET-COOKIE', 'SECRET-KEY', 'abcdefghijklmnopqrstuvwxyz123456']) expect(all).not.toContain(secret);
    expect(rec.headers.find(h => h.name === 'Authorization').value).toBe(REDACTED);
    expect(rec.headers.find(h => h.name === 'Cookie').value).toBe(REDACTED);
    expect(rec.headers.find(h => h.name === 'Content-Type').value).toBe('application/json');
    expect(rec.url).toContain('q=cats');
    expect(rec.method).toBe('POST');
  });
  it('leaves out the headers the browser adds that mean nothing when replayed by hand', () => {
    const r = createRequestRecorder();
    r.arm(7, { allowed: true });
    r.recordHeaders(req(), headers());
    const names = r.list(7)[0].headers.map(h => h.name);
    expect(names).not.toContain('sec-ch-ua');
    expect(names).not.toContain('Accept-Encoding');
    expect(names).toContain('Accept');
  });
  it('keeps no body, skips web sockets, is bounded, and lists the newest first', () => {
    const r = createRequestRecorder({ max: 3 });
    r.arm(7, { allowed: true });
    expect(r.recordHeaders(req({ resourceType: 'webSocket' }), headers())).toBe(false);
    for (let i = 1; i <= 5; i++) r.recordHeaders(req({ id: i, url: 'https://a.example.com/' + i }), { Accept: '*/*' });
    const l = r.list(7);
    expect(l.map(x => x.url)).toEqual(['https://a.example.com/5', 'https://a.example.com/4', 'https://a.example.com/3']);
    expect(Object.keys(l[0])).not.toContain('body');
  });
  it('the status of the answer is added to the request it belongs to; an error is said', () => {
    const r = createRequestRecorder();
    r.arm(7, { allowed: true });
    r.recordHeaders(req({ id: 1 }), {});
    r.recordHeaders(req({ id: 2 }), {});
    expect(r.recordDone({ id: 1, webContentsId: 7, statusCode: 201 })).toBe(true);
    expect(r.recordDone({ id: 2, webContentsId: 7, error: 'net::ERR_CONNECTION_RESET' })).toBe(true);
    const l = r.list(7);
    expect(l.find(x => x.rid === 1).status).toBe(201);
    expect(l.find(x => x.rid === 2).error).toBe('net::ERR_CONNECTION_RESET');
  });
  it('its sensitive-header rule is the one the window uses', () => {
    const { VexCopyAs } = require('../../src/renderer/js/copy-as-request.js');
    expect(SENSITIVE_HEADER.source).toBe(VexCopyAs.SENSITIVE_HEADER.source);
    expect(SENSITIVE_HEADER.flags).toBe(VexCopyAs.SENSITIVE_HEADER.flags);
  });
});
