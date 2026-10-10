> Draft — not legal advice; have it reviewed if you rely on it.

# Vex privacy policy

Effective date: 2026-10-07

Vex is a web browser for Windows made by 0xmortuex (https://github.com/0xmortuex/Vex). This page explains, feature by feature, what data leaves your PC, who receives it and why, and what Vex keeps on your PC. It is written from what the Vex code actually does.

## The short version

- **Vex has no analytics, telemetry or crash reporting.** The author does not collect usage data, and Vex does not send crash reports anywhere.
- **Vex does not come connected to a server run by the author.** Sync and cloud AI are off until you type in the address of a server. You normally deploy that server yourself on your own Cloudflare account (see [SELF_HOSTING.md](SELF_HOSTING.md)).
- **Your data stays on your PC** unless you use a feature that needs the internet. The sections below list every such feature.
- Some things do go online by default: the update check (GitHub), the ad-blocker lists and spell-check dictionary on first start, the Widevine DRM module (Google), search suggestions (from the search engine you chose, never from a private window), and the New Tab daily verse. Each is explained below, with how to turn it off where that is possible.
- Off until you choose them (first-run setup asks, under "Privacy choices"): the New Tab weather, which needs your city, and SponsorBlock on YouTube.

## Who is responsible

Vex is open-source software. The author makes the app; the author does not run a service that receives your browsing data.

When you set up Sync or cloud AI, your data goes to the server whose address you entered. **Whoever runs that server is responsible for it.** If you deployed it yourself, that is you. If someone else gave you the address (including the author, if he ever does), that person runs it and can see what is described below for that server.

## 1. Data stored on your PC

Vex keeps your profile in `%APPDATA%\Vex`. Nothing in this folder is sent anywhere unless a feature below sends it.

**Encrypted with Windows (DPAPI, through Electron safeStorage):** saved passwords (`vault.dat`), authenticator (2FA) secrets (`totp.dat`), mail account logins (`mail-accounts.enc`), the cloud AI access token (`ai-token.enc`), the tokens of MCP servers you add (`mcp-auth.enc`), and the Sync key and Sync sign-in details. Vex refuses to save these if Windows encryption is not available. Anyone who can sign in to your Windows account can still open them, the same as in Chrome or Edge.

**Stored as ordinary files (not encrypted):** browsing history (up to the newest 5,000 visits), the full-text page index called Recall (off until you turn it on in Settings › Recall; profiles set up before v2.37.1 keep the choice they had), bookmarks, notes, tabs and sessions, reading list, AI memory (facts the assistant remembers about you), AI chat history, settings, the downloads list, the local crash log (`crash-log.json`, last 100 errors), and Tor and ByeDPI log files. The crash log names only the site a crashed or frozen page was on (never its full address), and says only "a private page" for a private window, an off-the-record, burner or Tor tab. Downloads from a private window or an off-the-record, burner or Tor tab are listed until Vex closes and never written to disk.

**Backups.** Before installing an update, Vex saves a backup of your settings and data in `%APPDATA%\Vex\backups` and keeps the newest 3. Backups leave out passwords, tokens, keys, 2FA secrets, the lock PIN and your list of MCP servers. AI chats are only included if you tick that box.

**Downloaded installers** for updates are kept in `%APPDATA%\Vex\updates`.

**Reminders.** If you set a reminder, Vex creates a one-time Windows Task Scheduler task (under `\Vex\`) that starts Vex at that time. The task contains only the reminder's ID, not its text.

**Lock PIN.** If you set a PIN, only a salted hash of it is stored.

**Deleting local data:** clear history, Recall, AI memory and AI chats from their panels and Settings, or delete the `%APPDATA%\Vex` folder after uninstalling to remove everything. Uninstalling Vex does not delete this folder on its own.

## 2. Vex Sync (off by default)

Sync keeps your data the same across your computers. It does nothing until you enter a Sync server address in Settings › Cloud Services and sign in.

**Signing in.** You type your email address. It is sent (over HTTPS) to the Sync server, which emails you a 6-digit code through **Resend** (resend.com), an email delivery service. So the Sync server and Resend see your email address when a code is sent. The code is valid for 10 minutes and can be tried 5 times.

**What the server keeps.** The server never stores your email address in readable form. It stores a keyed hash (HMAC-SHA-256) of it as your account ID. For each account it stores:

- your synced data as **one encrypted blob**, with its size, revision number and the time and device of the last upload;
- a list of your devices: a random device ID, the device name (by default "Windows-" plus 4 characters), when it was added and when it last synced;
- sign-in sessions: a random token for each device, valid for **1 year** from sign-in and not extended;
- "Send to my devices" items (see below).

For rate limiting it also keeps your IP address for up to about 16 minutes. It does not log your email, IP address, or anything you sync. (The hosting company, such as Cloudflare, may keep its own request logs under its own policy.)

**End-to-end encryption.** Your synced data is encrypted on your PC with AES-256-GCM before it is sent. The key is made on your PC and shown to you once as your **recovery code**. The key and recovery code are never sent to the server. The server cannot read your bookmarks, history or anything else you sync. It can see the metadata listed above (device names, times, sizes, which device sent what).

**What syncs:** bookmarks, browsing history, open tabs, tab groups and sessions, workspaces, shortcuts and New Tab tiles, notes, reminders, settings and theme, custom commands, AI personas and AI routing settings, and AI memory. **What does not sync:** saved passwords, cookies, 2FA secrets and AI chat history.

**Send to my devices.** When you send a page to your other devices, its address and title are encrypted on your PC and kept on the server until another device picks them up, for at most **7 days** (newest 20 only).

**Limits.** An upload can be at most 4 MB; a sent page at most 16 KB.

**Deleting Sync data:**

- **Sign out** removes this device and its session from the server and deletes the key from this PC. Your encrypted data stays on the server for your other devices.
- **Remove device** removes another device and ends its session.
- **Wipe cloud data** deletes your encrypted data, your device list, your sent pages and all sessions. The server then holds nothing readable about your account; empty markers with the hashed account ID can remain. Pending sign-in codes and rate-limit records expire within about 16 minutes.
- There is no separate account to close: after a wipe nothing else is kept. Data does not expire on its own if you simply stop using Sync, so wipe it if you are done.
- Inside the encrypted data, Vex keeps small "deleted" markers so other devices know an item was removed. Only your devices can read them.

## 3. AI features

### Local AI (stays on your PC)

- **Ollama.** If you have installed Ollama, Vex talks to it at `localhost:11434` on your own PC, and can start it for you. Your questions and pages do not leave your PC. When you download a model through Vex, Ollama itself downloads it from the Ollama library.
- **On-device AI (WebLLM).** Runs inside Vex on your graphics card. When you click Download, the model is fetched from huggingface.co (and a small runtime file from raw.githubusercontent.com). After that, nothing is sent.
- **Dictation** (speech to text) runs on your PC. The first time, after asking you, Vex downloads the Whisper model from huggingface.co. Your voice is never sent.
- **Reading text from images and scanned PDFs** (OCR) runs on your PC. The first time, Vex downloads the English language data from cdn.jsdelivr.net.

### Cloud AI (off until you set it up)

Cloud AI only works after you enter an AI server address and access token in Settings. The server is a Cloudflare Worker you deploy yourself (or someone gives you).

**What is sent to the AI server**, depending on what you ask:

- your question, the recent conversation, your persona and, if AI memory is on, the facts it remembers about you;
- the page you are asking about: its address, title, visible text (up to 30,000 characters), description, headings and language, or a YouTube video's transcript;
- selected text, a file you dropped into the chat, or an image you asked about;
- for tab features: the addresses and titles (and for multi-tab chat, the text) of the tabs involved;
- for history search: your search and up to 200 history entries (address, title, summary, tags, date);
- for the AI agent: the page address, title, text and a list of buttons and fields on it;
- for screenshot-to-code: the screenshot.

Private and Tor tabs are never read for AI. The one exception is a picture you right-click there and choose "Ask Vex about this image": Vex asks first, and only if you agree fetches it through that tab's own connection (its Tor or proxy route) and sends it to your AI model. A picture from any other tab is fetched through that tab's connection too, never directly by Vex.

**Where it goes next.** The AI server forwards the request to **OpenRouter** (openrouter.ai), which passes it to the model (currently Anthropic's Claude Sonnet). Your IP address and identity are not forwarded; OpenRouter sees the server's address. OpenRouter's and the model provider's own privacy policies apply.

**What the AI server keeps.** It does not store your questions, pages or answers and does not log them. It keeps only request counters (per day and per minute) for rate limits, which expire after a day.

**When local AI fails.** If you left AI routing on "Auto" and a local model fails, Vex may retry the request with your cloud AI server (if you set one up). On-device AI (WebLLM) never falls back to the cloud. Choose a local model explicitly if you never want cloud use.

**Background history summaries** are off by default.

## 4. Updates

**What happens:** about 4 seconds after Vex starts and then every 6 hours while it stays open (not in private windows, and not if you turned off "Check for updates automatically" in Settings › About), and when you click "Check for Updates", Vex downloads `latest.yml` from the Vex releases on **GitHub** (github.com). If you choose to update, it downloads the installer (or only the changed parts) and the changelog from GitHub and checks it against a SHA-512 hash.

**What GitHub sees:** your IP address and a `User-Agent` header with your Vex version (for example `Vex/2.35.2`). Vex sends nothing else. GitHub's privacy policy applies. Turn off "Check for updates automatically" in Settings › About and Vex only checks when you click "Check for Updates". The "Stable" channel does not reduce checking; it only delays the prompt.

## 5. Other features that use the internet

These are **on by default:**

| Feature | Sent to | What is sent | When |
|---|---|---|---|
| Search suggestions | Only the search engine you chose: Google (suggestqueries.google.com), Bing (api.bing.com), DuckDuckGo (duckduckgo.com), Brave (search.brave.com), Startpage (www.startpage.com) or Ecosia (ac.ecosia.org) | What you type in the address bar or New Tab search box | As you type. Never from a private window, a Tor tab or a burner tab. Turn off in Settings › General › Search suggestions |
| Search | Your chosen search engine (Google by default; Bing, DuckDuckGo, Brave, Startpage or Ecosia) | Your search | When you search |
| New Tab daily verse | AlQuran Cloud (api.alquran.cloud) | Which verse to fetch | Once a day. Choose another source or "off" to stop it |
| Ad and tracker blocker | raw.githubusercontent.com (Ghostery's filter lists) | Nothing beyond a normal download | On first start, then saved |
| Spell check dictionary | Google (redirector.gvt1.com) | Nothing beyond a normal download | Once, on first start |
| DRM (Widevine) | Google, through the component updater built into castLabs Electron | What Chromium's component updater normally sends (such as version and platform) | At start, when the module is missing or out of date |
| Site icons | Each website (`/favicon.ico`) | A normal request to that site | When a list (bookmarks, history, sidebar…) shows that site, even if you did not open it this session. Not used for Tor, proxy or container tabs |
| Discord panel network help ("Light" mode) | Cloudflare DNS (1.1.1.1) | The names of the servers the Discord panel connects to | While the Discord panel is used |

These run **only when you use them:**

| Feature | Sent to | What is sent |
|---|---|---|
| New Tab weather | Open-Meteo (api.open-meteo.com); searching for a city goes to geocoding-api.open-meteo.com | Off until you set a city. Then the city's coordinates, at most once every 30 minutes (the forecast is kept in between); a city search sends what you type. "Use my approximate location" looks up your IP address once at ipapi.co (then ipwho.is or get.geojs.io if that fails) and saves the town it finds |
| SponsorBlock (skip sponsor segments on YouTube) | sponsor.ajay.app | The ID of each YouTube video you open in an ordinary tab. Never for a video in a private window, a Tor, off-the-record, burner or container tab, or a site you route through Tor or a proxy; while all of Vex is routed, it goes through that route too. Off until you turn it on in first-run setup or Settings › Privacy & Security (profiles from before it was off by default kept it as they had it) |
| Tor | archive.torproject.org (one-time download of Tor), then the Tor network; check.torproject.org to confirm the connection | Your Tor tab traffic goes through Tor |
| Mail panel | Your mail provider's IMAP server (Gmail, Yahoo, iCloud, a local bridge, or the server you enter) | Your login (an app password), to read your mail. Vex only reads mail; it never sends or changes it. While all of Vex goes through Tor or a proxy, mail does too (a local bridge stays local) |
| Extension catalogue | GitHub (api.github.com and github.com) | Which extension to download |
| Install or update an extension from the Chrome Web Store | Google's extension update server (clients2.google.com), which hands the download to clients2.googleusercontent.com | The extension's id, Vex's Chromium version (for example 148.0) and, as with any request, your IP address. Only when you click Add to Vex, Install or Update from Web Store; never from a private window, a Tor tab or a burner tab. Vex sends no Google account, cookie or list of your other extensions, and does not check for updates by itself |
| Vencord for the Discord panel | GitHub (Vendicated/Vencord releases) | A normal download |
| Discord/Roblox "Strong" or "Auto" bypass | GitHub (one-time ByeDPI download); test requests to discord.com and roblox.com | A normal download and test visits |
| Secure DNS (DNS over HTTPS) | The provider you pick: Cloudflare, Google or Quad9 | The names of the sites you visit. Off by default |
| Translate selection / side-by-side translation | Google Translate (translate.googleapis.com) | The text being translated |
| Translate page | Google Translate (opens in a tab) | The page address |
| Dictionary | Wiktionary (en.wiktionary.org) | The word |
| Currency converter | open.er-api.com | Nothing but the request (rates are saved for 12 hours) |
| Free games list and alerts | Epic Games and Steam | Nothing but the request (alerts are opt-in, at most once per 20 hours) |
| Page watch | The page you chose to watch | A normal visit, on the schedule you set |
| Live channel alerts | Twitch or YouTube | The channels you follow, checked every 10 minutes |
| GitHub widgets and alerts | api.github.com | The user name or repositories you entered |
| RSS feeds and calendars (iCal) | The addresses you added | A normal request |
| Link checker and site crawler | The sites you check (no cookies are sent) | A normal request |
| Latency check | 1.1.1.1, 8.8.8.8, Discord, Steam, Riot, Roblox, Epic, YouTube | Only a connection attempt, no data |
| "What is my IP" check | api.ipify.org | Nothing but the request |
| Website asks for your location | ipapi.co, then ipwho.is | Your IP address, only if you allowed the site and did not set a location yourself |
| Accessibility fonts | Google Fonts or cdnfonts.com | A normal font download, only if you turn these fonts on |
| Search image with Google Lens, Wayback Machine, archive.ph, VirusTotal, package tracking | Those sites (opened in a tab) | The image address, page address, file hash or tracking number |
| AI agent web tools | DuckDuckGo, or Bing if that fails, and pages the agent reads | The agent's searches |
| API tester, MCP servers, queue panel | Addresses you enter | What you send |

Everything else you do on the web goes, as in any browser, to the websites you visit. Their own privacy policies apply.

**Links that open another program.** A site can link to a program on your PC (Word, Steam, VS Code, Zoom, your email program…). Vex opens one only after you clicked or pressed a key on the page, and only once you have said yes for that site and that kind of link (Settings › Site permissions lists and revokes your answers). A link that makes Word or Excel fetch a document from the internet asks every time. Vex never opens another program from a private window or an off-the-record, burner or Tor tab: the program would reach the internet directly.

**Private routing ("All of Vex" through Tor or a proxy).** Off by default. When you turn it on, every tab, container, private window, off-the-record and burner tab, sidebar app (Discord and Roblox included, whose network help waits until it is off), the link checker and mail go through Tor or the proxy you named, and a session opened later does too. These keep a route of their own: a Tor tab (already on Tor), a container or site you routed yourself, and the latency check, which measures your own connection directly.

## 6. What Vex does not do

- No analytics, telemetry, usage statistics or crash reporting.
- No advertising and no selling or sharing of data.
- No account with the author. Vex does not know who you are.
- The "autofill log" and crash log in Settings stay on your PC.

## 7. Your rights and choices

Under laws such as the GDPR you have rights to access and delete your data. With Vex you can do this yourself:

- **On your PC:** everything is in `%APPDATA%\Vex`. You can export a backup in Settings, clear each kind of data in its panel, or delete the folder.
- **On a Sync server:** "Wipe cloud data" deletes your data. The server holds only encrypted data, device names and a hashed email, so it cannot show you more than your own app already does.
- **On a cloud AI server:** nothing about you is stored beyond short-lived request counters.
- For a server run by someone else, ask that person.
- For third-party services (GitHub, Google, OpenRouter, Resend, Cloudflare and the others above), use their own privacy tools.

## 8. Children

Vex is a general-purpose web browser and is not aimed at children. The author does not knowingly collect data from anyone, including children, because Vex does not send data to the author.

## 9. Changes to this policy

When Vex changes what it sends, this file will be updated in the Vex repository with a new effective date. The history of every change is visible on GitHub.

## 10. Contact

Questions or concerns: open an issue at https://github.com/0xmortuex/Vex/issues.
