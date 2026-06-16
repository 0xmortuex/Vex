# Vex — Complete Project Knowledge Base (Exhaustive Edition)

> **What this is.** A complete, source-verified reference for **Vex**, a privacy-first desktop browser.
> Upload it to your Claude Project ("Vex Development") as knowledge so Claude can give you upgrade ideas,
> design critiques, and implementation help with full context. Built by reading the actual source
> (main process, renderer, workers), not just the README/CHANGELOG.
> **Snapshot: v2.26.5 (June 2026).** When something here might drift, the file's own header comment in the
> repo is authoritative.

---

## 0. HOW TO USE THIS PROJECT — paste into the Project's Custom Instructions

```
You are my product & engineering partner for Vex, a privacy-first desktop web browser I build solo
(Electron + vanilla JS, no framework, no renderer build step). The knowledge file describes Vex
completely: architecture, constraints, every shipped feature, every storage key, the IPC surface,
the AI subsystem, and the self-hosted Cloudflare Workers.

Ground rules when I ask for ideas or upgrades:
- The stack is fixed: Electron (castLabs Widevine fork), vanilla-JS renderer with <webview> guests,
  JSON-file storage in userData, optional self-hosted Cloudflare Workers (AI proxy + Sync). No React/
  Vue, no bundler for the renderer, minimal dependencies unless clearly justified.
- Respect the philosophy: fast, private, minimal, single-window, deeply customizable, "a browser built
  just for you." Everything must degrade gracefully offline; cloud is always optional and self-hosted.
- Don't re-propose features Vex already has — check the inventory first. Suggest upgrades to existing
  features or genuinely new ones.
- For each idea give: (1) user value, (2) where it slots into the module map, (3) implementation
  sketch incl. new storage keys / IPC channels / worker actions if any, (4) risks & edge cases,
  (5) effort (S/M/L). Rank by impact-to-effort.
- Never compromise privacy, performance, or the minimal aesthetic. Prefer no-backend solutions.
- I ship fast via GitHub Releases + electron auto-update. Favor incremental, shippable changes.

Be concrete and opinionated.
```

---

## 1. WHAT VEX IS

**Vex — "a browser built just for you."** Fast, private, minimal desktop browser for **Windows 10/11
(64-bit)**, built with Electron. Arc/Vivaldi-inspired, solo-built, independent. Headline features:
vertical (or horizontal) tabs, a built-in AI agent, ad/tracker blocking, workspaces, and a command
bar that does everything.

- **Author:** 0xmortuex (Fadi Raad) · fraad002@gmail.com · **License:** MIT
- **Repo:** github.com/0xmortuex/Vex · **Site:** 0xmortuex.github.io/vex-website
- **App ID:** com.vex.browser · **Product:** Vex · **Installer:** `Vex-Setup.exe` (NSIS, per-user)
- **Independent & unsigned** → SmartScreen may warn on first run (More info → Run anyway).
- **Auto-updates** from GitHub Releases via electron-updater.
- **Current version: 2.26.5** (June 2026). Development is extremely fast/iterative (1.0.0 → 2.26.x).

---

## 2. TECH STACK & DEPENDENCIES

| Layer | Choice |
|---|---|
| Shell | **Electron 30**, castLabs Widevine fork: `electron@github:castlabs/electron-releases#v30.5.1+wvcus` (DRM: Netflix/Spotify) |
| Renderer | **Vanilla JavaScript**, no framework, no bundler/build step. Plain ES modules + per-feature CSS files |
| Page content | Electron `<webview>` guests; one shared `persist:main` session for tabs, isolated partitions per panel/container |
| Ad/tracker block | `@ghostery/adblocker-electron` (EasyList + EasyPrivacy) ORed with a 52-entry legacy domain list |
| Updates | `electron-updater` (GitHub feed) + a lightweight manual HTTPS version check |
| Other deps | `adm-zip` (extension `.zip`/`.crx`), `qrcode` (QR feature) |
| Build | `electron-builder` (NSIS x64); `sharp` + `electron-icon-builder` for icons; `vmp-sign.js` afterPack |
| Tests | `vitest` + `jsdom` (pure-function unit tests in `tests/`) |
| Cloud (optional) | Two **Cloudflare Workers** the user self-deploys: AI proxy (→ OpenRouter/Claude) + Sync (E2E) |
| Local AI | **Ollama** (HTTP, localhost:11434) and **WebGPU on-device** (WebLLM via esm.run CDN) |

Hard constraints: no transpiled renderer code; tiny dependency surface; offline-first; all persistence
is JSON files (plus one encrypted vault + one binary adblock cache) in `userData`.

---

## 3. ARCHITECTURE & PROCESS MODEL

Stock Electron 30, **one single main window** (no per-tab windows) hosting many `<webview>` guests.

```
┌──────── electron main process (src/main.js, ~104KB) ────────┐
│ Owns BrowserWindow + every <webview> session                │
│ Wires permissions, downloads, adblocker, extensions         │
│ Bridges OS shell (mailto:, roblox://, discord://, …)        │
│ Persistent storage in userData/*.json                       │
│ IPC server (window.vex.* + several narrow bridges)          │
└──────┬───────────────────────────────┬──────────────────────┘
       │ contextBridge → window.vex     │ contextBridge → window.__vexGeoBridge / vexHid /
       │ (src/preload.js)               │ vexSpellcheck / vexDevTools (src/preload-webview.js)
       ▼                                ▼
  renderer (src/renderer/)         webview guests (any site, sandboxed)
  chrome: tabs, sidebar, URL bar   page content + geolocation polyfill + farbling + PiP buttons
```

- Main window: `1400×900` (min 800×600), `frame:false, titleBarStyle:'hidden', transparent:true,
  backgroundColor:'#00000000'` (transparency required for the glass `backdrop-filter`). Side effect:
  `BrowserWindow.isFullScreen()` is unreliable → fullscreen tracked manually (`isFullscreenTracked`).
- `webPreferences`: `contextIsolation:true, nodeIntegration:false, webviewTag:true, webSecurity:true`,
  preload `src/preload.js`.
- **Private window**: ephemeral session `private:${Date.now()}`, `1200×800`, dark bg, inherits header
  stripping/adblock/permissions/Client-Hints/Chrome-UA/preload/downloads.
- **PiP window** (`src/pip.js`): `400×225`, 16:9 locked, `alwaysOnTop:'screen-saver'`, `skipTaskbar`,
  reused if alive; URL validated to http/https only (`safePipUrl`).
- **Single-instance lock**: a second launch with a URL/path argv forwards to the running instance via
  `second-instance` → buffered → `open-url` IPC (`normalizeLaunchArg`/`findLaunchUrl`).
- **Custom scheme**: `vex://start` registered privileged (standard/secure/fetch/bypassCSP); serves
  `renderer/start.html` and assets, injecting `data-theme` from `vex-storage/theme.json`,
  `Cache-Control: no-store`.
- **Command-line switches**: `enable-features=PrintPreview`, `enable-print-preview`,
  `disable-features=ThirdPartyStoragePartitioning` (the last one fixes Firebase/"Sign in with Google"
  redirect logins; the tracker blocker compensates for the lost isolation).

### Sessions & partitions
- Tabs share **`persist:main`**. Panels: **`persist:whatsapp`**, **`persist:claude`**,
  **`persist:spotify`**. Containers: **`persist:container-work` / `-personal` / `-shopping`**.
  Off-the-record tabs: ephemeral `otr-*`. Private window: `private:<ts>`.
- Every session is wired **once** (idempotent flags) with: header stripping (frame-ancestors +
  x-frame-options removal), adblocker `onBeforeRequest`, permission request/check handlers, WebHID
  device handler, downloads `will-download`, and the `preload-webview.js` preload.
- **UA spoof** on all sessions: Chrome 124 desktop UA. **Client Hints** normalized to Chrome 124
  (`Sec-CH-UA`, full-version-list, platform "Windows", mobile ?0) so sites that sniff Client Hints see
  consistent desktop Chrome and don't show "unsupported browser."
- **External protocols** allowlist (forwarded to OS via `shell.openExternal`): roblox, roblox-player,
  roblox-studio, mailto, tel, sms, msteams, slack, zoommtg, zoomus, skype, discord, vscode,
  vscode-insiders, obsidian, spotify, steam, ms-word/excel/powerpoint, itmss/itms/itms-apps,
  web+mastodon. Handled at 3 layers: `setWindowOpenHandler`, `will-navigate`, `will-frame-navigate`.
  Blocked: javascript:, data:, chrome://, file:// as navigation targets.
- **OAuth popups** kept as real popups (opener intact): accounts.google.com, login.microsoftonline.com,
  appleid.apple.com, and Firebase `/__/auth/(handler|iframe)$`. Others route into Peek/tab.
- **Print popups** allowed real: about:blank, blob:, data:, chrome-print://, frameName `_print`,
  `/print/i` features. Rich Print Preview enabled.

---

## 4. STORAGE SYSTEM

Two renderer layers + several main-process files.

| Layer | What | Path |
|---|---|---|
| `VexStorage` (async, per-key JSON) | Structured: tabs, groups, settings, theme, history | `userData/vex-storage/<safeName(key)>.json` |
| `PersistentStorage` (localStorage shim → debounced disk mirror, 250 ms) | Everything `localStorage`-y (`vex.*` keys) | `userData/vex-persist.json` |

The shim hijacks `localStorage.setItem/removeItem`, mirrors to disk via `persist-set`/`persist-delete`,
reads stay synchronous against the hydrated store → survives reinstalls and Chromium origin churn.

**Main-process files (userData/):**
- `permissions.json` — `"origin::permission" → "allow"/"deny"`
- `hid-grants.json` — `origin → [{vendorId, productId}]` (WebHID, Brave-style persistent grants)
- `vault.dat` — passwords, **safeStorage-encrypted** (Windows DPAPI/OS keychain); refuses to save if
  encryption unavailable (never plaintext)
- `privacy.json` — `{farble, doh, dohProvider}`
- `recall.json` — full-text index, array of `{url, title, text, at}`, cap **2000** entries, min 120 chars
- `sidebar-config.json` — user-created, gitignored: `{aiNewsUrl, queueUrl, queueSecret}`
- `vex-adblock-engine.bin` — serialized Ghostery engine cache (offline-safe instant startup)
- `sync-key.bin` — AES-GCM-256 key, hex, mode `0o600`; `sync-meta.json` — sync metadata
- Widevine: `WidevineCdm`, `component_crx_cache`, `widevine_cdm_hint` dirs; `Local State`
  (`updateclientdata`) — cleared/reset by DRM Retry.

**Full `vex.*` key catalog** (localStorage, persisted to `vex-persist.json` unless noted):

*Tabs/layout:* `vex.tabs`, `vex.groups`, `vex.stacks`, `vex.recentlyClosed` (max 25), `vex.tabLayout`
(horizontal|vertical), `vex.tabsHidden`/`vex.tabsVisible`, `vex.tabHibernateMinutes` (default 30),
`vex.autoSleepEnabled`/`vex.autosleep`, `vex.autosleepMinutes` (5/10/15/30/60), `vex.autosleepExcludePinned`,
`vex.memCeiling`/`vex.memCeilingMB` (Off/900/1200/1600/2400).
*Sessions/workspaces:* `vex.sessions` (max 50), `vex.workspaces`, `vex.autosave`, `vex.tools`.
*Grouping:* `vex.groupPatterns`, `vex.rejectedGroupPatterns` (cap 50), `vex.lastGroupSuggestionAt`,
`vex.autoGroupSuggest`, `vex.autoAddToGroups`.
*Schedules:* `vex.schedules` (max 500), `vex.scheduleHistory` (max 500).
*History/recall:* `vex.history` (cap ~500–5000 depending on path), `vex.recall.enabled`,
`vex.aiIndexingEnabled`.
*Search/personalization:* `vex.searchEngine`, `vex.userName`, `vex.githubUsername`, `vex.weatherLoc`
`{lat,lon,city}`, `vex.shortcuts` (start-page quick links), `vex.quranEnabled`.
*Theme/appearance:* `vex.theme` (+legacy `vex-theme`), `vex.favThemes`, `vex.customThemeImage`,
`vex.accentColor`, `vex.zooms` `{host:factor}`, `vex.forceDarkSites`, `vex.forceDarkHosts`.
*AI:* `vex.aiRouting`, `vex.preferLocalAI`, `vex.forceCloudAI`, `vex.localAIModel` (default
`llama3.2:3b`), `vex.webllmModel`, `vex.preferOnDeviceAI`, `vex.agentMode` (ask|auto|plan),
`vex.aiMemory` `{enabled,facts[]}` (max 100, 400 chars), `vex.personas`, `vex.activePersona`
(default `builtin_default`), `vex.activePersonaByTab.<id>`, `vex.skills`, `vex.chains`,
`vex.mcpServers`, `vex.customCommands`, `vex.ollamaHintShown`.
*Privacy/utilities:* `vex.pwNever`, `vex.a11y` `{font,cvd,ruler}`, `vex.boosts` (per-host
`{zaps,css,js}`), `vex.readLater`, `vex.archivedTabs` (max 200), `vex.autoArchiveDays` (0/3/7/14/30),
`vex.annotations` (highlights by URL), `vex.focusBlocklist`, `vex.compactMode`, `vex.gesturesEnabled`,
`vex.watches`, `vex.consentBlock`/`vex.consent`, `vex.bookmarks`, `vex.feeds`, `vex.notes`,
`vex.downloads` (max 100), `vex.manualLocation`, `vex.locationMode` (off|manual|ip),
`vex.translateLang`.
*Cloud/flags:* `vex.aiWorkerUrl`, `vex.syncWorkerUrl`, `vex.defaultBrowserConfigured`,
`vex.onboardingDone`, `vex.tourSeen`, `vex.hasRunBefore`, `vex.vaultSeeded`, `vex.lastUpdateCheck`,
`vex.adblocking`/`vex.adBlocker`, `vex.userShortcuts`, `vex.sidebarOrder`, `vex.sitePanels`,
`vex.panelOverrides`, `vex.settings`.

---

## 5. IPC SURFACE (the contract between renderer and main)

`preload.js` exposes `window.vex.*` (60+ methods). Narrow bridges: `window.__vexGeoBridge`
(geolocation), `window.vexHid` (WebHID chooser), `window.vexSpellcheck` (replace misspelling),
`window.vexDevTools` (DevTools control). Selected channels:

- **Window:** window-minimize/maximize/close; toggle-fullscreen; is-fullscreen; open-private-window;
  open-pip-window(url).
- **Storage:** storage-save/load; persist-get-all/set/delete; get-user-data-path; sidebar-config:get.
- **Search/nav:** web-suggest(query) (Google Suggest proxy); get-start-page-path/url; webview:hard-reload.
- **Geolocation:** geolocation:get; geolocation:check-permission (coarsened to ~11 km, 1 dp).
- **Permissions:** permission:request (push), permission:respond, permissions:list/revoke/clear-all.
- **WebHID:** hid:select-request (push), hid:select-respond.
- **Downloads:** download-started/progress/complete (broadcast to all windows); downloads:open-file/
  show-in-folder/open-folder.
- **DevTools:** devtools:toggle-webview, devtools:open-for-webcontents (two-strategy id/URL lookup).
- **Spellcheck:** spellcheck:replace-misspelling.
- **Tools:** qr:make (280px), app:metrics (per-process CPU/mem), translate:text, rss:fetch (≤2 MB),
  api:request (curl-like, ≤5 MB body, returns status/time/size).
- **Recall:** recall:index/search/clear.
- **Privacy:** privacy:config-sync (sync, for preload), privacy:get-config/set-config,
  privacy:tracker-stats/tracker-reset.
- **Vault:** vault:list/get/save/delete.
- **Extensions:** extensions:list/install-folder/install-zip/uninstall/open-folder.
- **Updates/system:** check-for-updates, download-update, install-update, get-app-version,
  widevine:status, widevine:retry, set-as-default-browser, is-default-browser.
- **Sync:** sync-save-key/load-key/save-meta/load-meta/clear-state.
- **Adblock:** adblocker-get-state/set-state.
- **Cold-start link:** open-url (buffered until renderer registers handler) + onTabCreateFromExternal,
  onPeekOpen.
- Platform info exports: platform, electronVersion, chromeVersion, nodeVersion.

---

## 6. MAIN-PROCESS FEATURES (beyond the bridge)

- **Global shortcuts:** F12 (DevTools focused window), Ctrl+Alt+H (Boss key: hide+mute all),
  Ctrl+Shift+F12 (detached DevTools), Ctrl+Shift+J (DevTools for focused webContents).
  `before-input-event` on main window + every guest routes ~30 Ctrl/Alt combos to renderer IPC and
  handles F11/Esc (fullscreen), F12/Ctrl+Shift+I (DevTools), Ctrl+Shift+R (guest hard reload).
- **DRM/Widevine:** castLabs `components.whenReady()` before any EME; fire-and-forget init, 30 s
  timeout per attempt, 2 attempts; `mediaKeySystem` auto-allowed; status states "ready"/"failed: …"/
  "unavailable"/"dev mode — …". `widevine:retry` clears the CDM dirs + resets `Local State`
  updateclientdata (preserving the os_crypt key) and relaunches.
- **VMP signing** at build (`scripts/vmp-sign.js` afterPack); build aborts if the signer falls back to
  a dev/cached signature; `VEX_SKIP_VMP_VERIFY=1` to build without DRM. Valid DRM needs a real castLabs
  EVS signature (`python -m castlabs_evs.account reauth`).
- **Auto-updater:** electron-updater (autoDownload off, autoInstallOnAppQuit on). Startup uses a
  lightweight HTTPS fetch of `latest.yml` + semver compare (avoids spawning `7za.exe`/MSVC prompts).
- **Fingerprint farbling** (preload, opt-in): Mulberry32 PRNG seeded per session; ±1 LSB on ~5% of
  canvas pixels, WebGL vendor/renderer masking, audio ±tiny noise, hardwareConcurrency/deviceMemory→8.
  Config read synchronously before page scripts run.
- **DNS-over-HTTPS:** `secureDnsMode` off/secure(strict)/automatic(opportunistic); providers
  Cloudflare (default)/Google/Quad9.
- **Geolocation polyfill** in guests → asks main; coarsened to mode+lat+lng at 1 dp; IP fallback via
  ipapi.co then ipwho.is (50 km accuracy).
- **PiP injection:** `◉ PiP` button overlaid on every `<video>`; MutationObserver for late videos.
- **Mouse gestures, spellcheck replace, cred-submit capture** also flow through the webview preload.
- Cleanup on launch of legacy artifacts (old `memory/`, `gmail-creds.enc`, stale `Partitions/netflix`).

---

## 7. TABS SYSTEM

**Tab object:** `{id, url, title, favicon, loading, pinned, unread, groupId, stackId, sleeping,
originalUrl, scrollPosition, audible, muted, partition, _lazy, lastViewedAt}` (groupId XOR stackId).

- **Create/switch/close/duplicate/reopen**; closing saves to recently-closed (max 25; skips start
  pages, bulk ops, off-the-record) and auto-prunes empty groups/stacks; Ctrl+Shift+T reopens
  (restores into original group if it still exists).
- **Pin** (compact icons at top, no overflow scroll), **mute / mute-all-others**, audio badges
  (🔊/🔇) driven by media-started/paused events, **per-tab volume**.
- **Containers:** Work/Personal/Shopping with isolated cookie partitions (two accounts at once).
- **Off-the-record tab:** ephemeral partition, no history/recall, cookies gone on close.
- **Sleep/Wake:** captures scrollX/Y via executeJavaScript, tears down the webview to near-zero RAM;
  wake recreates + restores scroll. Can't sleep active/pinned. **Auto-sleep:** polls every 30 s,
  sleeps idle tabs after threshold (default 30 min), excludes pinned/audible by default.
- **Hibernation:** background tabs idle past `tabHibernateMinutes` (default 30; 0 disables) navigate to
  about:blank, reload on reactivation from a stored URL. Never hibernates active/audible/pinned/local.
- **Lazy restore:** on launch only the focused tab loads a webview; the rest are title+favicon
  placeholders, materialized on first click (~60% startup RAM cut).
- **Memory guard:** when total memory crosses the ceiling, sleeps least-recently-used background tabs
  until under (never active/pinned).
- **Drag-drop reorder** (vertical & horizontal), **tab previews** on ~800 ms hover (capturePage →
  280px thumb; skips sleeping/lazy), **horizontal vs vertical** layout toggle.

---

## 8. TAB GROUPS & TAB STACKS

- **Groups:** `{id, name, color, collapsed}`. Color stored as a **theme reference**, drawn from the
  active theme's palette (`--vex-accent`, `--vex-success`, …) so groups recolor live when you switch
  themes; new groups take the theme accent. Context menu: rename, change color, convert to stack
  (≥2 tabs), close all, ungroup (keep tabs), delete group+tabs. Empty groups not rendered.
- **AI auto-grouping:** proposes clusters via `groupTabs`; user reviews (expand/rename/toggle), can
  "remember patterns" (domains + keywords per group). New tabs (after 2.5 s title settle) auto-join a
  matching pattern locally (no AI per tab). Suggest banner at 12+ ungrouped, 30-min cooldown, rejected
  patterns cap 50. Undo last grouping supported. AI groups map onto theme palette and re-theme too.
- **Stacks** (Phase 4): `{id, name, color, topTabId}`. Mutually exclusive with groups, **always
  collapsed on disk** (expansion is ephemeral UI state, not persisted), deck-of-cards CSS, one header
  per stack. Convert group↔stack; auto-disband below 2 members; load-time prune of empties/orphans.

---

## 9. COMMAND BAR (Ctrl+K) — full action catalog (~110 commands)

Default (no query) shows the first ~8 (New Tab, Tour, Run Setup Wizard, Peek, Zap Element, Boost,
Read Later, Library). `>` prefix searches by id/label only. Literal URL/domain → "Go to …" + "Search …".

**Navigation/core:** New Tab, Close Tab, Reload, Hard Reload, Reopen Closed Tab, Browsing History,
Start Page, Focus URL Bar (Ctrl+L), Find in Page (Ctrl+F), Toggle Fullscreen (F11), Toggle Tabs
Sidebar (Ctrl+B), Zoom In/Out/Reset.

**Panels:** Settings, Notes, Downloads, History, Memory, Schedules, Bookmarks, RSS Feeds, Keyboard
Shortcuts, Recall (full-text), Highlights/Annotations, Library, Watched Pages.

**AI & agents:** Vex AI Panel (Ctrl+Shift+A), Ask Vex AI (Ctrl+J), Summarize Page, AI Translate,
Compare All Tabs, Summarize All Tabs, Explain Selection, Remember… (AI history search, Ctrl+Shift+H),
Re-index Open Tabs, Manage AI Personas, New Persona, AI: Remember a Fact, AI Memory, On-Device AI
(WebGPU), MCP Servers & Tools, AI Compose, AI Tab Command, Screenshot → Code.

**Tabs/groups:** Sleep Tab (Ctrl+Shift+Z), Sleep All Inactive, Wake All, Mute Tab (Ctrl+M), Mute All
Others, Pin/Unpin, Organize My Tabs (Ctrl+Shift+G), Undo Last Grouping.

**Sessions/workspaces:** Save Session, Load Session (Ctrl+Shift+O), Switch Workspace.

**Reading/media:** Reading Mode (Ctrl+Alt+R), Translate Page, Read Aloud, Bionic Reading, Speed Read
(RSVP), Translate Selection, Screenshot (Ctrl+Alt+S), Responsive Preview, Peek Current Page.

**Web utilities:** Zap Element, Boost This Site, Privacy Report, API Client, Format JSON, Watch This
Page, Save to / View Wayback, Pin Site to Sidebar.

**Content/library:** Read Later, Highlight (yellow/green/pink), Clip to Notes, Bookmark This Page,
QR Code for This Page.

**Focus/window:** Focus 25, Focus 50, Compact Mode, Split Screen (Ctrl+Shift+S), Picture-in-Picture
(Ctrl+Shift+P).

**Containers/privacy:** New Work/Personal/Shopping Container Tab, Off-the-Record Tab, Send to Phone,
Private Window (Ctrl+Shift+N).

**Service shortcuts / sites:** Claude, WhatsApp, Spotify, GitHub, Roblox Hub, YouTube, ChatGPT,
Gemini.

**Custom tools (examples shipped by the author):** FlashMind, LoopholeMap, AIJudge, NetMap,
BillForge, Resource Monitor.

**Meta:** Export All Data, Guide/Tour, Run Setup Wizard.

Plus dynamic entries: each AI Skill (`skill:<id>`), each Command Chain (`chain:<id>`), each custom
Tool, each pinned site.

---

## 10. KEYBOARD SHORTCUTS (defaults; all remappable via shortcuts-registry + editor)

| Combo | Action | Combo | Action |
|---|---|---|---|
| Ctrl+K | Command bar | Ctrl+Shift+S | Split screen |
| Ctrl+J | Ask Vex AI bar | Ctrl+Shift+P | Picture-in-picture |
| Ctrl+Shift+A | AI panel | Ctrl+Shift+N | Notes / Private window* |
| Ctrl+T / Ctrl+W | New / Close tab | Ctrl+Shift+M | Memory panel |
| Ctrl+Shift+T | Reopen closed tab | Ctrl+Shift+O | Sessions |
| Ctrl+R / Ctrl+Shift+R | Reload / Hard reload | Ctrl+Shift+L | Schedules |
| Ctrl+F | Find in page | Ctrl+Shift+Z | Sleep current tab |
| Ctrl+L | Focus URL bar | Ctrl+Shift+G | Organize tabs (AI) |
| Ctrl+H / Ctrl+Shift+H | History / AI history | Ctrl+Shift+Y | Theme picker |
| Ctrl+B | Toggle tabs sidebar | Ctrl+Alt+R | Reading mode |
| Ctrl+M | Mute tab | Ctrl+Alt+S | Screenshot |
| Ctrl+=/− / Ctrl+0 | Zoom in/out / reset | Ctrl+Alt+H | Boss key (hide+mute all) |
| Alt+←/→ | Back / Forward | F11 | Fullscreen |
| Ctrl+Alt+1/2/3 | Quick-slot command chains | F12 / Ctrl+Shift+I | DevTools |

\*Notes vs Private window are distinct bindings in different registries; verify in
`shortcuts-registry.js` before changing.

Shortcut registry: stored combos → handlers, conflict detection, per-id reset, `eventToShortcut`,
capture-phase listener (skips inputs unless modifiers/F-keys). Stored in `vex.userShortcuts`.

---

## 11. WORKSPACES & SESSIONS

- **Workspaces** (default 4): Personal (#d4a574), Work (#e2231a), School (#22c55e), Dev (#00b4d8).
  Each owns its own tabs/groups (shortcuts/tools reserved) + accent color (sets `--primary`).
  Switching saves current state, closes tabs, lazily restores the target's tabs, re-themes the chrome.
  One active at a time; add/rename/delete/color in a modal; min 1 workspace.
- **Named sessions:** snapshots `{id,name,createdAt,tabs[],groups[],activeTabIndex}`, max 50.
  Restore = full replace or merge; optional auto-save every 10 min ("Auto-saved <date>").

---

## 12. SCHEDULER (recurring AI tasks)

Task: `{id,enabled,name,description,frequency,time,daysOfWeek,dayOfMonth,customCron,startDate,prompt,
runMode:'auto',startingUrl,maxIterations:15,notifyOnComplete,notifyOnFail,lastRunAt,lastRunResult,
runCount}`. Frequencies: once/daily/weekly/monthly/**custom 5-field cron**. Polls every 60 s (first
check 5 s after startup), max 3 concurrent, skips already-running. On fire: opens startingUrl, waits
3 s, runs `AgentLoop.startHeadless(prompt,'auto',{maxIterations})`, records run to history (max 500),
optional OS Notification + toast. Built-in templates: GitHub Trending (daily 12:00), Weather (07:30),
News Briefing (09:00).

---

## 13. START PAGE (`vex://start`)

Widgets: live **clock**; **greeting** (uses `vex.userName`); **search bar** with **engine picker**
(Google, DuckDuckGo, Bing, Brave, Startpage, Ecosia — each with glyph/color); customizable
**quick-link shortcuts** (`vex.shortcuts`, add/rename/reorder/delete); **weather** (Open-Meteo, °C,
district-accurate geocoding, Turkish locale, 5-day forecast); **daily Qur'an verse** (Turkish/Diyanet,
cached, hidden offline); **GitHub widget** (public profile/repos via api.github.com, 5-min cache);
**name widget**; **Theme button** (opens the picker). Wallpaper from theme bg or
`vex.customThemeImage`. The start page is a separate webview origin; onboarding/settings push values
into its localStorage and reload it. URL-bar logic: full URL → navigate; domain-like → prepend https;
else search via engine. Ctrl/Alt+Enter opens result in a new tab.

---

## 14. THEMES (35 total) + customization

`oxford` (Oxford Editorial, default), `default` (Graphite), `midnight`, `forest`, `ocean`, `dracula`,
`nord`, `catppuccin`, `sunset`, `rose` (Rosé), `matrix`, `mocha`, `solarized`, `vaporwave`, `aurora`,
`crimson`, `gold`, `sakura`, `cyberpunk`, `monochrome`, `slate`, `emerald`, `amethyst`, `volcano`,
`sapphire`, `honey`, `mint`, `obsidian`, `ruby`, `lime`, `bronze`, `plum`, `arctic`, `wine`, and
`custom` (Custom Image). Each has an accent color and a live, **inline-styled CSS preview** (no image
files → can't go stale). **Favorites** (`vex.favThemes`) sort to a ★ section. **Custom color editor**
for accents; **Custom Image** uploads a downscaled wallpaper (≤1600px JPEG q0.82, readability scrim,
graphite-dark UI). Picker on Ctrl+Shift+Y or the start-page Theme button. Applied via `data-theme` on
`<html>` + CSS variables (`theme-tokens.css`); fires `theme-changed`; old `blackops` migrates →
`oxford`. **Glassmorphism**: 5-phase glass (chrome → sidebar → start page → modals → panels), depends
on transparent window + `backdrop-filter`; workspace accent tints content edges.

---

## 15. AI SUBSYSTEM

### Router (`ai-router.js`)
Per-feature backend selection across **cloud** (Cloudflare Worker → Claude), **local** (Ollama,
localhost:11434, 2 s ping, 30 s background re-check), **on-device** (WebGPU/WebLLM, chat-only).
Routable features & defaults: chat (auto), summarize (auto), translate (cloud), explain (auto),
historyIndex (local), historySearch (cloud), agent (cloud, **never** falls back to local), multiTab
(cloud), groupTabs (auto). Fallback to the inverse backend **except** when the user explicitly prefers
local (then no cloud fallback) and except agent. Cloud needs online + worker URL; local needs Ollama
ping. Structured features use tight JSON-schema prompts locally.

### Agent (`agent-loop.js` + `agent-executor.js`)
Tool-calling loop, **max 15 iterations** (configurable), modes **ask/auto/plan**. **19 built-in tools:**
navigate, new_tab, close_tab, go_back, go_forward, reload, click, type_text, select_option, scroll,
extract_elements, extract_text, screenshot, list_tabs, switch_tab, wait, search_in_page, finish,
ask_user. Safe (no prompt) tools: extract_elements/text, screenshot, list_tabs, scroll, wait,
search_in_page. Permission: ask prompts every non-safe tool; auto prompts only on `intent:'risky'`;
plan pre-approved. **MCP tools** appear as `mcp__<server>__<tool>` and route to McpClient. Robust
response parsing across field aliases (tool/toolName/action/function_name/name; parameters/params/
arguments/args), markdown-fence stripping. **Stall detection** (same URL+tool ×3 → summarize) and
**ToolCallHistory** (≥2 identical calls in last 5 → returns `loopPrevented` guidance; rolling buffer 20).

### Panel (`ai-panel.js`)
Quick actions: compare, summarize, translate, ask, group-tabs. Chat features: chat/summarize/translate/
explain with page-context injection. **Multi-tab** (`multiTab`, cloud): per-tab budget = min(8000,
60000/N) chars; response has perTab summaries + comparison table + recommendation. Persona switcher,
`@mention` to switch persona, 5 quick-prompts per persona, per-tab persona (`vex.activePersonaByTab`)
with global fallback. AI Memory injected as the first system message (additive). Response parsing:
fences → JSON → regex `reply` → plain text.

### Personas (5 built-in, forkable; custom in `vex.personas`)
- **Vex** ✨ (builtin_default, temp 0.7, auto) — general assistant.
- **Research Vex** 🔬 (temp 0.3, cloud) — citations, skepticism, evidence grading.
- **Code Reviewer Vex** 💻 (temp 0.2, cloud) — bugs→security→perf→readability→style.
- **Writing Coach Vex** ✍️ (temp 0.5, cloud) — biggest single improvement, concrete rewrites.
- **ELI5 Vex** 🎓 (temp 0.6, auto) — analogies, layered explanations.
Persona fields: id/name/description/icon/systemPrompt/temperature/preferredBackend/preferredModel/
tabContextDefault/responseFormat/suggestedFollowUps/quickPrompts(≤5). Update of a built-in forks a
custom copy. Export/import, @mention fuzzy match (3-level).

### On-device (WebLLM, `webllm.js`)
Models: Llama-3.2-1B (~0.9 GB), Qwen2.5-1.5B (~1.0 GB), Llama-3.2-3B (~1.8 GB), Phi-3.5-mini (~2.2 GB).
CDN `esm.run/@mlc-ai/web-llm`, WebGPU feature-detected, weights cached by browser. chat() plain-text,
800 tokens, temp 0.6, 120 s timeout → fallback. `vex.webllmModel`, `vex.preferOnDeviceAI`.

### Ollama (`ollama.js`)
localhost:11434; ping `/api/tags` (2 s); list/generate/chat/pullModel; `format:'json'` for structured;
recommended models llama3.2:3b, qwen2.5:3b, llama3.2:8b, gemma2:2b.

### MCP client (`mcp-client.js`)
Protocol `2025-06-18`, JSON-RPC 2.0 over HTTP, session id from `Mcp-Session-Id` header, optional bearer.
initialize → notifications/initialized → tools/list → tools/call. CORS-free via `api:request`. Explorer
UI (pick tool, JSON args skeleton from inputSchema, run, inline result). Agent integration via
`agentToolDefs()`/`agentCall()`. Servers in `vex.mcpServers`.

### Other AI features
- **AI Memory** (`ai-memory.js`): up to 100 facts ≤400 chars, dedup, injected as first system message,
  works local+cloud, syncs.
- **Skills** (`skills.js`): 5 defaults (Summarize in 5 bullets 📌, Explain like I'm 5 🧒, Extract action
  items ✅, Draft a reply ✍️, Find the weak points 🔍) + custom; registered as `skill:<id>` commands.
- **Screenshot → Code** (`screenshot-to-code.js`): capturePage→1200px→worker `screenshot-to-code`;
  output Plain HTML+CSS / HTML+Tailwind / React CDN; preview-in-tab or copy.
- **Recall / history-indexer:** Recall indexes readable page text locally (min 200 chars, ≤16 000;
  skips file/OTR/start/search-engine pages) → `recall.json`; History Indexer summarizes visited pages
  via `historyIndex` (throttled 1/5 s, queue ≤20) writing summary/tags/contentType back to history.
- **DOM extractor:** interactive elements (a/button/input/textarea/select/[role]/[onclick]/[tabindex])
  with stable `[data-vex-id]` selectors, visibility, value, options; ≤100 elements.
- **Page context / multi-tab context:** cleaned main-content text (≤30 000 chars), headings, lang,
  word count; multi-tab budget 60 000 chars total.
- **AI Compose** (`compose-chains.js`): rewrites focused input or copies result. **Command Chains**:
  sequential command runs (350 ms apart), `chain:<id>`, quick-slots Ctrl+Alt+1/2/3.
- **Tab AI commands** (`tab-ai-media.js`): NL over tabs → strict JSON {close, groups, explanation} +
  confirm. **Now Playing** bar. **Resource Monitor** modal (live CPU/mem per process).
- **Ask AI bar** (Ctrl+J): quick prompt that pipes into the full AI panel logic.

---

## 16. PRIVACY & SECURITY

- **Ad/tracker blocker:** Ghostery EasyList+EasyPrivacy engine (cached `.bin`) ORed with a 52-entry
  legacy list; per-partition; never blocks main-frame navigations; tallies blocks + per-site presence.
  Toggle `vex.adblocking`.
- **Privacy Report:** blocked totals, top blocked hosts (25), **cross-site trackers** (top 12 by reach
  with the site list — "following you across sites"), fingerprint + DoH status, reset counters.
- **Fingerprint farbling** (opt-in) and **DNS-over-HTTPS** (off/opportunistic/strict; CF/Google/Quad9)
  — see §6. Config in `privacy.json`.
- **Passwords** (`passwords.js` + `vault.dat`): offers to save on login submit (20 s card), autofill on
  matching sites (dispatches input/change events), never-save list `vex.pwNever`, copy auto-clears
  clipboard after 30 s, DPAPI/safeStorage at rest, plaintext only crosses IPC on fill/copy.
- **Permissions** (`permission-prompts.js`): geolocation/media/camera/microphone/notifications/midi/
  midiSysex/mediaKeySystem(DRM, auto-allowed)/display-capture; one prompt at a time, remember checkbox,
  per-site allow/deny in `permissions.json`, list/revoke/clear in settings.
- **Location** (`location-settings.js`): off / manual (recommended, `{latitude,longitude,label}`) / ip;
  preset cities (NY, London, Berlin, Istanbul, Tokyo, Sydney); one-click IP fill; coarsened to ~11 km.
- **First-party favicons** (no Google leak), **cookie/consent auto-hide** (CSS-only, CMP selector list,
  scroll-unlock only when a consent element exists, MutationObserver for late banners).
- **WebHID** chooser (`hid-picker.js`) with persistent per-origin device grants.

---

## 17. READING & ACCESSIBILITY

- **Reading mode** (`reading-mode.js`): extracts article/main → cream Georgia 19px/1.8, max-width 700,
  word count + read time (÷250 wpm), exit restores original URL.
- **Highlights/annotations** (`annotations.js`): colors yellow/green/pink/blue, stored per normalized
  URL in `vex.annotations`, re-applied on revisit via `<mark class="vexhl">`, per-highlight notes,
  Highlights panel grouped by page with count badge.
- **Accessibility pack** (`accessibility.js`, `vex.a11y`): dyslexia fonts Off/Lexend/Atkinson
  Hyperlegible/OpenDyslexic; CVD filters protan/deuter/tritanopia/grayscale (feColorMatrix); reading
  ruler (38px, follows cursor); **Bionic Reading** (bold ~42% of each word, ≤4000 nodes);
  **RSVP speed read** 150–900 wpm (default 400); **Read Aloud** (SpeechSynthesis, rate 1.05);
  **Translate Selection** (≤400 chars via `translate:text`).
- **Translate** (`translate.js`): page translate via Google Translate, target in `vex.translateLang`,
  languages EN/TR/ES/FR/DE/AR/zh-CN/JA/KO/PT/RU.
- **Per-domain zoom** (`vex.zooms`) and **per-site dark mode** (`vex.forceDarkHosts`, right-click).

---

## 18. PRODUCTIVITY & UTILITIES

- **Notes** (`notes-panel.js`, `vex.notes`): markdown (h1–3, bold/italic/code/lists) preview, pin,
  search, word count, export `.md`, 1 s debounced autosave; **Clip to Notes** appends to a "Clippings"
  note with source + date.
- **Read Later / Library** (`readlater.js`): queue `vex.readLater` with unread badge (mark read on
  open); **auto-archive** untouched tabs after N days (`vex.autoArchiveDays`, checks every 30 min,
  keep ≤200; never pinned/active/local) into `vex.archivedTabs`.
- **Bookmarks** (`bookmarks.js`, `vex.bookmarks`): ☆ in URL bar, folders, search, panel.
- **RSS Feeds** (`rss.js`, `vex.feeds`): RSS 2.0 + Atom via `rss:fetch`, merged newest-first cap 120.
- **Downloads** (`downloads-panel.js`, `vex.downloads` max 100): live progress rows, open/show/remove,
  badge for in-progress, clear finished, toast + DownloadToast on complete.
- **History** (`history-panel.js`): keyword search + date filters (today/yesterday/7/30/all), grouped
  by date, optional AI search mode (relevance % + interpretation), relative timestamps.
- **Focus mode** (`focus-mode.js`): Focus 25/50 hides chrome + blocks `vex.focusBlocklist`
  (default youtube/tiktok/instagram/x/twitter/reddit); **Compact mode** collapses both sidebars.
- **Gestures** (`gestures.js`, `vex.gesturesEnabled`): ←back, →forward, ↑top, ↓reload, ↓→close, ↓←reopen.
- **Web monitor** (`web-monitor.js`, `vex.watches`): periodic refetch + 32-bit text hash diff →
  changed flag + optional OS notification; manager modal; **Wayback** save/view.
- **Screenshots** (`screenshot.js`): capturePage → preview (save/copy/annotate); annotation editor
  pen/rect/arrow, color, 25-frame undo; saves `vex-screenshot-<ISO>.png` / annotated variant.
- **Dev tools pack** (`devtools-pack.js`): **API client** (GET/POST/PUT/PATCH/DELETE/HEAD, headers/body,
  CORS-free, JSON tree, status/time/size); **Format JSON**; **Responsive Preview** (iPhone SE/14, iPad,
  Laptop 1280, Desktop 1440 side-by-side, reload-all).
- **Boosts** (`boosts.js`, `vex.boosts` per host): **Zap Element** (pick → hide forever via stored
  selector), **custom CSS** (`<style id="vex-boost-style">`), **custom JS** (try/catch at dom-ready).
- **QR code** (Ctrl+K), **reverse image search** (right-click), **page extras** (Read Aloud, consent
  auto-hide).

---

## 19. SIDEBAR PANELS

Built-in (no webview): settings, roblox, github, notes, downloads, history, memory, shortcuts,
schedules, queue, bookmarks, feeds, library, annotations, recall. Web panels (isolated partitions):
**WhatsApp** (web.whatsapp.com), **Claude** (claude.ai), **Spotify** (open.spotify.com). Plus
**pinned sites** (`vex.sitePanels`, Vivaldi-style, any HTTPS). **Every button** is right-click
customizable (Rename, Change icon from ~20 preset SVGs, Change link for web buttons + service switch
Claude/Gemini/ChatGPT, Refresh, Open DevTools, Hide, Reset) and reorderable; master list in
**Settings → Sidebar Buttons** restores hidden ones. `vex.panelOverrides`, `vex.sidebarOrder`.

- **GitHub panel:** profile card (avatar/bio/followers/repos), 10 recent repos with language-color
  dots, 5-min cache, `vex.githubUsername`.
- **Roblox hub:** quick grid (Home/Games/Friends/Trade/Catalog/Groups) + Open Roblox / Launch Studio.
- **Queue panel:** self-hosted task queue (`sidebar-config.json` queueUrl/queueSecret), GET queue /
  POST done / DELETE item, 60 s auto-refresh while visible.
- **Tools / My Tools** (`tools.js`, `vex.tools`): user-added web tools (name/url/desc/icon/favicon),
  drag-reorder, right-click edit/remove; "AI News" injected from `sidebar-config.json` aiNewsUrl.
  The author ships custom tools (FlashMind, LoopholeMap, AIJudge, NetMap, BillForge).
- **Memory panel:** per-tab RAM estimate (active ~150 / inactive ~80 / sleeping ~1 MB), color-coded,
  bulk sleep/reload, per-tab actions, 3 s refresh.
- **Schedules / Shortcuts panels:** task management + a read-only shortcut reference.

---

## 20. SYNC (optional, end-to-end encrypted)

**What syncs** (`SYNC_KEYS`): tabs, sessions, workspaces, shortcuts, tools, notes, history, theme,
settings, schedules, groups, agentMode, aiIndexingEnabled, customCommands, zooms, forceDarkSites,
autosleep(+minutes/excludePinned), aiRouting, preferLocalAI, forceCloudAI, personas, activePersona,
aiMemory, autoGroupSuggest, autoAddToGroups, groupPatterns, userShortcuts, tabLayout. **Not synced:**
passwords (OS keychain), cookies/logins, AI chat history, local model choice, per-tab personas.

**Crypto:** AES-GCM-256, 12-byte random IV per encrypt, key generated on-device and **never sent**;
exported to 64-hex → recovery code `XXXXXXXX-XXXXXXXX-…` (8-char groups). Server stores **ciphertext
only**.

**Auth:** email → 6-digit code (TTL 10 min) → session token (TTL 1 yr) + deviceId + emailHash.
Recovery-code enroll restores the key on a new device (cloud is authoritative on first pull).
**Auto-sync:** push every 2 min, pull every 5 min; manual push/pull anytime. **Handoff / Send to
Phone:** "drop" mailbox (≤20 items, 7-day TTL) — send open tab to other devices; they poll and offer
to open. Device list + revoke + wipe-all-cloud in Settings.

---

## 21. ONBOARDING WIZARD & TOUR

**Wizard** (`onboarding.js`) — shown only on a genuinely fresh install; resumable (shows only
unconfigured steps, pre-fills saved values tagged "✓ already set"); re-runnable from the top bar.
**13 steps:** Welcome → Theme → Name → Weather (district geocoding, ≤5 matches) → GitHub → Search
engine → Make Vex default → Cloud AI (worker URL) → Local AI (Ollama detect) → On-device AI (WebGPU
download) → Vex Sync (worker URL) → Password (seed one login) → Done. Each AI backend judged
independently; configuring any one clears all three AI steps. Every step skippable + "Skip setup."

**Tour** (`tour.js`) — 11-step spotlight (Welcome, Address bar, Back/Forward/Reload, Vertical tabs,
New tab, Workspaces, Sidebar panels, Command bar, AI assistant & agent, Split/PiP/extras, You're all
set), adaptive (skips missing targets), Back/Next/Skip + arrows/Esc, `vex.tourSeen`.

**Update notifier** (`update-notifier.js`): checks ~4 s after launch; if newer, shows a Download card
(opens installer) → progress → "Restart to apply"; manual check toasts latest/error.

---

## 22. EXTENSIONS

Chrome extension support (`extensions-settings.js` + main loader, adm-zip): install from **unpacked
folder** or **.zip/.crx** (CRX v2/v3 header stripping, zip-slip-safe), list (name/version/desc/folder),
uninstall (needs restart to unload from live tabs), open folder. In-app guidance points to crxextractor
for Web Store and GitHub source; MV3 works best. Loaded into every session.

---

## 23. CLOUDFLARE WORKERS (self-hosted backends)

### AI worker (`workers/vex-ai-worker`)
Proxies to **OpenRouter**, model **`anthropic/claude-sonnet-4`** (Bearer `OPENROUTER_API_KEY`).
Actions (max tokens): **chat** (4000), **summarize** (4000), **translate** (4000), **explain** (4000),
**agent** (2000, pure JSON one-tool-per-call), **multi-tab-chat** (4000), **screenshot-to-code** (6000,
vision; framework html/tailwind/react), **summarize-for-history** (500), **search-history** (2000, ≤200
entries), **group-tabs** (2500, temp 0.3). **Rate limits per IP:** 30/min (TTL 60 s) + 1000/day (TTL
86 400), key `rl:{ip}:{window}:{bucket}`, **fails open** if KV unbound. KV: `VEX_AI_KV`. CORS `*`,
POST/OPTIONS, payload ≤4 MB. Client IP via `CF-Connecting-IP`.

### Sync worker (`workers/vex-sync-worker`)
Endpoints: `POST /auth/request-code`, `POST /auth/verify-code`, `POST /sync/push`, `GET /sync/pull`,
`GET /sync/devices`, `DELETE /sync/devices/:id`, `DELETE /sync/all`, `POST /sync/drop`, `GET /sync/drop`.
Auth: 6-digit secure code (TTL 10 min, email SHA-256 hashed); rate limits — code issuance 3/email/15 min
+ 10/IP/15 min; verify 30/IP/10 min + 5 failed attempts burns the code; constant-time compare; session
TTL 1 yr. Stores **ciphertext blob only** (`blob:{emailHash}`, ≤5 MB) + device registry + drop mailbox
(≤20, 7-day TTL). Email via **Resend** (`RESEND_API_KEY`) or dev fallback (code in response / wrangler
tail). KV: `VEX_SYNC_KV` + `VEX_AUTH_KV`. CORS `*`, GET/POST/DELETE/OPTIONS.

Both are optional; unconfigured → AI falls back to Ollama, Sync stays off, GitHub/greeting show hints.
`sidebar-config.json` adds AI News + Queue.

---

## 24. SETTINGS CATALOG (27 categories)

General (search engine) · Browser (set default) · Appearance (accent chips, tabs sidebar, theme
picker) · Privacy & Security (adblock, clear data, fingerprint farbling, DoH, tracker report) ·
Performance (auto-sleep + minutes + exclude-pinned, memory-guard ceiling) · Sessions (auto-save,
manage) · Workspaces (manage) · Location (off/manual/ip) · Sync (email auth, devices, recovery,
danger zone) · AI Backend (Auto/Prefer-local/Force-cloud, Ollama status + model + refresh + install
guide, per-feature routing grid) · Personas · AI Memory · On-Device AI (model + download) · MCP
Servers · Skills · Boosts · Passwords · Focus (blocklist) · Library (auto-archive) · Reading &
Accessibility (fonts/CVD/ruler) · Recall (toggle + clear) · Command Chains · Browsing Extras
(gestures, consent auto-hide) + AI history indexing · Extensions (install zip/folder, list, uninstall)
· Permissions · Data (export all, reset to defaults) · About (version, check updates, Electron/
Chromium/Node/Widevine versions, links). Plus **Personalization** (name, GitHub, weather, theme) and
**Cloud Services** (AI/Sync worker URLs). Live **search-in-settings** filters groups and hides chips.

---

## 25. BUILD, RELEASE & SELF-HOSTING

- **Dev:** `npm install && npm start` (`electron .`). **Tests:** `npm test` (vitest).
- **Build:** `npm run dist` → build-icons (sharp → electron-icon-builder → finalize) → `rimraf dist`
  → electron-builder → NSIS `Vex-Setup.exe` (per-user, desktop+start-menu shortcuts) → afterPack VMP
  signing (build aborts on dev/cached signature). Auto-update via electron-updater (full installs).
- **Self-host workers:** see §23 and `SELF_HOSTING.md` (wrangler KV namespaces + secrets). Free-tier
  friendly; nothing points at anyone else's backend.

---

## 26. MODULE MAP

**Main:** `main.js` (entry, window, sessions, IPC, extensions, updater, global shortcuts, DRM) ·
`main-helpers.js` (external-protocol allowlist, argv normalization, fullscreen decider, safeJoin/
safeName/safePipUrl/coarsenLocation) · `adblocker.js` + `adblocker-engine.js` · `pip.js` ·
`preload.js` · `preload-webview.js` · `sidebar-config.js`.

**Renderer core:** app, tabs, horizontal-tabs, webview, sidebar, command, storage, shortcuts-registry,
shortcut-editor, scheduler, sessions, workspaces, split, peek, tab-grouper, tab-preview, tab-selector,
smart-searchbar.

**Renderer AI:** ai-router, ai-panel, ai-settings, ai-memory, agent-loop, agent-executor, dom-extractor,
page-context, multi-tab-context, history-indexer, personas-builtin/manager/settings, ollama, webllm,
mcp-client, screenshot-to-code, skills, recall, ask-ai-bar, compose-chains, tab-ai-media.

**Renderer panels/utilities:** history/notes/downloads/memory/schedules/shortcuts/github/roblox/queue
panels; extensions/permissions/location/ai/personas/sync settings; bookmarks, rss, readlater,
annotations, boosts, focus-mode, gestures, privacy-pack, devtools-pack, page-extras, accessibility,
reading-mode, translate, screenshot, theme-manager, theme-picker, start, tools, onboarding, tour,
update-notifier, permission-prompts, passwords, web-monitor, sync-crypto, sync-engine, hid-picker,
vex-config, settings-ui.

**Docs in repo:** `docs/ARCHITECTURE.md`, `docs/security-audit-2026-04.md`, `docs/test-gap-report.md`,
`docs/PHASE-4-TAB-STACKS-PLAN.md`, `SELF_HOSTING.md`, `CHANGELOG.md`.

---

## 27. KNOWN ISSUES / TECH DEBT (good upgrade targets)

- Legacy `adblocker.js` `shouldBlock` had a substring-match issue (audit M-1); legacy list still ORed in.
- `__vexGeoBridge` exposed to all origins in webviews (audit M-3).
- Transparent/frameless window makes `isFullScreen()` unreliable (manual tracking).
- Auto-updater uses **full installs** (no differential packages).
- ThirdPartyStoragePartitioning disabled globally (trade-off for federated logins).
- Test coverage is thin (pure functions only; UI/integration largely untested).
- Search-engine sets differ between start page (6) and some settings paths (3–4) — worth unifying.
- Several reserved-but-unused fields (workspace shortcuts/tools).

---

## 28. DESIGN PHILOSOPHY (lens for judging ideas)

1. **Privacy by default** — block trackers, leak nothing to third parties, local-first, E2E for sync,
   opt-in for anything that phones home.
2. **Fast & light** — sleep/hibernate/lazy-restore, tiny deps, no framework.
3. **Minimal, single-window, glass** — chrome out of the way; one window, many webviews.
4. **"Built just for you"** — sidebar, themes (35), shortcuts, workspaces, personas, boosts, skills,
   chains, custom tools.
5. **Graceful degradation** — offline-first; cloud optional & self-hosted; no hard backend deps.
6. **Solo, fast iteration** — small shippable changes, frequent releases, auto-update.

When proposing upgrades: maximize impact-to-effort, never compromise 1–3, prefer no-backend solutions,
slot cleanly into the module map, and name any new storage keys / IPC channels / worker actions.
