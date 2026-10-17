// T3-123: the standalone way out (scripts/profile-decrypt.js) on a fixture profile.
import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const { createProfileCrypt, isEnvelope } = req('../../src/main/profile-crypt.js');
const { main } = req('../../scripts/profile-decrypt.js');
const KDF = { N: 16384, r: 8, p: 1 };
const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) nodeFs.rmSync(d, { recursive: true, force: true }); });

async function encrypted() {
  const d = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-cli-')); dirs.push(d);
  nodeFs.mkdirSync(path.join(d, 'vex-storage'));
  nodeFs.writeFileSync(path.join(d, 'vex-persist.json'), '{"vex.notes":"diary"}');
  nodeFs.writeFileSync(path.join(d, 'vex-storage', 'tabs.json'), '{"$vexStore":1,"data":["t"]}');
  const eng = createProfileCrypt({ userDataPath: d, kdf: KDF });
  const { recoveryCode } = await eng.enable({ passphrase: 'a long passphrase', files: eng.profileFiles(['tabs']) });
  return { d, recoveryCode };
}

describe('scripts/profile-decrypt.js', () => {
  it('reports the state without a secret', async () => {
    const { d } = await encrypted();
    expect(JSON.parse(await main(['--profile', d, '--status'], {}))).toMatchObject({ enabled: true, state: 'encrypted', locked: true });
  });
  it('decrypts with the passphrase', async () => {
    const { d } = await encrypted();
    expect(await main(['--profile', d], { VEX_PROFILE_PASSPHRASE: 'a long passphrase' })).toMatch(/Decrypted 2 file/);
    expect(nodeFs.readFileSync(path.join(d, 'vex-persist.json'), 'utf8')).toBe('{"vex.notes":"diary"}');
    expect(nodeFs.existsSync(path.join(d, 'profile-lock.json'))).toBe(false);
  });
  it('decrypts with the recovery code', async () => {
    const { d, recoveryCode } = await encrypted();
    await main(['--profile', d], { VEX_PROFILE_RECOVERY: recoveryCode });
    expect(isEnvelope(nodeFs.readFileSync(path.join(d, 'vex-storage', 'tabs.json')))).toBe(false);
  });
  it('a wrong secret or none changes nothing and says so', async () => {
    const { d } = await encrypted();
    await expect(main(['--profile', d], { VEX_PROFILE_PASSPHRASE: 'not the passphrase' })).rejects.toThrow(/Wrong passphrase/);
    await expect(main(['--profile', d], {})).rejects.toThrow(/Set VEX_PROFILE_PASSPHRASE/);
    expect(isEnvelope(nodeFs.readFileSync(path.join(d, 'vex-persist.json')))).toBe(true);
  });
  it('needs a folder, and says a plain profile has nothing to do', async () => {
    await expect(main([], {})).rejects.toThrow(/Usage/);
    const d = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'vex-cli-')); dirs.push(d);
    expect(await main(['--profile', d], {})).toMatch(/not encrypted/);
  });
});
