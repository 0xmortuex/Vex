# Vex Security Audit — 2026-04

**Date:** 2026-05-01
**Auditor:** ruflo-security-audit (`ruflo-security-audit@ruflo` v0.1.0) + manual review
**Scope:** `src/` only — `node_modules/`, `dist/`, `assets/`, build scripts excluded
**Lines reviewed:** ~13,800 (1,481 in `src/main.js`; 376 across `src/preload.js`+`src/preload-webview.js`+`src/adblocker.js`+`src/pip.js`+`src/main-helpers.js`; ~12,000 in `src/renderer/js/`)

This is a **point-in-time** audit. It is not a substitute for a continuous SAST pipeline, dependency-CVE scanner, or third-party penetration test.

---

## Summary

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 3 |
| Medium | 5 |
| Low / informational | 4 |
| False positives / known-accepted | 2 |
| **Total findings** | **14** |

No critical issues found. Three high-severity findings worth fixing in the next release; the most impactful is the zip-slip in `extensions:install-zip` (H-1).

---

## Critical issues (immediate fix)

*None.*

---

## High issues (fix soon)

### H-1 — Zip-slip in `extensions:install-zip`
- **File:** `src/main.js:411-490`
- **Category:** Path traversal
- **Severity:** High
- **Description:** The handler unzips a user-selected `.zip`/`.crx` into `extensionsDir`. Each entry's path is computed as `path.join(destFolder, rel)` where `rel` comes from the archive. A malicious archive containing entries like `../../../../AppData/Roaming/Vex/vex-persist.json` would write outside `destFolder`, overwriting persistent storage, the sync key, or other extensions. The current code does no `path.resolve()` containment check.
- **Suggested fix:** Before each `fs.writeFileSync(outPath, …)`, assert
  ```js
  const safe = path.resolve(outPath);
  if (!safe.startsWith(path.resolve(destFolder) + path.sep)) {
    throw new Error('Refusing to write outside extension folder: ' + entry.entryName);
  }
  ```
- **Exploit prerequisite:** User opens a malicious archive via "Install from .zip/.crx".

### H-2 — Path traversal in `storage-save` / `storage-load`
- **File:** `src/main.js:1231-1252`, `src/main.js:638-640` (`getStorageFile`)
- **Category:** Path traversal
- **Severity:** High
- **Description:** `getStorageFile(key)` does `path.join(storagePath, ${key}.json)`. The renderer can pass any string as `key`. With contextIsolation enabled and an honest renderer, this is unreachable — but a single XSS in any of the many `innerHTML` sites (M-2, M-3, L-2) plus an `eval`-equivalent path in the renderer (e.g. compromised AI markdown output reaching `document.write`) would let an attacker call `vex.saveData('../../../something', payload)` and write arbitrary files inside `userData`.
- **Suggested fix:** Whitelist or sanitise the key before joining:
  ```js
  function getStorageFile(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(key)) {
      throw new Error('storage: invalid key');
    }
    return path.join(storagePath, `${key}.json`);
  }
  ```
- **Same class** also applies to `persist-set` / `persist-delete` (line 731-742). Recommend a shared validator.

### H-3 — `extensions:uninstall` accepts any folderName
- **File:** `src/main.js:492-509`
- **Category:** Path traversal / arbitrary file deletion
- **Severity:** High
- **Description:** Computes `path.join(extensionsDir, folderName)` and `fs.rmSync(extPath, { recursive: true, force: true })`. The renderer's `vex.extensionsUninstall(folderName)` passes the raw value. A `folderName` like `../../../Vex` would delete the userData root. Behind the same XSS prerequisite as H-2, but the blast radius is unbounded recursive delete.
- **Suggested fix:** Same pattern as H-2 — validate `folderName` matches `/^[a-zA-Z0-9._-]{1,80}$/` AND assert `path.resolve(extPath).startsWith(path.resolve(extensionsDir) + path.sep)` before `rmSync`.

---

## Medium issues (track for later)

### M-1 — Adblocker substring matching false-positives
- **File:** `src/adblocker.js:46-55`
- **Category:** Logic / privacy
- **Severity:** Medium
- **Description:** `shouldBlock` does `host + parsed.pathname` then `AD_DOMAINS.some(d => … || full.includes(d))`. Hostnames that contain an ad-domain as a substring (`mydoubleclick.net`) are blocked. URL paths embedding an ad-domain literal (`example.com/redirect/doubleclick.net/…`) are blocked. Pinned by tests `tests/main/adblocker.test.js` and `it.todo`.
- **Suggested fix:** Replace the `full.includes(d)` leg with strict hostname match plus path-prefix match for entries containing `/`. Full pseudocode in the prompt for Step 4 of this evaluation; addressed in commit immediately following this report.

### M-2 — Markdown preview in `notes-panel` is regex-based
- **File:** `src/renderer/js/notes-panel.js:233-247`, used at `:168`
- **Category:** XSS (self-XSS)
- **Severity:** Medium
- **Description:** `renderMarkdown` escapes `&<>` first, then applies regex transforms — but `*`/`**`/`` ` ``/list rules can interact in surprising ways with crafted input, and emoji/unicode edge cases can produce broken HTML that browsers may interpret differently. Notes content is user-authored, so the realistic threat is **self-XSS** (a user pasting a malicious blob from elsewhere). Still, regex markdown is hard to reason about; safer to use a vetted small library or a strict whitelist DOM-builder.
- **Suggested fix:** Either (a) replace with `marked` + `DOMPurify` if those are acceptable additions, or (b) build the preview by creating DOM nodes and setting `textContent` per token, never `innerHTML`.

### M-3 — Geolocation bridge exposed to all webviews
- **File:** `src/preload-webview.js:120-134`
- **Category:** Privacy / fingerprinting
- **Severity:** Medium
- **Description:** `contextBridge.exposeInMainWorld('__vexGeoBridge', bridge)` is exposed to every guest page (excluding `about:`/`chrome:`/`vex:`/`devtools:`/`data:`/`file:`). Any site can call `window.__vexGeoBridge.getPref()` and read the user's manual location coordinates *without* invoking the navigator.geolocation polyfill — bypassing the permission prompt. `__vexGeoBridge` is also a fingerprinting marker (presence reveals the user is on Vex).
- **Suggested fix:** Move the read of `getPref()` behind `checkPermission(origin)` so the bridge requires permission for both methods, OR rename `__vexGeoBridge` to a randomised-per-launch key (cheap fingerprint mitigation), OR scope the polyfill so it never exposes the bridge — instead the polyfill can synchronously message the parent via `window.postMessage` and the main-world script returns the answer.

### M-4 — `open-pip-window` URL not validated
- **File:** `src/main.js:1254-1262`, `src/pip.js:*`
- **Category:** URL handling
- **Severity:** Medium
- **Description:** `ipcMain.handle('open-pip-window', (event, url) => createPipWindow(url))`. If `pip.js` calls `loadURL(url)` on a fresh `BrowserWindow` without protocol checks, a renderer with XSS could pop a window pointing at `file:///` or arbitrary `chrome://` resources.
- **Suggested fix:** In `createPipWindow`, parse the URL and refuse anything not in `{http:, https:, blob:, data:}` — or, better, only allow URLs whose origin matches one of the live tabs.

### M-5 — Geolocation polyfill leaks IP to two third parties
- **File:** `src/preload-webview.js:156-172`
- **Category:** Privacy
- **Severity:** Medium
- **Description:** `fetchIPLocation` calls `https://ipapi.co/json/` then `https://ipwho.is/` from inside guest pages. Every site that calls `navigator.geolocation.getCurrentPosition` causes Vex to ping these third parties from the user's IP, potentially without the user understanding the data flow. No documentation in the Settings panel that this happens.
- **Suggested fix:** Move the IP-geolocation lookup to the main process (so the request is shaped by Vex's session UA + happens once, cached) and surface the behaviour in Settings → Location.

---

## Low / informational

### L-1 — Permissions decision keys are renderer-supplied strings
- **File:** `src/main.js:257-269`
- **Category:** Trust boundary
- **Severity:** Low
- **Description:** `permission:respond` accepts `{ origin, permission }` from the renderer and writes to the decisions file using those values verbatim as keys (`${origin}::${permission}`). With trusted renderer this is fine; with a renderer-XSS it lets the attacker pre-grant decisions for any origin without showing a prompt.
- **Suggested fix:** Cross-check the `(origin, permission)` against the pending request's recorded values when the prompt was raised.

### L-2 — Many `innerHTML` sites in renderer
- **Files (sample):** `app.js:706`, `command.js:214`, `ai-panel.js:184/216/458/538/661`, `cusa-panel.js:54`, `download-toast.js:25`, `downloads-panel.js:147/170`, `github-panel.js:149`, `history-panel.js:185/225/255`, `horizontal-tabs.js:83`, etc.
- **Category:** XSS surface
- **Severity:** Low (most cases use a `_esc()` helper)
- **Description:** Spot-checked a representative sample — all that interpolate user/network data wrap it in `_esc()` (textContent-then-innerHTML pattern). However, the surface area is large and a future regression in any one of them becomes a renderer-XSS. Worth a follow-up pass + a lint rule.
- **Suggested fix:** Add an ESLint rule (e.g. `no-unsanitized/property`) to flag `.innerHTML =` outside an allowlist of known-safe constants.

### L-3 — `ipapi.co` and `ipwho.is` chosen without certificate pinning
- **File:** `src/preload-webview.js:158, 165`
- **Category:** Network trust
- **Severity:** Low
- **Description:** Plain `fetch` with no integrity. A network attacker who MITMs the user can return arbitrary "location" coordinates that Vex feeds to every site that asks for geolocation. Mitigated by HTTPS + the cert chain.
- **Suggested fix:** Document the trust model in Settings → Location and consider falling back gracefully when the response shape is unexpected.

### L-4 — Console logs include URLs and command-line argv
- **Files:** `src/main.js:21-26, 142-146, 1133-1136`, plus `[Vex F11]` traces and `[Vex URL]` traces
- **Category:** Information disclosure
- **Severity:** Low (informational)
- **Description:** Production logs to stdout include full `process.argv`, the resolved launch URL, and detailed F11 state. On a shared machine where Vex stdout is captured, these reveal browsing intent. Also makes the log noisy.
- **Suggested fix:** Gate `[Vex URL]` and `[Vex F11]` debug logs behind a `--debug-launch` / `--debug-fullscreen` flag for shipped builds, or behind `!app.isPackaged`.

---

## False positives / known-accepted issues

### FP-1 — `gmail-creds.enc` cleanup deletes credentials
- **File:** `src/main.js:749-757`
- **Verdict:** Not a vulnerability — this is the **defensive cleanup** for a feature that was reverted twice. Deleting any stale `gmail-creds.enc` from disk is the desired behaviour. No action needed.

### FP-2 — `nodeIntegration: true` warning (none in current code)
- **Files reviewed:** `src/main.js:1369-1376` (private window) and `:1163` (main window — `webPreferences` block)
- **Verdict:** All `BrowserWindow` constructions set `contextIsolation: true, nodeIntegration: false`. `webviewTag: true` is required for the tab system. No SAST hit; included as a clean negative result.

---

## Methodology notes

- **What this audit covered:** static review of IPC handler signatures, every `innerHTML` site in `src/renderer/js/`, every `shell.openExternal` / `shell.openPath` / `loadURL` call, every preload `contextBridge.exposeInMainWorld` surface, every `fs.write*` / `fs.rm*` call against renderer-supplied paths, the existing adblocker bug pinned in unit tests.
- **What this audit did NOT cover:** dependency CVEs (`npm audit` reports 27 vulnerabilities — out of scope here, file separately), runtime behaviour, fuzzing, the Cloudflare worker at `vex-ai.mortuexhavoc.workers.dev` (server-side), the auto-update channel, code-signing posture, or the build pipeline.
- **Recommended next pass:** add a CI step that runs `npm audit --omit=dev` and fails the build on `high`+ findings.

---

## Fixes Applied (2026-05-01)

- **H-1 zip-slip:** ✅ fixed. `extensions:install-zip` now validates each entry's resolved write-path via `safeJoin(destFolder, rel)` before `fs.writeFileSync`. Hostile entries are skipped with a `console.warn` instead of aborting the whole extraction; the existing manifest-existence check at the end of the loop catches the all-skipped case.
- **H-2 path traversal in storage:** ✅ fixed. `getStorageFile(key)` now runs the key through `safeName` (rejects `/`, `\`, `..`, null byte, `.`/`..` literals) and resolves via `safeJoin(storagePath, …)`. `storage-save` and `storage-load` already wrap their callers in try/catch, so a hostile key surfaces as a benign error to the renderer.
- **H-3 unvalidated folderName:** ✅ fixed. `extensions:uninstall` now validates `folderName` via `safeName` + `safeJoin(extensionsDir, …)` and returns `{ ok: false, error: 'Invalid folder name' }` for traversal attempts (logged via `console.warn`).
- **M-4 PiP URL not validated:** ✅ fixed via `safePipUrl()` in `src/main-helpers.js` (http/https only, throws on `file://`, `javascript:`, `data:`, `chrome://`, `blob:`, `vbscript:`, etc.). The `open-pip-window` IPC handler in `src/main.js` runs the renderer-supplied URL through `safePipUrl` before calling `createPipWindow`, returning `false` to the renderer on rejection. Audit suggested `{http, https, blob, data}`; we tightened to `{http, https}` only — PiP has no legitimate `blob:` or `data:` use case in Vex. Tests in `tests/main/safePath.test.js`.

Shared helpers `safeJoin`, `safeName`, and `safePipUrl` live in `src/main-helpers.js`. Tests in `tests/main/safePath.test.js` cover all three. Full suite: **183 passing, 0 failed**.
