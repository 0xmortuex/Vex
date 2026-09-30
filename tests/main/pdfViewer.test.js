// A PDF opened as a blank page (feature sweep, 2026-09-28): Chromium's PDF
// viewer is a plugin and runs only in a webview with plugins on, and tabs were
// built without them. Checked live: the viewer, toolbar and document appear.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/' + f), 'utf8');

describe('PDFs show in tabs', () => {
  it('every tab webview is built with plugins on', () => {
    const src = read('renderer/js/webview.js');
    const create = src.slice(src.indexOf('createWebview(tab) {'), src.indexOf("webview.dataset.tabId = tab.id;"));
    expect(create).toMatch(/webview\.setAttribute\('plugins', ''\)/);
  });
  it('the webview security policy does not take plugins away', () => {
    const src = read('main/session-security.js');
    // The handler itself, from its .on( to the next one's: a comment above it
    // names 'did-attach-webview' too, which made the old slice empty.
    const from = src.indexOf("on('will-attach-webview'");
    const attach = src.slice(from, src.indexOf("on('did-attach-webview'", from));
    expect(attach.length).toBeGreaterThan(100);
    expect(attach).not.toMatch(/plugins/);
  });
});
