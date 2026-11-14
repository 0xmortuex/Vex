// @vitest-environment jsdom
//
// How a native failure reaches the chrome. Tab calls are forgiving — a failed
// one resolves to {} — because the chrome makes them on every page event. The
// on-device AI, translation and speech, and the file calls, reject instead:
// their callers were written against the development stand-in, which throws,
// and on a phone a swallowed failure was a GPU load that never fell back to
// the CPU and a translation that reported success having changed nothing.
import { describe, it, expect, beforeAll, vi } from 'vitest';

const failing = () => vi.fn(async () => { throw new Error('native said no'); });
window.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    VexTabs: {
      addListener: () => ({ remove() {} }),
      reload: failing(),
      openDownload: failing(),
      writeDownload: failing()
    },
    VexLocalAI: { addListener: () => ({ remove() {} }), load: failing() },
    VexTranslate: { ensureModel: failing() },
    VexSpeak: { speak: failing() }
  }
};
vi.spyOn(console, 'error').mockImplementation(() => {});

const { VexBridge } = require('../../mobile/www/js/bridge.js');

beforeAll(async () => { await VexBridge.init(); });

describe('a native failure', () => {
  it('is forgiven for an ordinary tab call', async () => {
    await expect(VexBridge.reload('t1')).resolves.toEqual({});
  });

  it('reaches the caller for the on-device model', async () => {
    await expect(VexBridge.localAI('load', { name: 'x' })).rejects.toThrow('native said no');
  });

  it('reaches the caller for translation and speech', async () => {
    await expect(VexBridge.translateEnsureModel('fr', 'en')).rejects.toThrow('native said no');
    await expect(VexBridge.speak(['a'], {})).rejects.toThrow('native said no');
  });

  it('reaches the caller for opening and writing files', async () => {
    await expect(VexBridge.openDownload({ localUri: 'content://x' })).rejects.toThrow('native said no');
    await expect(VexBridge.writeToDownloads('a.txt', 'text/plain', 'YQ==')).rejects.toThrow('native said no');
  });
});
