# Changelog

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
