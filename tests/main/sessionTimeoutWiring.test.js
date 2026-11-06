// The main-process side of the sign-out warning: a tab's real activity is reported to its window only while some site has a
// timeout, throttled, as a page id and nothing else (src/main.js _reportTabActivity); the window can hear it (preload).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const main = fs.readFileSync('src/main.js', 'utf8');
const preload = fs.readFileSync('src/preload.js', 'utf8');

describe('activity report', () => {
  const at = main.indexOf('function _reportTabActivity(');
  const body = main.slice(at, at + 900);
  it('only runs while a site has a timeout, only for web pages, and at most every 5 seconds', () => {
    expect(at).toBeGreaterThan(0);
    expect(body).toMatch(/if \(!_hasTimeoutRules \|\| contents\.getType\(\) !== 'webview'\) return;/);
    expect(body).toMatch(/< 5000\) return;/);
  });
  it('sends the page id and nothing else', () => {
    expect(body).toMatch(/send\('session-timeout:activity', \{ pageId: contents\.id \}\)/);
  });
  it('is fed by a click, key press or touch the page really received', () => {
    const w = main.slice(main.indexOf('function _watchGestures('), main.indexOf('function _watchGestures(') + 600);
    expect(w).toMatch(/GESTURE_INPUT_TYPES\.has\(input\.type\)\) \{ _lastGestureAt\.set\(id, Date\.now\(\)\); _reportTabActivity\(contents\); \}/);
    expect(w).toMatch(/_activitySentAt\.delete\(id\)/);
  });
  it('the flag follows the saved rules', () => {
    expect(main).toMatch(/_hasTimeoutRules = Object\.values\(_siteRules\)\.some\(r => Number\.isInteger\(r\.sessionMin\)\)/);
  });
  it('the window can listen', () => {
    expect(preload).toMatch(/onTabActivity: \(callback\) => subscribe\('session-timeout:activity', callback\)/);
  });
});
