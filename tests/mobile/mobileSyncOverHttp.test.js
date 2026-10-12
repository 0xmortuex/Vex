// @vitest-environment node
//
// The same account over a real socket: scripts/sync-stand-in.mjs (the shipping
// worker code behind node:http) started as its own process, the desktop engine
// and the phone talking to it with fetch. What the in-process tests prove, this
// proves survives HTTP — headers, bodies, status codes, CORS answers.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktop, phone, accountDocument } from './sync-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18787 + Math.floor(Math.random() * 1000);
const BASE = 'http://127.0.0.1:' + PORT;
let server;
const stand = { base: BASE, fetch: (...args) => fetch(...args) };

beforeAll(async () => {
  server = spawn(process.execPath, [path.join(here, '..', '..', 'mobile', 'scripts', 'sync-stand-in.mjs'), String(PORT)], {
    env: { ...process.env, EMAIL_HASH_SECRET: 'over-http-test-secret-0123456789abcdef' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('stand-in did not start')), 10000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('stand-in on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error('stand-in exited ' + code)));
  });
});
afterAll(() => { if (server) server.kill(); });

describe('over HTTP', () => {
  it('a desktop makes the account, the phone joins, edits, and the desktop takes the edit', async () => {
    const pc = desktop(stand);
    pc.local.set('vex.bookmarks', JSON.stringify([{ id: 'bmA', url: 'https://a.example/', title: 'A', folder: '', at: 1 }]));
    const deskCode = (await pc.engine.requestCode('http@example.com')).devCode;
    const { recoveryCode } = await pc.engine.verifyCode('http@example.com', deskCode, 'PC');

    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(BASE);
    const code = (await mobile.sync.requestCode('http@example.com')).devCode;
    expect((await mobile.sync.signIn('http@example.com', code, recoveryCode)).ok).toBe(true);
    await mobile.bookmarks.add({ url: 'https://b.example/', title: 'B from the phone' });
    expect((await mobile.sync.syncNow()).ok).toBe(true);

    expect((await pc.engine.pullNow()).ok).toBe(true);
    expect(JSON.parse(pc.local.get('vex.bookmarks')).map(item => item.title).sort()).toEqual(['A', 'B from the phone']);
    expect((await pc.engine.listDevices()).length).toBe(2);
  });

  it('a wrong recovery code over HTTP leaves the device list as it was', async () => {
    const pc = desktop(stand);
    const deskCode = (await pc.engine.requestCode('ghost@example.com')).devCode;
    await pc.engine.verifyCode('ghost@example.com', deskCode, 'PC');
    const mobile = phone(stand);
    await mobile.sync.setWorkerUrl(BASE);
    const code = (await mobile.sync.requestCode('ghost@example.com')).devCode;
    await expect(mobile.sync.signIn('ghost@example.com', code, '1'.repeat(64))).rejects.toThrow(/doesn’t unlock/);
    expect((await pc.engine.listDevices()).map(device => device.deviceName)).toEqual(['PC']);
  });
});
