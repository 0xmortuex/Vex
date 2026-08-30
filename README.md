<div align="center">

# Vex

### A browser built just for you.

A fast, private, deeply customizable desktop browser built on Electron + Chromium — with a built‑in AI agent, real DRM streaming, Tor & censorship bypass, password/2FA/email‑code autofill, sidebar apps, split screen, and a UI you can literally rearrange to the pixel.

[![Latest release](https://img.shields.io/github/v/release/0xmortuex/Vex?label=download&style=flat-square)](https://github.com/0xmortuex/Vex/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-42.5.2%20(castLabs)-47848F?style=flat-square)
![Chromium](https://img.shields.io/badge/Chromium-148-4285F4?style=flat-square)

**[⬇ Download the latest release](https://github.com/0xmortuex/Vex/releases/latest)** · **[🌐 Website](https://0xmortuex.github.io/vex-website/)**

</div>

---

## What is Vex?

Vex is a Chromium desktop browser (via [castLabs Electron](https://github.com/castlabs/electron-releases), so **Widevine DRM works** — Netflix, Spotify, Prime, Disney+ all play). It pairs a private, ad‑free, resource‑light browsing core with an unusually deep set of built‑in tools: an AI assistant that can act on your tabs, sidebar app panels, Tor and DPI‑bypass privacy, encrypted sync, and a customize‑everything UI. Nothing here is a paid add‑on — it's all in the browser.

> **Windows 10/11 · 64‑bit.** Install the signed build from [Releases](https://github.com/0xmortuex/Vex/releases/latest) (DRM/Widevine only works in the signed build). Auto‑updates built in.

---

## Highlights

- 🧠 **Built‑in AI agent** — chat over your pages, "close all YouTube tabs" in plain English, screenshot‑to‑code, summarize/translate, content‑search everything you've read. Cloud (your own Claude worker), local (Ollama), or fully on‑device (WebGPU).
- 🔒 **Private by default** — ad + tracker blocking (network *and* cosmetic), fingerprint protection, DNS‑over‑HTTPS, HTTPS‑only, one‑click Tor, and a DPI/censorship‑bypass proxy — no VPN, no admin.
- ▶️ **Real streaming** — Widevine DRM playback for Netflix/Spotify/Prime/Disney+, plus codec fallbacks so short‑video sites just play.
- 🎨 **A browser built for you** — drag‑rearrange the entire toolbar & sidebar, Classic or frosted **Glass** UI, per‑site profiles, shareable setups, themes.
- 🧩 **Sidebar apps** — Discord, WhatsApp, Spotify, Netflix, Claude, GitHub, Roblox and any site you pin — each in its own isolated session, with unread badges.
- 🔐 **Autofill that actually works** — encrypted password vault, built‑in 2FA authenticator with autofill, and email verification‑code autofill.
- 💤 **Light on resources** — auto‑sleep/hibernate idle tabs (with a "never sleep" you can trust), a memory‑ceiling guard, and a Tab Health dashboard.

---

## Every feature

### 🗂 Browsing & tabs
- **Tabs your way** — horizontal (Chrome‑style top bar) or **vertical** (left sidebar) layout.
- **Tab groups + AI auto‑grouping** — clusters open tabs into named groups and remembers the pattern so future tabs auto‑join (`Organize My Tabs`, `Ctrl+Shift+G`).
- **Tab sleep / wake / hibernate** — idle tabs sleep with scroll restore; **Tab Health dashboard** shows every tab by state (active · kept‑awake · awake · hibernated · sleeping · not‑loaded) with live memory and one‑click sleep/wake/keep‑awake.
- **"Never sleep" (keep awake)** — pin a tab so it stays live and loaded in the background (right‑click a tab → ☕).
- **Split screen** — 2, 3, or 4 panes side‑by‑side (2×2 for four) — `Ctrl+Shift+S`.
- **Tab preview on hover**, **pin/unpin**, **mute tab / mute others**.
- **Picture‑in‑Picture** — pop any video into a floating always‑on‑top window (`Ctrl+Shift+P`).
- **Peek** — Shift‑click a link to preview it in a floating card without leaving the page.
- **Mouse gestures** — hold right‑drag for back/forward/close/etc.
- **Smart address bar** — autosuggest from open tabs + history, keyword search engines, and DuckDuckGo `!bang` shortcuts.
- **Command bar** (`Ctrl+K`) — one launcher for URLs, search, panels, tools and every command below, fuzzy‑ranked by use.
- **Personalized start page** — greeting, weather, GitHub stats, daily wisdom, speed‑dial.
- **QR‑to‑phone**, **image zoom lightbox**, **find in page**, **reader zoom (per‑site)**.
- **Container / Off‑the‑Record / Identity tabs** — isolated sessions, ephemeral tabs, or a fresh fingerprint per tab.

### 🔐 Privacy & security
- **Ad & tracker blocking** — pattern blocker + full EasyList/EasyPrivacy/uBlock filter engine, **network and cosmetic** (element hiding).
- **Privacy Dashboard** — live count of trackers & ads blocked, fingerprint/DNS status.
- **Fingerprint protection** — canvas/WebGL/audio randomization + navigator normalization.
- **DNS‑over‑HTTPS** (Cloudflare/Google/Quad9), **HTTPS‑only mode**.
- **Tor, one click** — Vex downloads and launches the official Tor Expert Bundle itself; a Tor tab routes every request *and* DNS through Tor. No Tor Browser needed.
- **DPI / censorship bypass** — a built‑in local proxy defeats DNS + SNI blocking (no VPN, no admin), plus a ByeDPI userspace desync mode for stubborn blocks (used for the Discord panel).
- **Per‑container routing** — send a whole container or session through Tor or a custom SOCKS/HTTP proxy, persistently (`Route Through Tor / Proxy`).
- **Site permissions manager** — geolocation, mic, camera, notifications, WebHID/WebUSB, screen‑share picker — allow/deny & remember.
- **Private window**, **clear browsing / per‑site data**, **location override**.

### 🧠 AI
- **Vex AI assistant** (`Ctrl+Shift+A`) — chat over the current page, selection, or many tabs.
- **AI Router** — routes each feature to **Cloud** (Claude, via *your own* Cloudflare Worker), **local Ollama**, or **on‑device WebLLM (WebGPU)**; Auto / Prefer‑local / Always‑cloud, with per‑feature overrides.
- **Ask Vex to do something…** — plain‑English commands understood **locally & offline** ("close all youtube tabs", "sleep the others", "group my github tabs", "split screen"), with an AI fallback for the rest.
- **AI Tab Command** — natural‑language tab management with a confirm‑before‑closing plan.
- **Selection AI bar** — Explain / Summarize / Translate on any highlighted text.
- **Summarize page · Explain · Translate · Compare/summarize all tabs.**
- **Screenshot → Code** — capture a page, AI rebuilds it as HTML / Tailwind / React.
- **Recall** — local full‑text search of every page you've read ("what was that article…").
- **AI history indexing & semantic search** — find pages by *meaning*, indexed on‑device.
- **AI Personas, AI Memory, AI Skills** — custom assistant personalities, remembered facts, saved reusable prompts.
- **MCP client** — connect to Model Context Protocol servers and run their tools.
- **AI Scheduler**, **Catch Me Up** (AI digest of feeds + read‑later), **AI Compose**.

### ▶️ Media & streaming
- **Widevine / DRM playback** — Netflix, Spotify, Prime Video, Disney+, etc. (signed build).
- **Codec fixes** — Spotify DRM‑robustness fallback and an HEVC/H.265 mask so short‑video sites fall back to playable codecs.
- **Media Grabber** — find and save the video/audio playing on a page.
- **Master Volume** — one 0–500% slider across every tab.
- **Read Aloud (TTS)**, **Now Playing** media hub, **cookie‑banner auto‑dismiss**.

### 🧩 Sidebar apps & panels
- **App web‑panels** — WhatsApp, Claude, Spotify, Netflix, **Discord** (with a stay‑connected fix + optional Vencord), GitHub, Roblox — each in its own persistent isolated session.
- **Pin any site** to the sidebar as a web panel; **unread badges** from each app's title appear on its icon.
- **Native panels** — Notes & Scratchpad, Downloads, Library (Read Later + auto‑archive), Bookmarks (folders), Feeds (RSS), Highlights, Recall, Authenticator, Privacy, History, Memory, Schedules, Queue, Shortcuts.

### 🔑 Autofill & logins
- **Password vault** — encrypted at rest with the OS keychain (DPAPI/safeStorage); offers to save on login, autofills on return.
- **Authenticator (2FA/TOTP)** — generate codes for Discord/GitHub/Roblox/etc., and **autofill** the 6‑digit code on 2FA screens.
- **Email‑code autofill** — reads the newest verification code from your Gmail and fills it — even from a backgrounded Gmail, or (opt‑in) a hidden background Gmail with no tab open at all.
- **Logins & Codes hub** — all three systems in one place with per‑site success rates.

### 📖 Reading & accessibility
- **Reading Mode** (`Ctrl+Alt+R`), **Bionic reading**, **Speed Read (RSVP)**.
- **Read Free** (metered‑paywall bypass), **Copy Unlock** (defeat select/right‑click blockers).
- **Doc extractor** (pull text from Google Docs / copy‑locked pages, OCR).
- **Translate page / selection**, **accessibility pack** (dyslexia font, color‑blind filter, reading ruler).
- **Annotations / Highlights** — persistent highlighting that reappears on revisit.

### 🛠 Productivity
- **Notes & Clip‑to‑Notes**, **Read Later / Library**, **Bookmarks**, **Feeds (RSS)**.
- **Web Monitor** — get alerted when a page changes (restocks, status pages) + **Wayback** archiving.
- **Focus Mode** — hide chrome + block distracting sites for 25/50 min; **Compact Mode**.
- **Sessions** (save/restore named tab sets, auto‑save), **Workspaces**, **Workspace Time‑Travel**.
- **Resource Monitor**, **Memory guard** (sleep idle tabs above a memory ceiling), **Downloads manager**, **History** (keyword + AI semantic search), **Send to Phone**.
- **Command Chains** — chain commands into macros.

### 👩‍💻 Developer tools
- **API Client** (built‑in REST + JSON‑tree viewer), **Format JSON**, **Responsive Preview**, **DevTools** (`F12`), spellcheck.

### 🎨 Customization
- **Layout Editor** — drag to reorder or hide **every** toolbar button and sidebar icon in place; move whole toolbar sections; one‑click **Default / Essentials / Minimal** presets.
- **GUI Style** — Classic (your themes) or **Glass** (frosted UI, tabs on top, speed‑dial shortcuts bar).
- **Themes** — multi‑theme picker (`Ctrl+Shift+Y`).
- **Per‑site Settings** — remembered zoom, forced dark mode, and custom CSS/JS **Boosts** (Zap‑to‑hide any element) per website.
- **Setup Gallery** — save, name, share and switch whole setups (panels, shortcuts, theme) via portable `VEXSETUP1` codes.
- **Customizable keyboard shortcuts**, **customizable sidebar** (rename/re‑icon/reorder/hide/re‑link), **Chrome extension support** (install from folder/ZIP; Vencord for Discord).

### ☁️ Sync
- **Vex Sync** — end‑to‑end encrypted (AES‑GCM‑256) sync of tabs, bookmarks, history and settings across devices, via your own self‑hosted Cloudflare Worker. A hex recovery code is your key.

### 🚀 Onboarding
- **First‑run wizard** — pick a **setup profile** (*The Mortuex Setup* / *Minimal* / *Custom* / paste a shared code), theme, language (EN/TR), daily wisdom, name, weather, GitHub, search engine, default‑browser, and each AI/Sync/password option.
- **Interactive tour**, **"What's New"** update log, **auto‑updater**.

---

## Keyboard shortcuts

| Shortcut | Action | | Shortcut | Action |
|---|---|---|---|---|
| `Ctrl+K` | Command bar | | `Ctrl+T` / `Ctrl+W` | New / close tab |
| `Ctrl+Shift+T` | Reopen closed tab | | `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+L` | Focus address bar | | `Ctrl+B` | Toggle tabs sidebar |
| `Ctrl+F` | Find in page | | `Ctrl+R` / `Ctrl+Shift+R` | Reload / hard reload |
| `Ctrl+Shift+S` | Split screen | | `Ctrl+Shift+P` | Picture‑in‑Picture |
| `Ctrl+Shift+A` | AI panel | | `Ctrl+J` | Quick ask AI |
| `Ctrl+Shift+G` | AI group tabs | | `Ctrl+Shift+Z` | Sleep tabs |
| `Ctrl+Shift+H` | Remember (index) page | | `Ctrl+H` | History |
| `Ctrl+D` | Bookmark | | `Ctrl+Shift+O` | Save session |
| `Ctrl+Shift+Y` | Theme picker | | `Ctrl+Alt+R` | Reading mode |
| `Ctrl+Alt+N` | Private window | | `F11` / `F12` | Fullscreen / DevTools |

*All shortcuts are rebindable in **Settings → Keyboard Shortcuts**.*

---

## AI setup (bring your own backend)

Vex never phones home. To use the cloud AI features you deploy **your own** Cloudflare Worker (Claude) and paste its URL in **Settings → Cloud Services** — see `SELF_HOSTING.md`. Alternatively:
- **Local** — install [Ollama](https://ollama.com) and Vex talks to it at `localhost:11434`.
- **On‑device** — enable WebGPU on‑device AI for fully offline, private chat (no install).

Sync uses your own self‑hosted Worker the same way.

---

## Building from source

> Requires [Node.js](https://nodejs.org) + [pnpm](https://pnpm.io) (or npm). Windows.

```bash
git clone https://github.com/0xmortuex/Vex.git
cd Vex
npm install
npm start          # run the dev build
npm test           # run the test suite (vitest)
npm run dist:win   # build the signed Windows installer
```

**Note:** DRM/Widevine playback requires the VMP‑signed build; the plain dev build (`npm start`) has no DRM by design.

---

## Under the hood

- **Runtime:** Electron `42.5.2` (castLabs `+wvcus` — enables Widevine), **Chromium 148**, bundled Node. The exact versions are shown live in **Settings → About**.
- **Ad blocking:** `@ghostery/adblocker-electron` with the full EasyList filter set, network + cosmetic.
- **Privacy engine:** in‑process DoH resolver, SNI/DPI‑bypass CONNECT proxy, ByeDPI SOCKS5, Tor Expert Bundle launcher.
- **Security:** password vault + TOTP secrets encrypted in the main process (OS keychain); secrets never cross to the renderer.

---

## License

[MIT](LICENSE) © [0xmortuex](https://github.com/0xmortuex)

<div align="center"><sub>Vex — a browser built just for you.</sub></div>
