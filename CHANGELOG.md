# Changelog

## v2.31.9 (2026-08-31) — Block game-site ads

### Fixed
- **Ads on browser games** (makeitmeme.com and similar) now blocked. Their display ads are served through `html-load.com` — a Playwire ad network that rotates subdomains to slip past EasyList. Added it and the rest of that ad stack to Vex's block list.

## v2.31.8 (2026-08-31) — Cloudflare Turnstile fix

### Fixed
- **Cloudflare Turnstile "Verification failed"** on sites like gartic.io. Vex presents itself as Google Chrome in its User‑Agent and request headers, but the browser's JavaScript client‑hints (`navigator.userAgentData`) still said "Chromium" — that mismatch tripped bot detection. Vex now reports "Google Chrome" consistently across all three, so challenges verify normally.

## v2.31.7 (2026-08-31) — A Vex built for your work

### Added
- **Job Profiles** — pick your profession (43 across Tech, Design, Writing, Business, Science, Health, Education, Legal, Creative) in the setup wizard or `Ctrl+K` → **Personalize for Your Job**. Vex applies a fitting theme, enables the built-in tools that job uses daily, and adds quick tool buttons next to the Tor button. You choose exactly which tools you want.
- **🧰 Toolbox** — 10 built‑in tools, all local (no external sites): Regex tester, JSON formatter, CSV viewer, Base64, Hash (SHA‑1/256/512), Unix timestamp, Cron explainer, UUID, Word count, and Color & contrast. Open from the Toolbox button or `Ctrl+K` → **Toolbox**.

## v2.31.6 (2026-08-31) — Everyday tools

### Added
- **Switch to an open tab from the command bar** — press `Ctrl+K`, type a tab's title or URL, and matching open tabs appear as "↪ Switch to tab".
- **📱 Send to Phone** — show a QR code of the current page (or a right-clicked link) to open it on your phone. Generated locally — nothing leaves your machine.
- **Paste & Go** — open the URL or search that's on your clipboard in one step.
- **Duplicate Tab** and **Copy All Tab URLs** — from the command bar (Duplicate is also on the right-click menu).
- **⟳ Auto-refresh** — reload a tab on an interval (30s / 1m / 5m / 15m) from the page right-click menu — for dashboards, live scores, and build logs.

## v2.31.5 (2026-08-31) — One-click restart

### Added
- **"⟳ Restart Vex to apply" button** — settings that only take effect at launch (like Memory Saver) now offer a one-click restart instead of just asking you to do it. The button appears under the setting when a restart is pending and relaunches Vex on click; your tabs come back.

## v2.31.4 (2026-08-31) — Pick-your-pane split, login tools & Memory Saver

### Changed
- **Split screen now lets you pick each pane.** Pressing split (or 3/4-pane) shows your open tabs to choose from — pane 2, then 3, then 4 — instead of grabbing whatever tab was next. Cancel keeps the panes you've chosen.

### Added
- **Email codes from more providers** — autofill now reads verification codes from Outlook, Proton, Yahoo and iCloud mail, in addition to Gmail.
- **Test autofill** — a self-check in Logins & Codes that reports whether it can reach and read your email (found a source? inbox readable? code visible?).
- **Auto-submit after filling a code** (opt-in) — presses the form's verify/submit button for you.
- **Password Health** (`Ctrl+K` → Password Health, or the hub) — finds reused, weak, or 2FA-less saved passwords. The analysis runs locally in the app; your passwords never leave your machine.
- **🧠 Memory Saver** (Settings → Performance) — one switch to lower RAM: sleeps tabs sooner (10 min), discards background tabs when Vex is minimized, caps renderer processes, and disables in-RAM page caching. Restart to fully apply.

### Performance
- **Email-code autofill no longer needs never-sleep on Gmail.** It wakes a sleeping Gmail only to read the code, then puts it straight back to sleep — so Gmail costs ~0 MB between codes instead of a permanent ~300–500 MB.
- **The hidden background Gmail reader frees itself** after a few minutes idle (it used to stay resident forever), and Chromium's always-warm **spare renderer** is disabled — both lower resting memory.

## v2.31.3 (2026-08-31) — Reliable code autofill & Custom Image

### Fixed
- **Email-code autofill now fills a code that was already in your inbox.** It snapshotted the newest code as a baseline and only filled a *different* one — so if the verification email was already there when the login page opened (Gmail woke a beat late, or the email landed as the page loaded), the code was skipped forever. It now fills an unread verification code that nothing newer supersedes, while still never filling an old, already-consumed code.
- **Custom Image theme wallpaper is reliable.** The image is now stored by the app itself (not only pushed into whatever Gmail-style start pages happened to be open), so it shows on the new-tab page whether or not one was open when you picked it, and survives restarts. Cancelling the picker no longer wipes your existing image.

### Added
- **Read email codes from a hidden Gmail** (Settings → Privacy → Autofill, or `Ctrl+K`) — fills verification codes with no Gmail tab open or awake, using your signed-in session.
- **"Fill code from email"** on demand — a `Ctrl+K` command and a right-click item on any input field.
- **Email-body fallback** — reads the code from the message body when it isn't in the inbox snippet.
- Autofill misses now say **why** (no Gmail open / still loading / no code arrived) — as a toast in the moment and in the Logins & Codes hub.

### Changed
- **"What's New" typography** — the release notes now use Vex's own fonts (Space Grotesk headings, Outfit body, JetBrains Mono for code).

## v2.31.2 (2026-08-31) — Browse every release

### Added
- **What's New version picker** — the release-notes modal now has a dropdown listing every version (newest-first, back to v1.0.0). Pick any release to read its notes; the "View on GitHub" link repoints to that tag. Read from the bundled changelog, so it works offline.

## v2.31.1 (2026-08-31) — Reopen "What's New"

### Added
- **"What's New" command** (`Ctrl+K → What's New`) — reopen this version's release notes any time. The update log used to appear only automatically after an update, with no way back to it.

## v2.31.0 (2026-08-31) — Eleven new tools

### Added
- **Ten features invented for Vex** (none exist in other browsers), each `Ctrl+K`: **🔥 Burner Identity** (throwaway OTR container + disposable email, optionally over Tor), **🕵️ Leak Canary** (warns when a saved email of yours is pre‑filled on the wrong site), **🧾 Tracker Receipts** (weekly narrative privacy report + trend), **⚙️ Automations** (if‑this‑then‑that: on a URL / at a time → open/panel/command), **🎯 Focus Flows** (composable work modes — tabs + persona + dim + block), **🎧 Read‑Later as Podcast** (auto‑advancing TTS of your saved articles), **🎨 AI Restyle** (AI writes CSS to restyle a site to a look you describe, saved as a Boost), **🧾 Universal Form Fill** (one profile fills signup/checkout forms), **📝 Sticky Notes per page**, and **🔗 Linked split‑scroll**.
- **Shortcuts & Gestures cheat‑sheet** (`Ctrl+K → Shortcuts & Gestures`) — a searchable reference of *every* keyboard shortcut (including the hidden ones — jump‑to‑tab `Ctrl+1‑9`, the `Ctrl+Alt+H` boss key, command‑chain slots, zoom/nav), all mouse gestures, and every right‑click action. Makes the hidden features findable.
- **More mouse gestures** — on top of back/forward/top/reload/close/reopen: **↑→ new tab**, **↑← duplicate tab**, **→↓ next tab**, **←↓ previous tab**.
- **Per‑tab AI persona switcher** (`Ctrl+K → Switch AI Persona (this tab)`) — Vex could already run a different persona per tab and switch with `@name`, but there was no quick picker; now there is one, showing which persona the tab uses.
- **Richer right‑click menu** — **🔊 Read aloud** a selection, **📚 Read Later** a link, and **🎯 Zap element** (hide anything on the site) now live on the page menu, alongside the existing Explain/Summarize/Translate/Highlight and Google Lens image search.
- **Screen‑share quality settings.** When a site asks to share your screen (Discord "Go Live", Meet, etc.), the source picker now also lets you set **resolution** (Source / 720p / 1080p / 1440p), **FPS** (15 / 30 / 60), **share system audio** on/off, and **show cursor** on/off — the choices Discord normally gates behind Nitro. Applied to the actual capture via a page‑world `getDisplayMedia` shim, and remembered for next time.
- **Tab Health dashboard** (`Ctrl+K → Tab Health`) — every tab grouped by its real state (active · kept-awake · awake · hibernated · sleeping · not-loaded) with live memory and one-click keep-awake / sleep / wake. Makes the sleep system visible instead of magic.
- **Logins & Codes hub** (`Ctrl+K → Logins & Codes`) — the three autofill systems (saved passwords, authenticator 2FA, and email-code) in one place, each with a per-kind success rate from a new local **autofill log**, plus a live "Gmail ready for codes?" status.
- **Site Settings** (`Ctrl+K → Site Settings`) — everything Vex remembers per website (zoom, forced dark mode, custom CSS/JS boosts) for the site you're on, plus a list of every site you've customized, with per-site reset.
- **Sidebar panel badges** — the unread count each app panel puts in its title (Discord, WhatsApp…) now shows as a badge on its sidebar icon, so the sidebar is a real dashboard.
- **Setup Gallery** (`Ctrl+K → Setup Gallery`) — save, name, share, and switch between whole Vex setups (panels, shortcuts, theme) as portable codes; keep a personal library.
- **Layout presets** — the layout editor gets one-click **Default / Essentials / Minimal** presets alongside the drag-to-rearrange controls.
- **Ask Vex to do something…** (`Ctrl+K`) — a plain-English command bar that understands common tab/window actions **locally, offline** ("close all youtube tabs", "sleep the others", "group my github tabs", "split screen", "keep this awake"), asking first before anything closes, and handing anything it can't parse to the AI tab manager.
- **Route through Tor / Proxy** (`Ctrl+K`) — send a whole container (or this session) through Tor or a custom SOCKS/HTTP proxy, persistently, or spin up a fresh Tor-routed container in one click.
- **Email codes without a Gmail tab** — opt-in: read verification codes from a hidden background Gmail using your already-signed-in session (no IMAP, no OAuth, no new credentials). Toggle it in the Logins & Codes hub.
- **Smoother local AI** — when Ollama isn't installed, on-device features (like history indexing) now skip quietly instead of failing on every page; verbose AI-routing logs are gated behind a debug flag. Much quieter console.

### Fixed
- **"Never sleep" tabs now really stay ready.** A tab you kept awake still came back from a restart as an unloaded stub — clicking it reloaded the page from scratch instead of showing it instantly, and background readers (like the email-code autofill) found nothing live to read. Now every kept-awake tab is brought fully back to life on launch, is materialized the moment you turn keep-awake on (even if it had never been opened), and opts out of background throttling so its page keeps running while it's not in front — so a kept-awake Gmail keeps receiving mail in the background and the code autofill reads a current inbox. This is a big part of why the autofill was hit-or-miss.
- **Ad blocker threw on early page loads.** The cosmetic (element-hiding) filter handlers were registered only after the filter engine finished loading in the background, so any page that loaded during that window threw "No handler registered" and got no element hiding. The handlers are now registered up front and simply wait for the engine — no error, and cosmetic filtering applies from the first page.
- **Discord stream pop-out trapped your screen.** Popping out a stream opened a near-fullscreen window pinned always-on-top, so it covered everything — Alt+Tab switched apps but you still couldn't see or reach them without minimizing the pop-out first. The always-on-top float now only applies while the pop-out is a small (picture-in-picture-sized) window: open or resize it large and it behaves like a normal window you can Alt+Tab freely; shrink it back down and it floats on top again.

## v2.30.1 (2026-08-29) — Fixes

### Fixed
- **Email-code autofill could fill a *stale* code from a previous attempt.** If a code had been emailed moments earlier (e.g. a retry), the autofill filled that older code right before the new one landed — so the login failed with "invalid code." It now snapshots whatever code is already in your inbox the moment the code screen opens, and only fills a code that's *different* — the one your current attempt actually triggers. (The previous timestamp check was too coarse: Gmail's row timestamps are minute-granular, so a retry within the same minute slipped through. Comparing the code value instead is exact.)

## v2.30.0 (2026-08-29) — A browser built for you: rearrange the UI

### Added
- **Edit Layout — rearrange your browser's own UI in place.** Vex's tagline is "a browser built for you," so now you can actually move it around. Open it from `Ctrl+K → "Edit Layout"` or **Settings → Appearance → Layout**, and the whole chrome becomes editable where it lives: **drag to reorder, ✕ to hide.** It covers *everything*, not just plain buttons — the Vex logo, the workspace switcher, the sync indicator, the address bar and its Copy-URL / Summarize buttons, Back/Forward/Reload, every top-bar button (Tor, Notes, Extensions, AI, Split, Command), every **sidebar icon**, and every **Glass shortcut chip** (Google, YouTube, Discord…). You can also drag a top-bar button **into a different cluster** — Tor over to the left, Back to the right, or a button dropped right into the address bar. And you can move **whole sections**: grab a section's grip handle to drag the entire left cluster, address bar, or right cluster into a new order (e.g. put the address bar on the far left). A bar at the bottom holds a **Hidden → click to restore** tray, plus **Reset toolbar** and **Done**. Your arrangement is saved and survives restarts. (Sidebar changes stay in sync with Settings → Sidebar; a shortcut's ✕ removes it — re-add with the + chip.)

## v2.29.10 (2026-08-29) — Auto-fill 2FA codes

### Fixed
- **Split screen broke after opening a sidebar panel.** Opening a panel (Discord, etc.) while split-screen was on left the content area stuck in a half-width grid when you came back — the split layout's forced grid was overriding the panel's hide. Opening a panel now cleanly exits split first.
- **Split screen showed a blank right pane.** Split-screen paired the active tab with the "next" tab — but almost every other tab is asleep with no live webview, so the right side came up empty. It now wakes/materializes both tabs before splitting, so both panes actually show their pages.

### Added
- **Auto-fill email verification codes from your Gmail.** When a site asks for a code it emailed you, and you have Gmail (web) open in a Vex tab, Vex reads the code from your inbox and fills it into the code field — no switching tabs, opening the email, and copying. Your Gmail tab doesn't even have to be in front: if it's in the background or asleep, Vex reads it in place without bringing it forward. Crucially, it fills only a code that *just arrived* (matched by the email's timestamp), so an older code still sitting in your inbox from a previous login is never used by mistake. It reads *only* a Gmail tab you already have open (no stored credentials, no email backend), fills only a real one-time-code field, and retries for a bit since the email usually lands a few seconds after you ask for it. Verified end-to-end on a real passwordless Spotify login. *(App-based 2FA still uses the Authenticator.)*
- **Split screen now does 3 and 4 panes.** Beyond the classic side-by-side, split into **3 equal columns** or a **2×2 quad** — open the command palette (Ctrl+K) and pick "Split into 3 panes" / "Split into 4 panes." The 2-pane split keeps its draggable divider.
- **Cloud AI setup now has a proper walkthrough in the setup wizard** — matching the Vex Sync step: what it is (Claude, on your own Cloudflare Worker + OpenRouter key) and 3 clear steps, instead of a bare "paste a URL" box.
- **Vex auto-fills your 2FA codes.** On a site's authenticator-app (TOTP) 2FA screen, Vex now fills the 6-digit code straight from its built-in Authenticator — no opening the panel, reading, and typing. It only fills a genuine one-time-code field (never a search or promo-code box), and — importantly — a code is only ever entered on the site it belongs to: the match is by the account's issuer against the site's real domain, so a look-alike/phishing host (e.g. `github.com.evil.com`) gets nothing. Add your accounts to the Authenticator (scan the QR or paste the key) and 2FA becomes one less thing to type. *(Note: this is for authenticator-app codes — it can't automate phone-approval prompts like GitHub Mobile, which require your phone by design.)*

## v2.29.9 (2026-08-29) — Tor with one click, no Tor Browser needed

### Added
- **The Tor button now launches Tor for you.** Before, you had to already have Tor Browser (or a tor service) running — otherwise the onion button just told you to go start one. Now Vex runs Tor itself: on first use it downloads the official Tor Expert Bundle (~15 MB, one time), starts `tor` in the background, and shows **live progress bars** — a download bar, then a "connecting to the Tor network" bar with each bootstrap stage — and opens your Tor tab automatically the moment it's fully connected (verified through check.torproject.org). If you *do* already have Tor Browser/service running, it uses that instead (instant). Tor shuts down when Vex closes.

## v2.29.8 (2026-08-29) — Privacy & sign-in polish: stronger ad blocker, smart autofill, no passkey nag

### Added
- **Privacy Dashboard** — a new 🛡️ sidebar panel showing, live, how much Vex is blocking for you: a running "requests blocked this session" total, the cross-site trackers that follow you across multiple sites, and a ranked top-offenders list. Read-only view over the blocking Vex already does — nothing new is sent anywhere.
- **HTTPS-Only mode** (Settings → Privacy, off by default). Always tries the encrypted https version of a site first. If a site genuinely has no https, Vex falls back to http for just that site (with a warning) so nothing breaks — and a site you asked for over https is never silently downgraded.
- **A stronger ad blocker.** Two upgrades: the built-in blocker now uses the *full* filter-list set (EasyList + EasyPrivacy plus Peter Lowe's, the uBlock Origin filters, badware/privacy/unbreak/quick-fixes, and annoyances) instead of just ads+tracking — so more ad and tracker requests are blocked at the network level. And Vex now does **cosmetic filtering** in-process: it hides the ad *slots and leftover placeholders* that network blocking alone leaves on the page (and first-party ad boxes it can't stop), on every site, following the ad-blocker on/off toggle.
- **Authenticator: add accounts by QR screenshot.** In the Add form, click/drag/paste a screenshot of a 2FA QR code and Vex reads it for you (decoded locally, no network) — no more hunting for the "enter a code manually" option. Manual entry is still there.
- **Notes button in the top toolbar** (beside the 🧅 Tor button), so it's one click away without opening the sidebar. The sidebar Notes button stays too (hide it in Settings → Sidebar if you want just the toolbar one).
- **Authenticator: click anywhere on a code to copy it.** No more hunting for the little copy button — click (or press Enter on) the whole row and the 2FA code is on your clipboard, with a quick flash to confirm.
- **Private tabs are now marked at a glance.** Tor and off-the-record tabs show a 🧅/🔒 badge and a subtle violet edge in both the tab sidebar and the horizontal/Glass strip, so you always know which tabs aren't being saved.
- **Autofill now works in sign-in popups.** "Sign in with Google/Discord/…" opens a small separate window; your saved login now fills there too (same phishing-safe, real-login-field-only logic as the main autofill).
- **Login-email pre-fill for passwordless sites.** Sites like Spotify log you in with an emailed code (no password to save), so full autofill never applied. Vex now remembers, per site, the email you type on a login page and pre-fills it next time — so you only enter the code. Email only, never a password, and only into a real login field (never a search box).
- **Claude sidebar auto-logs-in with Google.** When the Claude panel shows its logged-out screen, Vex auto-clicks "Continue with Google" for you (with a proper user-gesture, so the Google sign-in actually opens). Scoped to the Claude panel and throttled so a cancelled login can't loop.
- **No more "Windows Security" passkey prompt during sign-in.** That native "Sign in with a passkey / Insert your security key into the USB port" dialog pops up whenever a site (Google, etc.) asks for a passkey — a hassle if you don't use a security key. Vex now declines passkey requests so sign-in falls back to password/other methods and the dialog never appears. (Password autofill is unaffected. If you *do* want passkeys back, this can be turned off.)

### Changed
- **Removed the dead "Appearance" settings section.** The accent-color swatches fought the color themes (and did nothing useful once themes existed), and the "Show tabs sidebar" toggle duplicated the sidebar's own collapse button. The Appearance chip now jumps straight to the real look controls (GUI Style / Tab Layout).
- **The Tor tab now opens a search page you can use right away.** Clicking the onion used to land you on the Tor "check" page, which felt like a dead end. It now opens DuckDuckGo (which works cleanly over Tor — unlike Google, which drowns you in CAPTCHAs), so you can just start searching. The background check still confirms you're on Tor.

### Fixed
- **Tor tabs leaked into your saved session.** A tab opened over Tor was being persisted and, on the next launch, reopened as a *normal* tab — reloading a page you'd browsed privately over your real connection, and recording its URL. Tor (and off-the-record) tabs are now never saved — they vanish on close, as they should.
- **Tor now tells you if you're actually on Tor.** Finding Tor's port open doesn't mean Tor has finished connecting. Vex now verifies the tab really routes through Tor (via check.torproject.org) and shows a clear result — "🧅 Connected · exit IP …" on success, or a plain warning if the port's open but traffic isn't going through yet (still bootstrapping) or the proxy isn't Tor at all.
- **"Prevent from sleeping" was leaky.** A tab you'd kept awake could still get put to sleep by the background idle-hibernation sweep (which only spared the active/audible/pinned tabs, not kept-awake ones) — and the setting was dropped entirely when Vex restarted, because the restore code didn't carry the keep-awake flag back onto the tab. Both are fixed: the hibernation sweep now respects keep-awake, and the setting survives a restart (a timed "keep awake for N hours" resumes with its remaining time; "until reverted" stays until you turn it off). The **☕ badge** that marks a kept-awake tab was also broken — its style targeted the wrong CSS class and was only loaded after you opened the keep-awake menu, so after a restart a still-kept-awake tab showed no badge and *looked* disabled even though it wasn't. The badge now shows immediately on launch, in both the vertical and horizontal tab bars.
- **The keyboard-shortcut editor promised rebinds it couldn't deliver.** Twenty core shortcuts (New Tab, Find, Command Bar, History, Mute Tab, Toggle Sidebar, Fullscreen, …) are handled deep in the window layer, which fires them before the editor's binding is consulted — so "rebinding" them did nothing. They're now shown as fixed **system** shortcuts (the key still works, it just can't be reassigned), while the shortcuts that *can* be rebound still can. And the **Private Window** shortcut, which was a dead key (its Ctrl+Shift+N is taken by Notes, so it opened Notes), now lives on **Ctrl+Alt+N** and actually opens a private window.
- **Removed three persona-editor settings that did nothing** — "Preferred AI Backend", "Default tab context", and "Suggest follow-up questions" were saved but never read by anything (the AI router never received them; follow-ups come from the model's reply and the persona's own prompt). The misleading backend badge on each persona card is gone too. Temperature, Quick Prompts and the rest are untouched.

## v2.29.7 (2026-08-28) — Cleaner sidebar, theme-aware Glass, and a wave of fixes

### Added
- **Keyboard shortcuts now work while a web page has focus.** Previously, the moment you clicked into a site, the core browser shortcuts did nothing — only fullscreen/devtools/hard-reload reached the browser. Now **Ctrl+T** (new tab), **Ctrl+W** (close), **Ctrl+L** (address bar), **Ctrl+Tab / Ctrl+Shift+Tab** (switch tabs), **Ctrl+1–9** (jump to tab), **Ctrl +/−/0** (zoom), **Ctrl+F** (find) and **Ctrl+D** (bookmark) work everywhere. App shortcuts that web pages legitimately use (Ctrl+B bold, Ctrl+K quick-switcher) are deliberately left to the page.
- **The sidebar ships lean.** Only the browser core, your apps, Notes, Authenticator and GitHub stats show by default; the niche panels (Tab queue, RSS, Library, Annotations, Recall, AI memory, Schedules) are tucked away — one click to bring any back in **Settings → Sidebar**, or open them anytime with **Ctrl+K**.
- **Glass is now a first-class choice in the setup wizard**, and **the Glass look takes on your color theme** — pick Crimson and the frosted chrome glows red, Emerald green, and so on, instead of a fixed indigo.

### Fixed
- **Notes were unusable.** Selecting or creating a note threw an error and the editor never populated — the panel is fully working again.
- **Autofill typed your email into the wrong places.** In Discord, the "+ Add role" picker and "Find or start a conversation" search got your saved email. Autofill now only fills genuine login fields (never search/combobox boxes), while real logins — including 2-step email-first ones — still fill.
- **Right-click and popup menus wouldn't close when you clicked the web page.** The sidebar-button menu, tab menu, tools menu, extensions menu, media/volume/read-free popups and more now dismiss on the first click anywhere.
- **Menus were camouflaged over web pages.** The tab right-click menu and the URL-bar suggestions were semi-transparent and hard to read over a site; they're now solid.
- **Downloads silently overwrote same-name files.** A second `image.png` clobbered the first on disk — Vex now keeps both (`image (1).png`).
- **Sidebar buttons vanished when switching setup style** (Minimal ⇄ Full) and didn't come back; switching now restores every panel.
- **Picture-in-Picture toolbar button never worked right.** The page→browser "there's a video here" signal used a message channel that can't cross the `<webview>` boundary, so the toolbar PiP button's show/hide never fired and its click couldn't reach the video. Rewired over the correct webview IPC — the button now shows only when the active tab has a video and triggers native PiP. Also debounced the per-page video scan so it no longer churns CPU on busy sites like Discord.
- **"Save password?" could offer the wrong username** — anything typed into a 3+ character text field (a search box, a comment) was remembered as the login name. It now only remembers real username/email fields, scoped to the login form.
- **Restoring a saved session froze the browser.** Clearing the current tabs hit a loop where closing the last tab auto-created a new one, so the "close all" never finished. Restore now completes instantly.
- **The start page didn't match the theme in Glass mode.** With Glass on, the start page kept a fixed indigo/navy background regardless of the color theme, so themes like Ruby left it clashing with the themed chrome. It now derives its color from the theme, matching the rest of the window.
- **Scheduled tasks fired up to a minute early and could be skipped.** Daily/weekly/monthly tasks now fire *at* their time (not ~60s before), and a task missed while the computer was asleep runs when you're back (up to 6 hours late) instead of being silently skipped.
- **The AI chat could lock up.** An error in the wrong spot could leave the panel permanently refusing to send; it always recovers now.
- **PiP button now refreshes when you switch tabs** (it could show stale state from the previous tab).
- **Agent mode:** filling several fields on one page no longer aborts as "stuck," and the agent's type/select actions now report real success/failure instead of always "ok."
- **Reading Mode could trap a tab.** Entering Reading Mode and then restarting (or restoring the tab from a session) left the tab stuck on the article snapshot with no way back to the real page, and dumped a huge snapshot URL into your history. Reading Mode is now treated as the temporary view it is — the tab keeps its real page and history stays clean.
- **Restored tab stacks no longer vanish**, tab drag-reorder drops where you expect, and very large downloads (≥1 TB) show the right size unit.
- **No more favicon tracking.** Vex was fetching site icons from Google (`google.com/s2/favicons`) across the tab strip, history, bookmarks, Recall, Read-Later, the sidebar's pinned sites, the start-page speed dial, and more — which quietly told Google every domain in your tabs, history and bookmarks. Every one of those now uses the site's own first-party favicon. Nothing about your browsing goes to Google.
- **Smaller fixes:** URL-bar ArrowUp now reaches the last suggestion; the command palette no longer shows a duplicate "History"; dragging a tab onto a stack no longer misplaces it; open-tab full-text history indexing works again; the tab-sidebar toggle shows its pressed state; a benign navigation error no longer spams the console; and the Discord spellcheck replacement is more reliable.

## v2.29.6 (2026-08-27) — Safer DRM settings + build guardrail

### Fixed
- **Removed a "Reset DRM" button that appeared on a *healthy* DRM component.** Settings → About offered a reset even when Widevine was working; resetting a healthy component is destructive (it clears and re-downloads it, then restarts Vex) and was based on a misdiagnosis. The button now appears only when the DRM component has actually failed to load, labeled "Retry," with a confirmation first.

### Changed
- **Builds now verify the packaged app's Verified Media Path (VMP) signature and abort if it's invalid** — a fail-closed guard so a build can never again ship broken Spotify/Netflix/Prime DRM (the cause of the pre-2.29.5 breakage). Belt-and-suspenders on top of the 2.29.5 `afterSign` fix.

## v2.29.5 (2026-08-27) — DRM playback actually fixed (valid VMP signature)

### Fixed
- **Spotify, Netflix, Prime Video, Disney+ — all DRM playback failing (tracks skip / "can't play right now" / video won't start).** The real cause was a packaging bug, not app code. Vex's Widevine Verified Media Path (VMP) signing ran as electron-builder's `afterPack` hook, which fires *before* Authenticode code-signing — so a valid VMP signature was applied and then immediately invalidated when Authenticode re-wrote `Vex.exe`. Shipped builds carried a signature that castLabs' own verifier rejects (`InvalidSignature`), so streaming services' license servers refused the Widevine license (Spotify returned HTTP 403: audio downloaded but couldn't be decrypted, so each track auto-skipped to the next; Netflix/Prime/Disney+ failed the same way). Fixed by moving the signer to the `afterSign` hook, so VMP signing is the last step to touch the binary and the signature stays valid. This supersedes the 2.29.2 and 2.29.4 attempts — those treated symptoms of individual Spotify tracks, but the invalid signature was the root cause and it affected *all* protected playback, not a subset.

## v2.29.4 (2026-08-26) — Spotify playback: the real fix (hardware DRM)

### Fixed
- **"Spotify can't play this right now" on a subset of tracks — actually fixed this time.** The tracks that failed play fine in Chrome, so it was never a Spotify restriction: Chrome enables hardware-backed Widevine decryption by default and Electron does not, so Vex only offered the basic software robustness (SW_SECURE_CRYPTO) and the tracks that need more failed. Vex now enables `HardwareSecureDecryption`, which activates the MediaFoundation Widevine CDM — verified on a signed build to unlock SW_SECURE_DECODE and all hardware robustness levels. Falls back to software automatically on machines without hardware DRM, so it can't regress them. (The 2.29.2 robustness-retry was treating the symptom; this addresses the cause. As a bonus, Netflix/other DRM video can now use HD/hardware paths too.)

## v2.29.3 (2026-08-26) — Spellcheck fix sticks in Discord

### Fixed
- **Right-click "fix word" reverted in the Discord composer.** Clicking a spelling suggestion replaced the word, but as soon as you clicked next to it and typed, the misspelled word came back. Discord's editor (Slate.js) keeps its own model and reconciles the DOM to it — and because clicking Vex's menu takes focus off the Discord frame, the replacement never reached Slate's model. Vex now re-focuses the frame and re-selects the word before replacing, so the fix registers and sticks. Plain inputs and other editors (e.g. Claude) are unaffected.

## v2.29.2 (2026-08-26) — Claude notification error suppressed

### Fixed
- **Some Spotify tracks showed "Spotify can't play this right now."** Spotify requests a higher Widevine robustness (SW_SECURE_DECODE) for a subset of tracks than Electron's DRM provides (SW_SECURE_CRYPTO), so those specific tracks failed while the rest played. Vex now retries the failed DRM negotiation at the level it does support, so those tracks play. (Only kicks in when the original request fails; never weakens working playback.)
- **"An unknown error occurred while enabling push notifications" on the Claude panel** persisted even after 2.29.1 removed the Push API — claude.ai shows its notification toggle based on the Notification API and then attempts a push subscription that no Electron browser can service. Vex now reports notifications as unavailable on claude.ai, so it shows a normal "notifications blocked" state instead of an error. (Web Push is an inherent Electron limitation; foreground notifications from claude.ai are disabled as part of this.)

## v2.29.1 (2026-08-26) — Password saving, push-notification & first-run fixes

### Added
- **Password saving that actually catches modern logins.** Vex now offers to save your login on sites that submit with a button + JavaScript (Spotify, Google, most apps) and across multi-step email-then-password flows — not just old-style form submits. Saved logins autofill on return, and **clicking an empty login field brings the saved data back** (click-to-fill). Sidebar panels (Spotify, WhatsApp, Claude…) get save + autofill too, which they didn't before.

### Fixed
- **"An unknown error occurred while enabling push notifications" on the Claude panel (and other sites).** v2.29.0 shimmed the Push API to a rejecting object, but sites detect push by whether `pushManager` exists — so they still tried and errored. Vex now fully removes the Web Push surface, emulating a browser without push (like older Safari), which every major site handles gracefully by simply not offering push. Regular notifications are unaffected.
- **Two welcome screens on a fresh install.** The setup wizard and a legacy welcome card both appeared at once. The wizard is now the single first-run welcome, with "Take a tour" moved onto its final step.

### Changed
- **More Google sign-in hardening.** In addition to the userAgentData fix, Vex now presents a fully-populated `window.chrome` (runtime/app/csi/loadTimes) on Google pages so the browser fingerprint matches real Chrome more completely.

## v2.29.0 (2026-08-25) — Choose-your-Vex onboarding, tab drag-reorder & a stack of long-standing fixes

### Added
- **"Choose your starting point"** — a new wizard step right after Welcome. Pick **The Mortuex Setup** (everything on, exactly how Vex's creator runs it), **Minimal** (a clean browser — no app panels, empty shortcut bar), **Custom** (per-panel and per-shortcut checkboxes plus a Glass toggle), or **Use a shared setup** (paste a setup code). Each card has a visual preview; every choice is reversible in Settings → Sidebar.
- **Shareable setup codes** — export your whole setup (panels, shortcuts, theme, Glass/Classic) as a `VEXSETUP1.` code from the wizard; anyone can paste it into theirs and Vex arranges itself to match. Codes are validated live and sanitized on import.
- **Drag tabs to reorder** — hold and drag tabs on the top strip like any browser: an insertion line shows where the tab lands, dropping into a group joins it, dragging into the pinned zone pins it, and pulling a tab out of a stack keeps stack bookkeeping intact.
- **Declutter nudge** — two weeks after install, if several app panels were never opened, Vex offers (once, dismissible) to hide them.
- **Daily wisdom, your way** — the start-page daily verse is now a choice: Qur'an (Turkish or English), Bible, Tanakh, secular quotes from philosophers and writers, or off entirely. Bible/Tanakh/quotes rotate through curated local sets — no network needed.
- **Start page language** — English or Türkçe, covering the greeting, labels, search placeholder, and the daily verse (full interface translation is on the roadmap).
- **Right-click menus in editable fields now offer Cut / Copy / Paste / Select All**, with spellcheck suggestions on top.

### Fixed
- **Google sign-in rejected Vex** ("This browser or app may not be secure") — the page-visible `navigator.userAgentData` lacked the "Google Chrome" brand the spoofed UA claims; a scoped site tweak grafts it in, version-consistent with the real Chromium build.
- **Tabs shrank on every tab switch and stopped covering the strip** — the size classifier measured its own class-forced widths back (a one-way ratchet) and `very-narrow` tabs were hard-locked at 40px. Sizing is now computed from available width, tabs always fill the bar, and stale scroll offsets are clamped.
- **"An unknown error occurred while enabling push notifications"** — Electron cannot service Web Push, but advertised the API, so sites walked into an always-failing subscribe. The Push API is now hidden from feature detection, and direct `subscribe()` callers get a clean Chrome-like `NotAllowedError` instead of a crash. Regular notifications keep working, and Windows toasts now display in every run (AppUserModelID set at startup).
- **Right-click did nothing in the sidebar app panels** (Discord, Claude, Spotify, WhatsApp…) — the menu wiring guarded on a `window` property that never existed. Panels now get the full Vex context menu.
- **Spellcheck never actually worked** — no Hunspell dictionary was ever downloaded and sessions were never configured. Sessions now get explicit languages and the en-US dictionary is installed from the main process (immune to per-session proxies), so misspelled words get red squiggles and right-click suggestions everywhere, including the Discord panel.
- **Console spam `file:///C:/sync/...` on boot** when sync state existed without a configured worker URL — all sync endpoints now bail cleanly when unconfigured.
- **"What's New" showed "Couldn't load the release notes (offline?)" to online users** — release notes now come from the changelog bundled inside the app (no network, no rate limits); GitHub is only a last-resort fallback.

## v2.28.1 (2026-07-08) — Sidebar toggle: no more leftover strip

### Fixed
- **Closing the left sidebar (Ctrl+B) left an empty colored strip behind.** The toggle zeroed only the rail's width — its own margin, padding and border stayed, and the Glass GUI style's fixed 46px rail width overrode the collapse entirely. The rail now collapses to nothing in both Classic and Glass styles, and the page/webviews (including the sidebar site panels) reflow to use the full window width.

## v2.28.0 (2026-07-07) — Electron 42 (Chromium 148) + media-health hardening

### Changed
- **Electron upgraded 30.5.1 → 42.5.2 (castLabs, Widevine)** — Chromium jumps 124 → 148, picking up two years of security patches, codec/GPU fixes, and web-platform features. Verified: full test suite, smoke boot, Widevine CDM initialization (4.10.3050.0), and the site-tweak injections all pass on the new runtime.
- **Per-site page patches now live in one registry** (`src/site-tweaks.js`) instead of hand-rolled blocks in the webview preload. The Discord always-visible spoof and the HEVC mask are entries in a table (host pattern + main-world code + injection mechanism), unit-tested, and registered as their own preload — webview preloads are sandboxed, so the registry can't be `require`d from the main preload (verified: a local require silently never loads there).

### Added
- **Media decode failures are now surfaced.** Guest pages report media error events and the frozen-decode signature (playback time advancing, zero new decoded frames — exactly how the TikTok HEVC bug manifested, with no error event at all) to the host, which logs them against the page URL and shows a one-per-session toast. The next codec bug gets diagnosed from the console instead of from a vibe description.
- **HEVC mask extended to Instagram** — Reels serve H.265 the same way TikTok does, with the same frozen-frame failure mode on GPUs where hardware HEVC decode is broken; Instagram now falls back to H.264 too (verified live: HEVC probes denied, H.264 intact).
- **One-command releases** — `node scripts/release.js <version> "<title>"` verifies the CHANGELOG entry exists, bumps versions, commits only the release files, pushes, builds + publishes the GitHub release, and updates the website's version badge, so the repo, the release, and the website can no longer disagree.

## v2.27.23 (2026-07-07) — TikTok: videos no longer freeze on the first frame

### Fixed
- **TikTok videos showed a single frozen frame while the audio played on.** TikTok probes the browser for HEVC/H.265 support and serves its `bytevc1` (H.265) streams when the browser says yes — Electron's codec probes answer "yes" (the platform-HEVC path exists), but the actual hardware decode fails, so only the first keyframe ever rendered. Vex now hides HEVC from TikTok's codec probes (`MediaSource.isTypeSupported`, `canPlayType`, `mediaCapabilities.decodingInfo`), so TikTok falls back to H.264, which decodes everywhere. Scoped to tiktok.com; injected via `webFrame.executeJavaScript` because TikTok's CSP blocks inline-script injection.

## v2.27.22 (2026-07-04) — Discord panel: no more random reloads

### Fixed
- **The Discord panel randomly reconnected and dropped to the loading screen** when you switched to another tab and came back. Hiding the panel (`display:none`) flipped its Page Visibility to "hidden", so Discord tore down its gateway WebSocket and did a full reload when it couldn't resume. Vex now keeps the Discord guest reporting as always-visible (Page Visibility API spoofed, scoped to Discord only), so it stays connected across tab switches with no loading-screen flash.

## v2.27.21 (2026-06-19) — Feature drop: inline AI edits, link hints, smart recall & more

### Added
- **Inline AI text edits** — select text in any editable field and the selection bar now offers **✍️ Rewrite / ✓ Fix / ✂️ Shorten**, which transform the text and write it back in place (read-only Explain/Summarize/Translate still there for any selection).
- **Keyboard link hints** — press **`f`** on a page to overlay letter labels on every link/button; type the label to click. **Shift+F** opens a link in a new tab, **Esc** cancels. Toggle with the `vex.linkHints` setting (default on).
- **Tor tab** — a new 🧅 onion button in the top-right toolbar (and "New Tor Tab" in the command bar) opens a maximum-security private tab: a throwaway in-memory session routed entirely through a local Tor SOCKS5 proxy with remote DNS (no leak), **WebRTC disabled**, all site permissions denied, and fingerprint resistance. Requires Tor running locally (Tor Browser on port 9150 or a tor service on 9050); Vex guides you to start it if it isn't detected, and opens check.torproject.org to confirm.
- **New Identity tab** (command bar) — opens a throwaway, fully isolated session (cookies/storage vanish on close) with a freshly rotated, self-consistent Chrome fingerprint. Unlike the fixed containers, sites can't correlate it with your logins.
- **Smart Recall** — the Recall panel has a **✨ Smart search** toggle: the AI expands your natural-language query into related terms and merges the full-text results, so you can find a page by *meaning*. (Press Enter to run; no new dependency.)
- **Catch Me Up** (command bar) — an AI digest of your newest RSS items + unread Read Later, with the source articles listed to open directly.
- **Workspace Time-Travel** (command bar) — auto-snapshots each workspace's open tabs every 10 minutes (and on demand); restore any past tab set non-destructively as new tabs.

### Changed
- **Auto-reject cookie banners** — the consent blocker now actively clicks "Reject all" across the major CMPs (OneTrust, Cookiebot, Didomi, Usercentrics, Quantcast, Google FC…) instead of only hiding the banner, so the opt-out is actually recorded.

### Fixed
- **Discord stream pop-out** — now remembers its size/position and floats picture-in-picture style (**Ctrl+Shift+P** toggles the on-top pin). Crucially, always-on-top is **automatically dropped while the pop-out is fullscreen**, so **Alt+Tab works** (the earlier pin level trapped app-switching).

## v2.27.20 (2026-06-19) — Discord panel: no freeze on return + working stream pop-out

### Fixed
- **The Discord panel froze for a few seconds** when you closed it (clicked the Discord button again) or switched to another tab and came back. Hiding the panel sets the guest to `display:none`, and Electron's default background throttling let Chromium suspend the page — so on return the heavy Discord SPA had to reconnect its gateway and replay throttled timers before it could paint. The Discord panel's webview now runs with `backgroundThrottling=no`, so it stays live while hidden and re-shows instantly. (Scoped to Discord only; other panels keep default throttling to save battery.)
- **Discord "Pop Out" (watching a friend's screen-share / stream) opened in a cramped preview** where **Full Screen did nothing** and **"Open as tab" loaded a blank tab**. The pop-out is a scripted `window.open` from Discord, so it was being dressed as the Peek auth-popup card (which forces `fullscreenable: false` and bolts on a stream-breaking "Open as tab" bar). Discord pop-outs now open as a **normal resizable, fullscreenable window** pinned to the Discord session — fullscreen works and the broken chrome bar is gone.

## v2.27.19 (2026-06-19) — "Prevent from sleeping" per tab

### Added
- **Right-click a tab → ☕ Prevent from sleeping** — choose how long to keep it awake: **1 / 5 / 12 / 24 hours, Custom…, or Never (until reverted)**. Kept-awake tabs are skipped by auto-sleep + the memory-pressure guard, show a small ☕ marker, and the setting persists across restarts. Manual "Sleep Tab" still works (it overrides). Re-open the menu to change or "Allow sleeping again".

## v2.27.18 (2026-06-19) — Hotfix: Discord panel rendered blank

### Fixed
- **Discord panel showed only the top and went blank below** in v2.27.17 — the new back/forward bar restructured the panel into a flex column, but `showPanel` sets the panel's display inline, so the layout never applied and the webview collapsed. The nav buttons now **float over the panel** (the webview is never resized).

## v2.27.17 (2026-06-19) — Discord login in tabs + panel back/forward

### Added
- **Discord works in normal tabs through the bypass** — when the Discord bypass is on, `discord.com` / `discord.gg` / `discordapp.com` now route through it in regular tabs too (via a PAC script; everything else stays direct). Fixes the **OAuth "Login with Discord" authorize page** and "Open in Discord" links hanging on censored networks. (TCP only — voice still needs Zapret.)
- **Back / forward / reload bar on the Discord panel** — web Discord lacks the desktop app's history buttons, so the panel now has a slim nav bar (themed for Classic + Glass).

## v2.27.16 (2026-06-18) — "What's New" closes when you open the release

### Fixed
- The "What's New" modal now **closes automatically** when you click "View latest release on GitHub" (the release opens in your browser, so there's no reason to keep the modal up).

## v2.27.15 (2026-06-18) — "What's New" opens the latest release in your browser

### Fixed
- The **"View on GitHub"** link in the update-log modal now opens the **latest release** in your **system browser** (so GitHub renders properly), instead of an in-app window where its stylesheet could fail and show a bare navigation menu.

## v2.27.14 (2026-06-18) — Glass shortcuts bar (favicons + custom) & window-show fix

### Added
- **Glass shortcuts bar upgrade** — each shortcut now shows the site's **real favicon** (letter-chip fallback), an **＋ Add shortcut** button, and **right-click any shortcut → edit name / link / color, or delete**. Custom shortcuts persist.

### Fixed
- **Window sometimes opened in the taskbar but never surfaced** — the transparent/frameless window is now created hidden and shown only once it's painted (with a safety fallback), fixing the blank/unfocusable launch.

## v2.27.13 (2026-06-18) — Glass GUI, Discord voice/screen-share, Roblox panel, update logs

### Added
- **New "Glass" GUI Style** (Settings → GUI Style) — a whole-UI look you switch with one click: **tabs move on top**, a Chrome/Firefox-style **shortcuts bar** appears below the address bar, window controls move to the tab row, and the chrome + home page turn **frosted glass** with a soft glow. Self-contained palette (independent of your color themes); Classic stays the default.
- **Discord voice now captures your headset** — mic input *and* output/device selection work in the Discord panel (the media permission is auto-granted for the dedicated Discord session, which was previously blocked by a prompt that never surfaced).
- **Screen share / Go Live** — a proper "Choose what to share" picker (screens + windows, with thumbnails) for `getDisplayMedia`, including system-audio loopback.
- **Roblox as a sidebar panel** — opens `roblox.com` as a clean panel like Discord (replacing the old Roblox Hub), with a **🛡️ Block bypass** toggle that shares Discord's ByeDPI for censored networks.
- **Update logs ("What's New")** — after Vex auto-updates, a modal shows that release's notes pulled straight from the GitHub release. Re-openable anytime.

## v2.27.12 (2026-06-18) — The Roku Channel in the streaming switcher

### Added
- **The Roku Channel** (free, licensed) joins the streaming panel switcher — right-click the streaming icon → **📡 Switch to Roku Channel**, alongside Netflix / Prime Video / Disney+. Shares the same session and swaps the URL + icon.

## v2.27.11 (2026-06-18) — Discord bypass: one-click Auto-configure (now actually works)

### Added
- **🔧 Auto-configure bypass** (right-click Discord, and the auto "Discord looks blocked" popup) — sweeps every ByeDPI desync mode, **rigorously tests each against a real Discord handshake** (two requests must both pass, so a fluke doesn't win), shows a live "Testing mode X/N…" card, and keeps the first that genuinely works. Built-in light is only a last resort. Each mode's real result is logged to `userData/byedpi/sweep.log`.
- The bypass now **runs on startup** and, on success, **auto-reloads the Discord panel** so it just works with no blank flash.

### Fixed
- **ByeDPI presets that silently crashed** — `--md5sig` isn't supported by ByeDPI v0.17.3, so every preset using it exited immediately ("unknown option") and the sweep never reached a working mode. Presets reworked to valid flags only; the known-good `--fake -1 --ttl 8 --tlsrec 1+s` is tried first, plus `--fake-sni` (fake an allowed domain so the DPI whitelists the connection).
- The sweep no longer **short-circuits on the built-in light test** (which could pass without actually carrying the app) — ByeDPI desync modes are tried first.

### Changed
- Simplified the Discord right-click menu to **Auto-configure bypass** + **Turn bypass off (use Zapret)** — no more Light/Strong/preset/custom clutter.

## v2.27.10 (2026-06-18) — Stronger Discord bypass (ByeDPI, auto-tuning) [experimental]

### Added
- **Strong Discord bypass via ByeDPI** — right-click Discord → "Bypass: Strong (ByeDPI, auto-tune)". Vex downloads the official userspace ByeDPI (`ciadpi`) on demand and runs it as a local SOCKS5 desync proxy (split/disorder/fake-TTL/tlsrec) — the power of Zapret/GoodbyeDPI without admin. **Auto-tune** walks ~10 desync presets and keeps the first whose Discord TLS handshake actually completes; you can also force a specific preset or paste **custom ByeDPI flags**. ciadpi output is logged to `userData/byedpi/ciadpi.log`. Robust start (verifies it's listening, retries).
- Three bypass levels now: **Off** (use your own Zapret), **Light** (built-in DoH + SNI fragmentation), **Strong** (ByeDPI).

### Notes
- Experimental: desync effectiveness is ISP-specific and stateful, so it may be inconsistent; antivirus can flag `ciadpi.exe`. If none of the presets get through, run Zapret and set bypass to Off.

## v2.27.9 (2026-06-18) — Discord panel with block-bypass + Vencord support

### Added
- **Discord in the sidebar** — a Discord panel (its own `persist:discord` login), with a built-in **censorship bypass** for regions where Discord is blocked (e.g. Turkey): the session is routed through a local proxy that resolves over **DNS-over-HTTPS** and **fragments the TLS ClientHello inside the SNI** across two TCP segments (the GoodbyeDPI/ByeDPI/Zapret "split" technique). On by default, scoped to Discord only, fail-open; toggle via right-click → "Block bypass". Best-effort — a stubborn DPI may still need a dedicated tool.
- **One-click Vencord** — right-click the Discord icon → "Install / Update Vencord" downloads the official Vencord browser extension and loads it into the Discord panel (Vex now loads extensions into that session, and relaxes CSP there so Vencord can inject). Custom userplugins are supported by building Vencord's web extension (`pnpm buildWeb`) and loading it via Settings → Extensions.

## v2.27.8 (2026-06-17) — Search shortcuts, Master Volume, Netflix, image zoom

### Added
- **Search keywords & bangs in the address bar** — `yt cats` → YouTube, `gh vex` → GitHub, `w einstein` → Wikipedia, `a usb cable` → Amazon, etc., plus DuckDuckGo bangs anywhere (`!w einstein`, `einstein !yt`). Built-ins: `g · ddg · b · yt · gh · w/wiki · a/amazon · r/reddit · so · npm · mdn · maps · img · x/tw · imdb · tr`; add your own via `localStorage 'vex.searchKeywords'`.
- **Master Volume** — Quick Tools → "Master Volume": one slider (0–500%) for media across every tab and panel, in real time. Above 100% boosts via Web Audio (works on tabs/normal media); cross-origin and DRM media (Netflix/Disney+/Prime) are limited to 0–100% by design (their audio can't be amplified).
- **Netflix** — back as a sidebar panel (the "N", on its own `persist:netflix` session). **Right-click it to switch between Netflix / Prime Video / Disney+** — the icon changes to match and all three share one login jar.
- **Zoom image** — right-click any image → "Zoom image" opens a pan & zoom lightbox (scroll to zoom at the cursor, drag to pan, double-click to fit, Esc to close).

### Changed
- Relaxed the autoplay policy so AudioContexts start immediately — required for Master Volume's boost to engage.

## v2.27.7 (2026-06-17) — Power tools: selection AI, Read Free, Media Grabber, faster suggestions

### Added
- **Selection AI** — select text on any page and a floating **Explain / Summarize / Translate** bar appears above it (one gesture instead of right-click → menu). The right-click menu also gains **Summarize selection**, between Explain and Translate.
- **Read Free** — get past paywalls on the page you're reading (Quick Tools → 📰 Read Free, or Ctrl+K). Three tactics: **reset a metered paywall** (clears just that site's cookies + storage and reloads — resets "N free articles a month" counters), **open a free archived copy** on archive.today (for hard subscriber walls), or **reading mode**.
- **Media Grabber** — find and save video/audio playing on a page (Quick Tools → 🎬 Download Media, or Ctrl+K). Progressive files (mp4/webm/mp3/…) download in one click; HLS/DASH stream links can be copied/opened for VLC or yt-dlp. DRM/MSE video (YouTube, Netflix) can't be captured and isn't listed.

### Changed
- **Address-bar suggestions are much faster** — the Google-suggest debounce dropped from ~270 ms to ~80 ms, with a renderer-side cache (backspacing/re-typing is instant, no network) and a main-side LRU cache + request timeout. Feels like Chrome now.
- **Memory panel shows real numbers** — actual per-tab OS-process memory (was fixed 150/80/1 MB estimates), a true browser total, an "N asleep" count, and a `·shared` tag for same-site tabs that share a process.

### Fixed
- **Auto-sleep no longer silences audio** — auto-sleep, "Sleep inactive", and the memory-pressure guard now skip a tab that's actively playing audio (muted tabs are still fair game).

### Internal
- New `npm run smoke` — a real-Electron boot smoke test that asserts the renderer initializes (tab + webview render, core managers defined) in an isolated profile; catches "won't boot / renderer throws" regressions the unit tests can't.

## v2.27.6 (2026-06-17) — OAuth popups survive redirect-started flows + Peek-style login window

### Fixed
- **Discord/Ticket Tool login now actually completes.** v2.27.5 gated on the popup's *first* URL shape, but Ticket Tool opens its login popup at a non-OAuth-shaped bounce URL (`api.tickettool.xyz/api/auth/login`) that only *then* redirects into `discord.com/oauth2/authorize` → callback. `setWindowOpenHandler` never re-fires on in-window redirects, so the first-URL gate missed it and the popup still dead-ended in Peek. Vex now also keeps a popup real when it's a **scripted `window.open` popup** (disposition `new-window` *with* window features or a frame name) — a real opener-connected window in every browser, regardless of where it navigates next — so redirect-started OAuth flows survive. Bare shift+click (no features/name) still routes to Peek, unchanged.

### Changed
- **The login popup is dressed like the in-app Peek overlay again** — a compact, frameless rectangle centered over a dimmed Vex, with the Peek chrome bar (back · reload · URL · **Open as tab** · copy · close) overlaid on top. It stays a real `window.opener`-connected window (the Peek overlay itself can't host the opener, which is what broke the login), so the look is restored without breaking the handback. Drag the bar to move it; **Esc** or a backdrop click dismisses it; it auto-closes when the provider finishes.

### Notes
- This widens the opener-intact treatment from "OAuth-shaped URLs" to "any scripted `window.open` popup" — standard browser behavior; non-scripted navigations still route to tabs/Peek.
- `scripts/verify-oauth-popup-partition.js` gains **Scenario C** (bounce → OAuth redirect): proves the popup stays real with `window.opener` intact *through* the redirect, pinned to the opener's partition — a scenario the old first-URL gate cannot pass. 24/24 checks green; unit tests added for the scripted-popup detector.

## v2.27.5 (2026-06-17) — Fix: Discord (and other) OAuth logins failing in popups

### Fixed
- **OAuth logins that use a popup now complete and log the originating tab in** — previously a Discord-OAuth flow (e.g. the Ticket Tool dashboard at tickettool.xyz) had its auth popup routed into the Peek overlay, which severed `window.opener`, so after authorizing, the callback showed *"Login process is successful. But something went wrong…"* — the code exchange worked but the session handback to the tab failed. Vex now keeps **any OAuth-shaped popup** (not just the 4 hard-coded providers) as a real popup with `window.opener` intact, gating on URL *shape* — path `…/oauth2?/(authorize|auth)` or `…/auth/(authorize|callback)`, or `response_type=code`, or `client_id`+`redirect_uri` — instead of a host allowlist. The popup is also pinned **explicitly to the originating tab's session partition**, so the login cookie lands where the tab can read it — verified for container tabs (`persist:container-work`) and off-the-record tabs, not just the default session.

### Notes
- This widens the real-popup (opener-intact) treatment from the 4-host allowlist to any OAuth-shaped popup. That is standard browser behavior and applies only to OAuth-shaped popups (non-OAuth `window.open` popups still route to Peek); it does not change data isolation (the popup shares the opener tab's partition, as the allowlisted providers already did).
- New `scripts/verify-oauth-popup-partition.js` proves the popup's session in real Electron (identity, on-disk partition path, cookie landing, ephemeral OTR, `window.opener` non-null). Unit tests added for the OAuth-shape detector.

## v2.27.4 (2026-06-16) — "Copy Text from Doc" reliably gets the real Google Docs text

### Fixed
- **"Copy Text from Doc" now actually gets the real text from Google Docs instead of falling back to OCR.** The previous version fetched Google's `mobilebasic`/export endpoints from *inside* the editor page, where Google Docs' service worker intercepts the request and returns the canvas app shell (no real text) — so every text path looked blocked and it dropped to OCR. It now loads Google's plain-HTML render (`/mobilebasic` for Docs, `/htmlview` for Sheets) as a **real top-level navigation in a hidden, off-screen webview on your logged-in session** — the manual "change the URL to mobilebasic" trick, automated — and reads the rendered text. A real navigation gets the genuine text page, so you get exact text with no OCR mistakes. The in-page export fetch is now a secondary path and OCR is only a last resort. The result panel header shows which path ran ("Google Doc (real text)" vs "OCR (visible page)").

## v2.27.3 (2026-06-16) — "Copy Text from Doc" now gets the REAL text (no OCR mistakes)

### Changed
- **"Copy Text from Doc" now extracts the document's actual text first, like the dedicated "unlock copy" extensions — exact, no OCR errors.** Instead of jumping to OCR, it now fetches Google's own real-text render endpoints from inside the page (so they carry your Google login cookies), in order: **`/mobilebasic`** (Google's server-rendered plain-HTML version — gated differently from the download, so it still serves the real text on most copy-disabled docs), then **`/export?format=txt`**, then **`/export?format=html`**. Sheets use `export?format=csv` + `htmlview`; Slides use the text export. The first path that returns real content wins → exact text with zero mistakes. It detects sign-in / "request access" interstitials and skips them instead of returning a junk login page. **OCR (Tesseract.js, on-device) is now only a last resort** if Google hard-gates every text path.

## v2.27.2 (2026-06-16) — Copy text out of Google Docs & copy-locked pages

### Added
- **"Copy Text from Doc" — get the text out of Google Docs and copy-locked pages.** Copy Unlock (v2.27.0) re-enables selection of normal page text, but **Google Docs renders its text on a `<canvas>`**, so there's no selectable text to unlock — it needs a different approach. The new tool (Quick Tools menu → "Copy Text from Doc", or Ctrl+K → "Copy Text from Doc") gets the text two ways automatically: (1) **Google export fast path** — for Docs/Sheets it fetches the document's own `/export?format=txt|csv` endpoint *from inside the page*, so it carries your Google login cookies and returns exact text when you have view access; (2) **OCR fallback** — if export is blocked or the doc is canvas-rendered, it captures the rendered page and reads the pixels with Tesseract.js (loaded on demand, runs **entirely on your machine** — the image never leaves it). The extracted text is copied to your clipboard and shown in a panel you can select and edit. OCR works per visible screen (scroll + re-run for long docs); the export path needs you signed into Google with view access.

## v2.27.1 (2026-06-16) — Quick Tools menu in the top bar (puzzle button)

### Added
- **A "Quick Tools & Extensions" button in the top bar, just left of the AI button.** Click the puzzle icon for a one-tap menu of handy per-page tools — **Unlock Copy & Right-Click** (the new Copy Unlock feature, first in the list), Reading Mode, Dark mode for this site, Translate Page, Read Aloud, Zap Element, Boost This Site, Screenshot, Responsive Preview, and Privacy Report — plus **Manage Chrome extensions…** which opens Settings. Each item runs the same action as its command-bar entry, so behavior stays consistent. The popover is themed (matches every theme, light or dark), and dismisses on Esc or an outside click.

## v2.27.0 (2026-06-16) — Copy Unlock: bypass sites that block selecting & copying

### Added
- **Copy Unlock — re-enable selecting, copying, and right-click on sites that disable them.** Lots of pages turn off text selection and the right-click menu (via CSS `user-select:none`, `oncontextmenu` blockers, or capture-phase handlers that swallow `copy`/`selectstart`). Vex can now bypass that. Two ways to use it: **Ctrl+K → "Unlock Copy & Right-Click"** unlocks just the current page on demand (the "let me copy this" button), or turn on **Settings → Browsing extras → "Always allow copy & right-click (bypass site blocks)"** to apply it automatically on every page. The unlock re-enables selection via injected CSS, clears the inline `on*` blockers sites re-assign, and stops their capture-phase block handlers **without** calling `preventDefault` — so the native copy and context menu go through, and Vex's own mouse gestures keep working. Default is **off** so it never interferes with legitimate copy handlers in web apps (spreadsheets, code editors). Note: it can't read canvas-rendered editors like Google Docs (there's no selectable text there) and never touches DRM-protected media.

## v2.26.5 (2026-06-15) — Reliable build gate for invalid Widevine (VMP) signing

### Changed
- **The build now aborts when the Widevine signer falls back to a development/cached signature** — the deterministic signal that the app isn't validly signed for DRM (Spotify/Netflix). `scripts/vmp-sign.js` scans `sign-pkg`'s own output for "Certificate is valid for development only" / "Using cached signature" and fails the build with remediation steps. (v2.26.4 relied on `verify-pkg`, which proved unreliable as an in-build gate — it reported success in the build environment while failing standalone.) Set `VEX_SKIP_VMP_VERIFY=1` to build without DRM on purpose. **Fixing DRM requires a valid castLabs EVS signature** (`python -m castlabs_evs.account reauth` / `signup`, then rebuild) — it is not an app-code issue.

## v2.26.4 (2026-06-15) — Build fails loudly when the Widevine (VMP) signature is invalid (superseded by 2.26.5)

### Changed
- Attempted to gate the build on `vmp verify-pkg` after signing; this proved unreliable in the build environment (passed in-build while failing standalone) and is superseded by the output-detection gate in v2.26.5.

## v2.26.3 (2026-06-15) — DRM Retry now resets the stuck component-updater state

### Fixed
- **DRM Retry now actually recovers a stuck Widevine install.** On affected machines the standard Widevine CDM had registered but never finished downloading (empty `WidevineCdm` folder, no version recorded), and the component updater kept backing off — so clearing only the folder (v2.26.2) didn't help. Retry now also drops the updater's record of the Widevine components from `Local State` (preserving the encryption key that protects your saved passwords/cookies), so the relaunch re-downloads the CDM from scratch.

## v2.26.2 (2026-06-15) — DRM Retry now clears the cached component (clean re-download)

### Fixed
- **The DRM "Retry" button now clears the cached Widevine component before relaunching.** A plain relaunch didn't help when the first install left a partial/corrupted component on disk — the updater kept reusing the broken copy and failing every time. Retry now wipes the component cache under your profile so the relaunch re-downloads it cleanly.

## v2.26.1 (2026-06-15) — Resilient Widevine/DRM setup + Retry button

### Fixed
- **DRM ("Widevine") setup is now resilient and recoverable.** Settings → About could show *"DRM failed: …"* with no way to recover, and a stalled CDM download could even delay the main window. The castLabs Widevine component now initializes fire-and-forget (never blocks window creation), each attempt races a 30s timeout, and a slow first-run download gets a second attempt. When it does fail, **Settings → About now shows a Retry button** that relaunches Vex to re-run the install (the reliable fix for a transient first-run network failure), and the status re-polls so a slow download flips to "ready" on its own. Protected playback (Spotify/Netflix) works once the CDM reports ready.

## v2.26.0 (2026-06-15) — EasyList ad blocking, tab hibernation, per-site dark mode & privacy fixes

### Added
- **EasyList + EasyPrivacy ad/tracker blocking.** The request blocker now runs on the full EasyList + EasyPrivacy filter sets (via `@ghostery/adblocker`), a huge coverage jump over the previous hand-maintained domain list. It's wired surgically — Vex calls the engine's matcher inside its own request handler rather than handing over `webRequest`, so the tracker counter, per-partition wiring, and frame-ancestors stripping all keep working. The legacy list is still ORed in so nothing regresses, the engine never blocks page navigations, and the compiled engine is cached under your profile for instant, offline-safe startup.
- **Tab hibernation.** Background tabs left idle past a threshold (default 30 min; set `vex.tabHibernateMinutes` to `0` to disable) are suspended to free memory and reloaded when you click back. The active tab, audio-playing tabs, pinned tabs, and local/start pages are never suspended.
- **Per-site dark mode.** Right-click a page → **Dark mode for this site** to force-darken just that site (remembered per host). Right-click → **Reset this site’s settings** clears that site's saved zoom and dark-mode override. The old global force-dark toggle still works.

### Fixed
- **Favicons no longer leak your browsing to Google.** Tab icons previously came from Google's `s2/favicons` service, which told Google every domain you opened — at odds with Vex's tracker blocker. Vex now uses each site's own first-party favicon (with a clean placeholder fallback).
- **Client Hints now match the spoofed Chrome user-agent.** `Sec-CH-UA` request headers were still advertising Electron even with the Chrome UA set; they're now normalized to Chrome 124 on every tab session, so sites that sniff Client Hints (which most modern sites prefer over the UA string) see a consistent desktop Chrome.

## v2.25.3 (2026-06-15) — Fix site layouts broken by the consent blocker (e.g. Roblox footer mid-page)

### Fixed
- **Pages no longer render with misplaced content (Roblox showed its "About Us" footer in the middle of the game store page).** Vex's cookie/consent-banner blocker was injecting `html,body{position:static!important;overflow:auto!important}` into **every** page unconditionally. That override stripped the positioning context sites use to anchor elements to `<body>`, so Roblox's global footer dropped into the middle of the page. The scroll/position un-lock (which exists to undo a banner's scroll-lock) is now applied **only when an actual consent element is present** — re-checked briefly for banners that mount after load — so banner-free sites are left untouched. Cookie banners are still blocked as before.
- **Regular tabs now report the Chrome user-agent.** The Chrome UA spoof ("avoid unsupported-browser blocks") covered the default session and panel partitions but skipped `persist:main`, the partition every tab uses, so sites saw the raw Electron UA. `persist:main` now gets the Chrome UA too.

## v2.25.2 (2026-06-13) — Firebase sign-in popup no longer opens blank in Peek

### Fixed
- **"Sign in with Google" popups that loaded blank now complete.** The Firebase auth-handler popup (e.g. `elevenlabs.io/__/auth/handler`) was being routed into the Peek overlay, which severed `window.opener` so the popup could never hand the login back — it just sat white. Vex now opens the auth handler as a real popup window (matched by the `/__/auth/handler` path, since it lives on the site's own domain), keeping the opener intact. Together with v2.25.1 this fixes federated sign-in on ElevenLabs and similar sites.

## v2.25.1 (2026-06-13) — "Sign in with Google" works again (Firebase redirect logins)

### Fixed
- **Federated sign-in (e.g. "Sign in with Google" on ElevenLabs and other Firebase sites) no longer fails** with *"Unable to process request due to missing initial state."* Chromium's third-party storage partitioning was isolating the auth-handler's storage so the redirect couldn't read its own login state. Vex now disables that partitioning, restoring redirect-based logins. (Vex's ad/tracker blocker still handles the cross-site tracking that partitioning was guarding against.)

## v2.25.0 (2026-06-13) — Customize every left-sidebar button

### Added
- **Every left-sidebar button can now be customized**, not just the web-app ones. **Right-click any button** → Rename, Change icon, Hide, Reset. Buttons that open a website (Claude/Spotify/WhatsApp, pinned sites) also get **Change link** + service switch.
- **Settings → Sidebar Buttons** — a master list to **rename, change icon, change link (web buttons), show/hide, and reorder** every button, and the place to **restore hidden buttons** (previously there was no way back once a button was hidden).

### Fixed
- The sidebar right-click menu no longer leaves an invisible overlay behind after you pick an item (same class of bug fixed for the tab/group menus).

## v2.24.1 (2026-06-13) — Clicked links open with Vex on cold start

### Fixed
- **Clicking a link when Vex isn't already running now opens the link**, not just the browser. On a cold launch the link arrived before the page had finished wiring up its handler, so it was dropped and Vex showed the start page. Vex now buffers the incoming link until the page is ready and then navigates to it. Verified in real Electron.

## v2.24.0 (2026-06-13) — Group colors actually change + match every theme

### Fixed
- **Changing a tab group's color now actually changes it.** Group pills on the top bar were all rendering the *same* color no matter what you picked. Root cause: the pill color was being computed on the page root (where the group's own color isn't known), so every group fell back to one fixed default. The color is now computed on each group's own pill, so picks are distinct and apply immediately. Verified in real Chromium across themes, not just unit tests.
- The group/tab/stack right-click menus no longer leave an invisible full-screen overlay behind that could swallow your next click.

### Changed
- **Group colors now match every theme — and re-match when you switch themes.** Colors are stored as theme references and the choices are drawn from the active theme's palette, so a group is Dracula's purple in Dracula and Ocean's cyan in Ocean — switching themes recolors your groups live. New groups default to the current theme's accent. This applies to **AI-created groups** too (auto-grouper and the AI tab command) — they map onto the theme palette and re-theme like manual groups.

## v2.23.0 (2026-06-13) — Wizard shows everything + all settings re-editable

### Changed
- **Reopening the setup wizard now shows every step**, pre-filled with what you've already saved and tagged **“✓ already set”** — nothing is hidden, so theme, GitHub, and Local AI (Ollama) always appear. Each AI backend (Cloud / Ollama / On-device) is judged independently, so having cloud AI no longer hides the Ollama step.

### Added
- **Weather location is now editable in Settings → Personalization**, with the same district pick-list as the wizard (search → pick “Ataşehir · İstanbul · Türkiye”). Shows your current location too.
- **“Choose a theme…” button in Settings** opens the theme picker, so theme is reachable from Settings as well.
- Editing your **display name, GitHub username, search engine, or weather** in Settings now updates the start page **immediately** (previously some only applied after a restart).

## v2.22.0 (2026-06-13) — Fuller setup wizard + district-accurate location

### Added
- The setup wizard now covers **a lot more**: default **search engine**, **make Vex your default browser**, the three AI backends as **separate steps** (Cloud / Claude, local **Ollama** with a one-click detect, and **on-device** WebGPU), **Vex Sync**, and adding your first login to the **password manager** — on top of theme, name, weather, and GitHub.
- **District-level location.** Weather location now searches up to 5 matches and lets you pick the exact one shown as *“Ataşehir · İstanbul · Türkiye”* — so districts resolve correctly instead of snapping to a stray top hit. Applies to both the setup wizard and the start-page location button.

### Changed
- Resume logic understands the new steps: configuring **any one** AI backend clears all three AI steps (you’re never nagged to set up Ollama after you’ve set up cloud AI), and each other step disappears once its value is saved.

## v2.21.0 (2026-06-12) — Update prompt + resumable setup wizard

### Added
- **Update available popup.** A few seconds after launch (and from Settings → Check for Updates), if a newer version exists Vex shows a prompt with a **Download** button that grabs the new installer directly. Uses the lightweight HTTPS version check, so it can't crash the app like the old auto-updater path.
- **Setup-wizard button** in the top bar, just right of the reload button — re-open the onboarding wizard anytime if you skipped it during first run.

### Changed
- The onboarding wizard now **resumes instead of restarting.** Re-opening it shows only the steps you haven't completed yet (theme, name, weather, GitHub, AI) and skips the ones already set — so pausing part-way doesn't make you redo everything. If nothing's left, it just says you're all set.

## v2.20.3 (2026-06-12) — Theme previews actually render now

### Fixed
- The theme preview thumbnails were **collapsing to zero size**, so every card showed only a flat colored label bar instead of the preview. Two layout bugs caused it: the thumb used `aspect-ratio` for its height (which computes nothing when its only child is absolutely positioned), and the card is a `<button>`, whose UA default `align-items: flex-start` stopped the thumb from stretching to full width. The thumb now has an explicit width and height, so the detailed mini-window preview renders for every theme. Verified by capturing the real picker CSS, not a simplified mock.

## v2.20.2 (2026-06-12) — Bulletproof theme previews

### Fixed
- Theme previews were rendering as **flat color blocks** in the installed app (the container-query CSS they relied on didn't apply in that context). Each preview is now drawn with **inline styles only** — no external CSS classes, no CSS variables, no container queries — using each theme's real colors read directly from its stylesheet. Every theme (originals and new alike) now shows the identical detailed Vex window, and the previews can't be defeated by stale, cached, or overridden styles.

## v2.20.1 (2026-06-12) — Detailed live previews

### Changed
- The live theme previews are now the **detailed** Vex window (top bar, sidebar, tab, and the full Vex Sync settings content) — the same rich look the new themes had — rendered live from CSS in each theme's colors. Every theme's preview is identical in style and never an image file.

## v2.20.0 (2026-06-12) — Live theme previews + sidebar fixes

### Changed
- **Theme previews now render live from CSS** in each theme's own colors — no image files at all. Every theme (originals included) is the exact same format, and previews can never be stale, cached, or mismatched between builds again.

### Fixed
- The **close-sidebar button** (next to the Vex Sync icon) now collapses the **entire** left sidebar — icon rail included; click again to reopen. Removed the duplicate toggle that was next to the AI button.

## v2.19.1 (2026-06-12) — Sidebar toggle by the sync icon

### Added
- A **close/open left sidebar** button in the top bar, right next to the Vex Sync icon (also still on Ctrl+B and in the tabs header).

## v2.19.0 (2026-06-12) — Force-refresh theme previews

### Fixed
- **Theme previews now always reload after an update** — preview images are cache-busted by app version, so the regenerated (uniform) previews show instead of stale cached screenshots. All 35 themes share one identical preview style.

## v2.18.0 (2026-06-12) — Favorite themes + 6 more themes

### Added
- **Favorite themes** — hover any theme card in the picker (Ctrl+Shift+Y or the start-page Theme button) and click the **star** to favorite it. Starred themes appear in a **★ Favorites** section at the top of the picker.
- **6 more themes** — Ruby, Lime, Bronze, Plum, Arctic, and Wine (35 total).
- All previews remain one consistent generated style.

## v2.17.0 (2026-06-12) — 8 more themes + uniform previews

### Added
- **8 new themes** — Slate, Emerald, Amethyst, Volcano, Sapphire, Honey, Mint, and Obsidian (29 total).

### Changed
- **All theme previews now use one consistent style** — every theme card is the same full-app render in its own colors, so the whole picker is uniform.

## v2.16.5 (2026-06-12) — Revert to the original previews

### Fixed
- Restored the **original theme preview screenshots** (the real ones that were always there). v2.16.4 had overwritten them with a generated render — reverted to the v2.16.3 state (original screenshots for the first themes; matching previews for the newer ones).

## v2.16.3 (2026-06-12) — Restore original previews, match the new ones to them

### Fixed
- **Restored the original theme preview screenshots** (Oxford, Ocean, Midnight, etc.) that v2.16.2 had overwritten, and regenerated the new themes' previews in the **same full-app style** (top bar, sidebar, tabs, Settings content) at the same 1400×600 — so every theme's preview now looks consistent with the originals.

## v2.16.2 (2026-06-12) — Real preview screenshots for every theme

### Changed
- **Every theme now has a real screenshot preview** in the picker (not a flat swatch or mini-mockup) — all 21 themes are rendered consistently as an actual Vex window in their own colors. Regenerate anytime with `npm run capture-themes`.

## v2.16.1 (2026-06-12) — Widevine/DRM status

### Added
- **DRM (Widevine) status in Settings → About** — shows whether protected playback (Spotify, Netflix) is actually enabled, so you can tell at a glance if DRM is ready, loading, or only works in the installed build.

### Note
- Protected (DRM) playback requires the **installed, VMP-signed build** — it won't work when running Vex from source (`npm start`). If Spotify says "Playback of protected content is not enabled", check the new DRM line in Settings → About.

## v2.16.0 (2026-06-12) — Theme previews + 6 more themes

### Added
- **6 more themes** — Aurora, Crimson, Gold, Sakura, Cyberpunk, and Monochrome (21 themes total).
- **Live preview cards** — themes without a screenshot now render a real mini-UI mockup (sidebar, tabs, toolbar, text, accent button) drawn from their own palette, so every theme in the picker looks like a proper preview instead of a flat swatch.

## v2.15.1 (2026-06-12) — Fix "Check for Updates"

### Fixed
- **"Check for Updates" no longer closes the app.** It was invoking electron-updater's native checker, which on this build can spawn native helpers that crash the process. The manual check is now a lightweight HTTPS version lookup (fetches the latest release's version and compares) — it can't take the app down, tells you if you're up to date, and links straight to the download when a newer version exists.

## v2.15.0 (2026-06-12) — Search engines, more themes, custom wallpaper & more

### Added
- **Search engine picker** on the start page — click the engine button in the search bar to choose **Google, Bing, DuckDuckGo, Brave, Startpage, Ecosia, or YouTube**. The bar shows which one is active ("Search with DuckDuckGo…") and Enter sends your query there. Your choice is remembered.
- **Sidebar collapse button** — a chevron in the tabs header collapses/expands the left sidebar (still on Ctrl+B; the top-bar button reopens it too).
- **6 new themes** — Sunset, Rosé, Matrix, Mocha, Solarized, and Vaporwave, on top of the existing 8.
- **Custom Image theme** — in the theme picker, choose **Custom Image** and upload any picture; it becomes your start-page wallpaper (auto-downscaled, with a readability scrim) paired with a clean graphite-dark UI.
- **Download an on-device model during setup** — the first-run wizard's AI step now lets you pick and download a WebGPU model right there (where supported).

### Changed
- **Weather shows °C** instead of °F.

## v2.14.0 (2026-06-12) — First-run setup wizard

### Added
- **First-run setup wizard** — on a fresh install, Vex now walks you step-by-step through setting up each tool: pick a **theme**, your **name**, **weather** location, **GitHub** username, and **AI backend** (cloud worker URL / detect Ollama / on-device later). Every step has a **Skip**, and there's a **Skip setup** to bail entirely. Re-run anytime via Ctrl+K → "Run Setup Wizard". Existing installs never see it.

### Changed
- **Weather now shows °C** instead of °F on the start page.

## v2.13.0 (2026-06-12) — Theme button on the start page

### Added
- A **Theme** button in the top-right of the start page — click it and the full theme picker (all 8 themes with previews) appears. Picking one re-themes the whole browser instantly.

## v2.12.0 (2026-06-12) — Daily verse, weather location & Spotify playback

### Added
- **Daily Qur'an verse (Turkish)** on the start page, under the greeting — a different ayah each day (Diyanet translation), cached so it's stable through the day and silently hidden if offline.
- **Set location for weather** — a "📍 Set location" button next to the Weather widget. Type your city (geocoded via Open-Meteo) and the weather switches to it; the button disappears once a location is saved. Stored locally only.

### Fixed
- **Built-in Spotify can play now.** Two causes: the Widevine DRM component wasn't being initialized (castLabs Electron needs `components.whenReady()` before any EME playback), and the `mediaKeySystem` permission was being prompted (and silently failing in the panel) instead of auto-allowed like a normal browser. Both fixed — Play and other playback controls work in the Spotify panel.

## v2.11.5 (2026-06-12) — Spinner fix

### Fixed
- **Loading spinners no longer jump up-and-left each cycle.** The shared `spin` keyframe baked in a `translate(-50%,-50%)` that only the centered webview loader needed, so every other spinner (AI panel "Thinking", history, sync, generic) skipped on loop. The generic spinner now rotates cleanly in place; the centered loader keeps its own keyframe.

## v2.11.4 (2026-06-12) — AI Backend refresh button

### Added
- A **Refresh** button right next to the "Local (Ollama)" status in Settings → AI Backend, so you can re-check Ollama on the spot (it re-pings and reloads the model list). The existing "Refresh Ollama Status" button still works too.

## v2.11.3 (2026-06-12) — Settings scroll fix

### Fixed
- **Settings scrolls again** while the category bar stays pinned. v2.11.2 pinned the header but accidentally killed scrolling (the panel toggles `display:block`, which overrode the flex layout). The header is now an absolutely-pinned overlay and the list keeps its normal scroll — best of both.

## v2.11.2 (2026-06-12) — Settings header fix

### Fixed
- **Settings category bar genuinely stays pinned now** — `position: sticky` wasn't holding in this layout, so the search + category chips are now a fixed header above the scroll area instead. Scroll the settings and the chips stay put.

## v2.11.1 (2026-06-12) — Fixes

### Fixed
- **On-device AI chat hung on "Thinking…"** — the local path was forcing JSON-grammar generation, which stalls small WebGPU models. On-device chat now uses a plain-text prompt (so it actually responds), is scoped to chat only, and has a 120s timeout that falls back to cloud/Ollama if anything stalls — so the spinner can never loop forever.
- **Settings category bar now stays pinned** while you scroll (the sticky styling moved onto a solid toolbar wrapper).

### Added
- **Search bar in Settings** — filter all settings by keyword; the category chips hide while searching.

## v2.11.0 (2026-06-12) — Screenshot-to-code + MCP tools in the agent

### Added
- **Screenshot → Code** (Ctrl+K → "Screenshot → Code") — capture the current page and have AI rebuild it as a single self-contained file. Choose **Plain HTML+CSS**, **HTML+Tailwind**, or **React (CDN)**, then preview the result in a new tab or copy the code. The screenshot is downscaled client-side before upload to keep it fast and cheap. *(Requires the AI worker redeployed with the new `screenshot-to-code` vision action — the app shows a clear message if your worker is older.)*
- **MCP tools in the agent** — tools from your connected MCP servers are now offered to the autonomous agent alongside its built-in actions (namespaced `mcp__…` so they never collide). Ask the agent to do something a connected MCP server can handle and it can call that tool directly, feeding the result back into its reasoning. The standalone MCP explorer from v2.10.0 still works for manual calls.

## v2.10.0 (2026-06-12) — MCP client

### Added
- **MCP Servers** (Settings → MCP Servers, or Ctrl+K → "MCP Servers & Tools") — connect Vex to **Model Context Protocol** servers over HTTP. Add a server (URL + optional bearer token), Vex performs the MCP handshake and lists the server's tools, and a built-in **explorer** lets you pick a tool, fill in JSON arguments (pre-skeletoned from the tool's input schema), and run it — seeing the result inline. JSON-RPC traffic is proxied through Vex so there are no CORS limits, and both plain-JSON and SSE responses are handled.
- Scope note: this is a standalone MCP client/explorer; wiring MCP tools into the autonomous agent is a planned follow-up, kept separate so the stable agent is untouched.

## v2.9.0 (2026-06-12) — On-device AI (WebGPU)

### Added
- **On-Device AI** (Settings → On-Device AI, or Ctrl+K → "On-Device AI") — run a small LLM **entirely on your machine** via WebGPU: private, offline, no server. Pick a model (Llama 3.2 1B/3B, Qwen 2.5 1.5B, Phi 3.5 mini), press **Download & load** (weights download once and cache), and flip on "Use on-device AI for chat & summaries". Chat / summarize / explain / translate then run locally; agent & multi-tab still use cloud.
- Fully opt-in and safe: nothing downloads until you ask, WebGPU is feature-detected (the option explains itself if your device lacks it), and the router **falls back to cloud/Ollama automatically** if on-device isn't ready or errors. Your model choice is remembered.

## v2.8.0 (2026-06-12) — Cross-site tracker insights

### Added
- **"Following you across sites"** in the Privacy Report (Ctrl+K → "Privacy Report") — Vex now records *which of your sites* each blocked tracker appeared on, and surfaces the ones seen on multiple sites: the companies actually following you around the web, ranked by reach, with the site list. Turns the raw block count into a real privacy picture (Ghostery/Disconnect-style).

## v2.7.0 (2026-06-12) — Persistent AI memory

### Added
- **AI Memory** (Settings → AI Memory) — tell Vex facts and preferences to keep in mind in *every* chat: your name, role, tone ("answer concisely"), languages, tech stack, location… They're injected as context on each AI request, so the assistant stops forgetting who you are between sessions.
- **Remember a fact** (Ctrl+K → "AI: Remember a Fact") — jot a memory from anywhere without opening settings.
- Works on **both** the local (Ollama) and cloud backends — no worker change needed — and is purely additive (never overrides your persona or the default prompt). Memory is per-device but **syncs across your devices** when Vex Sync is on. Toggle it off anytime; nothing is sent until you add a fact.

## v2.6.0 (2026-06-12) — Developer & power tools

### Added
- **API client** (Ctrl+K → "API Client") — a built-in REST client: pick a method, set headers and a body, hit Send, and browse the response as a collapsible, syntax-coloured JSON tree (or raw text). CORS-free (runs in main, like curl); shows status, time, and size.
- **Format JSON** (Ctrl+K → "Format JSON") — turn the current raw-JSON tab into the same collapsible tree.
- **Responsive Preview** (Ctrl+K → "Responsive Preview") — see the current page side-by-side at iPhone SE / iPhone 14 / iPad / laptop / desktop widths in one overlay, with reload-all. Polypane-lite for checking responsive layouts.
- **Watch This Page** (Ctrl+K) — Vex periodically refetches a page, strips it to text, and **alerts you when it changes** (restocks, docs, status pages, listings). Manage everything in **Watched Pages**; optional OS notifications. Each watch runs on its own interval.
- **Wayback archiving** — "Save to Wayback Machine" preserves the current page on web.archive.org; "View Archived Version" (also on right-click → links) opens the latest snapshot to recover dead/changed links.

## v2.5.0 (2026-06-12) — Privacy hardening pack

### Added
- **Fingerprint protection** (Settings → Privacy Hardening, default off) — Brave-style "farbling" injects tiny, per-session, imperceptible noise into the canvas / WebGL / audio readouts that tracking scripts hash to fingerprint you, and normalizes `hardwareConcurrency` / `deviceMemory` / GPU strings. The noise is consistent within a session (sites still work) but changes every launch, so you can't be silently linked across sites or over time. Applies to pages opened after toggling.
- **DNS-over-HTTPS** (Settings → Privacy Hardening, default off) — encrypt your DNS lookups via Cloudflare, Google, or Quad9. *Opportunistic* (safe, falls back to system DNS) or *Strict* (DoH only). Applies browser-wide immediately via Chromium's secure resolver.
- **Privacy Report** (Ctrl+K → "Privacy Report", or the button in Settings) — a live shield showing how many trackers/ads were blocked this session, the top blocked domains, and your fingerprint + DNS protection status. Reset counters anytime.
- The existing ad/tracker blocker now **tallies** what it stops so the report has real numbers.

## v2.4.0 (2026-06-12) — Reading pack: highlights, recall & accessibility

### Added
- **Persistent highlights** — select text on any page and highlight it (Ctrl+K → "Highlight", or right-click → Highlight; yellow/green/pink). Highlights are stored locally per-URL and **reappear every time you revisit the page**. Add a note to any highlight. New **Highlights** sidebar panel lists every highlight across all pages, grouped by page, with a count badge.
- **Recall ("memex")** — full-text search of everything you've read. As you browse, the readable text of each page is indexed locally (capped, stored in `userData/recall.json`, never uploaded). The new **Recall** sidebar panel finds any page by its *content* — "that paragraph about DPI throttling" — not just its title. Off-the-record/container/file pages are never indexed. Toggle + clear in Settings → Recall.
- **Reading & Accessibility pack** (Settings → Reading & Accessibility), applied to every page:
  - **Dyslexia-friendly fonts** — Lexend, Atkinson Hyperlegible, OpenDyslexic.
  - **Color-vision filters** — protanopia / deuteranopia / tritanopia simulation + grayscale (feColorMatrix).
  - **Reading ruler** — a translucent bar that follows your cursor to keep your place.
  - **Bionic Reading** (Ctrl+K) — bolds the start of each word to speed reading; run again to undo.
  - **Speed Read / RSVP** (Ctrl+K) — flashes the article one word at a time at an adjustable 150–900 WPM.
  - **Translate Selection** (Ctrl+K) — translate highlighted text into your language inline.

## v2.3.2 (2026-06-12) — Adaptive memory guard

### Added
- **Memory guard** (Settings → Performance) — when total browser memory crosses a ceiling (default 1.2 GB), Vex sleeps the least-recently-used background tabs (never the active or pinned ones) until back under. Light sessions are untouched; heavy ones stay capped, keeping Vex near its floor without disrupting normal use. Off / 0.9 / 1.2 / 1.6 / 2.4 GB.

## v2.3.1 (2026-06-12) — Lazy session restore (big memory win)

### Changed
- **Lazy session restore** — on launch, only the focused tab loads a webview; the rest of your saved session restores as lightweight placeholders (title + favicon) and materializes the instant you click them. On a real session this cut startup memory by ~60% (≈950 MB → ≈390 MB private). Sleeping tabs and tab groups are unaffected; auto-sleep skips not-yet-loaded tabs.

## v2.3.0 (2026-06-12) — Library, AI tab commands & the works

### Added
- **Read Later / Library** — save pages to a queue (Ctrl+K → "Read Later"), unread badge on the new Library sidebar panel; opening marks read.
- **Auto-archive** — tabs untouched for N days (Settings → Library) close into the Library archive instead of rotting open.
- **Clip to Notes** — selected text (or the page link) saved into a pinned "Clippings" note with source + date.
- **AI Tab Commands** — "close all YouTube tabs", "group my shopping tabs": AI plans, you confirm, it applies.
- **Now Playing** — a mini bar for tabs making sound: play/pause, mute, jump-to-tab.
- **Pin Site to Sidebar** — keep any site as a Vivaldi-style web panel (right-click its icon to unpin).
- **Off-the-Record tab** — ephemeral tab: no history, cookies vanish on close.
- **Boss key** — Ctrl+Alt+H hides + mutes every Vex window instantly; again to restore.
- **Reverse-image search** — right-click any image → Search with Google Lens / copy / open.
- **QR code** — Ctrl+K → "QR Code" to open the current page on your phone.
- **Per-tab volume** — tab right-click → "Page volume…".
- **Resource Monitor** — live CPU/memory per browser process.
- **Quick slots** — Ctrl+Alt+1/2/3 run your first three command chains.
- **Ambient grouping** — links opened from a grouped tab join that group automatically.

## v2.2.0 (2026-06-12) — Focus, gestures, bookmarks, feeds & more

### Added
- **Focus Mode** — Ctrl+K → "Focus 25/50": hides all chrome and blocks distracting sites (editable blocklist in Settings → Focus) for the session.
- **Compact Mode** — collapse both sidebars for maximum page space (persists).
- **Mouse gestures** — hold right button and drag: ← back, → forward, ↑ top, ↓ reload, ↓→ close tab, ↓← reopen.
- **Bookmarks** — ☆ in the URL bar + a Bookmarks sidebar panel with folders and search.
- **Feeds (RSS)** — a minimal, algorithm-free feed reader panel.
- **Read Aloud** — text-to-speech for the current article.
- **AI Compose** — AI writes/rewrites text straight into the focused input on the page.
- **Command Chains** — run several command-bar actions as one command (Settings → Command Chains).
- **Container tabs** — Work/Personal/Shopping tabs with isolated cookies (log into two accounts at once).
- **Cookie-banner auto-hide** — major consent walls are hidden and scroll unlocked (toggle in Settings).
- **Screenshot annotation** — pen/box/arrow editor on captured screenshots.
- Sync worker: no-email dev fallback for sign-in (returns the code when RESEND_API_KEY is absent).

## v2.1.0 (2026-06-12) — Peek, Skills, Boosts, Handoff & Passwords

### Added
- **Peek** — Shift+click any link to preview it in a floating overlay; Esc dismisses, Ctrl+Enter (or one click) promotes it to a real tab.
- **AI Skills** — saved, reusable AI commands ("Summarize in 5 bullets", "Explain like I'm 5", …) that run on the current page from the command bar; create your own in Settings → AI Skills.
- **Boosts** — per-site customization: **Zap Element** (Ctrl+K) hides any element forever on that site; **Boost This Site** opens a custom CSS/JS editor. Managed in Settings → Boosts.
- **Send to Phone / Handoff** — push the current tab to your other Vex devices via the sync worker (Ctrl+K → "Send to Phone"); tabs sent from Vex Mobile open here automatically. Requires Vex Sync sign-in.
- **Password manager** — Vex offers to save logins as you sign in, autofills them on return visits, and lists them in Settings → Passwords. Encrypted at rest with the OS keychain (safeStorage/DPAPI); never-save list per site.

## v2.0.5 (2026-06-12) — Settings glow-up & customizable sidebar

### Added
- **Customizable sidebar buttons** — right-click a service icon (Claude / WhatsApp / Spotify) to **Rename**, **Change icon** (15-icon picker), **Change link**, **Delete (hide)**, or **Reset**. Claude can one-click **Switch to Claude / Gemini / ChatGPT**. Customizations persist across launches.

### Changed
- **Settings redesign** — the flat list is now vivid, color-coded **category cards** with icons, a sticky category nav to jump between sections, and livelier toggles/inputs/buttons. All existing settings and handlers are unchanged.

## v2.0.4 (2026-06-12) — Guided tour

### Added
- **Interactive tour** — a spotlight walkthrough that highlights every control (address bar, vertical tabs, workspaces, command bar, AI agent, split screen…) with tooltips and Back / Next / Skip. Offered automatically on first run; replay anytime via `Ctrl+K` → "Tour".

## v1.2.0 (2026-04-16) — Polish & Cleanup

### Changed
- Removed duplicate AI button from sidebar — top-bar button is now the single entry point
- Settings About: prominent version display with Electron/Chromium versions
- Unified toast notifications (slide-in from right, color-coded borders)
- Workspace accent color stripe at top of window

### Added
- Copy URL button in URL bar
- Middle-click to close tabs
- Double-click URL bar to select all
- Electron + Chromium version info in Settings About
- "Report Issue" link in Settings
- Update check timestamp persistence

### Fixed
- AI panel no longer registered in sidebar panel system
- Consistent spinner and empty state CSS classes available globally

## v1.1.0 (2026-04-16) — Multi-Tab AI
- Tab selector: Current/All/Group/Custom tab selection modes
- Cross-tab AI reasoning with comparison tables
- Multi-tab context extraction (parallel, 60K char budget)
- "Compare tabs" and "Summarize tabs" quick actions + commands

## v1.0.0 (2026-04-16)

### Features
- Vertical tabs with drag reorder and tab groups
- Sidebar panels: WhatsApp, Claude AI, CUSA, Roblox, GitHub
- Custom start page with editable shortcuts, weather, GitHub stats
- Command bar (Ctrl+K) with URL, search, and AI mode
- Ad/tracker blocker with 40+ domains
- Tab sessions, workspaces (Personal/CUSA/School/Dev)
- Notes panel with markdown preview
- Downloads manager with progress tracking
- Full browsing history with search and date filters
- Memory panel with per-tab usage and sleep mode
- Auto-sleep inactive tabs
- Tab restore on relaunch, recently closed tabs (Ctrl+Shift+T)
- Theme editor with 7 presets + custom colors
- Reading mode, translate, screenshots
- Zoom per-domain persistence
- Tab preview on hover
- F11 fullscreen with auto-hiding sidebars
- Per-video PiP button overlay
- Tab audio indicator + mute (Ctrl+M)
- Incognito/private windows
- Tab pinning (icon-only mode)
- AI assistant panel with page context awareness
- AI agent with 19 tools (navigate, click, type, extract, etc.)
- 3 permission modes: Ask, Plan, Auto
- Scheduled AI tasks with templates
- Auto-updater with GitHub Releases
- Windows installer (NSIS) with Start Menu + Desktop shortcuts
