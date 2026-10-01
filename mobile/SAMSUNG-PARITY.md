# Vex for Android against Samsung Internet

The brief was: everything Samsung Internet does, as the floor. This is the
list, feature by feature, with what Vex does instead where it does something
different. Samsung Internet 27 is the version compared against.

**Where Vex is short: extensions (the Galaxy Store content-blocker API has no
WebView equivalent — Vex's blocker is built in instead), and Samsung Pass and
Samsung Account (replaced by an on-device vault and your own sync worker).**
Everything else below is either matched or bettered.

## Browsing

| Samsung Internet | Vex | Notes |
|---|---|---|
| Tabs, grid switcher | ✅ | Plus tab search and tab groups |
| Secret mode | ✅ | Private tabs; own WebView profile on WebView 116+ |
| Secret mode lock (biometrics) | ✅ | Settings → Privacy → Lock private tabs |
| Close tabs after N days | ✅ | Settings → Tabs |
| Recently closed | ✅ | Menu → Reopen closed tab, and undo on "close all" |
| Address bar top or bottom | ✅ | Settings → Appearance → Toolbar position |
| Toolbar auto-hides on scroll | ✅ | Reported from the page WebView; the chrome cannot see page scrolling on its own |
| Customisable toolbar buttons | ✅ | Up to three either side of the address pill |
| Pull to refresh | ✅ | SwipeRefreshLayout around each tab |
| Swipe the address bar to change tabs | ✅ | Plus swipe up for the switcher, down to reload |
| Back/forward edge gestures | ✅ | Detected natively — page touches never reach the chrome |
| Find on page | ✅ | |
| Desktop site | ✅ | Global default and per site |
| Open links in new tab | ✅ | Settings → Tabs |
| Block pop-ups | ✅ | A window you tapped for still opens |
| Multi-window / split screen | ✅ | Android's own; Vex is a normal resizable activity |
| Tab bar on tablets | ✅ | A chip per tab above the page, shown when the window is at least 600px wide — a tablet, a split screen, a big phone sideways. Settings → Appearance → Tab bar to force it on or off |

## Reading and media

| Samsung Internet | Vex | Notes |
|---|---|---|
| Reader view | ✅ | Extraction in the page, rendered by the chrome in Spectral |
| Reader font size | ✅ | Six steps |
| Text size / page zoom | ✅ | Global, and per site |
| Force pinch-zoom everywhere | ✅ | Settings → Appearance → Always allow pinch zoom |
| Dark mode for web pages | ✅ | Global and per site (algorithmic darkening) |
| High contrast mode | ✅ | Settings → Appearance → Contrast |
| Night/eye comfort | ✅ | Night shade, four strengths |
| Video pop-up player | ✅ | Android picture-in-picture, sized to the video |
| Background audio | ✅ | Settings → Media |
| Video brightness | ✅ | A filter on the element, past what the site allows |
| Video controls overlay | ✅ | Play, ±10 s, pop out |
| Keep the screen on | ✅ | Settings → Media |
| Download videos | ❌ | Long-press download works for direct files, not streams |

## Saving and finding

| Samsung Internet | Vex | Notes |
|---|---|---|
| Bookmarks with folders | ✅ | Plus import/export as the standard bookmarks HTML file |
| Bookmark bar | ❌ | No room on a phone; the start page carries them |
| History with search | ✅ | In IndexedDB, grouped by day |
| Saved pages (offline) | ✅ | The whole document, opened with no connection |
| Downloads manager | ✅ | With live progress from the system queue |
| Quick access tiles | ✅ | Most-visited until you pin one, then yours to arrange |
| Custom homepage | ✅ | Settings → Search |
| Add page to home screen | ✅ | Pinned launcher shortcut with the site's own icon |
| Home-screen search widget | ✅ | Resizable; the pill opens the address bar, and the microphone and the square go straight to voice and the QR scanner |
| Share, QR share | ✅ | Samsung shares by QR too; Vex draws it locally |
| Scan a QR code | ✅ | Camera + jsQR; an otpauth:// code goes to the vault |
| Reading list | ✅ | Samsung has none; this is the desktop Vex feature |
| Full-text search of pages you read | ✅ | Recall — nothing in Samsung Internet matches it |
| Sessions | ✅ | Named sets of tabs, and they open on the desktop |

## Privacy and security

| Samsung Internet | Vex | Notes |
|---|---|---|
| Ad blocker (via extensions) | ✅ built in | Native matching in shouldInterceptRequest, EasyList subset, cosmetic filtering |
| Smart anti-tracking | ✅ | Third-party cookies off by default, tracker lists |
| Privacy dashboard | ✅ | Total blocked, and the sites that cost you the most |
| Per-site permissions | ✅ | Camera, microphone, location, notifications |
| Clear browsing data | ✅ | Everything, or one site |
| Secret mode + biometrics | ✅ | |
| Fingerprint protection | ✅ | Samsung has none; Vex runs a shim before the page's first script |
| HTTPS-only | ✅ | Samsung has none |
| Do Not Track / GPC | ✅ | |
| Safe Browsing | ✅ | Android's own, switched on |
| Warn on bad certificates | ✅ better | Vex refuses rather than offering a way past |
| Samsung Pass (passwords) | ✅ own | Vault under an Android Keystore key, with TOTP codes |
| Autofill addresses | ✅ | "Your details" — deliberately no card numbers |
| Autofill cards | ❌ | Not a thing a browser should type for you |

## Selection, notes and reminders

| Samsung Internet | Vex | Notes |
|---|---|---|
| Text selection: copy, share, web search | ✅ | Android's own, plus Vex's: ask the assistant, translate, polish (Gemini Nano, on the phone), keep as a note |
| — | ✅ Notes | A line about a page, or a passage kept from one |
| — | ✅ Reminders | "Bring this back this evening" — an Android alarm, so it fires whether or not Vex is running |

## Beyond Samsung Internet

The desktop features that came across, which Samsung Internet has no answer to:

- **The assistant** — ask about the page, summarise, translate, through a
  Cloudflare Worker you deploy yourself. Private tabs never send page text.
- **An assistant that needs no network at all** — a Gemma-class model running
  inside Vex through LiteRT-LM, and Gemini Nano for summaries where the phone
  has it. "On-device only" means exactly that: nothing is sent anywhere, and a
  model that cannot cope says so rather than quietly falling back to a server.
  Samsung Internet has no equivalent.
- **Recall** — the readable text of the pages you read, indexed on the device,
  searchable by what they said.
- **Encrypted sync with the desktop** — bookmarks, reading list, sessions,
  site rules and settings, end-to-end encrypted with a key that never leaves
  your devices, merged with the same version-vector records the desktop uses.
  Your PC's open tabs appear on the start page.
- **Eight themes, seven skins, five typefaces** — generated from the desktop's
  own token file, so a theme is the same colour on both.
- **Per-site rules** — JavaScript, images, dark, desktop layout, text size and
  blocking, per host.
- **A menu you can rearrange**, and toolbar buttons you choose.
- **An agent** — "close every YouTube tab", "search this site and open the
  first result". It works one step at a time, shows every step, and stops to
  ask before anything it marks risky.
- **The library** — all of it on named shelves, searchable, with "ask Vex what
  you don't know" for when you know the job but not the feature.

## What is not here yet

- Extensions of any kind (Android WebView has no extension system).
- Widevine-protected streaming (Netflix, Disney+ — see PORTING.md, blocker 1).
- Tor and the DPI bypass (they are bundled executables on Windows).
- Open-ended prompting on Gemini Nano, which Google exposes to Kotlin only.
  (On-device AI itself is here: a .litertlm model run by LiteRT-LM, and Nano for
  summaries — Settings → Assistant → On-device AI.)
- Downloading a stream (HLS, DASH). A direct file link downloads.
