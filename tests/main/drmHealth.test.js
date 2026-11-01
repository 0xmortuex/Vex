// Protected playback that explains itself (src/main/drm-health.js): the diagnosis from fake facts, the facts from a
// fake Electron and file system, the two repairs, and the per-site clearing. The real Widevine module, the real
// signature and a real streaming page are not exercised here; they need the installed Vex.
import { describe, it, expect, vi } from 'vitest';

const { diagnose, gatherFacts, createDrmHealth, clearSiteForPlayback, cleanReport, fill, TEMPLATES, BUILDER_STEPS } = require('../../src/main/drm-health.js');
const path = require('path');

const base = (over = {}) => ({
  packaged: true, electron: '42.11.18+wvcus', chrome: '148.0.0.0', castlabsBuild: true, api: true, updatesEnabled: true,
  widevine: { status: 'up-to-date', version: '4.10.3050.0', title: 'Widevine' }, mediaFoundation: null,
  sig: { checked: true, name: 'Vex.exe.sig', exists: true }, cdmDirs: { exists: true, versions: ['4.10.3050.0'] },
  init: { state: 'ready', message: '' }, reported: null, readErrors: [], ...over,
});
const codes = (r) => r.reasons.map(x => x.code);

describe('diagnose', () => {
  it('says ok when the module is installed, and still admits the signature cannot be checked', () => {
    const r = diagnose(base());
    expect(r.state).toBe('ok');
    expect(codes(r)).toEqual(['cdm-present', 'signature-unverifiable']);
    expect(r.fix.repairs).toEqual([]);
    expect(r.fix.owner).toBeNull();
    expect(r.reasons.find(x => x.code === 'cdm-present').text).toContain('4.10.3050.0');
  });

  it('is broken without the castLabs component API and needs the owner', () => {
    const r = diagnose(base({ api: false, widevine: null, castlabsBuild: false }));
    expect(r.state).toBe('broken');
    expect(codes(r)).toContain('no-widevine-build');
    expect(r.fix.owner.needed).toBe('yes');
    expect(r.fix.owner.builderSteps).toEqual(BUILDER_STEPS);
    expect(r.fix.repairs).toEqual([]);
  });

  it('is broken when the signature file is missing, and says only the builder can fix it', () => {
    const r = diagnose(base({ sig: { checked: true, name: 'Vex.exe.sig', exists: false }, widevine: { status: 'new', version: null, title: null } }));
    expect(r.state).toBe('broken');
    expect(codes(r)).toContain('sig-missing');
    expect(r.reasons.find(x => x.code === 'sig-missing').text).toContain('Vex.exe.sig');
    expect(r.fix.owner.needed).toBe('yes');
  });

  it('calls a present signature plus a missing module "likely", never "proven", and offers the repairs first', () => {
    const r = diagnose(base({ widevine: { status: 'new', version: null, title: null }, cdmDirs: { exists: true, versions: [] } }));
    expect(r.state).toBe('broken');
    expect(codes(r)).toEqual(expect.arrayContaining(['cdm-missing', 'sig-suspect', 'cdm-folder-empty']));
    expect(r.reasons.find(x => x.code === 'sig-suspect').level).toBe('warn');
    expect(r.reasons.find(x => x.code === 'sig-suspect').text).toMatch(/likely cause, not a proven one/);
    expect(r.fix.repairs).toEqual(['recheck', 'reset-component']);
    expect(r.fix.owner.needed).toBe('maybe');
    expect(r.reasons.find(x => x.code === 'cdm-missing').text).toContain('component state: new');
  });

  it('never claims the signature is valid', () => {
    for (const f of [base(), base({ widevine: { status: 'x', version: null, title: null } })]) {
      const all = diagnose(f).reasons.map(x => x.text).join(' ');
      expect(all).not.toMatch(/signature is valid|valid signature/i);
    }
  });

  it('finds component updates switched off and offers to turn them on', () => {
    const r = diagnose(base({ updatesEnabled: false, widevine: { status: 'new', version: null, title: null } }));
    expect(r.state).toBe('broken');
    expect(codes(r)).toContain('updates-off');
    expect(r.fix.repairs).toContain('enable-updates');
  });

  it('is only degraded when run from source, and says why', () => {
    const r = diagnose(base({ packaged: false, sig: null }));
    expect(r.state).toBe('degraded');
    expect(codes(r)).toContain('dev-build');
    expect(r.fix.owner).toBeNull();
  });

  it('reports a failed start-up install with its message, and a network hint for a timeout', () => {
    const r = diagnose(base({ widevine: { status: 'new', version: null, title: null }, init: { state: 'failed', message: 'timed out — check your internet connection' } }));
    expect(codes(r)).toEqual(expect.arrayContaining(['init-failed', 'init-network']));
    expect(r.reasons.find(x => x.code === 'init-failed').text).toContain('timed out');
    expect(r.fix.repairs).toContain('recheck');
  });

  it('is degraded, not broken, while the start-up install is still running without a module yet', () => {
    const r = diagnose(base({ widevine: { status: 'new', version: null, title: null }, init: { state: 'pending', message: '' }, sig: { checked: true, name: 'Vex.exe.sig', exists: true } }));
    expect(codes(r)).toContain('init-pending');
  });

  it('turns a page-reported problem with a healthy module into a degraded answer pointing at the site', () => {
    const r = diagnose(base({ reported: { host: 'www.netflix.com', message: 'requestMediaKeySystemAccess failed' } }));
    expect(r.state).toBe('degraded');
    const rep = r.reasons.find(x => x.code === 'page-reported');
    expect(rep.text).toContain('www.netflix.com');
    expect(rep.text).toMatch(/points at the site/);
    expect(r.fix.repairs).toEqual(['clear-site', 'reload']);
    expect(r.fix.owner.needed).toBe('maybe');
  });

  it('keeps a page-reported problem short of blaming the site when the module itself is broken', () => {
    const r = diagnose(base({ widevine: { status: 'new', version: null, title: null }, reported: { host: 'open.spotify.com', message: 'DRM failed' } }));
    expect(r.state).toBe('broken');
    expect(r.reasons.find(x => x.code === 'page-reported').text).not.toMatch(/points at the site/);
    expect(r.fix.repairs).not.toContain('clear-site');
  });

  it('names a file it could not read instead of skipping it', () => {
    const r = diagnose(base({ readErrors: ['the signature file (EPERM)'] }));
    expect(r.state).toBe('degraded');
    expect(r.reasons[0].text).toBe('Vex could not read the signature file (EPERM).');
  });

  it('has a template for every code it can produce, with the holes filled from args', () => {
    expect(fill('{0} and {1}', ['a', 'b'])).toBe('a and b');
    expect(fill('x {0}', [])).toBe('x ');
    const seen = new Set();
    const fs = [base(), base({ api: false, widevine: null }), base({ updatesEnabled: false, widevine: { version: null } }), base({ packaged: false, sig: null, castlabsBuild: false }),
      base({ sig: { checked: true, name: 'a.sig', exists: false } }), base({ widevine: { status: 's', version: null } }), base({ widevine: { status: null, version: null }, cdmDirs: { exists: true, versions: [] } }),
      base({ widevine: { status: 's', version: null }, mediaFoundation: { version: '1' }, init: { state: 'failed', message: 'network' } }),
      base({ widevine: { version: null }, init: { state: 'pending' } }), base({ reported: { host: 'h', message: 'm' } }), base({ readErrors: ['x'] })];
    for (const f of fs) { const r = diagnose(f); for (const x of r.reasons) { seen.add(x.template); expect(Object.values(TEMPLATES)).toContain(x.template); } expect(Object.values(TEMPLATES)).toContain(r.headline); }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('gatherFacts / createDrmHealth with a fake Electron', () => {
  const fakeFs = (files, dirs) => ({
    existsSync: (p) => files.includes(p) || Object.keys(dirs).includes(p),
    readdirSync: (p) => (dirs[p] || []).map(name => ({ name, isDirectory: () => true })),
  });
  const mk = (over = {}) => {
    const userData = path.join('C:', 'ud');
    const components = {
      WIDEVINE_CDM_ID: 'wv', MEDIA_FOUNDATION_WIDEVINE_CDM_ID: 'mf', updatesEnabled: true,
      status: () => ({ wv: { status: 'up-to-date', version: '4.10.3050.0', title: 'Widevine' }, mf: { status: 'up-to-date', version: '1.2', title: 'MF' } }),
      whenReady: vi.fn(async () => []),
      ...over.components,
    };
    const exe = path.join('C:', 'Vex', 'Vex.exe');
    return {
      app: { isPackaged: true, getPath: () => userData },
      electron: { components },
      versions: { electron: '42.11.18+wvcus', chrome: '148.0.0.0' },
      execPath: exe, platform: 'win32',
      fs: over.fs || fakeFs([exe + '.sig'], { [path.join(userData, 'WidevineCdm')]: ['4.10.3050.0', 'junk'] }),
      path, timeoutMs: 40,
    };
  };

  it('reads the module, the signature file and the profile folder', () => {
    const f = gatherFacts(mk(), { state: 'ready' }, null);
    expect(f).toMatchObject({ packaged: true, castlabsBuild: true, api: true, updatesEnabled: true });
    expect(f.widevine.version).toBe('4.10.3050.0');
    expect(f.mediaFoundation.version).toBe('1.2');
    expect(f.sig).toEqual({ checked: true, name: 'Vex.exe.sig', exists: true });
    expect(f.cdmDirs.versions).toEqual(['4.10.3050.0']);
    expect(f.readErrors).toEqual([]);
  });

  it('reports a failing read instead of hiding it', () => {
    const env = mk({ fs: { existsSync: () => { throw new Error('EPERM nope'); }, readdirSync: () => [] } });
    const f = gatherFacts(env, { state: 'ready' }, null);
    expect(f.readErrors.join(' ')).toMatch(/signature file \(EPERM nope\)/);
    expect(f.readErrors.join(' ')).toMatch(/Widevine folder of the profile \(EPERM nope\)/);
    expect(diagnose(f).state).not.toBe('ok');
  });

  it('check() is ok for a healthy fake, and degraded for a build without a module after a failed install', () => {
    const health = createDrmHealth(mk());
    expect(health.check().state).toBe('ok');
    const bad = createDrmHealth(mk({ components: { status: () => ({ wv: { status: 'new', version: null, title: null } }) } }));
    bad.noteInit(false, 'timed out');
    const r = bad.check();
    expect(r.state).toBe('broken');
    expect(codes(r)).toContain('init-failed');
  });

  it('recheck() asks whenReady again and picks up a module that arrived late', async () => {
    let installed = false;
    const env = mk({ components: { status: () => ({ wv: installed ? { status: 'up-to-date', version: '4.10.3050.0' } : { status: 'new', version: null } }) } });
    const health = createDrmHealth(env);
    health.noteInit(false, 'timed out');
    expect(health.check().state).toBe('broken');
    installed = true;
    const r = await health.recheck();
    expect(env.electron.components.whenReady).toHaveBeenCalledTimes(1);
    expect(r.state).toBe('ok');
  });

  it('recheck() keeps a whenReady failure in the answer', async () => {
    const env = mk({ components: { whenReady: vi.fn(async () => { throw new Error('install failed: 5'); }), status: () => ({ wv: { status: 'new', version: null } }) } });
    const r = await createDrmHealth(env).recheck();
    expect(r.state).toBe('broken');
    expect(r.reasons.find(x => x.code === 'init-failed').text).toContain('install failed: 5');
  });

  it('recheck() gives up with a timeout message when whenReady never answers', async () => {
    const env = mk({ components: { whenReady: () => new Promise(() => {}), status: () => ({ wv: { status: 'new', version: null } }) } });
    const r = await createDrmHealth(env).recheck();
    expect(r.reasons.find(x => x.code === 'init-failed').text).toMatch(/timed out after/);
  });

  it('enableUpdates() turns the switch on and rechecks, and throws when Electron refuses', async () => {
    const env = mk({ components: { updatesEnabled: false } });
    const r = await createDrmHealth(env).enableUpdates();
    expect(env.electron.components.updatesEnabled).toBe(true);
    expect(r.state).toBe('ok');
    const stuck = mk({});
    Object.defineProperty(stuck.electron.components, 'updatesEnabled', { get: () => false, set: () => {} });
    await expect(createDrmHealth(stuck).enableUpdates()).rejects.toThrow(/did not accept/);
  });

  it('passes only a host and a short message through as the page report', () => {
    expect(cleanReport({ host: 'a'.repeat(300), message: 'x\n  y '.repeat(200), evil: 1 }).message.length).toBeLessThanOrEqual(300);
    expect(cleanReport({ host: 'h' })).toBeNull();
    expect(Object.keys(cleanReport({ host: 'h', message: 'm', evil: 1 }))).toEqual(['host', 'message']);
  });
});

describe('clearSiteForPlayback', () => {
  const page = (url, extra = {}) => ({ isDestroyed: () => false, getURL: () => url, session: { clearStorageData: vi.fn(async () => {}) }, ...extra });

  it('clears one origin in the tab\'s own session and leaves cookies and local storage alone', async () => {
    const wc = page('https://www.netflix.com/watch/1?x=2');
    const r = await clearSiteForPlayback(wc);
    expect(r).toEqual({ ok: true, origin: 'https://www.netflix.com' });
    const arg = wc.session.clearStorageData.mock.calls[0][0];
    expect(arg.origin).toBe('https://www.netflix.com');
    expect(arg.storages).toEqual(['serviceworkers', 'cachestorage', 'indexdb', 'filesystem']);
    expect(arg.storages).not.toContain('cookies');
    expect(arg.storages).not.toContain('localstorage');
  });

  it('refuses a page that is gone, an unreadable address and a non-web page', async () => {
    await expect(clearSiteForPlayback(null)).rejects.toThrow(/gone/);
    await expect(clearSiteForPlayback(page('x', {}))).rejects.toThrow(/could not be read/);
    await expect(clearSiteForPlayback(page('file:///C:/a.html'))).rejects.toThrow(/website/);
    await expect(clearSiteForPlayback(page('https://a.example/', { isDestroyed: () => true }))).rejects.toThrow(/gone/);
  });

  it('lets a failing clear throw to the caller', async () => {
    const wc = page('https://open.spotify.com/');
    wc.session.clearStorageData = vi.fn(async () => { throw new Error('disk busy'); });
    await expect(clearSiteForPlayback(wc)).rejects.toThrow('disk busy');
  });
});
