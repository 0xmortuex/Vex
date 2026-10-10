// @vitest-environment node
//
// SE5: pop-ups were allowed by default, about:blank/blob:/data: ones always
// (even on a site set to Block), and the "was it the person" test was the
// page's own navigator.userActivation, which a page can redefine. Now a
// window opens only right after a click or key press the page really got
// (main's input events), one per click, unless the site's pop-ups are allowed.
import { describe, it, expect } from 'vitest';
const fs = require('fs'), path = require('path');
const { createPopupBlocker, ACTIVATION_MS } = require('../../src/main/popup-blocker.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
const main = read('src/main.js');

function blocker({ gestures = {}, decisions = {}, clock = { t: 100000 } } = {}) {
  const b = createPopupBlocker({
    lastGestureAt: (id) => gestures[id],
    sitePopups: (_contents, origin) => decisions[origin],
    now: () => clock.t,
  });
  return { b, gestures, decisions, clock };
}
const page = (id = 7) => ({ id });

describe('the pop-up blocker', () => {
  it('blocks a window nobody clicked for, from any page: http, about:blank, blob: or data:', () => {
    const { b } = blocker();
    for (const opener of ['https://ads.example/', 'about:blank', 'blob:https://ads.example/1', 'data:text/html,x']) {
      expect(b.judge(page(), opener).block).toBe(true);
    }
    expect(b.judge(page(), 'https://ads.example/x').origin).toBe('https://ads.example');
  });
  it('lets one window through right after a click on the page, and only one', () => {
    const { b, gestures, clock } = blocker();
    gestures[7] = clock.t - 300;
    expect(b.judge(page(), 'https://login.example/').block).toBe(false);   // the OAuth / print window after a click
    expect(b.judge(page(), 'https://login.example/').block).toBe(true);    // a second one on the same click
    gestures[7] = clock.t - 10;                                            // another click
    expect(b.judge(page(), 'https://login.example/').block).toBe(false);
  });
  it('a click more than five seconds ago does not count, nor a click on another page', () => {
    const { b, gestures, clock } = blocker();
    gestures[7] = clock.t - ACTIVATION_MS - 1;
    expect(b.judge(page(), 'https://a.example/').block).toBe(true);
    gestures[8] = clock.t - 100;
    expect(b.judge(page(7), 'https://a.example/').block).toBe(true);
  });
  it('a site whose pop-ups are allowed opens them without a click; Block is the default', () => {
    const { b, decisions } = blocker();
    decisions['https://app.example'] = 'allow';
    expect(b.judge(page(), 'https://app.example/x').block).toBe(false);
    decisions['https://app.example'] = 'deny';
    expect(b.judge(page(), 'https://app.example/x').block).toBe(true);
  });
  it('Vex’s own pages are not judged', () => {
    const { b } = blocker();
    for (const opener of ['file:///C:/Vex/resources/app/src/renderer/start.html', 'vex://start', 'chrome-extension://abc/popup.html', 'devtools://devtools/x']) {
      expect(b.judge(page(), opener).block).toBe(false);
    }
  });
});

describe('main.js', () => {
  const handler = main.slice(main.indexOf('contents.setWindowOpenHandler((details) => {'), main.indexOf('// Same story for top-level navigations'));
  it('asks the blocker before any window is let through, print and OAuth ones included', () => {
    const at = handler.indexOf('if (_popupRefused(contents, openerUrl, url)) return { action: \'deny\' };');
    expect(at).toBeGreaterThan(-1);
    for (const later of ['isPopupLikePrint', 'shouldKeepPopupReal(url)', 'isScriptedHandbackPopup', "win.webContents.send('tab:create-from-external'"]) {
      expect(handler.indexOf(later)).toBeGreaterThan(at);
    }
    expect(handler.match(/_popupRefused\(/g)).toHaveLength(1);
  });
  it('judges by the input the page got, never by what the page says', () => {
    expect(main).toMatch(/lastGestureAt: \(id\) => _lastGestureAt\.get\(id\)/);
    expect(main).not.toMatch(/popup:activation|_popupActivated/);
    expect(read('src/preload-webview.js')).not.toMatch(/vexPopupActivation|popup:activation|userActivation\.isActive/);
    expect(read('src/main/ipc-policy.js')).not.toMatch(/popup:activation/);
    expect(read('src/main/ipc-schemas.js')).not.toMatch(/popup:activation/);
  });
  it('tells the window, so its address bar can say so', () => {
    expect(main).toMatch(/host\.win\.webContents\.send\('popup:blocked', \{ pageId: contents\.id, origin, url: url \|\| 'about:blank' \}\)/);
    expect(read('src/preload.js')).toMatch(/onPopupBlocked: +\(cb\) => subscribe\('popup:blocked', cb\)/);
  });
  it('the Claude panel’s own sign-in click still opens its Google window', () => {
    const block = main.slice(main.indexOf('// Claude panel: auto-continue login with Google.'), main.indexOf('// (Gmail webview popup-intercept removed'));
    expect(block).toMatch(/_lastGestureAt\.set\(contents\.id, Date\.now\(\)\);\s*const clicked = await contents\.executeJavaScript\(clickJs, true\)/);
  });
});
