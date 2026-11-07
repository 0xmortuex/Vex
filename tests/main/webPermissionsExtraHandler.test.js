// keyboardLock, window-management and idle-detection through the real request and check handlers
// (src/main/permissions.js), with a fake session. Table-driven: permission x private/normal x remembered/not.
// storage-access has its own file (webPermissionsStorageHandler.test.js).
import { describe, it, expect, vi, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const { createPermissionHygiene } = require('../../src/main/permission-hygiene.js');
const { makeWorld, flush, cleanup } = require('./webPermissionsWorld.js');

afterEach(cleanup);
const world = makeWorld(vi);

const PAGE_OWN = ['keyboardLock', 'window-management'];

describe.each(PAGE_OWN)('%s through the request handler', (permission) => {
  it('asks the person instead of refusing unasked', async () => {
    const w = world();
    const r = await w.ask(permission);
    expect(r.answer).toBeUndefined();
    expect(r.prompt).toMatchObject({ permission, origin: 'https://app.example.com' });
    expect(r.prompt.choice).toBeUndefined();   // the normal choices: Block, this visit, a day, always
  });

  it('"Always allow" is remembered for the site and answers the next request at once, and the sync check', async () => {
    const w = world();
    await w.answerPrompt((await w.ask(permission)).prompt, 'allow', true);
    expect((await w.ask(permission)).answer).toBe(true);
    expect(w.svc.loadPermissionDecisions()).toEqual({ ['https://app.example.com::' + permission]: 'allow' });
    expect(w.check(permission, 'https://app.example.com/')).toBe(true);
    // another site is still asked
    expect((await w.ask(permission, { top: 'https://other.example/' })).prompt).toBeDefined();
    expect(w.check(permission, 'https://other.example/')).toBe(false);
  });

  it('"Block" is remembered (never) and the site is not asked again', async () => {
    const w = world();
    await w.answerPrompt((await w.ask(permission)).prompt, 'deny', true);
    expect((await w.ask(permission)).answer).toBe(false);
    expect(w.check(permission, 'https://app.example.com/')).toBe(false);
  });

  it('"Allow this visit" lasts until Vex closes and is not written down', async () => {
    const w = world();
    await w.answerPrompt((await w.ask(permission)).prompt, 'allow', 'session');
    expect((await w.ask(permission)).answer).toBe(true);
    expect(w.svc.loadPermissionDecisions()).toEqual({});
  });

  it('a frame inside the page is refused with no question', async () => {
    const w = world();
    expect(await w.ask(permission, { isMainFrame: false, url: 'https://ads.example/x' })).toMatchObject({ answer: false });
    expect(w.send).not.toHaveBeenCalled();
  });

  it('a request for another origin than the page is refused with no question', async () => {
    const w = world();
    expect(await w.ask(permission, { url: 'https://other.example/' })).toMatchObject({ answer: false });
  });

  it('a private, Tor or burner window asks every time and remembers nothing', async () => {
    for (const mode of [{ partition: 'otr-private-1' }, { partition: 'persist:main', sesFlags: { __vexTor: true } }, { partition: 'persist:main', sesFlags: { __vexEphemeral: true } }]) {
      const w = world(mode);
      const first = await w.ask(permission);
      expect(first.prompt, JSON.stringify(mode)).toMatchObject({ permission, choice: 'this-time', remember: false });
      await w.answerPrompt(first.prompt, 'allow', true);     // even "always" keeps nothing
      const second = await w.ask(permission);
      expect(second.answer, 'asked again').toBeUndefined();
      expect(second.prompt).toBeDefined();
      expect(w.svc.loadPermissionDecisions()).toEqual({});
      expect(w.check(permission, 'https://app.example.com/')).toBe(false);
    }
  });

  it('a "Block" in a private window is not kept either', async () => {
    const w = world({ partition: 'otr-private-1' });
    await w.answerPrompt((await w.ask(permission)).prompt, 'deny', true);
    expect((await w.ask(permission)).prompt).toBeDefined();
  });

  it('"Allow this time" lets this one request through and keeps nothing', async () => {
    const w = world({ partition: 'otr-private-1' });
    const first = await w.ask(permission);
    await w.answerPrompt(first.prompt, 'allow', false);
    expect(first.answeredWith()).toBe(true);
    expect(w.svc.loadPermissionDecisions()).toEqual({});
  });
});

describe('keyboardLock only while the page is in full screen', () => {
  it('asks in full screen, refuses outside it, and refuses when it cannot tell', async () => {
    const w = world();
    expect((await w.ask('keyboardLock', { fullscreen: true })).prompt).toBeDefined();
    expect(await w.ask('keyboardLock', { fullscreen: false })).toMatchObject({ answer: false });
    expect(await w.ask('keyboardLock', { jsFails: true })).toMatchObject({ answer: false });
  });

  it('a saved allow does not open it outside full screen', async () => {
    const w = world();
    await w.svc.savePermissionDecisions({ 'https://app.example.com::keyboardLock': 'allow' });
    expect((await w.ask('keyboardLock', { fullscreen: true })).answer).toBe(true);
    expect((await w.ask('keyboardLock', { fullscreen: false })).answer).toBe(false);
  });
});

describe('window-management is not in the way of full screen', () => {
  it.each(['window-management'])('%s asks without full screen', async (permission) => {
    const w = world();
    expect((await w.ask(permission, { fullscreen: false })).prompt).toBeDefined();
  });
});

describe('permission hygiene expiry applies to the four', () => {
  it.each([
    ['keyboardLock', 'https://app.example.com/', {}],
    ['window-management', 'https://app.example.com/', {}],
  ])('%s kept "always" ends after the configured days', async (permission, url, extraOpts) => {
    const NOW = 1_000_000_000;
    const hygiene = createPermissionHygiene({ now: () => NOW });
    hygiene.setConfig({ enabled: true, expiryDays: 10 });
    const w = world({ hygiene, isTrackerUrl: () => false });
    const r = await w.ask(permission, { url, ...extraOpts });
    await w.answerPrompt(r.prompt, 'allow', true);
    const all = w.svc.loadPermissionDecisions();
    const key = Object.keys(all).find((k) => k !== '__until__');
    expect(all.__until__[key]).toBe(NOW + 10 * 24 * 60 * 60 * 1000);
  });

  it('with hygiene off nothing expires, as for every other permission', async () => {
    const hygiene = createPermissionHygiene({ now: () => 5 });
    const w = world({ hygiene });
    await w.answerPrompt((await w.ask('keyboardLock')).prompt, 'allow', true);
    expect(w.svc.loadPermissionDecisions().__until__).toBeUndefined();
  });
});

describe('the site panel and Settings can list, set and revoke them', () => {
  it('setPageDecision accepts the page-own ones, and nothing near them', async () => {
    const w = world();
    const page = { getURL: () => 'https://app.example.com/', session: {} };
    for (const p of ['keyboardLock', 'window-management']) {
      await w.svc.setPageDecision(page, 'https://app.example.com/', p, 'allow');
      expect(w.svc.loadPermissionDecisions()['https://app.example.com::' + p], p).toBe('allow');
      await w.svc.setPageDecision(page, 'https://app.example.com/', p, 'ask');
      expect(w.svc.loadPermissionDecisions()['https://app.example.com::' + p], p + ' forgotten').toBeUndefined();
    }
    for (const bad of ['top-level-storage-access', 'openExternal', 'fileSystem', 'unknown']) {
      expect(() => w.svc.setPageDecision(page, 'https://app.example.com/', bad, 'allow'), bad).toThrow(/Unknown permission/);
    }
  });

  it('the IPC schema takes the same names', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    for (const p of ['keyboardLock', 'window-management']) {
      expect(() => validate('permissions:set-for-page', [1, p, 'allow']), p).not.toThrow();
    }
    for (const bad of ['top-level-storage-access', 'openExternal', 'fileSystem']) {
      expect(() => validate('permissions:set-for-page', [1, bad, 'allow']), bad).toThrow();
    }
  });
});

// Whatever was asked before is asked, granted or refused exactly as before.
describe('existing permissions behave exactly as before', () => {
  const NEEDS_PROMPT = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'permissions.js'), 'utf8')
    .match(/const NEEDS_PROMPT = new Set\(\[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  it('the set that prompts is the nine it always was', () => {
    expect(NEEDS_PROMPT.sort()).toEqual(['camera', 'clipboard-read', 'display-capture', 'geolocation', 'media', 'microphone', 'midi', 'midiSysex', 'notifications']);
  });

  it.each(['geolocation', 'media', 'midi', 'midiSysex', 'notifications', 'camera', 'microphone', 'display-capture', 'clipboard-read'])('%s still prompts, with the normal choices', async (permission) => {
    const w = world();
    let answer = 'prompted';
    w.ses.handlers.request({ getURL: () => 'https://example.com/page', session: {} }, permission, (ok) => { answer = ok; }, { requestingUrl: 'https://example.com/page' });
    await flush();
    expect(answer).toBe('prompted');
    const prompt = w.send.mock.calls[0][1];
    expect(prompt.choice).toBeUndefined();
    expect(prompt.embeddedIn).toBeUndefined();
  });

  it.each(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'mediaKeySystem'])('%s is still granted at once', async (permission) => {
    const w = world();
    let answer = 'prompted';
    w.ses.handlers.request({ getURL: () => 'https://example.com/', session: {} }, permission, (ok) => { answer = ok; }, { requestingUrl: 'https://example.com/' });
    expect(answer).toBe(true);
  });

  it.each(['openExternal', 'top-level-storage-access', 'fileSystem', 'speaker-selection', 'unknown', 'some-future-capability', 'hid', 'serial', 'usb', 'pageLock'])('%s is still refused unasked', async (permission) => {
    const w = world();
    let answer = 'prompted';
    w.ses.handlers.request({ getURL: () => 'https://example.com/', session: {} }, permission, (ok) => { answer = ok; }, { requestingUrl: 'https://example.com/', isMainFrame: true });
    await flush();
    expect(answer).toBe(false);
    expect(w.send).not.toHaveBeenCalled();
  });

  it('a camera answer in a private window is still kept for the window (only the four new ones keep nothing)', async () => {
    const w = world({ partition: 'otr-private-1' });
    let answer;
    w.ses.handlers.request({ getURL: () => 'https://example.com/', session: w.ses }, 'camera', (ok) => { answer = ok; }, { requestingUrl: 'https://example.com/', mediaTypes: ['video'] });
    const prompt = w.send.mock.calls[0][1];
    await w.answerPrompt(prompt, 'allow', 'session');
    expect(answer).toBe(true);
    let again;
    w.ses.handlers.request({ getURL: () => 'https://example.com/', session: w.ses }, 'camera', (ok) => { again = ok; }, { requestingUrl: 'https://example.com/', mediaTypes: ['video'] });
    expect(again).toBe(true);
  });
});
