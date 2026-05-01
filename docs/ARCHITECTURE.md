# Vex — Architecture

A practical map of how Vex is put together: the process model, the IPC surface, where state lives, how tabs and webviews are wired, the build pipeline, and the design history of the glass theme.

This document is meant to onboard a new contributor in ~20 minutes. It is not exhaustive — for any specific module, treat the file's own header comment as authoritative.

---

## 1. Process model

Vex is a stock Electron 30 app, but with a **single main window** (no per-tab windows) and many **`<webview>` guests** inside it.

```
┌──────────────── electron main process (src/main.js) ────────────────┐
│                                                                      │
│   • Owns BrowserWindow + every <webview>'s session                  │
│   • Wires permissions, downloads, adblocker, extension loader        │
│   • Bridges OS shell (mailto:, roblox://, Chrome shortcuts)          │
│   • Persistent storage: src/main/userData/vex-storage/*.json         │
│   • IPC server — see § 2                                             │
│                                                                      │
└─────────┬─────────────────────────────────────┬──────────────────────┘
          │ contextBridge → window.vex          │ contextBridge →
          │ (src/preload.js)                    │ window.__vexGeoBridge
          │                                     │ (src/preload-webview.js,
          ▼                                     │  for guest pages only)
┌────── renderer (src/renderer/) ──────┐    ┌───── webview guests ─────┐
│                                       │    │  (any site, sandboxed)   │
│ • TabManager, WorkspaceManager,       │    │                          │
│   CommandBar, AIPanel, AgentLoop,     │    │  Main-world polyfill of  │
│   ShortcutsRegistry, …                │    │  navigator.geolocation   │
│                                       │    │  → asks main via bridge  │
│ • Renders chrome (tabs, sidebar,      │    │                          │
│   url bar) — NOT the page content     │    │                          │
│                                       │    │                          │
│ • Embeds <webview> tags for tab       │    │                          │
│   content + sidebar panels            │    │                          │
└───────────────────────────────────────┘    └──────────────────────────┘
```

- `BrowserWindow` is `frame: false, transparent: true` (required for `backdrop-filter` on Windows). One consequence: `BrowserWindow.isFullScreen()` returns the wrong value; we track fullscreen state ourselves (see `src/main-helpers.js` and B-1 in `b692123`).
- `webPreferences` for the main window: `contextIsolation: true, nodeIntegration: false, webviewTag: true`. Same for the private-browsing window.
- Single-instance lock: a second launch with a URL argv is forwarded to the running instance via `app.on('second-instance')` and dispatched to the renderer through `open-url` IPC. See `src/main-helpers.js` (`findLaunchUrl`, `normalizeLaunchArg`).

## 2. IPC bridge — `src/preload.js`

`preload.js` is the only contextBridge surface available to the **main renderer**. It exposes `window.vex.*` (see file for the full list — over 60 methods grouped by feature: storage, persist, downloads, permissions, extensions, sync, updates, devtools).

A second narrow bridge, `window.__vexGeoBridge`, is exposed to **webview guests** by `src/preload-webview.js`. It only exists to let the geolocation polyfill ask main for the current location preference. (Caveat: this bridge is exposed to *all* origins in webviews — see `docs/security-audit-2026-04.md` M-3.)

Everything that mutates state on disk goes through main; the renderer never opens a fd directly.

## 3. Webview management

- All regular tabs share one persistent session, `persist:main`.
- Sidebar panels (Claude, WhatsApp, Spotify) get their own partitions: `persist:claude`, `persist:whatsapp`, `persist:spotify`. This keeps cookies/localStorage isolated so logging into a panel doesn't taint regular tabs.
- Each session has the **adblocker, downloads tracker, and permissions handler** wired once via `wireAdblockerOnSession`, `wireDownloadsOnSession`, `wirePermissionsOnSession` (`src/main.js:244-317`). These are idempotent (`__vexAdblockWired` etc. flags).
- External-protocol forwarding (`mailto:`, `roblox://`, `discord://`) is handled at three layers:
  1. `setWindowOpenHandler` for `window.open` calls
  2. `will-navigate` for top-level navigation
  3. `will-frame-navigate` for hidden-iframe handoffs (Roblox Play button)

  All three call `handleExternalProtocol`, which delegates to the allowlist in `src/main-helpers.js`.

## 4. Storage

Two layers, by design:

| Layer | What | Where | Used for |
|---|---|---|---|
| `VexStorage` (renderer) | One JSON file per key | `userData/vex-storage/<key>.json` | Tabs, groups, history, settings, shortcuts |
| `PersistentStorage` (renderer) + `vex-persist.json` | Single JSON file with a localStorage shim | `userData/vex-persist.json` | Everything `localStorage`-y: theme prefs, scheduler tasks, recently-closed list, AI routing prefs, tab-grouper learned patterns, keyboard remappings, sync key, sessions list |

The `PersistentStorage` shim hijacks `localStorage.setItem` / `removeItem` and mirrors writes to disk via debounced IPC (`persist-set`/`persist-delete`). Reads stay synchronous against the hydrated `localStorage`. This survives reinstalls and Chromium origin churn that would otherwise wipe localStorage.

A separate file `userData/sync-key.bin` (mode `0o600`) holds the AES-GCM 256 key used by the experimental Vex Sync feature. Recovery codes are exchanged via the helpers in `src/renderer/js/sync-crypto.js`.

## 5. Tab features

| Feature | Where | Notes |
|---|---|---|
| **Sleep / Wake** | `src/renderer/js/tabs.js:759-820` | Captures `window.scrollX/Y` via `executeJavaScript` before tearing down the webview; `wakeTab` recreates and restores via a one-shot `did-finish-load` listener. |
| **Auto-sleep** | `src/renderer/js/tabs.js:838-860` | Polls every 30s; sleeps inactive tabs after `thresholdMinutes` of no view. Excludes pinned tabs by default. |
| **Lazy tabs** | `src/renderer/js/tabs.js:256-280` | Workspace switch creates `_lazy: true` tabs whose webview only spawns on first activation. Avoids creating N webviews for N restored tabs. |
| **Groups** | `src/renderer/js/tabs.js` + `src/renderer/js/tab-grouper.js` | Tabs carry `groupId`; groups stored on `TabManager.groups`. AI grouper proposes clusters; auto-assign matches new tabs against learned domain/keyword patterns. Empty groups auto-prune in `closeTab`. |
| **Sessions (named)** | `src/renderer/js/sessions.js` | List of saved tab+group snapshots in `localStorage` key `vex.sessions`. Restore replaces or merges current. |
| **Workspaces** | `src/renderer/js/workspaces.js` | A workspace owns its own tabs/groups/shortcuts/tools and a primary colour. Switching saves current state, lazily creates the target workspace's tabs, and re-themes. |
| **Recently-closed** | `tabs.js` `getRecentlyClosed`/`saveRecentlyClosed` | Last 25 closed tabs, restorable via Ctrl+Shift+T. |

## 6. Build pipeline

- `npm run dist` → `npm run build-icons` → `rimraf dist` → `electron-builder`.
- **Electron** is the **castLabs Widevine fork** (`electron@github:castlabs/electron-releases#v30.5.1+wvcus`). This adds Widevine CDM hooks for DRM-capable builds (Netflix, Spotify Premium video).
- After packing, `scripts/vmp-sign.js` (configured as `build.afterPack`) applies **VMP signing** so Widevine accepts the bundle.
- Icon pipeline: `scripts/svg-to-png.js` rasterises `assets/icon.svg` → `electron-icon-builder` produces `.ico` + multi-size `.png` → `scripts/finalize-icons.js` does final cleanup.
- NSIS installer (one-click off; per-user install) writes desktop + start-menu shortcuts. `differentialPackage: false` because the auto-updater currently uses full installs.
- Auto-updates ship via `electron-updater` against the `0xmortuex/Vex` GitHub release feed.

## 7. Glassmorphism — the 5 design phases

Reconstructed from the commit log; each commit added glass surfaces to a specific UI layer:

| Phase | Commit | Scope |
|---|---|---|
| 1 | `86a3fa6` — `feat(theme): Phase 1 glassmorphism — chrome only` | Top bar, tab strip, URL bar, window controls |
| 2 | `7224b90` — `feat(theme): Phase 2 glassmorphism — left sidebar + tools bar` | Glass surfaces, amber active states, hover lift |
| 3 | `f9e127f` — `feat(theme): Phase 3 glassmorphism — home/start page` | Glowing search, glass shortcut cards, editorial greeting |
| 4 | `b796667` — `feat(theme): Phase 4 glassmorphism — settings, modals, context menus, toasts, permissions, downloads` | Full theme reaches every overlay |
| 5 | `9db3780` — `feat(theme): Phase 5 glassmorphism — sidebar panels (History, Bookmarks, Notes, Settings, CUSA, permissions) + workspace content tinting` | Panel chrome unified; workspace primary color tints content edges |

The theme depends on `BrowserWindow` `transparent: true` plus `backdrop-filter: blur(...)` on the surface CSS classes. On Windows, transparency requires the `frame: false` titlebar (we have it) and triggers the `isFullScreen()` lie noted in §1. `assets/GLASSMORPHISM_TESTING.md` (root) records Phase-1 regression checks; later phases were validated ad-hoc.

---

## Module map

A one-line summary of each in-tree module. For deeper detail read the file's own header comment.

### Main process

- `src/main.js` — Electron entry. Owns the main window, every webview session, all IPC handlers, the extension loader, the auto-updater wiring, and the global keyboard shortcuts that must work even when guest pages have focus.
- `src/main-helpers.js` — Pure helpers extracted from `main.js` for testability: external-protocol allowlist (`isExternalProtocol`), Windows argv URL/path normalisation (`normalizeLaunchArg`/`findLaunchUrl`), and the fullscreen-shortcut decider used to route F11/Esc.
- `src/adblocker.js` — Pattern-based request blocker. `shouldBlock(url)` is consulted by every session's `webRequest.onBeforeRequest`. Currently has a known substring-match bug (see `docs/security-audit-2026-04.md` M-1).
- `src/pip.js` — Picture-in-Picture window factory (used by `ipcMain.handle('open-pip-window')`).
- `src/preload.js` — `contextBridge` surface for the main renderer. Exposes `window.vex.*` with everything the renderer needs from main.
- `src/preload-webview.js` — Runs in every guest. Injects PiP buttons on `<video>` elements and replaces `navigator.geolocation` with a polyfill that asks main for permission/coordinates.

### Renderer — core

- `src/renderer/js/app.js` — Boot orchestration; mounts every singleton in the right order.
- `src/renderer/js/tabs.js` — `TabManager` singleton: tabs, groups, sleep/wake, auto-sleep, drag-drop, recently closed.
- `src/renderer/js/horizontal-tabs.js` — Optional horizontal tab-bar renderer; reads from TabManager and projects into `#top-tabs-list`.
- `src/renderer/js/webview.js` — `WebviewManager`: creates/destroys `<webview>` elements, wires per-tab events, applies per-domain zoom and force-dark, queues new pages for AI history indexing.
- `src/renderer/js/sidebar.js` — Sidebar shell: panel switching, Refresh / Open DevTools right-click actions, scroll behaviour.
- `src/renderer/js/command.js` — Ctrl+K command bar. Mixes static commands, URL/search heuristics, and history.
- `src/renderer/js/storage.js` — `VexStorage` (per-key JSON files, async) and `PersistentStorage` (localStorage shim with disk mirror).
- `src/renderer/js/shortcuts-registry.js` — Single source of truth for keyboard bindings. Maps a stored combo string to a registered handler.
- `src/renderer/js/scheduler.js` — Recurring task engine. `calculateNextRun` covers once/daily/weekly/monthly + 5-field cron. Runs the agent in headless mode at the scheduled time.
- `src/renderer/js/sessions.js` — Named session save/restore.
- `src/renderer/js/workspaces.js` — Workspace profiles (Personal / CUSA / School / Dev). Lazy-restore tabs on switch; primary color tints the chrome.

### Renderer — AI

- `src/renderer/js/ai-router.js` — Decides cloud (Cloudflare Worker → Claude) vs local (Ollama) per feature, respecting user prefs and online status.
- `src/renderer/js/ai-panel.js` — The chat panel UI. Multi-tab compare, summarise, translate, explain, history search.
- `src/renderer/js/agent-loop.js` — Tool-calling agent. `parseAgentResponse` (free function, exported for tests) normalises model output across 6 field aliases and stripped fences. `ToolCallHistory` prevents infinite tool re-spam.
- `src/renderer/js/agent-executor.js` — Implements each agent tool against `WebviewManager` / `TabManager`.
- `src/renderer/js/dom-extractor.js` — Asks the active webview for a stable list of interactive elements + selectors.
- `src/renderer/js/page-context.js` — Pulls page text + selection out of a webview for the AI panel.
- `src/renderer/js/history-indexer.js` — Async queue that summarises visited pages for AI history search.
- `src/renderer/js/personas-*.js` — Persona definitions, builtin set, settings UI.
- `src/renderer/js/tab-grouper.js` — AI auto-grouping; learned-pattern auto-assign on new tabs.
- `src/renderer/js/ollama.js` — Local Ollama HTTP client.

### Renderer — sidebar panels

`history-panel.js`, `notes-panel.js`, `downloads-panel.js`, `memory-panel.js`, `schedules-panel.js`, `shortcuts-panel.js`, `extensions-settings.js`, `permissions-settings.js`, `location-settings.js`, `ai-settings.js`, `personas-settings.js`, `sync-settings.js`, `cusa-panel.js`, `github-panel.js`, `roblox-panel.js`. Each owns its own DOM construction inside the sidebar shell.

### Renderer — utilities

`download-toast.js`, `tab-preview.js`, `tab-selector.js`, `tab-grouper.js`, `theme-editor.js`, `screenshot.js`, `reading-mode.js`, `translate.js`, `restore-prompt.js`, `update-notifier.js`, `permission-prompts.js`, `multi-tab-context.js`, `ask-ai-bar.js`, `shortcut-editor.js`, `sync-crypto.js`, `sync-engine.js`, `start.js`, `tools.js`, `split.js`.

### Tests

Tests live in `tests/`. The current suite covers the top-5 high-value pure functions surfaced by the test-gap report: `isExternalProtocol`, `shouldBlock`, `normalizeLaunchArg`/`findLaunchUrl`, `handleFullscreenShortcut`, `parseAgentResponse`. Run with `npm test`. See `docs/test-gap-report.md` for the prioritised list of what to cover next.
