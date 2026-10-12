// @vitest-environment node
//
// SE1: one navigator.hid.requestDevice() let the page see and open EVERY HID
// device while the chooser was up (the device gate said yes to any device for
// an origin with a request "in flight"), and a grant made in one container or
// panel was given to the same site everywhere (hid-grants.json was keyed by
// site alone). Now only the picked device, in the session it was picked in.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), os = require('os'), path = require('path');
const { createHidGrants } = require('../../src/main/hid-grants.js');
const main = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
const perms = fs.readFileSync(path.join(__dirname, '../../src/main/permissions.js'), 'utf8');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vex-hid-'));

describe('HID grants are per session and per site', () => {
  it('a device picked in one session is not granted in another, nor to another site', () => {
    const dir = tmp();
    const g = createHidGrants({ userDataPath: dir });
    g.grant('persist:main', 'https://keyboard.example', 0x3151, 0x4015);
    expect(g.isGranted('persist:main', 'https://keyboard.example', 0x3151, 0x4015)).toBe(true);
    expect(g.isGranted('persist:container-work', 'https://keyboard.example', 0x3151, 0x4015)).toBe(false);
    expect(g.isGranted('persist:main', 'https://other.example', 0x3151, 0x4015)).toBe(false);
    expect(g.isGranted('persist:main', 'https://keyboard.example', 0x3151, 0x4016)).toBe(false);
    // Kept on disk, read back by a new store.
    expect(createHidGrants({ userDataPath: dir }).isGranted('persist:main', 'https://keyboard.example', 0x3151, 0x4015)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('grants saved by site alone are read as persist:main’s', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'hid-grants.json'), JSON.stringify({ 'https://old.example': [{ vendorId: 1, productId: 2 }] }));
    const g = createHidGrants({ userDataPath: dir });
    expect(g.isGranted('persist:main', 'https://old.example', 1, 2)).toBe(true);
    expect(g.isGranted('persist:discord', 'https://old.example', 1, 2)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('a grant with no session or site is an error, not a grant for everyone', () => {
    const g = createHidGrants({ userDataPath: tmp() });
    expect(() => g.grant('', 'https://a.example', 1, 2)).toThrow(/session/);
    expect(() => g.grant('persist:main', 'unknown', 1, 2)).toThrow(/site/);
  });
  it('a damaged grants file is said, not read as no grants', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'hid-grants.json'), '[1,2]');
    expect(() => createHidGrants({ userDataPath: dir }).isGranted('persist:main', 'https://a.example', 1, 2)).toThrow(/not a list/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the device gate in main.js', () => {
  it('asks only the grant store, with the session it guards — no "request in flight" pass', () => {
    const at = main.indexOf('ses.setDevicePermissionHandler(');
    expect(at).toBeGreaterThan(-1);
    const body = main.slice(at, at + 400);
    expect(body).toMatch(/return _hidGrants\.isGranted\(tag, details\.origin, d\.vendorId, d\.productId\);/);
    expect(main).not.toMatch(/_isHidRequestActive|_markHidRequestActive/);
    expect(perms).not.toMatch(/_markHidRequestActive/);
  });
  it('the pick is kept under the session the chooser was opened in', () => {
    expect(main).toMatch(/pendingHidSelections\.set\(id, \{[^}]*partition: tag/);
    expect(main).toMatch(/_hidGrants\.grant\(pending\.partition, pending\.origin, chosen\.vendorId, chosen\.productId\)/);
  });
});
