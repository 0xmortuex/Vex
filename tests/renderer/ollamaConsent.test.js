// Vex must never start Ollama without asking (owner rule, 2026-11-07). These
// are the static guards around the behaviour tested in aiRouterResolveBackend
// (renderer) and ollamaLauncher (main): the Settings default, the Turkish
// texts, and the main-side refusal contract.

import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { VexI18nUI } = require('../../src/renderer/js/i18n-ui.js');
const { validate } = require('../../src/main/ipc-schemas.js');

describe('Settings › AI: Start Ollama without asking', () => {
  const html = read('src/renderer/index.html');
  it('is labelled "Start Ollama without asking" and is not ticked in the markup', () => {
    expect(html).toContain('<strong>Start Ollama without asking</strong>');
    expect(html).not.toContain('Start Ollama when it is needed');
    const tag = html.match(/<input[^>]*id="setting-ollama-autostart"[^>]*>/)[0];
    expect(tag).not.toMatch(/\bchecked\b/);
  });
  it('the router no longer defaults the stored value to on', () => {
    const src = read('src/renderer/js/ai-router.js');
    expect(src).not.toMatch(/_load\('vex\.ollamaAutoStart', true\)/);
    expect(src).toMatch(/_load\('vex\.ollamaAutoStart', false\) === true/);
  });
  it('the launch-time pre-start needs the explicit setting', () => {
    expect(read('src/renderer/js/ai-router.js')).toMatch(/!ollamaAvailable && ollamaAutoStart\(\) && dependsOnLocal\(\)/);
  });
});

describe('Turkish texts', () => {
  const tr = VexI18nUI.TABLE.tr;
  const keys = [
    'Start Ollama without asking', 'Start Ollama?', 'Start Ollama', 'Never ask again',
    'Local AI needs Ollama, which is not running. Start it now?',
    'Local AI needs Ollama, which is not running',
    'Start it now? Vex does not start it by itself.',
  ];
  it('exist and differ from the English', () => {
    for (const k of keys) { expect(typeof tr[k], k).toBe('string'); expect(tr[k]).not.toBe(k); }
  });
  it('the old texts are gone, not left stale', () => {
    expect(tr['Start Ollama when it is needed']).toBeUndefined();
    expect(Object.keys(tr).some(k => k.startsWith('If the local model is wanted and Ollama is not running'))).toBe(false);
  });
  it('the keys are unique in the source file', () => {
    const src = read('src/renderer/js/i18n-ui.js');
    for (const k of ['Start Ollama without asking', 'Start Ollama?', 'Start Ollama', 'Never ask again']) {
      const n = src.split('\n').filter(l => l.startsWith("      '" + k + "': ")).length;
      expect(n, k).toBe(1);
    }
  });
});

describe('ollama:ensure needs an approved request', () => {
  it('the schema requires approved:true and a known reason', () => {
    expect(() => validate('ollama:ensure', [])).toThrow(/Invalid payload/);
    expect(() => validate('ollama:ensure', [{}])).toThrow(/Invalid payload/);
    expect(() => validate('ollama:ensure', [{ approved: false, reason: 'setting-on' }])).toThrow(/Invalid payload/);
    expect(() => validate('ollama:ensure', [{ approved: true, reason: 'x' }])).toThrow(/Invalid payload/);
    expect(() => validate('ollama:ensure', [{ approved: true, reason: 'setting-on' }])).not.toThrow();
    expect(() => validate('ollama:ensure', [{ approved: true, reason: 'person-pressed-start' }])).not.toThrow();
  });
  it('is closed in private windows, passes the request on, and main hands it to ensureApproved', () => {
    expect(read('src/main/ipc-policy.js')).toMatch(/PRIVATE_DISABLED = \/\^\(\?:[^\n]*\|ollama:ensure\|/);
    expect(read('src/preload.js')).toContain("ollamaEnsure: (request) => ipcRenderer.invoke('ollama:ensure', request)");
    expect(read('src/main.js')).toContain("ipcMain.handle('ollama:ensure', (_e, request) => _ollamaLauncher.ensureApproved(request));");
  });
});

describe('the other callers only call the API', () => {
  it('Recall and the knowledge base never launch anything', () => {
    for (const f of ['src/main/recall-vectors.js', 'src/main/knowledge-base.js']) {
      const src = read(f);
      expect(src, f).not.toMatch(/child_process|ollama-launcher|ollama:ensure|\bspawn\(/);
    }
  });
});
