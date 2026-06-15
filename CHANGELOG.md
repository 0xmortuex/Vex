# Changelog

## v2.26.4 (2026-06-15) — Build fails loudly when the Widevine (VMP) signature is invalid

### Changed
- **The build now verifies the VMP signature and fails if it's invalid.** Root-causing the persistent "DRM failed" reports showed the packaged app was being signed with an invalid/dev fallback signature (`vmp verify-pkg` → `InvalidSignature`), which makes castLabs' component server withhold the software Widevine CDM — so DRM playback silently broke. `scripts/vmp-sign.js` now runs `vmp verify-pkg` after signing and aborts the build (with remediation steps) instead of shipping a broken-DRM build. Set `VEX_SKIP_VMP_VERIFY=1` to build a knowingly-unsigned dev build. **Fixing DRM requires a valid castLabs EVS signature** (`python -m castlabs_evs.account reauth` / `signup`, then rebuild) — it is not an app-code issue.

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
