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
| Tabs, grid switcher | ✅ | Plus tab search and tab groups; swipe a card aside to close it, with Undo |
| Secret mode | ✅ | Private tabs; own WebView profile on WebView 116+ |
| Secret mode lock (biometrics) | ✅ | Settings → Privacy → Lock private tabs |
| Close tabs after N days | ✅ | Settings → Tabs |
| Sleep unused tabs | ✅ | onPause on a tab you have left for fifteen minutes: its timers and animations stop and the page stays loaded. Never while background audio is on, because pausing a tab silences it |
| Recently closed | ✅ | Menu → Reopen closed tab, undo on "close all", and Undo in the toast the moment a tab is closed |
| Address bar top or bottom | ✅ | Settings → Appearance → Toolbar position |
| Toolbar auto-hides on scroll | ✅ | Reported from the page WebView; the chrome cannot see page scrolling on its own |
| Customisable toolbar buttons | ✅ | Up to three either side of the address pill |
| Pull to refresh | ✅ | SwipeRefreshLayout around each tab |
| Scroll buttons | ✅ | Settings → Pages → Scroll buttons: two arrows at the page's edge while you scroll; a tap is a screenful, a long press the top or bottom. Native, so they sit over the page |
| Hide the status bar | ✅ | Settings → Appearance → Show the status bar; a swipe from the top shows it for a moment |
| Swipe the address bar to change tabs | ✅ | Plus swipe up for the switcher, down to reload |
| Back/forward edge gestures | ✅ | Detected natively — page touches never reach the chrome |
| Find on page | ✅ | |
| Search suggestions as you type | ✅ | From the engine you chose, fetched natively because no suggestion endpoint allows a cross-origin request. Never in a private tab; Settings → Search to turn them off |
| Choose a search engine | ✅ better | Six built in, plus one of your own — SearXNG on a box in the hall, Kagi, anything with a `%s` — with its own suggestions endpoint |
| Find on page from the address bar | ✅ | Typing offers "find it on this page"; Samsung needs the menu |
| Desktop site | ✅ | Global default and per site |
| Open links in new tab | ✅ | Settings → Tabs |
| Open links in apps | ✅ | A tapped link to another site that an app owns opens in that app (Android 11+, never a browser, never from a private tab); the toast offers to keep links in Vex. Settings → Tabs. An intent:// link with no app goes to the page it names, as in Chrome |
| Block pop-ups | ✅ | A window you tapped for still opens |
| Multi-window / split screen | ✅ | Android's own; Vex is a normal resizable activity |
| Tab bar on tablets | ✅ | A chip per tab above the page, shown when the window is at least 600px wide — a tablet, a split screen, a big phone sideways. Settings → Appearance → Tab bar to force it on or off |

## Reading and media

| Samsung Internet | Vex | Notes |
|---|---|---|
| Built-in PDF viewer | ✅ | Android's WebView cannot render one; Vex draws them with pdf.js, with zoom, page count, share and download |
| Reader view | ✅ | Extraction in the page, rendered by the chrome in Spectral; a book icon in the address bar when the page has an article, as Samsung shows |
| Reader font size | ✅ | Six steps |
| Text size / page zoom | ✅ | Global, and per site |
| Force pinch-zoom everywhere | ✅ | Settings → Appearance → Always allow pinch zoom |
| Dark mode for web pages | ✅ | Never, always, or whenever Vex itself is dark — which on Auto means whenever the phone is. Per site too (algorithmic darkening) |
| Stop a site autoplaying video | ✅ better | Vex asks for a tap before any video plays, everywhere; a site can be allowed on its own |
| High contrast mode | ✅ | Settings → Appearance → Contrast |
| Interface size | ✅ better | Android's font-size setting reaches a WebView's page text, not a web app's layout, so Vex scales its own chrome: four sizes, on the type scale, the toolbar and the tap target |
| Night/eye comfort | ✅ | Night shade, four strengths |
| Video pop-up player | ✅ | Android picture-in-picture, sized to the video |
| Background audio | ✅ | Settings → Media |
| Video brightness | ✅ | A filter on the element, past what the site allows |
| Video controls overlay | ✅ | Play, ±10 s, pop out, and the label opens speed, brightness and sound |
| Read a page aloud | ✅ | Android's TextToSpeech on the article the reader extracts — paragraph at a time, skip, pause, speed, a voice you choose. It stops when you leave Vex rather than pretending to be a music player |
| Reader typography | ✅ better | Typeface, measure, line spacing and paper (including true black for an OLED in the dark), and how far through you are |
| Keep the screen on | ✅ | Settings → Media |
| Download videos | ✅ | Menu → Download the video, or the video bar's sheet. A plain file goes to the download queue; an HLS stream is saved whole as one file (.ts, or .mp4 for fragmented MP4), AES-128 included, found through the page's own requests when the player hides it behind a blob: URL. Not DRM, not live streams, and not DASH or a rendition whose sound is a separate stream — each is said rather than attempted. A long save shows its progress in the notification shade and keeps going with Vex in the background |

## Saving and finding

| Samsung Internet | Vex | Notes |
|---|---|---|
| Bookmarks with folders | ✅ | Plus import/export as the standard bookmarks HTML file |
| Bookmark bar | ❌ | No room on a phone; the start page carries them |
| History with search | ✅ | In IndexedDB, grouped by day |
| Saved pages (offline) | ✅ | The whole document, opened with no connection. Its scripts are taken out when it is saved, so it renders as it looked rather than filling with its own offline errors |
| Downloads manager | ✅ | Live progress from the system queue, Stop while one is running, and a way into the phone's own Downloads folder. A file the page made itself (blob: or data:) is saved too, which Android's download manager cannot do |
| Quick access tiles | ✅ | Most-visited until you pin one, then yours to arrange |
| Custom homepage | ✅ | Settings → Search |
| Add page to home screen | ✅ | Pinned launcher shortcut with the site's own icon |
| Home-screen search widget | ✅ | Resizable; the pill opens the address bar, and the microphone and the square go straight to voice and the QR scanner |
| Shortcuts on the launcher icon | ✅ | Long-press Vex: new tab, private tab, voice, scan |
| Share, QR share | ✅ | Samsung shares by QR too; Vex draws it locally |
| Scan a QR code | ✅ | Camera + jsQR; an otpauth:// code goes to the vault |
| Reading list | ✅ | Samsung has none; this is the desktop Vex feature |
| Full-text search of pages you read | ✅ | Recall — nothing in Samsung Internet matches it |
| Sessions | ✅ | Named sets of tabs, and they open on the desktop |
| Backup and restore | ✅ better | Samsung backs up through a Samsung Account; Vex writes one encrypted file you hold, and says plainly what it cannot carry |

## Privacy and security

| Samsung Internet | Vex | Notes |
|---|---|---|
| Ad blocker (via extensions) | ✅ built in | Native matching in shouldInterceptRequest, EasyList subset, cosmetic filtering |
| Smart anti-tracking | ✅ | Third-party cookies off by default, tracker lists |
| Privacy dashboard | ✅ | Total blocked, and the sites that cost you the most |
| Per-site permissions | ✅ | Camera, microphone, location, notifications. The page waits: the WebView hands the request to the chrome, which asks once per site and remembers |
| Clear browsing data | ✅ better | Eight things with tick boxes and a count beside each, one site at a time, or the same list every time you leave Vex. Samsung's list is shorter and its on-exit option is not per-item |
| Forget one site everywhere | ✅ | Its visits, its text in the Recall index, its cookies and its storage, from one long press in History |
| Secret mode + biometrics | ✅ | And it asks again when you leave Vex, rather than keeping the grace period across an app switch — coming back with a private tab in front asks before showing it, and every way into one (a link's long-press included) passes the lock. A private tab's start page shows nothing from your history, and its permission answers are not kept |
| Block screenshots in secret mode | ✅ | FLAG_SECURE while a private tab is in front, which also keeps it out of the app-switcher thumbnail |
| Fingerprint protection | ✅ | Samsung has none; Vex runs a shim before the page's first script |
| HTTPS-only | ✅ | Samsung has none |
| Do Not Track / GPC | ✅ | |
| Safe Browsing | ✅ | Android's own, switched on |
| Warn on bad certificates | ✅ better | Vex refuses rather than offering a way past |
| Samsung Pass (passwords) | ✅ own | Vault under an Android Keystore key, with TOTP codes, and a generator that makes one worth using |
| Autofill addresses | ✅ | "Your details" — deliberately no card numbers |
| Autofill cards | ❌ | Not a thing a browser should type for you |

## Selection, notes and reminders

| Samsung Internet | Vex | Notes |
|---|---|---|
| Text selection: copy, share, web search | ✅ | Android's own, plus Vex's: ask the assistant, translate, polish (Gemini Nano, on the phone), keep as a note |
| — | ✅ Notes | A line about a page, or a passage kept from one — which is marked on the page again whenever you come back to it, like the desktop's highlights. Exported as Markdown |
| — | ✅ Reminders | "Bring this back this evening" — an Android alarm, so it fires whether or not Vex is running |

## Beyond Samsung Internet

The desktop features that came across, which Samsung Internet has no answer to:

- **Translation that never leaves the phone** — ML Kit's models, downloaded
  once per language and then offline for good. The page is rewritten where it
  stands and "show the original" puts it back. Chrome and Samsung Internet both
  send the page to a server to do this.
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
  your devices, merged with the same version-vector records the desktop uses —
  and the recent slice of your history, in the desktop's own entry shape, merged
  rather than overwritten so two devices browsing at once do not fight.
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

## Smaller things Samsung has no answer to

- **Undo in the toast** the moment a tab is closed, rather than three taps away.
- **Tab groups you can rename, recolour and close as a set.**
- **A password generator** in the vault: rejection-sampled randomness, one
  character from each class a site might insist on, and none of `l I O 0 1`.
- **"Forget everything from this site"** from a long press in History — visits,
  page text, cookies and storage in one move.
- **A diagnostics page** that says what this phone's WebView can and cannot do,
  and the last hundred things that went wrong, copyable into a bug report.

## What is not here yet

- Extensions of any kind (Android WebView has no extension system).
- Widevine-protected streaming (Netflix, Disney+ — see PORTING.md, blocker 1).
- Tor and the DPI bypass (they are bundled executables on Windows).
- Open-ended prompting on Gemini Nano, which Google exposes to Kotlin only.
  (On-device AI itself is here: a .litertlm model run by LiteRT-LM, and Nano for
  summaries — Settings → Assistant → On-device AI.)
- Downloading a stream (HLS, DASH). A direct file link downloads.
