// @vitest-environment jsdom
//
// Found 2026-10-12 by reading Settings > Browsing extras the way a person does:
//  - the explanation of "Always allow copy & right-click" sat under the new
//    Picture-in-Picture rows, so it read as being about them;
//  - the sites the Picture-in-Picture button is hidden on ran together
//    ("a.com,b.org") with no space.
import { describe, it, expect } from 'vitest';

const fs = require('fs'), path = require('path');
const { PiPManager } = require('../../src/renderer/js/pip-manager.js');
const HTML = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.html'), 'utf8');

describe('Settings > Browsing extras', () => {
  it('keeps the copy-unlock explanation right under its own switch', () => {
    const at = HTML.indexOf('id="setting-copyunlock"');
    expect(at).toBeGreaterThan(0);
    const row = HTML.indexOf('</div>', at);
    const next = HTML.slice(row + '</div>'.length).trimStart();
    expect(next.startsWith('<p class="setting-info muted"')).toBe(true);
    expect(next).toContain('Re-enables text selection, copying, and right-click');
    // and nothing about copying sits under the Picture-in-Picture rows
    const pipEnd = HTML.indexOf('id="setting-pip-sites-clear"');
    const after = HTML.slice(pipEnd, pipEnd + 400);
    expect(after).not.toContain('Re-enables text selection');
  });

  it('lists the sites the button is hidden on with a space after each comma', () => {
    document.body.innerHTML = '<select id="setting-pip-button"><option value="hover"></option><option value="always"></option><option value="never"></option></select><div id="setting-pip-sites-row" style="display:none"><span id="setting-pip-sites-text"></span></div>';
    localStorage.setItem('vex.pipButtonOff', JSON.stringify(['a.com', 'b.org']));
    PiPManager._syncSettings();
    expect(document.getElementById('setting-pip-sites-text').textContent).toBe('Picture-in-Picture button hidden for a.com, b.org');
    localStorage.removeItem('vex.pipButtonOff');
  });
});
