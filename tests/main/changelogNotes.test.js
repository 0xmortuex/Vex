// parseChangelogEntry — the local-first "What's New" source. The GitHub-fetch
// path it replaced showed "Couldn't load the release notes (offline?)" to
// online users whenever the running version had no published release yet or
// the fallback release had an empty body.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseChangelogEntry } from '../../src/main-helpers.js';

const SAMPLE = `# Changelog

## v2.29.0 (2026-08-25) — Big things

### Added
- **Feature one** — details.
- Feature two.

## v2.28.1 (2026-07-08) — Small fix

### Fixed
- The fix.

## v2.28.0 — No date on this one
- Old stuff.
`;

describe('parseChangelogEntry', () => {
  it('extracts the exact version entry with title, date, and full body', () => {
    const e = parseChangelogEntry(SAMPLE, '2.28.1');
    expect(e.version).toBe('v2.28.1');
    expect(e.name).toBe('v2.28.1 — Small fix');
    expect(e.publishedAt).toBe('2026-07-08');
    expect(e.body).toContain('### Fixed');
    expect(e.body).toContain('The fix.');
    expect(e.body).not.toContain('Feature one');   // stops at the next entry
    expect(e.body).not.toContain('Old stuff');
  });

  it('falls back to the newest entry when the running version has none (dev build)', () => {
    const e = parseChangelogEntry(SAMPLE, '9.9.9');
    expect(e.version).toBe('v2.29.0');
    expect(e.name).toBe('v2.29.0 — Big things');
    expect(e.body).toContain('Feature one');
  });

  it('handles an entry with no date/title suffix', () => {
    const e = parseChangelogEntry(SAMPLE, '2.28.0');
    expect(e.version).toBe('v2.28.0');
    expect(e.body).toContain('Old stuff');
  });

  it('parses CRLF changelogs identically (Windows checkouts)', () => {
    const e = parseChangelogEntry(SAMPLE.replace(/\n/g, '\r\n'), '2.28.1');
    expect(e.name).toBe('v2.28.1 — Small fix');
    expect(e.publishedAt).toBe('2026-07-08');
    expect(e.body).not.toContain('\r');
  });

  it('returns null for empty/invalid input', () => {
    expect(parseChangelogEntry('', '1.0.0')).toBeNull();
    expect(parseChangelogEntry(null, '1.0.0')).toBeNull();
    expect(parseChangelogEntry('# nothing here', '1.0.0')).toBeNull();
  });

  it('parses the REAL repo CHANGELOG.md for the current package version', () => {
    const md = fs.readFileSync(path.join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8');
    const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const e = parseChangelogEntry(md, version);
    expect(e).not.toBeNull();
    expect(e.version).toBe('v' + version);
    expect(e.name).toContain(' — ');            // date + title suffix parsed
    expect(e.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.body.length).toBeGreaterThan(100);
  });

  it('the packaged-app files list ships CHANGELOG.md (the local source must exist in builds)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.build.files).toContain('CHANGELOG.md');
  });
});
