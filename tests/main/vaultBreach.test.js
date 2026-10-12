// @vitest-environment node
// The breach check (Password Health): off by default, and nothing is sent
// unless it is on. When on, only the first five hex characters of each
// password's SHA-1 go to Have I Been Pwned's range API (stubbed here; never
// called live), and the match is made locally.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createVaultService } = require('../../src/main/vault.js');

const sha = (s) => crypto.createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
let dir, handlers, on, fetchRange;
function build() {
  handlers = {};
  const ipcMain = { handle: (c, fn) => { handlers[c] = fn; }, on: () => {} };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString('utf8').slice(4) };
  createVaultService({ app: { getPath: () => dir }, safeStorage, ipcMain, breachCheckOn: () => on, fetchRange });
}
const call = (c, ...a) => handlers[c]({ sender: {} }, ...a);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-vault-breach-'));
  on = false;
  // The API's answer: every suffix in that range with its count, plus padding (count 0).
  fetchRange = vi.fn(async (prefix) => {
    const lines = ['0000000000000000000000000000000000A:0'];
    for (const pw of ['password', 'letmein']) { const h = sha(pw); if (h.startsWith(prefix)) lines.push(h.slice(5) + ':' + (pw === 'password' ? 9659365 : 1)); }
    // A padding line that matches a saved suffix must not count.
    const safe = sha('correct horse battery staple');
    if (safe.startsWith(prefix)) lines.push(safe.slice(5) + ':0');
    return lines.join('\r\n');
  });
  build();
  await call('vault:save', { host: 'a.example', username: 'me', password: 'password' });
  await call('vault:save', { host: 'b.example', username: 'you', password: 'correct horse battery staple' });
  await call('vault:save', { host: 'c.example', username: 'us', password: 'password' });
});

describe('vault:breach-check', () => {
  it('refuses, and sends nothing, while the switch is off', async () => {
    await expect(call('vault:breach-check')).rejects.toThrow(/breach check is off/);
    expect(fetchRange).not.toHaveBeenCalled();
  });

  it('sends only 5-character prefixes, once per prefix, and matches here', async () => {
    on = true;
    const r = await call('vault:breach-check');
    const sent = fetchRange.mock.calls.map(c => c[0]);
    expect(sent.every(p => /^[0-9A-F]{5}$/.test(p))).toBe(true);
    expect(sent.sort()).toEqual([sha('password').slice(0, 5), sha('correct horse battery staple').slice(0, 5)].sort());
    expect(JSON.stringify(fetchRange.mock.calls)).not.toContain('password');
    expect(r).toEqual({ checked: 3, breached: [
      { host: 'a.example', username: 'me', count: 9659365 },
      { host: 'c.example', username: 'us', count: 9659365 },
    ] });
  });

  it('says why when the service cannot be reached', async () => {
    on = true;
    fetchRange.mockImplementation(async () => { throw new Error('Have I Been Pwned answered 503'); });
    await expect(call('vault:breach-check')).rejects.toThrow('Have I Been Pwned answered 503');
  });

  it('the live fetch asks the range API with padding, from main', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../src/main/vault.js'), 'utf8');
    expect(src).toContain("net.fetch('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true'");
    const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
    expect(main).toContain("breachCheckOn: () => _readPersistString('vex.breachCheck', false) === true");
  });
});
