// The GitHub release body.
//
// electron-builder publishes the release, and with nothing configured it
// publishes an EMPTY body — v2.31.55, .56 and .58 all went out with no notes at
// all, and the only releases carrying any were written by hand afterwards.
// scripts/write-release-notes.js closes that, and package.json points
// electron-builder at what it writes.
//
// These pin the two things that matter: the right version's entry is extracted,
// and publishing a version with no changelog entry fails loudly rather than
// quietly shipping an empty page again.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'write-release-notes.js');

// Run the script against a throwaway copy of a repo, so the real CHANGELOG and
// package.json are never touched.
function runIn(version, changelog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vex-notes-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'write-release-notes.js'));
  try {
    const stdout = execFileSync(process.execPath, [path.join(dir, 'scripts', 'write-release-notes.js')], { encoding: 'utf8' });
    return { ok: true, stdout, body: fs.readFileSync(path.join(dir, 'build', 'release-notes.md'), 'utf8') };
  } catch (err) {
    return { ok: false, stderr: String(err.stderr || '') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CHANGELOG = [
  '# Changelog',
  '',
  '## v2.0.0 (2026-01-02) — Newer',
  '',
  '### Notes',
  '- the new thing',
  '',
  '## v1.0.0 (2026-01-01) — Older',
  '',
  '### Notes',
  '- the old thing',
  '',
].join('\n');

describe('release notes for the published version', () => {
  it("takes the entry for package.json's version, not simply the newest", () => {
    const r = runIn('1.0.0', CHANGELOG);
    expect(r.ok).toBe(true);
    expect(r.body).toContain('the old thing');
    expect(r.body).not.toContain('the new thing');
  });

  it('stops at the next version heading', () => {
    const r = runIn('2.0.0', CHANGELOG);
    expect(r.ok).toBe(true);
    expect(r.body).toContain('the new thing');
    expect(r.body).not.toContain('Older');
    expect(r.body).not.toContain('the old thing');
  });

  it('drops the version heading, which the release page already shows', () => {
    const r = runIn('2.0.0', CHANGELOG);
    expect(r.body.startsWith('## v')).toBe(false);
    expect(r.body.trim().startsWith('### Notes')).toBe(true);
  });

  it('fails loudly when the version has no changelog entry', () => {
    const r = runIn('9.9.9', CHANGELOG);
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('no "## v9.9.9" entry');
  });

  it('fails when the entry is only a heading with nothing under it', () => {
    const r = runIn('3.0.0', '# Changelog\n\n## v3.0.0 (2026-01-03) — Empty\n\n## v2.0.0 (2026-01-02) — Older\n\nstuff\n');
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain('no content');
  });

  it('is actually wired into publish, and electron-builder is told to use it', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.scripts.publish).toContain('scripts/write-release-notes.js');
    expect(pkg.build.releaseInfo.releaseNotesFile).toBe('build/release-notes.md');
    // It has to run before electron-builder, or the file is written too late.
    const s = pkg.scripts.publish;
    expect(s.indexOf('write-release-notes')).toBeLessThan(s.indexOf('electron-builder'));
  });

  it('produces real notes for the version this repo is on right now', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain(`## v${pkg.version} `);
  });
});
