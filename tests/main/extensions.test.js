// Helpers behind the Chrome-extension manager. These cover the cases that
// actually bit during the extension audit: a localized manifest listing as
// "__MSG_extName__" (and slugging its install folder that way), icons never
// reaching the manager, and a PowerShell-made .zip failing with an opaque
// "Unsafe archive path".
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ext = createRequire(import.meta.url)('../../src/main/extensions.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-ext-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function writeLocale(locale, messages) {
  const target = path.join(dir, '_locales', locale);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'messages.json'), JSON.stringify(messages));
}

describe('manifest localization', () => {
  it('resolves __MSG_ placeholders from the default locale', () => {
    writeLocale('de', { extName: { message: 'Mein Add-on' } });
    const messages = ext.readMessages(dir, 'de');
    expect(ext.localize('__MSG_extName__', messages)).toBe('Mein Add-on');
  });

  it('falls back to en when the default locale has no catalogue', () => {
    writeLocale('en', { extName: { message: 'My Add-on' } });
    expect(ext.localize('__MSG_extName__', ext.readMessages(dir, 'fr'))).toBe('My Add-on');
  });

  it('keeps an unknown placeholder visible rather than blanking the name', () => {
    writeLocale('en', { other: { message: 'x' } });
    expect(ext.localize('__MSG_missing__', ext.readMessages(dir, 'en'))).toBe('__MSG_missing__');
  });

  it('returns an empty catalogue when the extension is not localized', () => {
    expect(Object.keys(ext.readMessages(dir, undefined))).toEqual([]);
    expect(ext.localize('Plain Name', {})).toBe('Plain Name');
  });

  it('raises rather than hiding a corrupt messages.json', () => {
    fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), '{ not json');
    expect(() => ext.readMessages(dir, 'en')).toThrow();
  });
});

describe('slugFromName', () => {
  it('slugs a normal name', () => {
    expect(ext.slugFromName('uBlock Origin')).toBe('ublock-origin');
  });

  it('never produces the leading/trailing dashes an unresolved __MSG_ name gave', () => {
    expect(ext.slugFromName('__MSG_extName__')).toBe('msg-extname');
  });

  it('falls back to "extension" when nothing survives slugging', () => {
    expect(ext.slugFromName('!!!')).toBe('extension');
    expect(ext.slugFromName('')).toBe('extension');
    expect(ext.slugFromName(undefined)).toBe('extension');
  });

  it('caps the slug length without leaving a trailing dash', () => {
    const slug = ext.slugFromName('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('pickIcon', () => {
  it('prefers the largest declared identity icon', () => {
    expect(ext.pickIcon({ icons: { 16: 'i16.png', 128: 'i128.png', 48: 'i48.png' } })).toBe('i128.png');
  });

  it('falls back to the MV3 action icon, then the MV2 browser_action icon', () => {
    expect(ext.pickIcon({ action: { default_icon: { 32: 'a32.png' } } })).toBe('a32.png');
    expect(ext.pickIcon({ browser_action: { default_icon: 'b.png' } })).toBe('b.png');
  });

  it('returns null when the manifest declares no icon', () => {
    expect(ext.pickIcon({})).toBeNull();
    expect(ext.pickIcon(null)).toBeNull();
  });
});

describe('pickPages', () => {
  it('reads the MV3 action popup and options_page', () => {
    expect(ext.pickPages({ action: { default_popup: 'popup.html' }, options_page: 'options.html' }))
      .toEqual({ popup: 'popup.html', options: 'options.html' });
  });

  it('reads the MV2 browser_action popup and options_ui page', () => {
    expect(ext.pickPages({ browser_action: { default_popup: 'p.html' }, options_ui: { page: 'o.html' } }))
      .toEqual({ popup: 'p.html', options: 'o.html' });
  });

  it('reports nulls when the extension has neither', () => {
    expect(ext.pickPages({})).toEqual({ popup: null, options: null });
  });
});

describe('archiveProblem', () => {
  it('explains a PowerShell Compress-Archive zip instead of "Unsafe archive path"', () => {
    const message = ext.archiveProblem(['manifest.json', 'icons\\icon16.png']);
    expect(message).toMatch(/Compress-Archive/);
    expect(message).toMatch(/Install from folder/);
  });

  it('passes a normal archive', () => {
    expect(ext.archiveProblem(['manifest.json', 'icons/icon16.png'])).toBeNull();
  });

  it('rejects a non-array argument rather than guessing', () => {
    expect(() => ext.archiveProblem('manifest.json')).toThrow(TypeError);
  });
});

describe('disabled store', () => {
  it('round-trips disabled folders', () => {
    expect(ext.readDisabled(dir)).toEqual(new Set());
    ext.writeDisabled(dir, new Set(['ublock-1', 'dark-2']));
    expect(ext.readDisabled(dir)).toEqual(new Set(['ublock-1', 'dark-2']));
  });

  it('survives being re-read after a rewrite (state outlives a restart)', () => {
    ext.writeDisabled(dir, new Set(['a']));
    ext.writeDisabled(dir, new Set(['a', 'b']));
    expect([...ext.readDisabled(dir)].sort()).toEqual(['a', 'b']);
  });

  it('raises on a corrupt state file instead of silently enabling everything', () => {
    fs.writeFileSync(ext.disabledPath(dir), '{"nope":true}');
    expect(() => ext.readDisabled(dir)).toThrow(/corrupt/);
  });

  it('keeps the store out of the extension folder listing', () => {
    ext.writeDisabled(dir, new Set(['a']));
    expect(fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory())).toEqual([]);
  });
});
