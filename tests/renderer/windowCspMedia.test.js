// Quick look (js/download-quicklook.js) plays a downloaded sound or video from a blob: address. The window's content security policy had no media-src,
// so media fell back to default-src 'self' and the player said "This file could not be played here" for every video and sound (found in the real app, 2026-10-25).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');
const csp = (/Content-Security-Policy"\s+content="([^"]+)"/.exec(html) || [])[1] || '';

describe('the window\'s content security policy', () => {
  it('lets a media element play from a blob: address and from nowhere on the web', () => {
    expect(csp.length).toBeGreaterThan(50);
    const media = (/(?:^|;\s*)media-src ([^;]+)/.exec(csp) || [])[1] || '';
    expect(media.split(/\s+/)).toContain('blob:');
    expect(media).not.toMatch(/https?:|\*/);
  });
});
