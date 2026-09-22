# Vex for Android

The Vex browser as a native Android app: the Vex chrome rendered by Capacitor,
real pages rendered by Android's system WebView, and a native layer that does
the jobs Electron's main process does on the desktop.

This is a working scaffold, not a shipped app. It has never been compiled
against the Android SDK — see *Build and verification status* in
[PORTING.md](PORTING.md), which also says feature by feature what the desktop
browser can and cannot bring to a phone. Read that before planning work on it.

## How it fits together

```
┌─────────────────────────────────────────────┐
│ MainActivity (Capacitor BridgeActivity)     │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ chrome WebView  ← mobile/www          │  │  toolbar, omnibox, tab grid,
│  │   window.VexBridge ──────────┐        │  │  sheets, panels
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
   the tab grid, a sheet, a panel — calls `VexBridge.setVisible(false)` first,
   and `VexUI.cover()` refcounts that so two overlays do not uncover each other.

## Build

Requirements: Node 22+, JDK 21, Android SDK with platform 36, and either
Android Studio or a local `gradlew`.

```bash
cd mobile
npm install
npx cap sync android          # copies www/ into the app and writes the plugin lists
cd android
./gradlew assembleDebug       # or: npx cap open android
```

`npx cap sync` generates `android/capacitor.settings.gradle`,
`android/app/capacitor.build.gradle` and `android/capacitor-cordova-android-plugins/`.
None of them are in git, and the Gradle files guard against their absence — so
**run sync before Gradle** on a fresh clone.

There is no Gradle wrapper in the repo. Generate one once with
`gradle wrapper --gradle-version 8.13` (or open the project in Android Studio,
which does it for you).

## Develop the chrome without a device

`mobile/www/index.html` opens in a desktop browser. With no Capacitor present,
`VexBridge` falls back to iframes, so layout, the omnibox, the tab grid,
sheets, panels and gestures all work. What does not: real navigation to sites
that refuse framing, blocking, snapshots, find-in-page, and downloads — those
are native paths with no browser equivalent.

```bash
npm run check                 # parse every chrome script, check every reference
npm run smoke                 # drive the chrome in a phone-sized Chromium
```

`npm run smoke` needs Playwright (`npm i -D playwright && npx playwright install
chromium`); set `CHROMIUM_PATH` to reuse a Chromium that is already on the
machine. It walks the paths a person actually takes — omnibox, menu, new tab,
tab switcher, bookmarks, settings, find, private tab, Android back — and fails
on any page error or wrong state.

## The plugin API

`VexTabs` (`android/…/tabs/VexTabsPlugin.java`), called through
`window.VexBridge`:

| Method | Does |
|---|---|
| `create({url, incognito})` → `{id}` | New page WebView, hidden until activated |
| `close({id})` / `activate({id})` | Destroy / bring to front |
| `setBounds({x,y,width,height})` | Position the content rect, in CSS pixels |
| `setVisible({visible})` | Hide the page so chrome can cover it |
| `load` `back` `forward` `reload` `stop` `state` | Navigation |
| `find` `findNext` `clearFind` | Find in page |
| `snapshot({id})` → `{dataUrl}` | JPEG for the tab switcher |
| `setDesktopMode` `setDarkMode` `setTextZoom` | Page presentation |
| `setPrivacy({httpsOnly, doNotTrack})` | Applies to every tab |
| `evaluate({id, code})` | Run script in a page (what an agent would use) |
| `clearData({cookies, cache, storage})` | Clear browsing data |

Events: `loadStart` `loadProgress` `loadEnd` `title` `urlChange` `newTab`
`download` `blocked` `findResult` `error` `permission` `edgeSwipe`
`fullscreen`.

`VexBlock` (`android/…/block/VexBlockPlugin.java`): `setEnabled`,
`setSiteAllowed`, `loadRules({block, allow, hide})`, `stats`. Filter text is
parsed in JS (`www/js/adblock.js`) and handed over already split; matching
happens natively inside `shouldInterceptRequest`.

## Known limits in this scaffold

- Never compiled; first build will need fixing up.
- Private tabs only get a separate cookie jar on WebView 116+.
- History and bookmarks live in SharedPreferences — fine for hundreds of rows,
  not for thousands.
- The blocker implements a subset of EasyList syntax (see PORTING.md).
- Launcher icons are placeholder vectors.
- No tests beyond `npm run check`; the desktop app's vitest suite does not
  cover this tree.
