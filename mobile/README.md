# Vex for Android

The Vex browser as a native Android app: the Vex chrome rendered by Capacitor,
real pages rendered by Android's system WebView, and a native layer doing the
work Electron's main process does on the desktop.

It is not a release, but it builds: CI assembles a debug APK on every push and
leaves it as an artifact (4.4 MB, Gradle 8.14.3, AGP 8.13, compileSdk 36), with
`lintDebug` clean. It has never been installed on a phone — that is the next
thing that has to happen, and **The first run on a real device** below is the
list to walk.
[PORTING.md](PORTING.md) says, feature by feature, what the desktop browser can
and cannot bring to a phone. Read that before planning work here.

## What it does today

The target was everything Samsung Internet does, as a floor, plus everything
that could come across from the desktop. [SAMSUNG-PARITY.md](SAMSUNG-PARITY.md)
is the feature-by-feature comparison; the short version:

**Browsing** — tabs with a snapshot switcher, tab search and tab groups;
private tabs (own WebView profile on WebView 116+, optionally behind a
fingerprint); session restore down to the scroll position; pull to refresh; a
toolbar that sits at the top or the bottom, hides as you scroll, and carries
the buttons you choose; find in page; edge-swipe back and forward; long-press
menus on links and images; downloads with live progress; print and
save-as-PDF; pop-up blocking; Android back that walks the UI the way the
system expects.

**Reading** — a reader that pulls the article out and sets it in Spectral;
text size, forced pinch-zoom, contrast and a night shade for pages that fight
you; saved pages that open with no connection at all; a reading list.

**Finding things again** — history in IndexedDB with search, bookmarks in
folders with import and export, and Recall: the readable text of every page
you read, indexed on the device, searchable by what it said.

**Media** — a floating video window (Android picture-in-picture), background
audio, ±10 s controls, video brightness past what the site allows.

**Privacy** — ad and tracker blocking with cosmetic filtering and a dashboard
of what it cost the sites you visit; a fingerprint shield that runs before the
page's first script; per-site rules and per-site permissions; third-party
cookies off; HTTPS upgrades; DNT and GPC; certificate errors that refuse
rather than offering a way past.

**Your things** — a password vault under an Android Keystore key with TOTP
codes and form filling; personal details for sign-up forms; QR codes both
ways (scan one, or hand this page to the machine next to you); dictation into
the address bar; add a site to the home screen; a home-screen search widget
that opens the address bar, dictation or the scanner in one tap; and a tab bar
when the window is wide enough to hold one.

**Vex's own** — eight themes, seven skins and five typefaces generated from
the desktop's token file; the assistant against a Cloudflare Worker you deploy
yourself, in two modes (ask about the page, or let it do things with a tool
loop that shows every step); notes and reminders; the feature library with
"ask Vex what you don't know"; and encrypted sync with the desktop —
bookmarks, reading list, sessions and site rules, merged with the same
version-vector records the PC uses, with your desktop's open tabs on the start
page.

## How it fits together

```
┌─────────────────────────────────────────────┐
│ MainActivity (Capacitor BridgeActivity)     │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ chrome WebView  ← mobile/www          │  │  toolbar, omnibox, tab grid,
│  │   window.VexBridge ──────────┐        │  │  sheets, reader, assistant
│  └──────────────────────────────┼────────┘  │
│  ┌──────────────────────────────▼────────┐  │
│  │ EdgeSwipeLayout (the content rect)    │  │  positioned by setBounds()
│  │   TabWebView · TabWebView · …         │  │  one per tab, real pages
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

The chrome is a web page; the pages are not. Two consequences run through the
whole codebase:

1. **The chrome has a hole in it.** `#content` paints nothing and the page
   WebView is laid over its bounds. Any layout change has to be pushed down
   with `VexBridge.setBounds()`, which `VexUI.scheduleBounds()` does on resize,
   rotation and keyboard show/hide.
2. **A native view always paints above HTML.** Anything that covers the page —
   the tab grid, a sheet, a panel, the reader — calls `VexBridge.setVisible(false)`
   through `VexUI.cover()`, which refcounts so two overlays cannot uncover
   each other.

### The chrome, file by file

| File | Holds |
|---|---|
| `www/js/bridge.js` | `window.VexBridge` — the mobile answer to the desktop's `window.vex` |
| `www/js/db.js` | IndexedDB: history, the Recall index, saved pages, downloads |
| `www/js/history.js` | The visit log and Recall, over that database |
| `www/js/collections.js` | Bookmarks, reading list, sessions, start tiles, tab groups |
| `www/js/vault.js` | Logins, TOTP, form filling, personal details |
| `www/js/sync.js` | The encrypted sync client (with `www/js/shared/`, copied from the desktop) |
| `www/js/tools.js` | QR both ways, dictation, saved pages, capture, translate |
| `www/js/media.js` | Picture-in-picture, background audio, video controls |
| `www/js/permissions.js` | What each site may ask for |
| `www/js/agent.js` | The tool loop: what the assistant may do, and the rules it does it under |
| `www/js/notes.js` | Notes and kept passages |
| `www/js/remind.js` | Reminders, over Android's alarms |
| `www/js/library.js` | Every feature, on a shelf, searchable |
| `www/js/dom.js` | element helpers; nothing here has an innerHTML path for outside text |
| `www/js/storage.js` | async key/value over Preferences, same key names as the desktop |
| `www/js/theme.js` | themes, skins, fonts, the page's own theme colour |
| `www/js/tabs.js` | the tab model (`VexTabStore`) — no views, only what the chrome draws |
| `www/js/adblock.js` | filter lists: fetching, parsing, refresh |
| `www/js/shield.js` | the fingerprint script that runs before page scripts |
| `www/js/site-rules.js` | per-host switches, and pushing them into a tab |
| `www/js/reader.js` | article extraction (runs in the page) and its parsing |
| `www/js/ai.js` | the assistant client for your own worker |
| `www/js/ui.js` | toolbar, omnibox, tab switcher, find, toasts, geometry |
| `www/js/sheets.js` | the menu, the site sheet, long-press menus |
| `www/js/views.js` | reader and assistant views |
| `www/js/panels.js` | history, bookmarks, downloads, the settings tree |
| `www/js/start.js` | the start page |

### The native layer

| File | Holds |
|---|---|
| `MainActivity.java` | plugin registration, the file chooser, browser intents |
| `tabs/VexTabsPlugin.java` | creates, positions, shows and destroys page WebViews |
| `tabs/TabWebView.java` | one tab: settings, clients, downloads, find, snapshot, print |
| `tabs/EdgeSwipeLayout.java` | back/forward edge gestures over the page |
| `block/BlockEngine.java` | request matching inside `shouldInterceptRequest` |
| `block/VexBlockPlugin.java` | the JS control surface for it |
| `vault/VexVaultPlugin.java` | AES/GCM secrets under an Android Keystore key |
| `system/VexSystemPlugin.java` | Biometrics, shortcuts, dictation, PiP, permissions, default browser, the suggestion fetch |
| `remind/VexRemindPlugin.java` | Alarms for reminders |
| `remind/ReminderReceiver.java` | The notification when one comes due |
| `widget/SearchWidget.java` | The home-screen search bar: search, voice, QR |

## Build

**CI builds it for real.** `.github/workflows/mobile.yml` runs on every push
that touches `mobile/`: the checks, the Chromium walkthrough, the unit tests,
then `cap sync` and `assembleDebug` on a runner that has the Android SDK — and it leaves a debug APK as an artifact you can install. That
workflow is the first place this app is actually assembled, because it cannot
be assembled where it is written.

Locally, the requirements are Node 22+, JDK 21, an Android SDK with platform
36, and either Android Studio or a local `gradlew`.

```bash
cd mobile
npm install
npx cap sync android          # copies www/ into the app and writes the plugin lists
cd android
./gradlew assembleDebug       # or: npx cap open android
```

`npx cap sync` writes `android/capacitor.settings.gradle` (the plugin module
list), `android/app/capacitor.build.gradle` (their dependencies) and the
contents of `android/capacitor-cordova-android-plugins/`. The first two are
generated per machine and are not in git; the Cordova-plugins module is in git
because `capacitor.build.gradle` applies a file from it unconditionally, so
Gradle cannot even configure without the directory — Vex uses no Cordova
plugins, but the module still has to exist. **Run sync before Gradle** on a
fresh clone.

The Gradle wrapper **is** in the repo, and it is the Gradle to build with:
AGP 8.13 uses a Gradle internal API that Gradle 9.6 removed, so a modern
system-wide `gradle` — 9.8 on a GitHub runner — cannot even configure this
project, let alone build it. Use `./gradlew`, not `gradle`.

## Checks

```bash
npm run check        # chrome parse + references, every cross-module call,
                     # the bridge/native contract, themes and the shared sync
                     # files in step with the desktop, and a Java type-check
npm run smoke        # drive the whole chrome in a phone-sized Chromium
npm test             # 144 vitest cases over the chrome's logic
```

`npm run check:api` is the one worth knowing about: it loads every chrome
module in a sandbox and then checks that each `VexThing.method(` in the source
is a method that thing actually has. Two dozen modules call each other by
name, and a typo there is not a parse error — it is a button that throws when
somebody presses it, on a path the smoke run does not walk.

`npm run check:java` compiles every Android source with plain javac against the
real Android framework — Robolectric's `android-all` jar, which carries the
actual `android.webkit` classes — plus small androidx and Capacitor stubs in
`tools/stubs`, because those live on Google's Maven. It generates an `R.java`
from the resources the app declares — the strings, every layout and drawable,
and every `@+id` inside a layout — so a reference to a resource that is not
there is a compile error here rather than a crash on a device. It catches what
a compiler catches: wrong signatures, missing imports, unhandled exceptions. It is not a
substitute for Gradle, and the stubs are the part to distrust — if one drifts
from the real library, the check passes and the build still fails. The
framework jar is fetched once (~210 MB) and cached in `~/.cache/vex-mobile`;
set `ANDROID_JAR` or `ANDROID_HOME` to use your own, or pass `--offline` to
skip rather than fail.

`npm run themes` regenerates `www/css/themes.css` and `www/js/themes-data.js`
from `src/renderer/css/theme-tokens.css`. `npm run shared` re-copies the two
files the phone and the desktop must agree on byte for byte — the sync crypto
and the record merge. `npm run check` fails if either is stale, so a desktop
change cannot quietly leave the phone behind, and a device cannot end up
unable to read the other's synced data.

## Develop the chrome without a device

`mobile/www/index.html` opens in a desktop browser. With no Capacitor present,
`VexBridge` falls back to iframes, so layout, the omnibox, the tab grid,
sheets, panels, the reader and the assistant all work. What does not: real
navigation to sites that refuse framing, blocking, snapshots, find-in-page,
downloads and the Keystore — those are native paths with no browser
equivalent (in the fallback, a secret is kept in memory for the session and
then forgotten, never written to disk).

## The plugin API

`VexTabs` — page WebViews, called through `window.VexBridge`:

| Method | Does |
|---|---|
| `create({url, incognito})` → `{id}` | New page WebView, hidden until activated |
| `close` / `activate` | Destroy / bring to front |
| `setBounds({x,y,width,height})` | Position the content rect, in CSS pixels |
| `setVisible({visible})` | Hide the page so chrome can cover it |
| `load` `back` `forward` `reload` `stop` `state` | Navigation |
| `find` `findNext` `clearFind` | Find in page |
| `snapshot` → `{dataUrl}` | JPEG for the tab switcher |
| `setDesktopMode` `setDarkMode` `setTextZoom` `setZoom` `setUserAgent` | Presentation |
| `setScriptsEnabled` `setImagesEnabled` | Per-site rules |
| `setDocumentStartScript({script})` → `{atDocumentStart}` | The shield, before page scripts |
| `setPrivacy({httpsOnly, doNotTrack})` | Applies to every tab |
| `print` `download({url})` | System print dialog, DownloadManager |
| `scrollPosition` `restoreScroll` | Session restore |
| `evaluate({id, code})` | Run script in a page (the reader and the assistant use it) |
| `clearData({cookies, cache, storage})` | Clear browsing data |
| `setWindowBackground({color, dark})` | Theme the window and system bars |

Events: `loadStart` `loadProgress` `loadEnd` `title` `urlChange` `icon`
`newTab` `download` `blocked` `findResult` `error` `permission` `edgeSwipe`
`longPress` `fullscreen`.

Also on `VexTabs`: `setPullToRefresh`, `setBackgroundAudio`, `loadHtml` (saved
pages), `capturePage`, `downloadStatus`, `openDownload`, `clearSiteData`,
`setWindowBackground`, and `scroll` events for the auto-hiding toolbar.

`VexBlock`: `setEnabled`, `setSiteAllowed`, `loadRules({block, allow, hide})`,
`stats`. Filter text is parsed in JS (`www/js/adblock.js`) and handed over
already split; matching happens natively inside `shouldInterceptRequest`.

`VexVault`: `set`, `get`, `has`, `clear` — AES/GCM under a key that never
leaves the Android Keystore. The assistant's token, the sync key and the
password vault all sit behind it.

`VexSystem`: `biometricsAvailable`, `authenticate`, `addShortcut`,
`voiceInput`, `enterPictureInPicture`, `hasPermission`, `requestPermission`,
`isDefaultBrowser`, `openDefaultBrowserSettings`, `setFullscreen`,
`setKeepAwake`, `shareFile`.

## The first run on a real device

Nothing below can be settled without a phone, and all of it is cheap to check:

1. **The content rect.** Rotate, open the keyboard in a page's search field,
   open and close the find bar, switch the toolbar to the top. The page should
   stay exactly under the hole in the chrome through all of it.
2. **The toolbar hiding.** Scroll a long article: it should go on the way down
   and come back on the way up, and never strand you with no address bar.
3. **Pull to refresh** at the very top of a page, and *not* when you are
   scrolling up in the middle of one.
4. **Private tabs.** Check `WebViewFeature.MULTI_PROFILE` is on this device:
   open a private tab, sign in to something, close it, and see whether the
   normal tabs know you.
5. **The fingerprint prompts** — private tabs, the vault — and that refusing
   one leaves you where you were.
6. **Downloads**, then the notification, then opening the file from the panel.
7. **The QR scanner** (a camera permission Vex has never asked for before),
   **dictation**, and **picture-in-picture** on a video.
8. **A reminder** set five minutes out, with Vex swiped away.
9. **Sync**: sign in on the phone, enter the recovery code from the desktop,
   and check a bookmark made on one appears on the other.
10. **The agent**: "close every tab about X" on a handful of tabs.
11. **Gemini Nano**, which is the cheapest of these to try and needs no download:
    Settings → Assistant → On-device AI. A Galaxy S25 or a Pixel 9 should report
    *available* or *downloadable*; tap **Try it** on any article. If it says the
    phone has no Nano, that is AICore's answer, not a bug in Vex.
12. **A model of your own**, which is the expensive one. Open
    [litert-community](https://huggingface.co/litert-community) in Vex, accept
    Gemma's licence, download a `.litertlm` — Vex offers to import it the moment
    the download finishes — then set **Prefer on-device** and ask something.
    Watch for: the GPU backend failing and falling back to the CPU (expected on
    some phones, and it says so), the first load taking ten seconds, and how warm
    the phone gets on a long answer. Start with Gemma 3 1B even on a flagship:
    if 1B works, 4B is a storage decision rather than an unknown.

## Known limits

- Never installed on a phone. It assembles and lints clean, which is not the
  same thing: nothing below the Java has run on a device yet. In particular the
  on-device AI has never answered a question here — no runner can load a model.
- Android 8.0 and up (minSdk 26). ML Kit's GenAI libraries require it, and
  Gemini Nano cannot exist below it; Android 7 is nine years old.
- An on-device model is yours to fetch: Gemma is behind a licence you accept in
  a browser, so Vex opens the page and imports the .litertlm you download. It
  will not download gigabytes of weights on its own.
- Private tabs only get a separate cookie jar on WebView 116+ (multi-profile).
- History and Recall are in IndexedDB and scale to tens of thousands of rows;
  bookmarks, sessions and settings stay in SharedPreferences because they are
  small and they are what syncs.
- Sync carries bookmarks, the reading list, sessions, quick access and site
  rules. History does not travel — the encrypted blob is capped at 5 MB.
- The blocker implements a subset of EasyList syntax; see PORTING.md.
- The fingerprint shield needs WebView 83+ to run before page scripts. Older
  WebViews run it at page start, which a fast tracker can beat; the privacy
  screen says so when that is the case.
- Launcher icons are placeholder vectors.
