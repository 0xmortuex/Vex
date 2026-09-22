# Vex on Android — what carries over, and what does not

Vex is an Electron 42 (castLabs) desktop browser: 56 main-process modules,
252 renderer modules, ~5 MB of chrome JavaScript, and a feature list that
leans hard on having a real operating system underneath. This document is the
honest accounting of what a Capacitor + Android WebView shell can and cannot
reproduce, written against the code in `src/` as of v2.32.79.

Read the four blockers first. They are the reasons a mobile Vex is a sibling
of the desktop browser and not the same browser on a smaller screen.

---

## The four blockers

**1. Widevine DRM does not come with you.**
The desktop build exists in its current form because castLabs Electron ships a
VMP-signed Widevine CDM, which is why Netflix, Prime and Disney+ play. Android
System WebView has EME, but the major streaming services gate playback on an
allow-list of applications and on Widevine L1 provisioning that a third-party
WebView app does not get. Assume Netflix-class DRM does not work, and that
"real streaming" is a desktop-only headline. Spotify Web and YouTube (Widevine
L3 / clear) are the realistic ceiling — and Spotify's web player is itself DRM.

**2. There are no extensions.**
`src/main/extensions.js`, `extension-audit.js`, `extensions-menu.js`,
`extension-catalog.js` and the Vencord tooling all depend on Chromium's
extension system. Android WebView has no extension support of any kind and no
plan for one. Everything the extension layer provides has to be rebuilt as a
native feature or dropped. The ad blocker in this scaffold is the first
example: it is a re-implementation, not a port.

**3. No child processes, so no Tor and no ByeDPI as they exist today.**
`tor-launcher.js` and `byedpi.js` start bundled Windows executables and point
the session's proxy at them. Android has no equivalent: an app cannot exec a
binary from its data directory on a modern device. Tor would have to come back
as an embedded library (Arti, or Orbot's `tor-android` AAR with a VpnService),
and ByeDPI would have to be cross-compiled to a JNI library. Both are real
projects in their own right, not porting work.

**4. On-device AI is off the table; cloud AI is not.**
`@mlc-ai/web-llm` needs WebGPU, which Android WebView does not expose.
`ollama-launcher.js` starts a local server — see blocker 3. The Claude-worker
path (`workers/`) is plain HTTPS and works unchanged, so the AI assistant can
come to mobile as long as it is the cloud one.

---

## What this scaffold already does

```
mobile/
  www/                     the chrome, plain scripts like src/renderer
    index.html             toolbar, omnibox, tab grid, sheets, panels
    js/bridge.js           window.VexBridge — the mobile answer to window.vex
    js/tabs.js             tab model (VexTabStore)
    js/adblock.js          filter lists, parsing, refresh
    js/panels.js           history, bookmarks, downloads, settings
    js/ui.js               chrome behaviour, content-rect geometry
  android/
    …/MainActivity.java    plugin registration, file chooser, browser intents
    …/tabs/VexTabsPlugin   creates/positions/destroys page WebViews
    …/tabs/TabWebView      one tab: settings, clients, downloads, find, snapshot
    …/tabs/EdgeSwipeLayout back/forward edge gestures over the page
    …/block/BlockEngine    request blocking inside shouldInterceptRequest
    …/block/VexBlockPlugin the JS control surface for it
```

Working today: tabs and a tab switcher with live snapshots, private tabs,
omnibox with history/bookmark suggestions, per-site and global ad/tracker
blocking with cosmetic filtering, find in page, desktop-site toggle, dark
pages, text zoom, downloads through DownloadManager, bookmarks, history,
session restore, Android back/gesture handling, share and open-from-other-app
intents, file uploads, fullscreen video, third-party cookies off by default,
HTTPS upgrade, DNT/Sec-GPC headers, and SSL errors that refuse rather than
offer a "proceed anyway".

---

## Feature-by-feature

Legend: **✅ ported** here · **🟡 portable** with ordinary work · **🔧 native
rewrite** needed (weeks, new subsystem) · **❌ not possible** in a WebView app.

### Browsing core
| Desktop | Status | Note |
|---|---|---|
| Tabs, tab switching | ✅ | `VexTabsPlugin` + `www/js/tabs.js` |
| Tab groups, auto-grouping (`tab-grouper.js`) | 🟡 | Model ports; the phone UI for it has to be designed |
| Tab sleep / hibernate / Tab Health | 🟡 | Android already freezes background WebViews; the ceiling logic (`memory-baseline.js`) needs Android memory APIs |
| Vertical tabs, split screen, layout editor | ❌ | Phone-shaped; replaced by the tab grid |
| Sidebar apps (`sidebar.js`) | 🟡 | Each app is a partitioned webview — doable as extra tabs on their own profile, but a sidebar is not a phone pattern |
| Find in page | ✅ | `WebView.findAllAsync` |
| Reading list, peek, linked scroll | 🟡 | Pure chrome features |
| Picture-in-picture (`pip.js`) | 🔧 | Android PiP is an Activity mode, nothing like the desktop implementation |

### Privacy and network
| Desktop | Status | Note |
|---|---|---|
| Ad + tracker blocking (`@ghostery/adblocker-electron`) | ✅ partial | Rewritten as `BlockEngine`: host rules, substring rules, `$third-party`, `$domain=`, `@@` exceptions, `##` cosmetic. Missing: regex rules, `$csp`, `$redirect`, `$removeparam`, `#@#`, generichide |
| Cosmetic filtering | ✅ partial | Injected at page start/finish; should move to `WebViewCompat.addDocumentStartJavaScript` so it lands before first paint |
| Fingerprint protection | 🔧 | Needs document-start script injection (same API) to shim canvas/WebGL/audio — the desktop version patches the guest at preload time |
| HTTPS-only | ✅ | Upgrade in `shouldOverrideUrlLoading` |
| DNS-over-HTTPS | ❌ | WebView uses the system resolver. Android's own Private DNS is the only lever, and it is a system setting |
| Tor routing, ByeDPI bypass | 🔧 | See blocker 3 |
| Proxy / container routing (`routing.js`, `container-routing.js`) | 🟡 | `Proxy.setProxyOverride` in androidx.webkit is process-wide, not per tab — per-container routing does not survive |
| Private tabs | ✅ partial | Own profile on WebView 116+ (`MULTI_PROFILE`); older devices share the cookie jar and only get "nothing written to Vex's history" |
| Per-site rules (`site-rules.js`) | 🟡 | JS off per site needs a settings flip plus reload, which WebView supports |
| Password vault, 2FA, email-code autofill | 🔧 | `safeStorage` becomes Android Keystore; autofill has to go through the Android Autofill Service or document-start injection |

### Content and media
| Desktop | Status | Note |
|---|---|---|
| Widevine streaming | ❌ | Blocker 1 |
| Codec fallbacks | 🟡 | Whatever the device's WebView ships; no swapping in your own |
| Downloads + rules (`downloads.js`, `download-rules.js`) | ✅ basic | DownloadManager handles the transfer; the renaming/foldering rules are not ported |
| Save page as PDF / single file (`page-save.js`) | 🟡 | `PrintManager` gives PDF; single-file save needs its own implementation |
| Full-page capture (`full-page-capture.js`) | 🟡 | Scroll-and-stitch in the native layer |
| EPUB reader, PDF text extraction | 🟡 | Pure JS in `src/main`, runs anywhere |
| Screen recording, clips (`recordings.js`, `clips.js`) | ❌ | Desktop capture APIs; Android has MediaProjection but it is a different feature |

### Assistant and data
| Desktop | Status | Note |
|---|---|---|
| Cloud AI agent (Claude worker) | 🟡 | HTTPS only — the biggest single win available after the browsing core |
| Local AI (Ollama, WebGPU) | ❌ | Blocker 4 |
| Agent acting on tabs (`agent-tools.js`) | 🟡 | Needs `evaluate` per tab, which the plugin already exposes |
| Recall full-text index (`recall-index.js`) | 🟡 | Plain JS; storage moves to SQLite or the filesystem |
| History, bookmarks, sessions | ✅ basic | Same record shapes, stored via Preferences. A phone with 3,000 history rows wants SQLite, not SharedPreferences |
| Encrypted sync | 🟡 | Network code is portable; key storage moves to Keystore |
| Mail panel (IMAP), reminders, calendar | 🔧 | `imapflow` is Node — needs a Java IMAP client or a server-side relay |

### Chrome and platform
| Desktop | Status | Note |
|---|---|---|
| Themes, skins, fonts | 🟡 | Tokens already copied; the rest is CSS |
| Toolbar/sidebar rearranging | ❌ | Four controls fit on a phone toolbar; there is nothing to rearrange |
| Command bar (Ctrl+K), keyboard shortcuts | ❌ | No keyboard; the menu sheet is the mobile answer |
| Auto-update (`electron-updater`) | 🔧 | Play Store, or an APK update check of your own |
| Crash log, safe mode, smoke harness | 🟡 | Worth rebuilding: `restart-smoke.js` has an Android analogue in instrumented tests |
| DevTools | 🟡 | `chrome://inspect` from a desktop Chrome, with `setWebContentsDebuggingEnabled` |

---

## Build and verification status

Written and checked here:

- `node --check` on every chrome script, plus `npm run check` (`scripts/check-www.js`),
  which also asserts that every plugin the bridge calls is declared by a
  `@CapacitorPlugin` in the Java tree.
- The chrome booted in Chromium at Pixel 7 size through its iframe fallback:
  omnibox → navigate, menu sheet, new tab, tab grid (2 cards), private tab,
  bookmarks panel, settings panel, find bar, and Android back handling all
  behaved. No page errors.

Not verified here, and it matters:

- **Nothing Java has been compiled.** This environment has a JDK but no Android
  SDK and no access to Google's Maven, so `gradlew assembleDebug` has never
  run against this code. Expect to fix compile errors on the first build.
- The androidx.webkit multi-profile calls are made by reflection precisely
  because that API's shape could not be checked here; a wrong guess degrades
  to "no private profile" instead of failing the build.
- No device testing at all: geometry (the content rect vs. the keyboard and
  the gesture insets) is exactly the sort of thing that only a real phone
  settles.

## Suggested order of work

1. **Get it building and on a device.** `npm i && npx cap sync android`, fix
   the first round of compile errors, confirm the content rect tracks the
   keyboard.
2. **Document-start injection.** Move cosmetic filtering to
   `WebViewCompat.addDocumentStartJavaScript`, then reuse the same hook for
   fingerprint shims. This one API carries two desktop features.
3. **Storage that scales.** Move history and Recall off Preferences onto
   SQLite before the history panel is the slowest screen in the app.
4. **The cloud assistant.** The worker protocol is unchanged; this is the
   feature that makes mobile Vex feel like Vex.
5. **Sync.** Once storage is real, the desktop's encrypted sync gives the phone
   the same bookmarks and tabs.
6. Only then consider Tor/ByeDPI as an embedded library, knowing the size of it.
