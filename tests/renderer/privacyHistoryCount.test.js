// PRIVACY.md says how many visits history keeps. It said the newest 500 while
// the History list (js/history-panel.js) keeps up to 5,000 (found 2026-10-10).
import { describe, expect, it } from 'vitest';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const PRIVACY = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
const PANEL = fs.readFileSync(path.join(root, 'src/renderer/js/history-panel.js'), 'utf8');

describe('PRIVACY.md history count', () => {
  it('names the number of visits the History list keeps', () => {
    const cap = Number(PANEL.match(/MAX_ENTRIES:\s*(\d+)/)[1]);
    const said = PRIVACY.match(/browsing history \(up to the newest ([\d,]+) visits\)/);
    expect(said).not.toBeNull();
    expect(Number(said[1].replace(/,/g, ''))).toBe(cap);
  });
});
