# Vex on Android — what carries over, and what does not

Vex is an Electron 42 (castLabs) desktop browser: 56 main-process modules,
252 renderer modules, ~5 MB of chrome JavaScript, and a feature list that leans
hard on having a real operating system underneath. This is the honest
accounting of what a Capacitor + Android WebView shell can reproduce, written
against `src/` as of v2.32.79.

Read the four blockers first. They are why a mobile Vex is a sibling of the
desktop browser rather than the same browser on a smaller screen.

---

## The four blockers

**1. Widevine DRM does not come with you.**
The desktop build exists in its current form because castLabs Electron ships a
VMP-signed Widevine CDM, which is why Netflix, Prime and Disney+ play. Android
System WebView has EME, but the major streaming services gate playback on an
allow-list of applications and on Widevine L1 provisioning a third-party
WebView app does not get. Assume Netflix-class DRM does not work, and that
"real streaming" is a desktop-only headline.

**2. There are no extensions.**
`src/main/extensions.js`, `extension-audit.js`, `extensions-menu.js`,
`extension-catalog.js` and the Vencord tooling all depend on Chromium's
extension system. Android WebView has no extension support and no plan for one.
Everything the extension layer provides has to be rebuilt natively or dropped.
The ad blocker here is the first example: a re-implementation, not a port.

**3. No child processes, so no Tor and no ByeDPI as they exist today.**
`tor-launcher.js` and `byedpi.js` start bundled Windows executables and point
the session's proxy at them. An Android app cannot exec a binary from its data
directory on a modern device. Tor would have to return as an embedded library
(Arti, or Orbot's `tor-android` AAR with a VpnService) and ByeDPI as a
cross-compiled JNI library. Both are projects in their own right.

**4. On-device AI is out; cloud AI is in.**
`@mlc-ai/web-llm` needs WebGPU, which Android WebView does not expose.
`ollama-launcher.js` starts a local server — see blocker 3. The Claude-worker
path (`workers/`) is plain HTTPS and is shipped here unchanged, so the
assistant is the cloud one.

---

## Feature by feature

Legend: **✅ done** here · **🟡 portable** with ordinary work · **🔧 native
rewrite** needed (weeks, new subsystem) · **❌ not possible** in a WebView app.

### Browsing core
| Desktop | Status | Note |
|---|---|---|
| Tabs, tab switching | ✅ | Snapshot grid, tab search, long-press actions |
| Private tabs | ✅ | Own WebView profile on WebView 116+; older devices share the cookie jar and only get "nothing written to history" |
| Session restore | ✅ | Tabs, the front tab, and scroll position |
| Find in page | ✅ | `WebView.findAllAsync` |
| Reader | ✅ | Extraction runs in the page; rendered as text nodes in the chrome's own type |
| Print / save as PDF | ✅ | The system print dialog, which is also Android's Save-as-PDF |
| Downloads | ✅ basic | DownloadManager; the desktop's rename/foldering rules are not ported |
| Long-press link and image menus | ✅ | `HitTestResult` → a bottom sheet |
| Edge-swipe back/forward | ✅ | Detected natively; page touches never reach the chrome |
| Tab groups, auto-grouping | 🟡 | The model ports; the phone UI for it has to be designed |
| Tab sleep / hibernate / Tab Health | 🟡 | Android already freezes background WebViews; the ceiling logic needs Android memory APIs |
| Vertical tabs, split screen, layout editor | ❌ | Phone-shaped; the tab grid replaces them |
| Sidebar apps | 🟡 | Each is a partitioned webview — possible as tabs on their own profile, but a sidebar is not a phone pattern |
| Picture-in-picture | 🔧 | Android PiP is an Activity mode, nothing like the desktop one |

### Privacy and network
| Desktop | Status | Note |
|---|---|---|
| Ad + tracker blocking | ✅ partial | Rewritten as `BlockEngine`: host rules, substring rules, `$third-party`, `$domain=`, `@@` exceptions, `##` cosmetic. Missing: regex rules, `$csp`, `$redirect`, `$removeparam`, `#@#`, generichide |
| Cosmetic filtering | ✅ | Injected at page start; a document-start hook would land it before first paint |
| Fingerprint protection | ✅ partial | `shield.js` runs before page scripts via `addDocumentStartJavaScript`: canvas/audio/WebGL jitter, GPC, and at strict the hardware tells. WebView 83+ for the early hook; older runs at page start |
| Per-site rules | ✅ | JavaScript, images, dark, desktop layout, text size, blocking — per host, stored only when they differ from the default |
| HTTPS-only | ✅ | Upgrade in `shouldOverrideUrlLoading` |
| Third-party cookies off | ✅ | `CookieManager.setAcceptThirdPartyCookies(false)` |
| DNT / GPC | ✅ | Headers on navigation, plus `navigator.globalPrivacyControl` |
| Secrets at rest | ✅ | AES/GCM under an Android Keystore key (`VexVault`), standing in for Electron `safeStorage` |
| DNS-over-HTTPS | ❌ | WebView uses the system resolver; Android's Private DNS is the only lever |
| Tor routing, ByeDPI bypass | 🔧 | See blocker 3 |
| Proxy / container routing | 🟡 | `Proxy.setProxyOverride` is process-wide, so per-container routing does not survive |
| Password vault, 2FA, email-code autofill | 🔧 | The Keystore primitive is here; autofill itself needs the Android Autofill Service or document-start injection |

### Content and media
| Desktop | Status | Note |
|---|---|---|
| Widevine streaming | ❌ | Blocker 1 |
| Codec fallbacks | 🟡 | Whatever the device's WebView ships; no swapping in your own |
| Save page as single file | 🟡 | Needs its own implementation; PDF is done |
| Full-page capture | 🟡 | Scroll-and-stitch in the native layer |
| EPUB reader, PDF text extraction | 🟡 | Pure JS in `src/main`; runs anywhere |
| Screen recording, clips | ❌ | Desktop capture APIs; MediaProjection is a different feature |

### Assistant and data
| Desktop | Status | Note |
|---|---|---|
| Cloud AI assistant | ✅ | Same request shape as the desktop, so one worker serves both. Page text comes from the reader's extraction; private tabs never send any |
| Summarize / translate / explain | ✅ | The worker's own actions |
| Local AI (Ollama, WebGPU) | ❌ | Blocker 4 |
| Agent acting on tabs | 🟡 | `evaluate` per tab is already exposed; the tool loop is not ported |
| Recall full-text index | 🟡 | Plain JS; storage moves to SQLite |
| History, bookmarks, downloads | ✅ basic | Same record shapes, stored via Preferences. Thousands of rows want SQLite |
| Encrypted sync | 🟡 | Network code is portable; key storage is solved (`VexVault`) |
| Mail panel (IMAP), reminders, calendar | 🔧 | `imapflow` is Node — needs a Java client or a server-side relay |

### Chrome and platform
| Desktop | Status | Note |
|---|---|---|
| Themes | ✅ | All eight, generated from `theme-tokens.css` by `scripts/sync-themes.mjs`; `npm run check` fails when they drift |
| Skins | ✅ partial | Seven of the nineteen textures, drawn in the theme's ink at a strength you pick, plus corner and shadow |
| Interface typeface | ✅ | Five faces, Spectral and Outfit bundled from the desktop's own font folder |
| Page theme-colour tinting | ✅ | Only when the colour reads against the theme, so toolbar icons stay visible |
| Toolbar/sidebar rearranging | ❌ | Four controls fit on a phone toolbar |
| Command bar, keyboard shortcuts | ❌ | No keyboard; the menu sheet is the mobile answer |
| Auto-update | 🔧 | Play Store, or an APK update check of your own |
| Crash log, safe mode | 🟡 | Worth rebuilding; `restart-smoke.js` has an Android analogue in instrumented tests |
| DevTools | 🟡 | `chrome://inspect` from desktop Chrome |

---

## Build and verification status

What is checked here, on every `npm run check`:

- **The Java type-checks against the real Android framework.** `scripts/check-java.mjs`
  compiles all seven Android sources with javac against Robolectric's
  `android-all` jar — the actual `android.webkit`, `android.print`,
  `android.security.keystore` classes — plus hand-written androidx and
  Capacitor stubs in `tools/stubs`. A wrong WebView signature fails here the
  way it would in a real build.
- **The bridge and the plugins agree.** `check-www.js` asserts that every
  `call('method')` in `bridge.js` has a matching `@PluginMethod`, so the chrome
  cannot ship a call into a method nobody wrote.
- **The themes match the desktop.** `sync-themes.mjs --check`.
- **The chrome runs.** `npm run smoke` drives it in a phone-sized Chromium:
  navigate, menu, per-site rules, reader, assistant, theme switch, skin,
  privacy panel, tab search, private browsing, long-press sheet, find, and
  Android back — 33 expectations, plus any page error fails the run.
- **The logic has tests.** 80 vitest cases in `tests/mobile/` over the omnibox,
  the filter parser, the tab model, site rules, the assistant client, themes,
  the shield and reader parsing.

What is still unverified, and it matters:

- **Gradle has never run.** No Android SDK and no access to Google's Maven
  here. The stubs check our calls, not the libraries: if a stub has drifted
  from the real androidx signature, the check passes and the build fails.
- **No device testing at all.** Geometry — the content rect against the
  keyboard and the gesture insets — is exactly what only a real phone settles.
- The multi-profile calls for private tabs are made by reflection, because
  that API's shape could not be checked here; a wrong guess degrades to "no
  separate cookie jar" instead of failing the build.

## Suggested order of work

1. **Get it building and on a device.** `npm i && npx cap sync android`, fix
   the first round of Gradle errors, confirm the content rect tracks the
   keyboard and the insets.
2. **Storage that scales.** Move history and the blocker's rule cache off
   Preferences onto SQLite before the history panel is the slowest screen.
3. **Sync.** The key storage is already solved; the desktop's encrypted sync
   would give the phone the same bookmarks, tabs and history.
4. **The agent loop.** `evaluate` is exposed; the desktop's tool loop is the
   remaining piece, and it is the feature that makes mobile Vex feel like Vex.
5. **Tab groups and sidebar apps**, if the phone UI for them earns its place.
6. Only then Tor/ByeDPI as embedded libraries, knowing the size of it.
