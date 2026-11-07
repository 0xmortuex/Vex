// storage-access through the real request and check handlers (src/main/permissions.js), with a fake session.
// Table-driven over: who asks x tracker or not x same-site or cross-site x private or normal x remembered or not.
import { describe, it, expect, vi, afterEach } from 'vitest';
const { createPermissionHygiene } = require('../../src/main/permission-hygiene.js');
const { makeWorld, cleanup } = require('./webPermissionsWorld.js');

afterEach(cleanup);
const world = makeWorld(vi);

describe('storage-access', () => {
  const TOP = 'https://shop.example.com/cart';
  const FRAME = 'https://pay.widgets.example/box';
  const notTracker = () => false;
  const askFrame = (w, over = {}) => w.ask('storage-access', { top: TOP, url: FRAME, isMainFrame: false, ...over });

  // permission x who is asking x ad/tracker or not x same-site or cross-site
  it.each([
    ['cross-site third party', 'https://pay.widgets.example/box', false, 'ask', true],
    ['same-site frame', 'https://login.example.com/', false, 'ask', false],
    ['cross-site on a tracker list', 'https://ads.tracker.example/', true, 'refuse', true],
    ['same-site on a tracker list', 'https://metrics.example.com/', true, 'refuse', false],
  ])('%s (tracker %s)', async (_name, url, tracker, expected, cross) => {
    const w = world({ isTrackerUrl: () => tracker });
    const r = await askFrame(w, { url });
    if (expected === 'refuse') {
      expect(r.answer).toBe(false);
      expect(w.send).not.toHaveBeenCalled();
      return;
    }
    expect(r.answer).toBeUndefined();
    expect(r.prompt.permission).toMatch(/^storage-access:/);
    expect(r.prompt.origin).toBe(new URL(url).origin);
    expect(r.prompt.embeddedIn).toBe('https://shop.example.com');
    expect(r.prompt.crossSite).toBe(cross);
  });

  it('is kept per pair under the page, with the third party site in the name', async () => {
    const w = world({ isTrackerUrl: notTracker });
    const r = await askFrame(w);
    expect(r.prompt.permission).toBe('storage-access:widgets.example');
    await w.answerPrompt(r.prompt, 'allow', true);
    expect(w.svc.loadPermissionDecisions()).toEqual({ 'https://shop.example.com::storage-access:widgets.example': 'allow' });
    expect((await askFrame(w)).answer).toBe(true);
    // the sync check (permissions.query) agrees, for that pair only
    const details = { embeddingOrigin: 'https://shop.example.com', requestingUrl: FRAME, isMainFrame: false };
    expect(w.check('storage-access', 'https://pay.widgets.example/', details)).toBe(true);
    expect(w.check('storage-access', 'https://pay.widgets.example/', { ...details, embeddingOrigin: 'https://other.example' })).toBe(false);
    expect(w.check('storage-access', 'https://another.example/', { ...details, requestingUrl: 'https://another.example/' })).toBe(false);
  });

  it('an allow for one page does not carry to another page, nor to another third party', async () => {
    const w = world({ isTrackerUrl: notTracker });
    await w.answerPrompt((await askFrame(w)).prompt, 'allow', true);
    expect((await askFrame(w, { top: 'https://bank.example/' })).prompt, 'same frame on another page').toBeDefined();
    expect((await askFrame(w, { url: 'https://other-widget.example/' })).prompt, 'other third party on the same page').toBeDefined();
  });

  it('a Block is remembered and the third party is not asked about again', async () => {
    const w = world({ isTrackerUrl: notTracker });
    await w.answerPrompt((await askFrame(w)).prompt, 'deny', true);
    expect((await askFrame(w)).answer).toBe(false);
    expect(w.send).not.toHaveBeenCalled();
  });

  it('a same-site frame with an existing grant for its site is allowed at once', async () => {
    const w = world({ isTrackerUrl: notTracker });
    await w.svc.savePermissionDecisions({ 'https://shop.example.com::storage-access:example.com': 'allow' });
    expect((await askFrame(w, { url: 'https://login.example.com/' })).answer).toBe(true);
  });

  it('NEVER for a tracker, even when an allow is already saved for it', async () => {
    const w = world({ isTrackerUrl: () => true });
    await w.svc.savePermissionDecisions({ 'https://shop.example.com::storage-access:widgets.example': 'allow' });
    expect((await askFrame(w)).answer).toBe(false);
    const details = { embeddingOrigin: 'https://shop.example.com', requestingUrl: FRAME, isMainFrame: false };
    expect(w.check('storage-access', 'https://pay.widgets.example/', details)).toBe(false);
  });

  it('refuses when nothing can say the frame is not a tracker (no checker, or the checker fails)', async () => {
    const none = world();
    await none.svc.savePermissionDecisions({ 'https://shop.example.com::storage-access:widgets.example': 'allow' });
    expect((await askFrame(none)).answer).toBe(false);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = world({ isTrackerUrl: () => { throw new Error('list not loaded'); } });
    expect((await askFrame(broken)).answer).toBe(false);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('the page itself, or a request that does not say it is a frame, is refused', async () => {
    const w = world({ isTrackerUrl: notTracker });
    expect(await w.ask('storage-access', { top: TOP, url: TOP, isMainFrame: true })).toMatchObject({ answer: false });
    expect(await w.ask('storage-access', { top: TOP, url: FRAME, isMainFrame: null })).toMatchObject({ answer: false });
  });

  it('a private, Tor or burner window asks every time and keeps nothing', async () => {
    const w = world({ partition: 'otr-burner-1', isTrackerUrl: notTracker });
    const first = await askFrame(w);
    expect(first.prompt).toMatchObject({ choice: 'this-time', remember: false });
    await w.answerPrompt(first.prompt, 'allow', true);
    expect((await askFrame(w)).prompt).toBeDefined();
    expect(w.svc.loadPermissionDecisions()).toEqual({});
    const details = { embeddingOrigin: 'https://shop.example.com', requestingUrl: FRAME, isMainFrame: false };
    expect(w.check('storage-access', 'https://pay.widgets.example/', details)).toBe(false);
  });

  it('top-level-storage-access stays refused: its details do not name the origin it is for', async () => {
    const w = world({ isTrackerUrl: notTracker });
    expect(await w.ask('top-level-storage-access', { top: TOP, url: TOP, isMainFrame: true })).toMatchObject({ answer: false });
    expect(w.send).not.toHaveBeenCalled();
  });
});


describe('storage-access and permission hygiene', () => {
  it('a storage-access grant kept "always" ends after the configured days', async () => {
    const NOW = 1_000_000_000;
    const hygiene = createPermissionHygiene({ now: () => NOW });
    hygiene.setConfig({ enabled: true, expiryDays: 10 });
    const w = world({ hygiene, isTrackerUrl: () => false });
    const r = await w.ask('storage-access', { top: 'https://shop.example.com/cart', url: 'https://pay.widgets.example/box', isMainFrame: false });
    await w.answerPrompt(r.prompt, 'allow', true);
    const all = w.svc.loadPermissionDecisions();
    const key = 'https://shop.example.com::storage-access:widgets.example';
    expect(all[key]).toBe('allow');
    expect(all.__until__[key]).toBe(NOW + 10 * 24 * 60 * 60 * 1000);
  });
});

describe('the site panel and Settings can list, set and revoke storage-access', () => {
  it('setPageDecision accepts a per-site key and nothing near it', async () => {
    const w = world();
    const page = { getURL: () => 'https://app.example.com/', session: {} };
    const p = 'storage-access:widgets.example';
    await w.svc.setPageDecision(page, 'https://app.example.com/', p, 'allow');
    expect(w.svc.loadPermissionDecisions()['https://app.example.com::' + p]).toBe('allow');
    await w.svc.setPageDecision(page, 'https://app.example.com/', p, 'ask');
    expect(w.svc.loadPermissionDecisions()['https://app.example.com::' + p]).toBeUndefined();
    for (const bad of ['storage-access', 'storage-access:', 'storage-access:bad host', 'storage-access:a/b']) {
      expect(() => w.svc.setPageDecision(page, 'https://app.example.com/', bad, 'allow'), bad).toThrow(/Unknown permission/);
    }
  });

  it('the IPC schema takes the same names', () => {
    const { validate } = require('../../src/main/ipc-schemas.js');
    expect(() => validate('permissions:set-for-page', [1, 'storage-access:widgets.example', 'allow'])).not.toThrow();
    for (const bad of ['storage-access', 'storage-access:']) {
      expect(() => validate('permissions:set-for-page', [1, bad, 'allow']), bad).toThrow();
    }
  });
});
