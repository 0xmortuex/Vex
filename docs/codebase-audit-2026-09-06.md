# Vex codebase audit — 6 September 2026

This review produced fixes in the working tree, regression tests, and a reusable source-integrity checker. Changes are not committed or published.

## Scope and limits

The repository-wide automated scan covered 208 first-party code/configuration files, approximately 48,400 lines, including 162 JavaScript files, HTML inline scripts, and 174 local script/style references. It includes main/preload processes, renderer modules, Workers, and build scripts. Third-party vendor code, installed dependencies, generated builds, binary assets and the pre-existing scratchpad were not treated as first-party source.

Manual review concentrated on persistence, tab/session/workspace lifecycle, IPC, credentials, geolocation, sync, agent execution, worker authentication, proxy launchers and build configuration. Other modules received inventory, syntax/reference checks and targeted pattern inspection. This is a repository-wide scan with deeper review of important paths, **not a claim that every line was manually audited or every browser feature was exercised**.

The earlier security report is historical, not a current list of open issues. Some of its findings were already fixed. Ruflo MCP tools were unavailable in this session.

## Bugs fixed

| # | Problem and observable consequence | Change | Main files |
|---|---|---|---|
| 1 | Assigning methods directly on `localStorage` stored string keys instead of installing the persistence shim. Settings could appear saved locally while never reaching the disk mirror. | Patch Storage's prototype; mirror only localStorage, not sessionStorage. | `src/renderer/js/storage.js` |
| 2 | `localStorage.clear()` was not mirrored, allowing deleted settings to return from disk. | Mirror deletion of Vex keys on clear. | `storage.js` |
| 3 | Overlapping flushes could send a newer value before an older queued value for the same key. | Serialize IPC batches in invocation order. | `storage.js` |
| 4 | Simultaneous page loads could overwrite each other's history entries during read-modify-write. | Serialize history additions within a renderer. Cross-window concurrency still needs a main-process solution. | `storage.js` |
| 5 | Tor/off-the-record URLs were saved in recently closed tabs, named sessions, workspaces, automatic snapshots and automatic archives. | Exclude ephemeral partitions from those persistence paths. This does not erase old leaked records or fix the separate private-window feature. | `tabs.js`, `sessions.js`, `workspaces.js`, `workspace-snapshots.js`, `readlater.js` |
| 6 | Container tabs lost their cookie partition after restart or restoration, reopening in the main account/session. | Preserve partition metadata in tab saves, startup restoration, recently closed tabs, sessions, workspaces, snapshots and archives. Preserve it for the tab-strip Duplicate action. Other popup/link paths remain open work. | Same files plus `storage.js` |
| 7 | Deleting the active workspace removed its record before asynchronous switching saved it; the fallback could overwrite the next workspace. | Await the switch before deleting the record; ignore deletion while already switching. | `workspaces.js` |
| 8 | Workspace pins were saved but ignored on restoration. | Pass pin state into lazy tab creation before rendering. | `workspaces.js`, `tabs.js` |
| 9 | Saved session/workspace groups referenced live mutable objects; renaming a live group could change the saved snapshot. | Copy group records on save and restore; clear stale groups for a workspace without groups. | `sessions.js`, `workspaces.js` |
| 10 | Restored tabs received new IDs but stack tops still referenced old IDs; fallback could choose the wrong top tab. | Map saved IDs to new IDs before rendering stacks. | `tabs.js` |
| 11 | Merging a session selected an existing tab using the saved index, rather than a newly restored tab. | Select from the restored tab collection. | `sessions.js` |
| 12 | Restoring an empty session could leave no usable tab. | Create a Home tab when replacement restores nothing. | `sessions.js` |
| 13 | Snapshot restoration passed a tab object to `switchTab`, which expects an ID, so focus did not change. Pins were also ignored. | Use `tab.id`, restore pins, and repaint/persist the resulting state. | `workspace-snapshots.js` |
| 14 | Workspace names were inserted unescaped into the snapshot dialog's HTML. | Escape the name before interpolation. | `workspace-snapshots.js` |
| 15 | A guest could pass a forged or missing origin into the geolocation bridge and bypass its permission decision. | Derive origin from Electron's sending frame; deny missing/opaque/non-web frames. | `src/main.js` |
| 16 | Navigation while awaiting a vault lookup could cause credentials to be injected into a different origin. | Check the destination origin inside the injected script before filling. | `passwords.js` |
| 17 | Spelling replacement typed anyway when word selection failed, potentially changing unrelated text. | Stop when selection fails or rejects. | `webview.js` |
| 18 | A 64-character non-hex recovery key silently converted invalid bytes to zero. Malformed recovery input was validated after consuming the email code. | Validate hexadecimal bytes and import the key before enrollment. | `sync-crypto.js`, `sync-engine.js` |
| 19 | A failed recovery pull still enabled auto-sync; the new device could later overwrite cloud data with the wrong key. | Clear the failed local enrollment and report an error instead of starting timers. | `sync-engine.js` |
| 20 | A headless agent exhausting its iteration budget returned normally and the scheduler marked it successful. | Throw an explicit failure on exhaustion. | `agent-loop.js` |
| 21 | Packaging explicitly downloaded Electron 30.5.1 although development used 42.5.2. The installed builder lets the download override win. | Align the packaging version to 42.5.2; add a version-consistency check. A packaged installer was not built. | `package.json`, `scripts/verify-source.js` |
| 22 | Any remote URL containing `start.html` was treated as Home, replacing legitimate pages and omitting their history. | Recognize the Vex scheme or a local renderer start page instead of an arbitrary substring. | `tabs.js` |

Snapshot deduplication now includes partition and pin state instead of URL strings alone. An invalid workspace ID is ignored before any state mutation.

## Tests and checks

- Baseline: 55 test files; **825 passed, 12 failed, 1 todo**.
- Final: 59 test files; **863 passed, 0 failed, 1 existing todo**. Added 26 tests; corrected the stale baseline assertions described below.
- The print-preview tests assumed one exact feature string and a fixed source line number. They now accept the combined feature list and test ordering/uniqueness.
- Other stale expectations concerned the intentionally global passkey tweak, the new onboarding job step, stack self-repair and delayed spelling insertion. Their expectations were updated to current behavior rather than reverting working features.
- Added regression coverage for privacy persistence, partitions, workspace deletion, stack ID mapping, session/snapshot restoration, real Storage interception, batch ordering, history races, geolocation origin spoofing, credential navigation races, sync recovery and agent exhaustion.
- Real Electron smoke boot passed in a throwaway profile: one tab and one webview initialized.
- `node scripts/verify-source.js` checks JavaScript syntax, local HTML script/style references, inline script parsing, and development/package Electron version agreement.
- `git diff --check` found no whitespace errors.
- Signed packaging, Widevine playback, real Tor routes, live login providers, multi-device sync and full UI interaction testing were not performed. The smoke test confirms initialization, not every feature.

## Confirmed remaining issues and risks

These are deliberately distinguished from the fixes above. Some need a coordinated feature change and integration tests rather than a small patch.

| Priority | Finding | Evidence and next action |
|---|---|---|
| P0 | **Private windows are not actually isolated as advertised.** | `open-private-window` creates a private session but does not assign it to the BrowserWindow. `webview.js` defaults guests to `persist:main`; `app.js` only adds a private CSS class. Storage bridges still target shared files. Implement private host/guest partitions and ephemeral storage together. Do not consider this fixed by the private-tab filters. |
| P0 | **Sync authentication exposes codes without email configuration.** | The sync Worker returns `devCode` when `RESEND_API_KEY` is absent. Anyone reaching that Worker can enroll as a supplied email. Disable this production fallback or require an explicit development-only deployment mode. Encryption alone does not prevent unauthorized overwrite/deletion. |
| P1 | **Dependency advisories remain.** | npm reported 38 affected packages: 3 critical, 21 high, 13 moderate, 1 low. This is a package/advisory count, not 38 proven application exploits. Runtime `tar` and `adm-zip` deserve particular attention because Vex processes archives. |
| P1 | **New tabs/Peek can lose the source partition.** | Main's normal popup forwarding sends URL/background state without a partition; several renderer Duplicate/Open-in-New-Tab actions also omit it. Carry a validated source-session identity through the complete creation path, including Tor. |
| P1 | **Sync does not use the actual storage source for several advertised categories.** | `SYNC_KEYS` reads localStorage `vex.tabs`, `vex.history`, etc., while `VexStorage` stores these as separate JSON files. `vex.bookmarks` is absent. Define a versioned sync snapshot from authoritative stores. |
| P1 | **Sync is a last-writer snapshot with weak conflict handling.** | Push/pull timers can overwrite concurrent changes; ordinary verification generates a new encryption key and pushes immediately. Add revisions, conflict handling and an existing-account/key check. The recovery-pull fix addresses one specific destructive path. |
| P1 | **Privileged IPC lacks a central sender policy.** | Many `ipcMain.handle` callbacks ignore the event. Broad preload capabilities include storage, shell and vault operations. Validate trusted host frames and target guest ownership centrally. |
| P1 | **Host HTML has no CSP and still contains unescaped attribute interpolation.** | `src/renderer/index.html` has no CSP meta tag; tab favicon URLs and some imported record IDs/colors enter HTML attributes. Use DOM assignment and validate imported schemas; then deploy a restrictive host CSP. This review did not construct a complete exploit chain. |
| P1 | **Downloaded executables lack artifact integrity verification.** | Tor and ByeDPI launchers download/extract then execute binaries without a pinned digest/signature check. Verify before extraction and launch. |
| P1 | **Scheduled agents operate on the shared active webview.** | Scheduler permits up to three runs; headless iterations and executor actions read the current active tab. User tab switches or other runs can redirect actions. Bind a run to its own tab/webContents and serialize incompatible jobs. |
| P1 | **AI worker access and limits need stronger controls.** | Worker is publicly callable without app authentication; per-IP KV counters are approximate, and request size gating trusts Content-Length. Add authenticated access, cost limits and actual bounded body reads. |
| P2 | **DPI proxy assumes one TCP data event contains the complete CONNECT request.** | `main-dpi-bypass.js` parses only the first chunk and discards its remaining bytes. Buffer through the header terminator and forward any excess bytes; test fragmented/coalesced input and invalid ports. |
| P2 | **History/indexing formats and navigation handling need reconciliation.** | Structured history records lack IDs expected by parts of the indexer. Its navigation check comments say origin+path but only compare origin. Create one stable history schema and reject mismatched documents. |
| P2 | **Persistence can still lose writes on abrupt exit or failed IPC.** | A 300 ms renderer queue and separate main debounce exist; failed operations are logged and discarded. Add a reliable flush/acknowledgment protocol, retries, and atomic structured writes. |
| P2 | **Some documentation overstates implementation.** | Architecture docs still describe Electron 30. README says vault secrets never reach the renderer, while `vault:get` returns credentials for autofill. Sync coverage and private-window claims need correction alongside implementation. |

## Dependency audit detail

| Package | Reported severity | Context |
|---|---|---|
| `tar` | Critical | Direct runtime dependency, Tor extraction; audit proposes a major-version migration. |
| `adm-zip` | High | Direct runtime dependency, extension/ByeDPI extraction; audit proposes 0.6.0. |
| `electron-updater` | High | Runtime update dependency; upgrade with update-flow testing. |
| `electron-builder` | High | Development/build tooling; migration affects installer generation and signing. |
| `sharp` | High | Development icon generation; test output and supported runtime after migration. |
| `electron-icon-builder` | Moderate | Old build dependency chain, including affected packages without an automatic fix. |
| `request`, `form-data` | Critical | Transitive findings; establish paths and reachability rather than interpreting the rating as a shipped remote-code exploit. |

No blanket `npm audit fix --force` was applied. The audit output is in `scratchpad/audit-dependencies.json`; advisory data reflects the registry response during this review. Stage dependency migrations separately, regenerate the lockfile, and test archive handling, icon generation, installer creation and update behavior.

## Prioritized suggestions

These are proposals, not claims that each is an independently proven bug. Items 1–16 should come before adding more features.

1. Make private-window mode a complete session/storage boundary and test disk output after closing it.
2. Use one shared tab serialization policy for all save, restore, archive, duplicate and sync paths.
3. Preserve source partition and proxy route when following links into new tabs or Peek.
4. Prevent private URLs and page content from entering Recall, AI context, logs and automatic archives by default.
5. Remove production authentication-code disclosure from the sync Worker.
6. Bind privileged IPC to trusted renderer frames and validate every payload schema.
7. Check ownership when an IPC request names another webContents ID.
8. Keep host navigation restricted to packaged UI; deny unexpected navigation and preload changes.
9. Replace HTML string attributes with `textContent`, `.src`, `.dataset` and style assignments.
10. Add a host Content Security Policy and remove dependencies on inline handlers first.
11. Validate imported sessions, themes, setups, colors, URLs and identifiers before rendering them.
12. Verify Tor/ByeDPI downloads using pinned digests or publisher signatures.
13. Bound archive entry count, total expanded size, compression ratios and extraction destinations.
14. Upgrade runtime archive dependencies first, then the build/update chain in a separate migration.
15. Store sync keys and session tokens with OS encryption; file permission mode alone is insufficient Windows key protection.
16. Give scheduled agents their own tab context and enforce action policy in code, independently of model-provided intent.
17. Give sync data a versioned schema built from actual stores, including bookmarks.
18. Add per-record revisions/tombstones so deletions sync and concurrent edits do not silently disappear.
19. Never generate and push a fresh key onto an existing encrypted account without an explicit reset flow.
20. Encrypt cross-device URL/title handoffs too, or clearly distinguish their privacy properties.
21. Coordinate local persistence in main across windows; renderer-only serialization cannot prevent cross-window races.
22. Use atomic temporary-write/rename plus recovery backups for structured JSON files.
23. Add an acknowledged shutdown flush and retry transient persistence failures.
24. Surface storage failures to the user rather than reporting successful saves after failed writes.
25. Use versioned storage migrations and retain a recovery copy before changing formats.
26. Expose clear site/session data controls that also address Vex history, Recall, snapshots and archives.
27. Authenticate the AI Worker and add per-user quotas plus request-cost ceilings.
28. Bound actual request and response bytes, with cancellation/timeouts for every remote call.
29. Use a serialized/transactional counter service for strict auth attempts and quotas instead of assuming KV increments are atomic.
30. Revalidate document URL and navigation generation after every asynchronous page-content lookup.
31. Make autofill account selection explicit when several credentials match a site.
32. Test password and TOTP filling on hidden fields, nested frames, SPA navigation and changed form actions.
33. Make passkey suppression opt-in by site and explain its effect in settings.
34. Narrow global third-party storage and frame-header exceptions to documented compatibility cases.
35. Test proxy parsing with fragmented CONNECT lines, IPv6, extra bytes, disconnects and timeouts.
36. Add cancellation and crash-loop backoff for webview self-recovery.
37. Dispose timers, observers and event listeners through a common tab/panel lifecycle API.
38. Replace repeated monkey-patching of global managers with explicit events and extension hooks.
39. Debounce/coalesce tab persistence during bulk restores instead of saving every intermediate state.
40. Virtualize large history, bookmark and tab lists and measure improvements before rewriting them.
41. Keep synchronous filesystem work off high-frequency main-process handlers.
42. Track memory by live webContents and clear stale tab records immediately on destruction.
43. Split `main.js` into session, permissions, vault, storage, downloads and update modules with explicit dependencies.
44. Separate UI rendering from storage and network logic so tests can exercise real behavior without large mocks.
45. Introduce JSDoc/TypeScript checking gradually around IPC contracts, tabs and sync records.
46. Add lint checks for unhandled promises, unsafe HTML interpolation and accidental global references.
47. Add CI for unit tests, source checks and an isolated Electron boot on Windows.
48. Add end-to-end scenarios for private browsing, two-account containers, workspace deletion, save/restart and sync recovery.
49. Keep a packaged-build test matrix for updater, printing, OAuth, codecs and Widevine; development smoke tests cannot verify these.
50. Prefer behavioral assertions to source-string/line-number assertions except for deliberate initialization invariants.
51. Make release version/runtime/signing metadata come from one source; fail early if they disagree.
52. Use reproducible lockfile installs and periodically check the dependency tree with production/dev exposure separated.
53. Replace the obsolete icon-building dependency chain with the existing image tooling where practical.
54. Bundle UI fonts locally so browser chrome does not request remote fonts at startup.
55. Make keyboard focus, dialog labels, Escape behavior and focus return consistent across panels.
56. Test both GUI styles at common Windows scaling levels, high contrast, reduced motion and keyboard-only navigation.
57. Centralize strings and test long Turkish labels and translated onboarding flows.
58. Show save/sync/network status where users need it, with retry actions for actionable failures.
59. Redact URLs containing tokens and credentials from diagnostic logs; make verbose diagnostics opt-in.
60. Update the architecture, privacy and release documentation to distinguish implemented guarantees from planned features.

Electron's [security guidance](https://github.com/electron/electron/blob/main/docs/tutorial/security.md) supports sender validation, constrained navigation and renderer hardening. Cloudflare documents that [concurrent KV writes can overwrite each other](https://developers.cloudflare.com/kv/api/write-key-value-pairs/) and describes its [consistency model](https://developers.cloudflare.com/kv/concepts/how-kv-works/); strict counter behavior needs an appropriate design rather than a get/increment/put assumption.

Suggested next sequence: finish private-window/session isolation; close production sync/worker authentication gaps; migrate runtime archive dependencies; then unify persistence/sync and scheduled-agent tab ownership. After those, invest in CI and modularization before expanding the feature list.
