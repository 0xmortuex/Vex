import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSidebarConfig, DEFAULTS, CONFIG_FILENAME } from '../../src/sidebar-config.js';

// Each test gets a fresh empty "userData" dir.
function tmpUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vex-sidebar-cfg-'));
}
function writeConfig(dir, contents) {
  fs.writeFileSync(path.join(dir, CONFIG_FILENAME), contents);
}

describe('loadSidebarConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('missing file returns the public defaults (all empty)', () => {
    const cfg = loadSidebarConfig(tmpUserData()); // empty dir, no config file
    expect(cfg).toEqual(DEFAULTS);
    expect(cfg.aiNewsUrl).toBe('');
  });

  it('valid file returns the parsed value merged over defaults', () => {
    const dir = tmpUserData();
    const url = 'https://example.com/news/#/guides?personalize=abc123';
    writeConfig(dir, JSON.stringify({ aiNewsUrl: url }));
    expect(loadSidebarConfig(dir).aiNewsUrl).toBe(url);
  });

  it('ignores unknown keys (e.g. _comment) and keeps defaults for absent keys', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({ _comment: 'setup notes', somethingElse: 1 }));
    expect(loadSidebarConfig(dir)).toEqual(DEFAULTS);
  });

  it('blank / non-string aiNewsUrl falls back to the default', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({ aiNewsUrl: '   ' }));
    expect(loadSidebarConfig(dir).aiNewsUrl).toBe(DEFAULTS.aiNewsUrl);
  });

  it('malformed JSON returns defaults and logs an error', () => {
    const dir = tmpUserData();
    writeConfig(dir, '{ this is not: valid json');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadSidebarConfig(dir)).toEqual(DEFAULTS);
    expect(errSpy).toHaveBeenCalled();
  });

  it('non-object JSON (array) returns defaults and logs an error', () => {
    const dir = tmpUserData();
    writeConfig(dir, '[1, 2, 3]');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadSidebarConfig(dir)).toEqual(DEFAULTS);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('loadSidebarConfig — queue panel fields', () => {
  it('defaults queueUrl and queueSecret to empty strings', () => {
    expect(DEFAULTS.queueUrl).toBe('');
    expect(DEFAULTS.queueSecret).toBe('');
    const cfg = loadSidebarConfig(tmpUserData());
    expect(cfg.queueUrl).toBe('');
    expect(cfg.queueSecret).toBe('');
  });

  it('reads queueUrl and queueSecret from the config file', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({
      queueUrl: 'https://queue-bot.example.workers.dev',
      queueSecret: 'db5a628e-secret',
    }));
    const cfg = loadSidebarConfig(dir);
    expect(cfg.queueUrl).toBe('https://queue-bot.example.workers.dev');
    expect(cfg.queueSecret).toBe('db5a628e-secret');
  });

  it('trims surrounding whitespace on queue fields', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({ queueUrl: '  https://q/  ', queueSecret: ' s ' }));
    const cfg = loadSidebarConfig(dir);
    expect(cfg.queueUrl).toBe('https://q/');
    expect(cfg.queueSecret).toBe('s');
  });

  it('blank / non-string queue fields fall back to the empty default', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({ queueUrl: '   ', queueSecret: 123 }));
    const cfg = loadSidebarConfig(dir);
    expect(cfg.queueUrl).toBe('');
    expect(cfg.queueSecret).toBe('');
  });

  it('queue fields are independent of aiNewsUrl', () => {
    const dir = tmpUserData();
    writeConfig(dir, JSON.stringify({ queueUrl: 'https://q/', queueSecret: 's' }));
    const cfg = loadSidebarConfig(dir);
    expect(cfg.aiNewsUrl).toBe(DEFAULTS.aiNewsUrl);
    expect(cfg.queueUrl).toBe('https://q/');
  });
});
