// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolvePanelWebview, navigatePanelWebview } from '../../src/renderer/js/sidebar.js';

// The "Switch to ..." / "Change link" / "Reset to default" paths used to drive
// manager.panelWebviews[panel] directly. That cached node goes stale after a
// re-mount, and loadURL() on the detached node is a silent no-op inside an
// empty catch - the menu item looked dead. These two helpers are what those
// paths go through now.

function fakeWv(tag) {
  return { tag, loadURL: vi.fn(() => Promise.resolve()), setAttribute: vi.fn() };
}

function mountPanel(panel, wv) {
  const el = document.createElement('div');
  el.id = 'panel-' + panel;
  // querySelector('webview') must find it, so give the stub a real element.
  const node = document.createElement('webview');
  Object.assign(node, wv);
  el.appendChild(node);
  document.body.appendChild(el);
  return node;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('resolvePanelWebview', () => {
  it('prefers the live DOM webview over a stale cached reference', () => {
    const stale = fakeWv('stale');
    const live = mountPanel('netflix', fakeWv('live'));
    const manager = { panelWebviews: { netflix: stale } };

    expect(resolvePanelWebview(manager, 'netflix')).toBe(live);
  });

  it('re-syncs the cache so the next caller starts from the live node', () => {
    const stale = fakeWv('stale');
    const live = mountPanel('netflix', fakeWv('live'));
    const manager = { panelWebviews: { netflix: stale } };

    resolvePanelWebview(manager, 'netflix');

    expect(manager.panelWebviews.netflix).toBe(live);
  });

  it('falls back to the cached reference when the panel is not mounted', () => {
    const cached = fakeWv('cached');
    const manager = { panelWebviews: { netflix: cached } };

    expect(resolvePanelWebview(manager, 'netflix')).toBe(cached);
  });

  it('returns null rather than throwing when there is nothing to resolve', () => {
    expect(resolvePanelWebview({}, 'netflix')).toBeNull();
    expect(resolvePanelWebview(undefined, 'netflix')).toBeNull();
  });
});

describe('navigatePanelWebview', () => {
  it('navigates via loadURL', () => {
    const wv = fakeWv('a');
    expect(navigatePanelWebview(wv, 'https://www.netflix.com/')).toBe(true);
    expect(wv.loadURL).toHaveBeenCalledWith('https://www.netflix.com/');
  });

  it('falls back to the src attribute when loadURL rejects', async () => {
    const wv = fakeWv('a');
    wv.loadURL = vi.fn(() => Promise.reject(new Error('not attached')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    navigatePanelWebview(wv, 'https://www.netflix.com/');
    await Promise.resolve();
    await Promise.resolve();

    expect(wv.setAttribute).toHaveBeenCalledWith('src', 'https://www.netflix.com/');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the src attribute when loadURL throws synchronously', () => {
    const wv = fakeWv('a');
    wv.loadURL = vi.fn(() => { throw new Error('detached'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(navigatePanelWebview(wv, 'https://x.test/')).toBe(true);
    expect(wv.setAttribute).toHaveBeenCalledWith('src', 'https://x.test/');
    warn.mockRestore();
  });

  it('is a no-op for a missing webview or url', () => {
    expect(navigatePanelWebview(null, 'https://x.test/')).toBe(false);
    expect(navigatePanelWebview(fakeWv('a'), '')).toBe(false);
  });
});
