# Implementation of the September audit recommendations

User request: implement all 60 recommendations in `codebase-audit-2026-09-06.md`.

Work is tracked by recommendation number. A code change alone is not proof that a feature or an external integration works. Packaging, live services, DRM, OS accessibility and proxy connectivity require the corresponding integration checks.

| Recommendations | Workstream | Status |
|---|---|---|
| 1–4 | Private windows, shared tab policy, routing, private content | In progress |
| 5–11 | Worker authentication, IPC, host navigation, safe rendering/imports/CSP | In progress |
| 12–15 | Verified bounded archives, dependencies, encrypted local secrets | Implemented; final packaged integration pending |
| 16 | Scheduled agent context and deterministic tool policy | Readiness, deadlines and logical cancellation implemented; upstream AI cancellation remains partial |
| 17–20 | Versioned authoritative sync, conflicts, key enrollment, encrypted handoffs | In progress; recovery guards and list-panel refresh tested |
| 21–26 | Main-process storage, durability, migrations, clearing data | In progress |
| 27–30 | Authenticated/bounded networking, strict counters, navigation revalidation | In progress; not all renderer requests covered |
| 31–34 | Autofill selection, tests, passkeys, compatibility exceptions | In progress; hidden/iframe/SPA/TOTP matrix pending |
| 35–42 | Proxy framing, lifecycle, events, bulk writes, virtualization, memory | In progress; CONNECT tests pass, lifecycle conversion incomplete |
| 43–46 | Modular services, typed contracts, linting | In progress |
| 47–53 | CI, integration/package checks, release metadata, dependencies/icons | In progress; unpacked build succeeded, final artifact matrix pending |
| 54–59 | Local fonts, accessibility, localization, status, diagnostics | In progress; fonts local, Turkish catalog and accessibility coverage partial |
| 60 | Correct architecture/privacy/release documentation | In progress; self-hosting and worker configuration comments updated |

## Continuation: sync integrity

The following additional defects were fixed after the initial audit:

- Pull acknowledged the server revision before decrypting and applying the document. Revision acknowledgement now happens only after successful application.
- A restored wrong key could upload over data at the known revision. Restored accounts now require a successful pull before uploading; failed decryption/application keeps uploads blocked.
- Pull skipped documents attributed to the same device without verifying decryption. That shortcut was removed.
- Sync records accepted prototype-related keys and malformed revision/conflict structures. Validation now rejects these inputs.
- Different payloads with equal version vectors could silently discard edits depending on merge order. Both variants are now retained with a deterministic winner.
- Concurrent array inserts with the same position could appear in different orders on different devices. Record keys now break position ties deterministically.
- Open bookmark, history and saved-session panels retained old in-memory arrays after a pull. They now refresh on the sync application event. Bookmarks have a regression test verifying that a subsequent save preserves the received data.
- Synced bookmark/history/session values are checked as arrays before preference writes.

These changes do not complete recommendation 17: live tab/workspace reconciliation and other cached settings still need review. The schema checks are not yet a complete per-feature import contract. Worker deployment and real multi-device recovery remain unverified.

## Verification and remaining scope

- Latest full suite: 66 test files passed, 891 tests passed, one existing TODO. Subsequent email-sender configuration change: 12 relevant worker tests passed.
- Source audit: 235 first-party files, 187 JavaScript files, 185 references checked with no failures before the last test addition.
- Lint and typed contracts pass. Their scope is the configured main services and selected contracts, not every renderer module.
- Development Electron boot smoke passes after service extraction.
- Earlier unsigned unpacked Windows packaging succeeded. That artifact predates the latest changes and must be rebuilt before release verification.
- The list benchmark measures jsdom DOM construction, not Chromium frame rate: 10,000 rows versus 16 mounted rows. It does not establish accessibility or scrolling performance.
- Outstanding cross-cutting work includes complete IPC/import schemas, all tab snapshot consumers, all request cancellation, shutdown/multi-window persistence races, comprehensive lifecycle cleanup, complete Turkish text, accessibility and packaged integration matrices, and updated architecture/self-hosting/release documentation.

No release or worker deployment has been performed. All 60 recommendations are not yet complete.

## Continuation: September 7

Additional fixes and implementation work:

- All public desktop preload operations now have IPC arity and bounded argument schemas. Shared record contracts validate tabs, groups, stacks, history, bookmarks and imported/synced data. Screen/HID chooser responses are bound to the owning window and requesting frame.
- Stable UUID tab IDs survive restarts. Sync reconciles live tabs and workspace state, retaining private tabs; first enrollment reports a failed initial push instead of claiming success.
- Main-process preference updates are queued and atomic. Unsupported future structured-store versions are rejected without restoring an older backup. Secret deletion waits for pending writes. Failed renderer saves remain retryable and late failures cannot overwrite newer success status.
- Preference hydration removes stale local copies of deleted keys, including after all user preferences were deleted. Writes arriving during hydration take precedence over the disk snapshot.
- Shared network transport bounds request/response sizes and deadlines, including streaming progress. Extension/bypass downloads, release notes and Tor verification now use bounded transport. Some guest/vendor/upstream requests remain outside this helper.
- DOM extraction omits sensitive input values and rejects stale navigation results. Agent cancellation cannot become a successful completion after a late model response. Scheduler readiness, timeout, disposal and cancellation are wired. History indexing checks navigation generations and uses the actual tab manager when reindexing open tabs.
- TOTP uses explicit issuer/domain matching instead of substring matches. Password/TOTP/email-code filling checks target URLs, private-session policy, visible fields and same-origin form actions. Email provider matching rejects lookalike hostnames; delayed email submission revalidates navigation. Clipboard expiry preserves text copied after the password.
- Saved Tor sessions are blocked before any restored page loads; they no longer silently start on a direct connection. Saved custom proxies are awaited before window creation. Tor startup cannot overwrite a subsequent routing choice. Routing preferences use queued atomic writes and report write failures.
- Session destruction removes ownership records and clears unused ephemeral sessions. Virtual lists dispose when removed from the DOM. Snapshot/archive startup timers have disposal hooks.
- Dialog keyboard focus, Turkish navigation/subtitles and save-error status were improved. Real Electron smoke covers Classic/Glass at 100%, 125%, 150% and 200% browser zoom plus PDF generation.
- CI now runs security/UI smoke and an unsigned unpacked package smoke; weekly dependency checks include development dependencies. README corrects network and credential-memory claims. Architecture documents current runtime, process boundaries, services and sync.

Verification so far: 72 files / 917 tests passed, one existing TODO, before the latest preference, clipboard and routing changes. Those changes have passing targeted tests; lint and the combined development Electron smoke pass. The fresh `scratchpad/package-final/win-unpacked/Vex.exe` passed security/UI/PDF smoke, but predates the last networking, preference and routing edits and must be rebuilt again. This unsigned no-DRM artifact is not a release build. Browser zoom is not Windows display scaling; real service recovery, signed DRM playback, OS accessibility and live proxy connectivity remain unverified.

Remaining work includes multi-window stale-array/clear races, complete request abort propagation and lifecycle coverage, full Turkish body text, other cached settings after sync, broader typed/lint coverage, restart and multi-device scenarios, final packaging, and remaining documentation inaccuracies. These are not all completed by the passing smoke tests.

### Subsequent verification and fixes

- Full suite advanced to 73 files and 922 passing tests with one TODO before the latest archive and upstream-response regressions.
- Added `npm run smoke:restart`: two real Electron processes share a throwaway profile. It verifies stable tab IDs, pinned metadata, persisted preferences and removal of a stale Chromium copy of a deleted preference. Both development and `scratchpad/package-verified/win-unpacked/Vex.exe` passed this test; the same package passed the security/UI/PDF matrix. That artifact predates the subsequent archive and Recall/privacy write changes.
- AI Durable Object locking now covers quota admission only, preserving atomic counters without holding the lock during model generation. Slow-response concurrency coverage passes. Model JSON responses are limited to 1 MiB, with gateway errors for malformed/oversized responses; all worker tests pass.
- Tar preflight now aborts immediately on invalid entries, enforces decompression ratios and a deadline, and rejects existing extraction-path junctions/symlinks. Real archive extraction, size rejection and Windows junction regression tests pass.
- Recall indexing/clearing, privacy preferences and GUI style now await atomic storage acknowledgement. Recall deletion is ordered after older writes and removes its backup. Shutdown awaits these services and routing saves.
- Typed checking now includes routing restoration. Architecture runtime/build/icon/storage descriptions were corrected. Vitest configuration uses `.mjs` to match its ESM syntax.

- Latest complete suite: 74 files, 932 passing tests, one existing TODO. Subsequent lint/type scope changes have passing targeted checks.
- Recall now identifies privacy from the actual source webview rather than a URL match and rejects content returned after navigation. Private highlights remain on the page without being added to persisted annotations. Raw URL/callback-error logging was removed from the desktop preload.
- Document extraction preserves the source account/container partition, bounds hidden document text and export responses, and rejects stale extraction/OCR results. Account-partition and stale-document tests pass.
- Worker counters reject malformed/negative/unsafe numeric values instead of resetting them to zero. This retains fail-closed quota/auth behavior when stored counters are corrupt.
- Type checking covers the real sync-record implementation in an incremental non-strict project, alongside strict main contracts/routing. Shared renderer transport, data contracts, sync records and lifecycle helpers now receive undefined-global, promise and unsafe-HTML lint checks. Legacy UI modules remain outside that lint scope.

## Continuation: tab snapshots and deployment instructions

- Saved sessions, workspaces and time-travel snapshots now use the shared tab serializer. This preserves the common metadata and excludes private-window tabs even if their partition field is absent.
- Restoring sessions now preserves pinned status and keep-awake expiry, and persists the final restored state.
- Session/workspace restoration keeps the original selected record when unsafe or ephemeral legacy entries are skipped. Snapshots also reject these records on restore.
- Workspace restore preserves saved favicon and keep-awake metadata. Complete stack/group reconciliation across merge restores remains outstanding.
- Added regression coverage for common snapshot metadata, private windows without per-tab partition metadata, unsafe legacy URLs and selected-tab preservation.
- Updated SELF_HOSTING.md and Wrangler comments for required Durable Objects, client tokens, fail-closed quotas, production email delivery, legacy migration and recovery behavior. Added configurable RESEND_FROM so deployments can use an authorized sender.
- Full test suite, source checks and development boot smoke passed for the tab changes. No live email delivery or worker deployment was performed.

## Continuation: accessibility verification (recommendation 56)

- The UI smoke now covers Windows High Contrast (`forced-colors: active`) and reduced motion for both Classic and Glass, driven through CDP media emulation.
- Each emulation asserts `matchMedia(...).matches` before asserting on any CSS effect. Without that guard a silently-ignored emulation would have made every downstream assertion vacuously true.
- Keyboard-only navigation now uses real `Input.dispatchKeyEvent` Tab presses instead of synthetic `KeyboardEvent`s. Synthetic events run page handlers but never move focus, so the previous tab-order assertion could not have detected broken sequential navigation; it only exercised the dialog's own trap handler.
- Both new assertions were verified against negative controls. With the reduced-motion blocks disabled the smoke fails with the real measured durations (`transition 0.9s, animation 0.9s` against a 0.05s bound) and with the forced-colors block disabled it fails on a `0px` control border — in both cases with `matched: true`, proving the emulation reached the page and the failure is the app's, not the harness's. The stylesheets were restored byte-identical afterwards.
- Result: `8 style/zoom keyboard-dialog cases; a11y: classic (reduced-motion, forced-colors, 6 tab stops); glass (...); PDF print passed`.
- Still unverified: real Windows display scaling (browser zoom is not the same thing) and actual OS high-contrast themes, which need a configured Windows session rather than media emulation.

## Continuation: cross-window collection writes (recommendation 21)

- History's cross-window race was already closed by the main-process `dataStore.update('history', …)` append. The remaining exposure was in the renderer collections that hold their whole list in memory.
- `Bookmarks` and `ReadLater` loaded their list once at init and wrote that snapshot back on every change. With two windows open (same session, so shared localStorage) the last window to save erased every record the other had added since it loaded, and the storage shim mirrored the loss to disk so it survived a restart.
- Added `src/renderer/js/collection-store.js`: a window writes only the delta it actually made — the ids it removed and the records it added or edited — onto whatever is persisted at write time. Per-record last-writer-wins; whole-array clobbering is gone. Records without an id are compared by value so repeated saves cannot duplicate them.
- A module that was never initialised has an empty baseline, so it can add records but never delete them. That is the safe direction for an uninitialised consumer.
- Regression coverage in `tests/renderer/collectionStore.test.js`: another window's addition survives, this window's deletion still applies without resurrecting the record, an edit to a shared record propagates, and repeated saves do not duplicate.
- Verified against a negative control. With the old snapshot write restored the suite fails with `expected [ 'a', 'c' ] to deeply equal [ 'a', 'b', 'c' ]` — the other window's bookmark erased — and `expected [ 'keep' ] to deeply equal [ 'b', 'keep' ]`.
- Still outstanding for this recommendation: `Annotations` keeps a URL-keyed object with the same snapshot-write pattern and needs map-shaped merge semantics; `TabArchiver._save` re-reads before writing, so its window is narrow but not zero. Neither is fixed yet.

### Verification for this batch

- Full suite: 75 files, 939 passing, one existing TODO (was 74/934).
- `check:source`: 244 files, 196 JS, 188 references, 0 failures.
- Combined real-Electron smoke: `private-session/storage/ownership passed; 8 style/zoom keyboard-dialog cases; a11y: classic (reduced-motion, forced-colors, 6 tab stops); glass (…); PDF print passed`.
- Lint and both type projects pass.

### Cross-window collections completed

- `Annotations` now merges per page key (`saveMap`/`mergeMap`): another window's highlights on the same page survive our write, deleting our last highlight on a page removes only our record, and a page with nothing left is dropped. Negative control with the old snapshot write fails with `expected [ 'h1', 'h3' ] to deeply equal [ 'h1', 'h2', 'h3' ]`.
- `TabArchiver` sweep and remove are delta-merged against a baseline captured before the in-place unshifts, and the 200-entry cap is applied after merging.
- Added a guard test asserting `index.html` loads `collection-store.js` before `bookmarks.js`, `readlater.js` and `annotations.js`. A consumer loaded first would call `.save` on `undefined` and every write would throw, silently losing the change. Verified by moving the tag after its consumers: `bookmarks.js must load after collection-store.js: expected 96 to be greater than 105`.
- Recommendation 21 is complete for the renderer collections; history was already atomic in main.

### Dependency advisories (recommendations 14, 52, 53) — closed

- `npm audit` now reports `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`. The audit's 3 critical / 21 high / 13 moderate / 1 low across 38 packages is resolved by the committed Electron 42 / electron-builder 26 / tar 7 / adm-zip 0.6 / electron-updater / sharp upgrade.
- The obsolete `electron-icon-builder` chain is gone, replaced by `scripts/build-icons.js` (recommendation 53).
- CI already enforces this: `npm ci` for reproducible installs, `npm audit --omit=dev --audit-level=high` on every run and a full `npm audit` on the weekly schedule (recommendation 52).
- CI also runs check:source, check:types, lint, the suite, boot smoke, restart smoke, the security/UI/a11y smoke, icon generation, an unsigned unpacked package and the same security/UI/a11y smoke against that packaged `Vex.exe` (recommendation 47). The new high-contrast/reduced-motion/keyboard coverage runs in both smoke passes.

## Continuation: localization, lifecycle, documentation, sync caches

### Recommendation 57 — translation parity guard
- Added `tests/renderer/i18n.test.js`: every key in the English catalog must exist in Turkish, no Turkish value may be blank, and no two-word-or-longer English phrase may be copied across untranslated. Also covers locale reading whether or not the storage shim JSON-quoted the value, the en → caller-fallback → key fallback chain, and defaulting to English for an unknown language.
- Verified by removing one Turkish key: `untranslated keys: finish: expected [ 'finish' ] to deeply equal []`.
- The long-Turkish-label requirement in this recommendation is already covered by the UI smoke, which asserts a long Turkish dialog fits at four zoom levels in both GUI styles.
- Full translation of remaining body text is deliberately not attempted here: it needs a Turkish reviewer, not an automated sweep. The parity guard is what prevents silent regression in the meantime.

### Recommendation 37 — lifecycle guards
- Audited every renderer `setInterval` and observer. The per-panel timers (queue, memory, privacy, badges, archiver, automations, tracker receipts) are all singleton-guarded; the remaining undisposed observers are boot-time singletons on app chrome, not per-tab resources.
- What was missing was coverage of the guards themselves. `tests/renderer/lifecycleGuards.test.js` asserts repeated `start`/`init` calls do not stack intervals, and that `TabArchiver.dispose()` genuinely allows a restart.
- Verified by deleting one guard: `expected 3 to be 1`.

### Recommendations 51 and 60 — documentation drift
- `VEX_PROJECT_KNOWLEDGE.md` still described Electron 30, "one single main window", the removed `electron-icon-builder`, WebLLM loaded from a CDN, and VMP signing as `afterPack`. Corrected against the actual configuration. The afterPack claim mattered: that ordering is what shipped broken DRM in v2.29.4, because Authenticode rewrites `Vex.exe` after the hook runs.
- `check:source` now fails when any non-historical doc names an Electron major version that disagrees with `package.json`. CHANGELOG, release notes and the audit/progress records are exempt because they are history.
- Verified: `README.md: claims Electron 30 but the runtime is 42.5.2+wvcus`. `docsChecked` reports 7.
- Two bugs were found and fixed in that check while proving it: the version regex had been written with escapes the shell stripped, and `path.relative` returns backslashes on Windows so the history-doc exemption never matched. The broken regex was masking the second bug.

### Recommendation 46 — lint scope
- Extended to `scripts/verify-source.js`, `src/renderer/js/collection-store.js` and `src/renderer/js/i18n.js`. All pass.

### Recommendation 17 — stale caches after a sync pull
- `WorkspaceManager.reloadSyncedState` was already invoked directly by the sync engine; `Bookmarks`, `HistoryPanel` and `SessionManager` already listen for `vex-sync-data-applied`.
- `NotesPanel` did not. It caches `this.notes` at init and writes that whole array on every edit, so after a pull the first note edit erased every note the pull brought in. It now re-reads on the event, drops an active-note id that no longer exists, and ignores a malformed stored value instead of dropping notes.
- `vex.readLater` and `vex.annotations` are not in `SYNC_KEYS`, so they are unaffected by pulls.
- Verified by removing the listener: `expected [ { id: 'local', … } ] to deeply equal [ { id: 'remote', … } ]`.

### Verification for this batch
- Full suite: 78 files, 958 passing, one existing TODO (was 74/934 at the start of this session).
- `check:source` 0 failures, `check:types` both projects, lint clean at the widened scope.
- Real-Electron: security/UI/a11y smoke and the two-process restart smoke both pass.

### Recommendation 28 — remaining unbounded requests

- Audited every remaining request path. In the renderer only three raw `fetch` calls are left: a `data:` URL read in `screenshot.js` (no network), a comment in `sync-engine.js`, and the `vex-config.js` fallback used when the desktop bridge is absent. The two `net.request` connectivity probes in `main.js` already carry a 6 s deadline and `res.resume()`, so they neither hang nor buffer.
- The real gap was `src/preload-webview.js`: the geolocation IP fallback called `ipapi.co` and `ipwho.is` with no timeout and no size ceiling, for any page that requests a position. A slow endpoint hung the position callback indefinitely and an endless body grew guest memory.
- Both lookups now share a bounded helper: a 5 s `AbortController` deadline, rejection of an oversized declared `Content-Length`, and a streamed 64 KiB ceiling that cancels the reader — because `Content-Length` is advisory and a lying header would otherwise defeat the check.
- `tests/main/geoLookupBounds.test.js` extracts the helper from the polyfill template literal and exercises it behaviourally rather than asserting on source text (recommendation 50): small body parses, non-ok returns null, oversized declaration rejected, a lying header still cancels the reader, the deadline aborts instead of hanging, and every request carries a signal with `cache: 'no-store'`.
- Verified by deleting the streaming ceiling: `expected "vi.fn()" to be called at least once`.

### Keyboard traversal made deterministic

- The first version counted how many of six Tab presses landed on a control. That count is style-dependent — one run reported 6 stops for Classic and 3 for Glass against a threshold of 3, which would eventually have failed for no real reason.
- It now anchors on the first visible focusable control, presses Tab four times, and asserts the invariant that matters: focus is never stranded on `<body>`, never lands on an invisible control, and actually moves. Reports 52 focusable controls and 4 distinct stops for both styles, identical across three consecutive runs.

### Recommendation 8 — host navigation and guest attachment, now covered

- The hardening existed but had no direct test: host `will-navigate`/`will-redirect` are blocked, and `will-attach-webview` strips a renderer-requested preload, forces `nodeIntegration:false`, `nodeIntegrationInSubFrames:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, validates the partition name, and hands the guest the session object for the resolved partition.
- `tests/main/webviewAttachHardening.test.js` covers all of it, including that a private window pins its guests to the private partition no matter which partition the renderer asks for.
- Verified by removing two lines: `expected 'C:/evil.js' to be undefined` (preload honoured) and `expected 'persist:main' to be 'private:abc123'` — the second is a private-window guest silently falling back to the shared session, a real privacy leak.

## Session summary (Claude, 7 September)

Starting point: 74 files / 934 tests. Ending point: **80 files / 972 tests**, one existing TODO.

Completed this session:
- **56** accessibility: high contrast and reduced motion for both GUI styles under CDP media emulation, plus real (not synthetic) keyboard traversal. The previous keyboard assertion could not fail.
- **21** cross-window collection writes: `Bookmarks`, `ReadLater`, `Annotations`, `TabArchiver` now delta-merge instead of overwriting with a stale snapshot, with a script-order guard.
- **14, 52, 53** dependency advisories: `npm audit` clean, enforced in CI.
- **57** translation parity guard.
- **37** lifecycle guard coverage.
- **51, 60** documentation corrected and drift now fails `check:source`.
- **46** widened lint scope.
- **17** `NotesPanel` stale cache after a sync pull.
- **28** bounded the last unbounded remote calls (geolocation IP fallback).
- **8** host navigation and guest attachment hardening now tested.

Every fix in this session was verified against a negative control: the change was reverted, the test was watched to fail with the real symptom, and the source restored byte-identically. Tests that pass without ever having failed were not treated as coverage.

### What still cannot be verified locally

These need live services, real hardware or a signed build, and are the remaining gaps in the 60:
- Worker deployment, live email delivery and real multi-device sync recovery (recommendations 5, 17–20, 27).
- Signed Widevine/DRM playback in a released build (recommendation 49) — the verification package here is deliberately unsigned and no-DRM.
- Actual Windows display scaling and OS high-contrast themes (recommendation 56) — browser zoom and media emulation are not the same thing.
- Live Tor/ByeDPI proxy connectivity against a real blocking network (recommendations 12, 35).
- Autofill against real login providers, including hidden fields, nested frames and SPA navigation (recommendations 31–33).
