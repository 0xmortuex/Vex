// Audit (2026-10): tryUnlock was not serialised, so N guesses fired at once all
// read the same wrong-PIN count and counted as one failure between them.
import { describe, it, expect } from 'vitest';
const { webcrypto } = require('crypto');
const { createLockGate, MAX_FAILS } = require('../../src/main/lock-pin.js');

async function windowRecord(pin) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256);
  return JSON.stringify({ salt: Buffer.from(salt).toString('base64'), hash: Buffer.from(new Uint8Array(bits)).toString('base64') });
}

describe('tryUnlock counts every parallel guess', () => {
  it('MAX_FAILS guesses fired together lock the gate, and the right PIN is then refused', async () => {
    const rec = await windowRecord('4821');
    const t = 1000000;
    const gate = createLockGate({ readRecord: () => rec, now: () => t });
    const results = await Promise.all(Array.from({ length: MAX_FAILS }, () => gate.tryUnlock('0000')));
    expect(results.filter(r => r.error === 'Wrong PIN')).toHaveLength(MAX_FAILS - 1);
    expect(results[MAX_FAILS - 1].error).toMatch(/^Too many tries/);
    expect((await gate.tryUnlock('4821')).error).toMatch(/^Too many tries/);
  });

  it('a call that throws does not stop the next one', async () => {
    const rec = await windowRecord('4821');
    let calls = 0;
    const gate = createLockGate({ readRecord: () => { if (calls++ === 0) throw new Error('boom'); return rec; } });
    const first = gate.tryUnlock('0000');
    const second = gate.tryUnlock('4821');
    await expect(first).rejects.toThrow('boom');
    expect(await second).toEqual({ ok: true });
  });
});
