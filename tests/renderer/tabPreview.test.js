// @vitest-environment jsdom
//
// Hover-preview behaviour test. We exercise:
//   - the 800ms delay before a preview appears
//   - cancelling the timer when the user mouses off before it fires
//   - the wv.capturePage() success path (thumbnail rendered)
//   - the wv.capturePage() failure path (metadata-only popup, no <img>)
//   - both vertical (.tab-item under #tabs-list) and horizontal
//     (.top-tab under #top-tabs-list) layouts
//
// We don't have Electron's NativeImage in node, so the fake webview returns
// a stub with isEmpty() / resize() / toDataURL() that mimics the real shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fakeImg = {
  isEmpty: () => false,
  resize: () => fakeImg,
  toDataURL: () => 'data:image/png;base64,FAKE',
};

const emptyImg = { isEmpty: () => true };

function buildVerticalDOM() {
  document.body.innerHTML = `
    <div id="tabs-sidebar">
      <ul id="tabs-list">
        <li class="tab-item" data-tab-id="t1"></li>
        <li class="tab-item" data-tab-id="t2"></li>
      </ul>
    </div>
  `;
}

function buildHorizontalDOM() {
  document.body.dataset.tabLayout = 'horizontal';
  document.body.innerHTML = `
    <div id="top-tabs-bar">
      <div id="top-tabs-list">
        <div class="top-tab" data-tab-id="t1"></div>
        <div class="top-tab" data-tab-id="t2"></div>
      </div>
    </div>
  `;
}

function installTabManager(over = {}) {
  globalThis.TabManager = {
    tabs: [
      { id: 't1', title: 'Hacker News', url: 'https://news.ycombinator.com/' },
      { id: 't2', title: 'Sleeping Tab', url: 'https://example.com/', sleeping: true },
    ],
    ...over,
  };
}
function installWebviewManager(captureImpl = () => Promise.resolve(fakeImg)) {
  globalThis.WebviewManager = {
    webviews: new Map([
      ['t1', { capturePage: captureImpl }],
      ['t2', { capturePage: captureImpl }],
    ]),
  };
}

let TabPreview, HOVER_DELAY_MS;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '';
  delete document.body.dataset.tabLayout;
  installTabManager();
  installWebviewManager();
  ({ TabPreview, HOVER_DELAY_MS } = await import('../../src/renderer/js/tab-preview.js'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TabPreview — hover delay', () => {
  it('exposes HOVER_DELAY_MS = 800', () => {
    expect(HOVER_DELAY_MS).toBe(800);
  });

  it('does NOT show the preview until 800ms after mouseenter', async () => {
    buildVerticalDOM();
    TabPreview.init();
    const item = document.querySelector('.tab-item[data-tab-id="t1"]');

    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(false);

    // 799ms — still not visible.
    await vi.advanceTimersByTimeAsync(799);
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(false);

    // 1ms more = 800ms total. capturePage() is awaited via a microtask, so
    // flush microtasks too.
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve(); await Promise.resolve();

    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(true);
  });

  it('cancels the preview if the user leaves before 800ms', async () => {
    buildVerticalDOM();
    TabPreview.init();
    const item = document.querySelector('.tab-item[data-tab-id="t1"]');

    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await vi.advanceTimersByTimeAsync(400);
    item.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

    // After cancel, the timer must not fire even after 800ms+ elapses.
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve(); await Promise.resolve();
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(false);
    expect(TabPreview._getHoverTimerForTest()).toBeNull();
  });

  it('cancels when the cursor moves off a tab onto the gap', async () => {
    buildVerticalDOM();
    TabPreview.init();
    const item = document.querySelector('.tab-item[data-tab-id="t1"]');
    const list = document.getElementById('tabs-list');

    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    await vi.advanceTimersByTimeAsync(200);

    // mousemove on the bare list (no .tab-item ancestor) should cancel.
    list.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(false);
  });
});

describe('TabPreview — thumbnail capture', () => {
  it('renders the thumbnail returned by wv.capturePage()', async () => {
    buildVerticalDOM();
    TabPreview.init();
    document.querySelector('.tab-item[data-tab-id="t1"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    await vi.advanceTimersByTimeAsync(800);
    // capturePage() promise + thumbnail.toDataURL chain
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const img = document.querySelector('#tab-preview img');
    expect(img.style.display).toBe('block');
    expect(img.src).toBe('data:image/png;base64,FAKE');
  });

  it('falls back to metadata-only when capturePage rejects', async () => {
    installWebviewManager(() => Promise.reject(new Error('webview destroyed')));
    vi.resetModules();
    ({ TabPreview } = await import('../../src/renderer/js/tab-preview.js'));

    buildVerticalDOM();
    TabPreview.init();
    document.querySelector('.tab-item[data-tab-id="t1"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    const preview = document.getElementById('tab-preview');
    expect(preview.classList.contains('visible')).toBe(true);
    expect(preview.querySelector('img').style.display).toBe('none');
    expect(preview.querySelector('.preview-title').textContent).toBe('Hacker News');
    expect(preview.querySelector('.preview-url').textContent).toBe('https://news.ycombinator.com/');
  });

  it('falls back to metadata-only when capturePage returns an empty bitmap', async () => {
    installWebviewManager(() => Promise.resolve(emptyImg));
    vi.resetModules();
    ({ TabPreview } = await import('../../src/renderer/js/tab-preview.js'));

    buildVerticalDOM();
    TabPreview.init();
    document.querySelector('.tab-item[data-tab-id="t1"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(document.querySelector('#tab-preview img').style.display).toBe('none');
    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(true);
  });

  it('does NOT show a preview for sleeping tabs', async () => {
    buildVerticalDOM();
    TabPreview.init();
    document.querySelector('.tab-item[data-tab-id="t2"]')   // t2 is sleeping
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve(); await Promise.resolve();

    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(false);
  });
});

describe('TabPreview — horizontal layout', () => {
  it('also wires hover on .top-tab elements under #top-tabs-list', async () => {
    buildHorizontalDOM();
    TabPreview.init();

    document.querySelector('.top-tab[data-tab-id="t1"]')
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    await vi.advanceTimersByTimeAsync(800);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    expect(document.getElementById('tab-preview').classList.contains('visible')).toBe(true);
  });
});
