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

  it('missing file returns the public defaults', () => {
    const cfg = loadSidebarConfig(tmpUserData()); // empty dir, no config file
    expect(cfg).toEqual(DEFAULTS);
    expect(cfg.aiNewsUrl).toBe('https://0xmortuex.github.io/ai-news-tracker/');
  });

  it('valid file returns the parsed value merged over defaults', () => {
    const dir = tmpUserData();
    const url = 'https://0xmortuex.github.io/ai-news-tracker/#/guides?personalize=fadi-abc123';
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
