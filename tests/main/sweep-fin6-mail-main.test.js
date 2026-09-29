// Mail sign-in fixes found live against local IMAP servers (2026-09-29): a
// local bridge's self-made certificate, plain-language TLS errors.
import { describe, expect, it, vi } from 'vitest';
const { createMail } = require('../../src/main/mail.js');

function setup({ fail } = {}) {
  const made = [];
  class FakeImap {
    constructor(opts) { this.opts = opts; made.push(this); }
    async connect() { if (fail) throw fail(); }
    async logout() {}
    close() {}
  }
  const files = new Map();
  const secrets = { read: vi.fn(async (f) => (files.has(f) ? JSON.parse(files.get(f)) : null)), write: vi.fn(async (f, v) => { files.set(f, JSON.stringify(v)); }) };
  const mail = createMail({ ImapFlow: FakeImap, simpleParser: vi.fn(), secrets, file: 'm', randomId: () => 'id1' });
  return { mail, made };
}
const err = (message, code) => () => Object.assign(new Error(message), code ? { code } : {});

describe('a local bridge (ProtonMail Bridge)', () => {
  it('its self-made certificate is accepted on this computer only', async () => {
    const { mail, made } = setup();
    await mail.add({ email: 'me@proton.example', password: 'b', host: '127.0.0.1', port: 1143, secure: false });
    expect(made[0].opts.tls).toEqual({ rejectUnauthorized: false });
    await mail.add({ email: 'me2@proton.example', password: 'b', host: '::1', port: 1143, secure: false });
    expect(made[1].opts).toMatchObject({ host: '::1', tls: { rejectUnauthorized: false } });
    expect(made[1].opts.doSTARTTLS).toBeUndefined();
    await mail.add({ email: 'me@company.example', password: 'b', host: 'imap.company.example', port: 993, secure: true });
    expect(made[2].opts.tls).toBeUndefined();
  });
});

describe('TLS failures in plain words', () => {
  const add = (mail, secure = true, port = 993) => mail.add({ email: 'me@company.example', password: 'x', host: 'imap.company.example', port, secure });
  it('an untrusted certificate', async () => {
    for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
      const { mail } = setup({ fail: err('self-signed certificate', code) });
      await expect(add(mail)).rejects.toThrow(/security certificate is not trusted/);
    }
  });
  it('TLS spoken to a plain port', async () => {
    for (const [msg, code] of [['wrong version number', 'ERR_SSL_WRONG_VERSION_NUMBER'], ['packet length too long', undefined]]) {
      const { mail } = setup({ fail: err(msg, code) });
      await expect(add(mail)).rejects.toThrow(/this port expects a plain connection, or TLS is set wrong/);
    }
  });
  it('a plain connection to a TLS port', async () => {
    const { mail } = setup({ fail: err('Failed to receive greeting from server in required time. Maybe should use TLS?', 'GREETING_TIMEOUT') });
    await expect(add(mail, false, 1993)).rejects.toThrow(/expects an encrypted connection\. Turn on TLS, or use port 993/);
  });
});
