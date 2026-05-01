import { describe, it, expect } from 'vitest';
import path from 'path';
import { safeJoin, safeName } from '../../src/main-helpers.js';

// Use OS-appropriate parent paths so tests work on both Windows (CI may run
// on Linux later, and dev runs on Windows). path.resolve normalises
// regardless, so picking a shape that exists on the host avoids surprise.
const ROOT = path.resolve('/foo');
const ROOT_SUB = path.resolve('/foo/sub');

describe('safeJoin', () => {
  describe('legal joins', () => {
    it('plain filename', () => {
      expect(safeJoin('/foo', 'bar.txt')).toBe(path.resolve('/foo/bar.txt'));
    });

    it('nested path inside parent', () => {
      expect(safeJoin('/foo', 'a/b/c.txt')).toBe(path.resolve('/foo/a/b/c.txt'));
    });

    it('empty string resolves to the parent itself', () => {
      expect(safeJoin('/foo', '')).toBe(ROOT);
    });

    it('"." resolves to the parent itself', () => {
      expect(safeJoin('/foo', '.')).toBe(ROOT);
    });

    it('redundant traversal that stays inside parent is allowed', () => {
      // a/../b → b, still inside /foo.
      expect(safeJoin('/foo', 'a/../b')).toBe(path.resolve('/foo/b'));
    });

    it('trailing-slash variations on parent', () => {
      expect(safeJoin('/foo/', 'bar.txt')).toBe(path.resolve('/foo/bar.txt'));
      expect(safeJoin('/foo', './bar.txt')).toBe(path.resolve('/foo/bar.txt'));
    });

    it('parent itself (no relative) is fine', () => {
      // Non-trivial: candidate === parentResolved is the only legal "no sep" case.
      expect(safeJoin(ROOT, '.')).toBe(ROOT);
    });
  });

  describe('blocks traversal', () => {
    it('"../" escape', () => {
      expect(() => safeJoin('/foo', '../etc/passwd')).toThrow(/Path traversal blocked/);
    });

    it('multi-segment "../../" escape', () => {
      expect(() => safeJoin('/foo', '../../etc/passwd')).toThrow(/Path traversal blocked/);
    });

    it('escape buried in the middle', () => {
      expect(() => safeJoin('/foo', 'a/../../etc')).toThrow(/Path traversal blocked/);
    });

    it('absolute path that escapes the parent', () => {
      // Resolving to an absolute outside parent must fail.
      const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';
      expect(() => safeJoin('/foo', outside)).toThrow(/Path traversal blocked/);
    });

    it('parent prefix match must be by separator, not substring', () => {
      // /foobar must NOT count as inside /foo.
      // We construct this by placing a sibling that shares a prefix.
      const parent = path.resolve('/foo');
      const trickRel = path.relative(parent, path.resolve('/foobar/x'));
      expect(() => safeJoin(parent, trickRel)).toThrow(/Path traversal blocked/);
    });
  });

  describe('rejects bad arguments', () => {
    it('empty parentDir', () => {
      expect(() => safeJoin('', 'foo')).toThrow(/parentDir/);
    });

    it('non-string parentDir', () => {
      expect(() => safeJoin(null, 'foo')).toThrow(/parentDir/);
      expect(() => safeJoin(42, 'foo')).toThrow(/parentDir/);
    });

    it('non-string untrustedRelative', () => {
      expect(() => safeJoin('/foo', null)).toThrow(/untrustedRelative/);
      expect(() => safeJoin('/foo', undefined)).toThrow(/untrustedRelative/);
      expect(() => safeJoin('/foo', 42)).toThrow(/untrustedRelative/);
    });
  });
});

describe('safeName', () => {
  describe('accepts plain segments', () => {
    it('alphanumeric', () => {
      expect(safeName('hello')).toBe('hello');
      expect(safeName('hello123')).toBe('hello123');
    });

    it('with dashes / underscores / dots', () => {
      expect(safeName('hello-world_v1.2')).toBe('hello-world_v1.2');
    });

    it('UTF-8 segment without separators', () => {
      expect(safeName('üñíç𝕠de')).toBe('üñíç𝕠de');
    });
  });

  describe('rejects illegal input', () => {
    it('empty string', () => {
      expect(() => safeName('')).toThrow(/non-empty/);
    });

    it('non-string', () => {
      expect(() => safeName(null)).toThrow(/non-empty/);
      expect(() => safeName(undefined)).toThrow(/non-empty/);
      expect(() => safeName(42)).toThrow(/non-empty/);
      expect(() => safeName({})).toThrow(/non-empty/);
    });

    it('contains forward slash', () => {
      expect(() => safeName('a/b')).toThrow(/illegal characters/);
      expect(() => safeName('/abs')).toThrow(/illegal characters/);
    });

    it('contains backslash', () => {
      expect(() => safeName('a\\b')).toThrow(/illegal characters/);
      expect(() => safeName('C:\\foo')).toThrow(/illegal characters/);
    });

    it('contains "..".', () => {
      expect(() => safeName('a..b')).toThrow(/illegal characters/);
      expect(() => safeName('..foo')).toThrow(/illegal characters/);
      expect(() => safeName('foo..')).toThrow(/illegal characters/);
    });

    it('contains null byte', () => {
      expect(() => safeName('a\0b')).toThrow(/illegal characters/);
    });

    it('exact "." or ".."', () => {
      expect(() => safeName('.')).toThrow(/reserved/);
      // ".." also trips the "contains .." check before the reserved check —
      // either error message is fine, just verify it throws.
      expect(() => safeName('..')).toThrow();
    });
  });

  // Returned value type for chained use with safeJoin.
  it('returns the input verbatim on success', () => {
    expect(safeName('extension-folder-1234')).toBe('extension-folder-1234');
  });
});

// Integration: the two helpers compose the way the H-2/H-3 fixes use them.
describe('safeJoin + safeName composition', () => {
  it('storage-key flow: legitimate key resolves inside dir', () => {
    const STORAGE_DIR = path.resolve('/var/Vex/storage');
    const key = 'tabs';
    const fp = safeJoin(STORAGE_DIR, safeName(key) + '.json');
    expect(fp).toBe(path.resolve(STORAGE_DIR, 'tabs.json'));
  });

  it('storage-key flow: malicious key is rejected by safeName, never reaches safeJoin', () => {
    const STORAGE_DIR = path.resolve('/var/Vex/storage');
    expect(() => safeJoin(STORAGE_DIR, safeName('../../../passwd') + '.json'))
      .toThrow(/illegal characters/);
  });

  it('extensions-uninstall flow: legitimate folderName resolves inside extensions dir', () => {
    const EXT_DIR = path.resolve('/var/Vex/extensions');
    const fp = safeJoin(EXT_DIR, safeName('ublock-1700000000000'));
    expect(fp).toBe(path.resolve(EXT_DIR, 'ublock-1700000000000'));
  });

  it('extensions-uninstall flow: traversal in folderName is rejected', () => {
    const EXT_DIR = path.resolve('/var/Vex/extensions');
    expect(() => safeJoin(EXT_DIR, safeName('../../sensitive')))
      .toThrow(/illegal characters/);
  });
});
