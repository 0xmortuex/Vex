# Releasing Vex

A release is two commands: `scripts/release.js` prepares and pushes the version, and `npm run publish` (run by the owner) builds, checks and uploads it. Nothing is drafted or tagged by hand.

## Before you start

- **gh CLI signed in** (`gh auth status`), or `GH_TOKEN` set — every GitHub step uses `gh`.
- **castLabs EVS account for Widevine (VMP) signing.** `scripts/vmp-sign.js` runs as electron-builder's `afterSign`, forces a fresh online signature and **aborts the build** if it gets a development signature or no signature. If the session has expired, sign in again first:
  ```
  python -m castlabs_evs.account reauth
  ```
  (`VEX_SKIP_VMP_VERIFY=1` builds without DRM. Such a build is never a release: Netflix/Spotify playback fails with it.)
- **The website checked out next to this repo** as `..\vex-website` — `post-publish.js` moves its "Latest" badge.
- **Close any Vex running from `dist\`.** The build deletes and rebuilds `dist\`; `scripts/check-dist-free.js` stops the build with a message if a `dist\…\Vex.exe` is still running.
- **CI is green** for the commit you are releasing (`gh run list --limit 3`). CI runs on Node 22 — run the tests under Node 22 too, along with `npm run lint`, `npm run check:types` and `npm audit --omit=dev --audit-level=high`.

## 1. Write the changelog entry

Add a `## vX.Y.Z (YYYY-MM-DD) — Title` entry at the top of `CHANGELOG.md`. Neither script invents notes: `release.js` refuses to run without the entry, and `write-release-notes.js` copies it onto the GitHub release page.

## 2. Bump, commit and push

```
node scripts/release.js X.Y.Z "Title" --no-publish
```

This checks the changelog entry exists, sets the version in `package.json` and `package-lock.json`, commits **only** those two files and `CHANGELOG.md` (other dirty or staged files are left alone), and pushes `origin main`. Add `--dry-run` to see the steps without changing anything.

Without `--no-publish` it then runs `npm run publish` itself (step 3).

## 3. Build, check and publish

```
npm run publish
```

In order:

1. `prepublish` → `build:vendor` copies the browser runtimes into `src/renderer/vendor/runtime/`.
2. `build-icons`, then `write-release-notes.js` writes `build/release-notes.md` from the changelog entry.
3. `check-dist-free.js`, `rimraf dist`, then `electron-builder --publish never` builds `dist\` (VMP-signed by `afterSign`).
4. `verify-packaged-boot.js` checks `dist\` holds this version's `Vex-Setup.exe`, its block map and `latest.yml`, and starts the packaged `Vex.exe` through the smoke test. A build that does not start is never uploaded.
5. `ensure-release.js` creates the **published** GitHub release `vX.Y.Z` (tag + notes) if it does not exist yet.
6. `upload-release.js` uploads `Vex-Setup.exe`, `Vex-Setup.exe.blockmap`, and `latest.yml` **last** — `latest.yml` is what tells installed copies there is an update.
7. `postpublish` → `post-publish.js` checks the release is complete (not a draft, all three assets present and non-empty), and only then moves the website's `Latest: vX.Y.Z` badge, commits and pushes `vex-website`.

If any step fails, the later ones do not run. Fix the cause and run `npm run publish` again; `ensure-release.js` and the uploader are safe to repeat.

## 4. After publishing

- Check the website's GitHub Pages deploy finished: `gh run list -R 0xmortuex/vex-website --limit 1`. A failed or stuck run leaves the live site on the old version; re-run it with `gh run rerun <id> -R 0xmortuex/vex-website`.
- Installed copies see the update the next time they check (Settings → About → Check for updates, or at startup). They download only the changed blocks when they can (`src/main/differential.js`).

## Installing from a release

Download `Vex-Setup.exe` from GitHub Releases (always the latest: `https://github.com/0xmortuex/Vex/releases/latest/download/Vex-Setup.exe`) and run it. Vex updates itself from then on.
