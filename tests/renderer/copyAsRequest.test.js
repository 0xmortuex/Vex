// @vitest-environment jsdom
//
// Copy as cURL / fetch / PowerShell (js/copy-as-request.js): four formats, secrets redacted unless the
// explicit toggle says otherwise, and what goes to the API playground.
import { describe, it, expect, beforeEach } from 'vitest';
const { VexCopyAs: C } = require('../../src/renderer/js/copy-as-request.js');

const REQ = {
  method: 'POST',
  url: 'https://api.example.com/v1/items?id=3&access_token=SECRET&user=a',
  headers: [{ name: 'Authorization', value: 'Bearer T0KEN' }, { name: 'Content-Type', value: 'application/json' }, { name: 'X-Foo', value: "it's" }],
  body: '{"password":"hunter2","name":"a"}',
};

beforeEach(() => { localStorage.clear(); });

describe('the four formats', () => {
  it('cURL for bash quotes with single quotes', () => {
    expect(C.format(REQ, 'curl-bash', { includeAuth: true })).toBe(
      "curl -X POST 'https://api.example.com/v1/items?id=3&access_token=SECRET&user=a' -H 'Authorization: Bearer T0KEN' -H 'Content-Type: application/json' -H 'X-Foo: it'\\''s' --data-raw '{\"password\":\"hunter2\",\"name\":\"a\"}'");
  });
  it('cURL for cmd quotes with double quotes', () => {
    const s = C.format({ method: 'GET', url: 'https://a.example/x', headers: [{ name: 'X-A', value: 'b' }] }, 'curl-cmd');
    expect(s).toBe('curl "https://a.example/x" -H "X-A: b"');
  });
  it('PowerShell uses Invoke-RestMethod, -ContentType and doubled single quotes', () => {
    const s = C.format(REQ, 'powershell', { includeAuth: true });
    expect(s).toContain("Invoke-RestMethod -Method Post -Uri 'https://api.example.com/v1/items?id=3&access_token=SECRET&user=a'");
    expect(s).toContain("-Headers @{ 'Authorization' = 'Bearer T0KEN'; 'X-Foo' = 'it''s' }");
    expect(s).toContain("-ContentType 'application/json'");
    expect(s).toContain("-Body '{\"password\":\"hunter2\",\"name\":\"a\"}'");
  });
  it('fetch is valid JavaScript with JSON-escaped strings', () => {
    const s = C.format(REQ, 'fetch', { includeAuth: true });
    expect(s.startsWith('fetch("https://api.example.com/')).toBe(true);
    expect(s).toContain('method: "POST",');
    expect(s).toContain('"X-Foo": "it\'s",');
    expect(() => new Function('fetch', s)(() => 0)).not.toThrow();
  });
  it('a body on GET and HEAD is dropped', () => {
    expect(C.format({ method: 'GET', url: 'https://a.example/', body: 'x' }, 'curl-bash')).toBe("curl 'https://a.example/'");
  });
  it('HEAD is -I', () => {
    expect(C.format({ method: 'HEAD', url: 'https://a.example/' }, 'curl-bash')).toBe("curl -I 'https://a.example/'");
  });
});

describe('secrets are left out unless the toggle says otherwise', () => {
  it('redacts sensitive headers, query values and body fields by default', () => {
    for (const kind of Object.keys(C.FORMATS)) {
      const s = C.format(REQ, kind);
      expect(s, kind).not.toContain('T0KEN');
      expect(s, kind).not.toContain('SECRET');
      expect(s, kind).not.toContain('hunter2');
      expect(s, kind).toContain('<REDACTED>');
      expect(s, kind).toContain('id=3');
    }
  });
  it('keeps them when the toggle is on', () => {
    const s = C.format(REQ, 'curl-bash', { includeAuth: true });
    expect(s).toContain('T0KEN');
    expect(s).toContain('SECRET');
    expect(s).toContain('hunter2');
  });
  it('removes user:password@ from the address', () => {
    expect(C.format({ method: 'GET', url: 'https://me:pw@a.example/p' }, 'curl-bash')).toBe("curl 'https://a.example/p'");
  });
  it('treats cookies and token-like header names as sensitive', () => {
    for (const n of ['Cookie', 'X-Api-Key', 'Authorization', 'X-Auth-Token', 'X-Session-Id', 'Proxy-Authorization']) expect(C.isSensitiveHeader(n), n).toBe(true);
    for (const n of ['Content-Type', 'Accept', 'User-Agent']) expect(C.isSensitiveHeader(n), n).toBe(false);
  });
  it('counts what it replaced', () => { expect(C.redactedCount(REQ)).toBe(3); });
  it('for the playground, sensitive headers are left out, not sent as a placeholder', () => {
    expect(C.redact(REQ, { drop: true }).headers.map(h => h.name)).toEqual(['Content-Type', 'X-Foo']);
    expect(C.redact(REQ, { includeAuth: true, drop: true }).headers.length).toBe(3);
  });
});

describe('input is checked', () => {
  it('bad method, bad address, bad header', () => {
    expect(() => C.format({ method: 'TRACE', url: 'https://a/' }, 'fetch')).toThrow(/Method not allowed/);
    expect(() => C.format({ url: 'ftp://a/' }, 'fetch')).toThrow(/http/);
    expect(() => C.format({ url: 'https://a/', headers: [{ name: 'Bad Name', value: 'x' }] }, 'fetch')).toThrow(/not a valid header name/);
    expect(() => C.format({ url: 'https://a/', headers: [{ name: 'X-A', value: 'a\nb' }] }, 'fetch')).toThrow(/line break/);
    expect(() => C.format(REQ, 'perl')).toThrow(/Unknown format/);
  });
  it('parses header lines', () => {
    expect(C.parseHeaders('A: b\n\nC: d: e')).toEqual([{ name: 'A', value: 'b' }, { name: 'C', value: 'd: e' }]);
    expect(() => C.parseHeaders('no colon')).toThrow(/Name: value/);
  });
});

describe('sending to the API playground', () => {
  it('passes the redacted request, with no sensitive header', () => {
    let got = null;
    globalThis.ApiPlayground = { open: (p) => { got = p; return 'opened'; } };
    expect(C.toPlayground(REQ)).toBe('opened');
    expect(got.method).toBe('POST');
    expect(got.url).toContain('access_token=<REDACTED>');
    expect(got.headers.map(h => h.name)).toEqual(['Content-Type', 'X-Foo']);
    delete globalThis.ApiPlayground;
  });
  it('says so when the playground is missing', () => {
    delete globalThis.ApiPlayground;
    expect(() => C.toPlayground(REQ)).toThrow(/not available/);
  });
});
