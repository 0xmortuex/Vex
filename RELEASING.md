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
   Then `verify-signing.js --release` checks the Authenticode signatures when code signing is configured ([Turn on code signing](#turn-on-code-signing)). An unsigned build prints `unsigned build` and passes.
5. `ensure-release.js` creates the **published** GitHub release `vX.Y.Z` (tag + notes) if it does not exist yet.
6. `upload-release.js` uploads `Vex-Setup.exe`, `Vex-Setup.exe.blockmap`, and `latest.yml` **last** — `latest.yml` is what tells installed copies there is an update.
7. `postpublish` → `post-publish.js` checks the release is complete (not a draft, all three assets present and non-empty), and only then moves the website's `Latest: vX.Y.Z` badge, commits and pushes `vex-website`.

If any step fails, the later ones do not run. Fix the cause and run `npm run publish` again; `ensure-release.js` and the uploader are safe to repeat.

## 4. After publishing

- Check the website's GitHub Pages deploy finished: `gh run list -R 0xmortuex/vex-website --limit 1`. A failed or stuck run leaves the live site on the old version; re-run it with `gh run rerun <id> -R 0xmortuex/vex-website`.
- Installed copies see the update the next time they check (Settings → About → Check for updates, or at startup). They download only the changed blocks when they can (`src/main/differential.js`).

## Turn on code signing

Vex is released **unsigned** until there is a certificate. Everything else is ready: signing turns on by setting environment variables before `npm run publish` (or `node scripts/release.js`). Nothing in `package.json` changes. With none of them set, the build is exactly what it was and prints one line: `[Sign] unsigned build`.

### What happens when it is on

1. electron-builder Authenticode-signs every `.exe` in `win-unpacked` (`Vex.exe` first) with SHA-256 and an RFC 3161 timestamp. `forceCodeSigning` is on, so a file that cannot be signed stops the build.
2. `afterSign` → `scripts/vmp-sign.js` checks that `Vex.exe` is already signed (else it stops before castLabs is called), then gets the Widevine (VMP) signature, runs `verify-pkg`, and checks that `Vex.exe` is byte for byte the same as before VMP signing.
3. The NSIS target signs the uninstaller, packs it into the installer, then signs `Vex-Setup.exe`. `latest.yml` and the block map are written from the signed installer.
4. `scripts/verify-signing.js --release` (in `npm run publish`, after the boot check and before `ensure-release`) reads the signatures of every `.exe` in `win-unpacked`, `Vex-Setup.exe`, and `Uninstall Vex.exe` taken out of the installer. Each one must be **Valid**, **timestamped** and signed by **one** name (`VEX_WIN_PUBLISHER` when set). Otherwise nothing is uploaded.

**The order with Widevine matters.** castLabs' VMP signature of `Vex.exe` is a SHA-512 of the *whole* file (`hash_pe0` in castLabs' `vmp-resign.py`). Authenticode writes into `Vex.exe`, so it must come first and VMP last. Signing `Vex.exe` again after `afterSign`, by hand or with another tool, breaks Netflix, Spotify and Prime. Re-run the build instead.

### Pick one method (set exactly one; two at once is an error)

| Method | Set these | Notes |
|---|---|---|
| **Azure Trusted Signing** (recommended if you qualify) | `VEX_AZURE_SIGN_ENDPOINT` (e.g. `https://weu.codesigning.azure.net`), `VEX_AZURE_SIGN_ACCOUNT`, `VEX_AZURE_SIGN_PROFILE`, `VEX_WIN_PUBLISHER` (the name on the certificate profile), and the app registration's `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | No hardware and no `.pfx`. electron-builder installs Microsoft's `TrustedSigning` PowerShell module on first use. The app registration needs the "Trusted Signing Certificate Profile Signer" role on the account. |
| **Certificate in the Windows store** (USB token, or a cloud card such as Certum SimplySign) | `VEX_WIN_CERT_SHA1` = the certificate's thumbprint; optionally `VEX_WIN_PUBLISHER` | Since June 2023 public CAs only issue code-signing keys on hardware or a cloud HSM, so a newly bought OV/EV certificate normally arrives this way. The token/card must be connected and unlocked while the build runs (it may ask for its PIN once per file). |
| **.pfx file** | `CSC_LINK` (or `WIN_CSC_LINK`) = path, `https://` URL or base64 of the `.pfx`; `CSC_KEY_PASSWORD` (or `WIN_CSC_KEY_PASSWORD`); optionally `VEX_WIN_PUBLISHER` | electron-builder's own variables. Only for a certificate that can be exported with its key. |

Example (PowerShell, store certificate):
```
$env:VEX_WIN_CERT_SHA1 = "<40 hex characters>"
$env:VEX_WIN_PUBLISHER = "<common name on the certificate>"
npm run publish
```
Look for `[Sign] code signing ON: …`, `[Sign] Vex.exe is Authenticode-signed; VMP signing comes after it`, the VMP lines, and finally `[Sign] all N files are signed by "<name>" and timestamped`. Clear the variables afterwards.

The timestamp server is electron-builder's default (`http://timestamp.digicert.com`; Azure: Microsoft's). `ELECTRON_BUILDER_OFFLINE=true` skips timestamping. The check then allows a missing timestamp; never release such a build.

### Which certificate (prices change: check before buying)

- **Azure Trusted Signing**: a monthly subscription (the Basic tier has been around US$10/month). Microsoft verifies your identity, and eligibility has been limited by country and by organisation or individual. Check that you qualify first. Works directly with electron-builder.
- **Certum "Open Source Code Signing"**: a low-cost yearly certificate for open-source developers (Vex is MIT). It comes on a smart card or as SimplySign (cloud). Use the store method above. The signer name reads "Open Source Developer, <your name>".
- **SignPath Foundation**: free signing for qualifying open-source projects. Signing happens in SignPath's service from a CI build, and the publisher shown is "SignPath Foundation". Vex's build signs locally and must VMP-sign between Authenticode and packaging, so this one needs a different pipeline. Not supported as is.
- Any certificate builds SmartScreen reputation over downloads. A new certificate can still show "Windows protected your PC" for a while.

### Updates across the switch

Vex's updater (`src/main/updates.js`) checks the installer's size and SHA-512 against `latest.yml`. It does not use electron-updater and does not check Authenticode. So installed unsigned copies update to the first signed release like any other release (`latest.yml` hashes the signed installer). Nothing locks them out. `publisherName` only goes into `resources/app-update.yml`, which nothing reads.

### Testing with a throwaway certificate

Never import a test certificate into the Windows certificate stores. Make a self-signed one with Git's `openssl` in a temp folder, then build into a scratch folder. Never use `dist\`.
```
openssl req -x509 -newkey rsa:2048 -sha256 -days 2 -nodes -keyout key.pem -out cert.pem -subj "/CN=Vex Test Signer" -addext "extendedKeyUsage=codeSigning"
openssl pkcs12 -export -out test.pfx -inkey key.pem -in cert.pem -passout pass:test -certpbe AES-256-CBC -keypbe AES-256-CBC -macalg sha256
$env:CSC_LINK = "<temp>\test.pfx"; $env:CSC_KEY_PASSWORD = "test"; $env:VEX_WIN_PUBLISHER = "Vex Test Signer"; $env:VEX_SIGN_ALLOW_UNTRUSTED = "1"
npx electron-builder --win --config.directories.output=dist-signtest
node scripts/verify-signing.js --dir dist-signtest
```
Windows does not trust a self-signed certificate, so the status reads `UnknownError`. `VEX_SIGN_ALLOW_UNTRUSTED=1` accepts that for a test, and `--release` refuses it. Delete the scratch folder and the `.pfx` afterwards.

## Installing from a release

Download `Vex-Setup.exe` from GitHub Releases (always the latest: `https://github.com/0xmortuex/Vex/releases/latest/download/Vex-Setup.exe`) and run it. Vex updates itself from then on.
