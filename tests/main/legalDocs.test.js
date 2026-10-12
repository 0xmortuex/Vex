// The documents shown inside Vex are read from the app folder, by name only,
// and only Vex's own window may ask for them or quit Vex.
import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const { readLegalDoc, registerLegalDocs, LEGAL_DOCS } = require('../../src/main/legal-docs.js');
const { validate } = require('../../src/main/ipc-schemas.js');
const root = path.join(__dirname, '../..');

describe('legal documents in the main process', () => {
  it('reads each shipped document and nothing else', () => {
    for (const name of LEGAL_DOCS) expect(readLegalDoc(root, name).length).toBeGreaterThan(100);
    expect(() => readLegalDoc(root, '../package.json')).toThrow(/Not a document/);
    expect(() => readLegalDoc(root, 'package.json')).toThrow(/Not a document/);
  });

  it('the documents start with their title, with no "draft" or "not legal advice" notice', () => {
    for (const name of ['PRIVACY.md', 'TERMS.md']) {
      const text = readLegalDoc(root, name);
      expect(text.startsWith('# Vex '), name).toBe(true);
      expect(text).not.toMatch(/\bdraft\b|not legal advice/i);
    }
  });

  it('the IPC contract takes only those names, and the channels are UI-only', () => {
    expect(() => validate('legal:read', ['PRIVACY.md'])).not.toThrow();
    expect(() => validate('legal:read', ['..\\package.json'])).toThrow();
    expect(() => validate('app:quit', [])).not.toThrow();
    const { UI_ONLY_CHANNELS } = require('../../src/main/ipc-policy.js');
    for (const ch of ['legal:read', 'app:quit', 'legal:gate']) expect(UI_ONLY_CHANNELS.has(ch), ch).toBe(true);
  });

  it('registers the handlers; Quit Vex quits', async () => {
    const handlers = {};
    const app = { quit: vi.fn() };
    registerLegalDocs({ ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, app, root });
    expect(await handlers['legal:read']({}, 'TERMS.md')).toMatch(/terms of use/i);
    await handlers['app:quit']({});
    expect(app.quit).toHaveBeenCalledTimes(1);
  });
});
