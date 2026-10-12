# Vex privacy policy

Document version: 2
Last updated: 2026-10-11

Vex is a web browser for Windows made by 0xmortuex (https://github.com/0xmortuex/Vex). This page explains, feature by feature, what data leaves your PC, who receives it and why, what Vex does by itself without a click each time, and what Vex keeps on your PC. It is written from what the Vex code does.

The first time you start Vex, and again when this document changes, Vex shows a short summary and asks you to agree to this policy and the terms of use ([TERMS.md](https://github.com/0xmortuex/Vex/blob/main/TERMS.md)). Settings › About shows the version you accepted and when, and opens both documents.

## The short version

- **Vex has no analytics, telemetry or crash reporting.** The author does not collect usage data, Vex has no account with the author, and Vex does not send crash reports anywhere.
- **Vex does not come connected to a server run by the author.** Sync and cloud AI are off until you type in the address of a server. You normally deploy that server yourself on your own Cloudflare account (see SELF_HOSTING.md in the Vex repository).
- **Your data stays on your PC** unless you use a feature that needs the internet. The sections below list every such feature.
- **Some things happen by themselves**, without a click each time. Section 2 lists all of them, with how to turn each one off where that is possible.

## Who is responsible

Vex is open-source software. The author makes the app; the author does not run a service that receives your browsing data.

When you set up Sync or cloud AI, your data goes to the server whose address you entered. **Whoever runs that server is responsible for it.** If you deployed it yourself, that is you. If someone else gave you the address (including the author, if he ever does), that person runs it and can see what is described below for that server.

## 1. Data stored on your PC

Vex keeps your profile in `%APPDATA%\Vex`. Extra profiles you create live in `%APPDATA%\Vex Profiles\<profile id>`. Nothing in these folders is sent anywhere unless a feature below sends it.

**Encrypted with Windows (DPAPI, through Electron safeStorage):** saved passwords (`vault.dat`), authenticator (2FA) secrets (`totp.dat`), mail account logins (`mail-accounts.enc`), the cloud AI access token (`ai-token.enc`), the tokens of MCP servers you add (`mcp-auth.enc`), and **passkeys** (`passkeys.dat`, the private keys Vex makes when a site asks you to create a passkey, see "Passkeys" below), and the Sync key and Sync sign-in details. Vex refuses to save these if Windows encryption is not available. Anyone who can sign in to your Windows account can still open them, the same as in Chrome or Edge.

**Stored as ordinary files (not encrypted):**

- browsing history (up to the newest 5,000 visits), bookmarks, notes, tabs and sessions, reading list, settings, the downloads list;
- **Recall**, the full-text index of pages you open (`recall.json`), only while it is on (see section 2);
- **AI memory** (facts you asked the assistant to remember), AI chat history, and AI history summaries if you turned those on;
- **Clipboard History**: only the items you pin are saved (newest 100); the rest is kept in memory until Vex closes;
- **price history**: the price a product page publishes for search engines, noted when you open it (newest 200 products);
- the **autofill log**, a local list of what Vex filled and where (newest 300), and the **problems list** and **crash log** (`crash-log.json`, last 100 errors). The crash log names only the site a crashed or frozen page was on (never its full address), and says only "a private page" for a private window, an off-the-record, burner or Tor tab;
- the values Page Watch last saw on the pages you watch;
- the ad-blocker's list cache (`vex-adblock-engine-full.bin`), the spell-check dictionary (`Dictionaries`), currency rates (`fx-rates.json`), and the Tor and ByeDPI programs with their log files (`tor`, `byedpi`).

Downloads from a private window or an off-the-record, burner or Tor tab are listed until Vex closes and never written to disk.

**Backups.** Before installing an update (or, for a version installed another way, when it first starts), Vex saves a backup of your settings and data in `%APPDATA%\Vex\backups` and keeps the newest 5. Backups leave out passwords, tokens, keys, 2FA secrets, the lock PIN and your list of MCP servers. AI chats are only included if you tick that box.

**Downloaded installers** for updates are kept in `%APPDATA%\Vex\updates`.

**Lock PIN.** If you set a PIN, only a salted hash of it is stored.

**Deleting local data:** clear history, Recall, AI memory, AI chats, Clipboard History and price history from their panels and Settings, or delete the `%APPDATA%\Vex` folder (and `%APPDATA%\Vex Profiles`) after uninstalling to remove everything. Uninstalling Vex does not delete these folders on its own.

## 2. What Vex does by itself

These run without a click each time. "On by default" means a new profile has it on.

| What | When | What leaves your PC, and to whom | How to turn it off |
|---|---|---|---|
| **Update check** | About 4 seconds after start, then every 6 hours while Vex is open. Never from a private window | A request for `latest.yml` to GitHub (github.com), with your IP address and a `User-Agent` naming your Vex version | Settings › About › "Check for updates automatically". Then Vex only checks when you click "Check for Updates" |
| **Ad and tracker block lists** | On first start, then again whenever the saved copy is more than 7 days old (checked a minute after start and once a day) | A normal download of Ghostery's lists from raw.githubusercontent.com, through Vex's own connection: while all of Vex goes through Tor or a proxy, so do these downloads | Settings › General › "Block ads and trackers". While the blocker is off, the lists are not downloaded |
| **Extension updates** (on by default) | 2 minutes after start, then every 6 hours. Not on a metered connection | For a Chrome Web Store extension: its id, its installed version and Vex's Chromium version, to Google's update server (clients2.google.com); downloads come from Google. For a catalogue extension: a request to the GitHub API. No Google account or cookie is sent. An update that asks for more permissions waits for your approval | Vex's Extensions settings › "Update extensions automatically" |
| **Spell-check dictionary** | Once, at start, if it is missing | A normal download from Google (redirector.gvt1.com). Chromium may also download the dictionary for your Windows language from Google | No switch |
| **DRM (Widevine)** | At start, when the module is missing or out of date | What Chromium's component updater normally sends to Google (such as version and platform), through castLabs Electron | No switch |
| **Discord panel network help ("Light" mode)** (on by default) | At every start, for the Discord panel only | The names of the servers the Discord panel connects to, to Cloudflare DNS (1.1.1.1), over encrypted DNS | Settings › Privacy Hardening › "Discord and Roblox block bypass" › Off |
| **Discord/Roblox "Strong" bypass (ByeDPI)** | Only once you turn it on; then again at every start until you turn it off. The Roblox bypass, once on, also starts again at every start | A one-time download of ByeDPI (`ciadpi.exe`) from GitHub, and test visits to discord.com or roblox.com. ByeDPI then runs on your PC | The same setting, or the Discord and Roblox buttons' right-click menus |
| **Discord in your Vex theme** (off by default) | While "Match Discord to my Vex theme" is on and your Vex theme is one of those named after a BetterDiscord theme (ClearVision, Dark Matter, Tokyo Night and the others): each time Discord loads in Vex, and when you switch to such a theme | Discord's page (with Vencord) downloads that theme's CSS file from the theme's own published address (its GitHub Pages site, or jsDelivr, cdn.jsdelivr.net, for the four that have none), through the Discord panel's own connection and bypass. A normal request with your IP address. Any other Vex theme is coloured by Vex and downloads nothing | Settings › Appearance › "Match Discord to my Vex theme", or the Discord button's right-click menu |
| **Site icons** | When a list (bookmarks, history, sidebar, New Tab tiles…) shows a site, even one you did not open this session | A normal request for that site's icon (`/favicon.ico`) to that site | No switch. Lists skip sites you route through Tor, a proxy or a container |
| **Search suggestions** (on by default) | As you type in the address bar or New Tab search box. Never from a private window, a Tor tab, a burner tab, a site you route through Tor or a proxy, or a container that goes through Tor or a proxy (a Tor container included) | What you type, to the search engine you chose only: Google, Bing, DuckDuckGo, Brave, Startpage or Ecosia | Settings › General › "Search suggestions" |
| **New Tab daily verse** (on by default) | Once a day | Which verse to fetch, to AlQuran Cloud (api.alquran.cloud). The Bible, Tanakh and quotes sources are built in and send nothing | Open setup again (the sparkles button) and choose another source or Off in "Daily wisdom" |
| **New Tab weather** (off until you set a city) | At most every 30 minutes while a New Tab is shown | Your city's coordinates, to Open-Meteo (api.open-meteo.com) | There is no switch to remove the city yet; setup (the sparkles button) changes it |
| **New Tab GitHub widget** (off until you enter a user name) | Each time a New Tab opens | Your GitHub user name, to api.github.com | There is no switch to remove the user name yet; setup (the sparkles button) changes it |
| **Email-code autofill** (on by default) | On sign-in pages that ask for a code: Vex looks for an empty code field, then reads the newest 12 messages (sender and visible text) in a webmail tab you have open (Gmail, Outlook, Proton, Yahoo or iCloud). It may wake a sleeping mail tab for 2 minutes and press its Refresh button | Nothing is sent by Vex. It fills a code only when the email came from the same site as the page. Never in a private window, an off-the-record, burner or Tor tab, or a tab that goes through Tor or a proxy (a site you route that way, or a routed or Tor container): its mail is not read, and no code is filled into it | Settings › Autofill › "Fill sign-in codes from your email" |
| **Hidden Gmail code reader** (off by default) | When a code is needed and no Gmail tab is open | Vex opens Gmail out of sight with your signed-in session and can open the newest unread verification email to read it (Gmail may then mark it as read) | Settings › Autofill › "Read email codes from a hidden Gmail" |
| **Recall** (off by default for new profiles; profiles set up before v2.37.1 keep the choice they had) | Each page you open in an ordinary tab (not a private, Tor, off-the-record, burner or routed tab), while on | Nothing. The title, description, headings and text (up to 16,000 characters per page) are saved on your PC | Settings › Recall (full-text history) › "Index pages for full-text recall" |
| **Clipboard History** (on by default) | When you copy text on a web page. Never your other programs, Vex's own window, or password and code fields, and never in a private window or a Tor, off-the-record, burner or routed tab (see "Which tabs the AI can read") | Nothing. Kept in memory until Vex closes, except what you pin | Settings › Browsing extras › "Clipboard history" |
| **Price history** (on by default) | When you open a product page that publishes its price for search engines, except in a private window or a Tor, off-the-record, burner or routed tab | Nothing; saved on your PC | "Note prices" in the Price history sheet (Ctrl+K "Price history") |
| **Open-tab keyword index** | While tabs are open | Nothing. Up to 400 keywords per open tab, in memory only, so the command bar and AI can find tabs | No switch; it is never written to disk |
| **AI memory** (on by default, empty until you add facts) | Facts are added only when you add them in Settings or type "remember that …" in Ctrl+K | When on, the facts go with every AI chat, to whichever AI answers (local or cloud) | Settings › AI Memory › "Use my memory in AI chats" |
| **AI history indexing** (off by default) | Each page you visit in an ordinary tab (not a private, Tor, off-the-record, burner or routed tab), while on | Up to 8,000 characters of each page's text to the AI. Local by default; the cloud only if you route it there | Settings › AI History Indexing › "Enable AI history indexing" |
| **Starting Ollama** (on by default) | At start and when a local model is needed, if Ollama is installed and Vex uses local AI | Nothing leaves your PC. Vex runs `ollama serve` and checks it at `localhost:11434` every 30 seconds | Settings › AI Backend › "Start Ollama when it is needed" |
| **MCP servers** (none by default) | At every start, Vex connects to each MCP server you added (to list its tools) | A connection and the MCP handshake to the addresses you entered, with the token you saved for them | Remove the server in Settings › MCP Servers |
| **Page Watch** (none by default) | Checks each page you chose to watch on its schedule (5 minutes to 1 day); runs while Vex is minimised | A request for that page, without your cookies, with an ordinary Chrome `User-Agent`. Page Watch can also watch devices on your home network (a router, printer or camera page); those requests stay on your network. Sites you route through Tor, a proxy or a container are skipped | Delete the watch in "Watched pages" (Ctrl+K "Watch This Page") |
| **Live channel alerts** (none by default) | Every 10 minutes, also while Vex is minimised | A request for each channel page you follow, to Twitch or YouTube | Remove the channels |
| **GitHub watches** (none by default) | A workflow run every 2 minutes until it finishes; releases every 30 minutes | Requests to api.github.com for the repositories you entered | Remove the watch |
| **Calendars (iCal)** (none by default) | Every 30 minutes | A request to each calendar address you added | Remove the calendar |
| **Free games alerts** (off by default) | At most once every 20 hours | A request to Epic Games and Steam | Turn alerts off in the Free games panel |
| **Your scheduled tasks** (none by default) | When a task you created is due (checked every 20 seconds). Not in private windows | Whatever the task does: open pages, or run the AI agent, which may use cloud AI | Delete the task in Schedules |
| **Reminders and the weekly review** | On the first start, Vex adds a weekly review reminder (Fridays at 17:00). Each reminder, yours or this one, creates a one-time Windows Task Scheduler task under `\Vex\` that starts Vex at that time, even when it is closed | Nothing leaves your PC. The task holds Vex's program path, your profile's folder and id, and the reminder's id, not its text. The reminder text appears in a Windows notification, and Windows keeps it in its notification history | Delete the reminder (and the weekly review) in Reminders; Windows deletes the task a day after it ran |
| **Notifications** | Reminders, alarms, page changes and sites you allowed | Shown by Windows. Nothing is sent over the internet | Delete what triggers them, or turn notifications off in Windows |
| **Vex Sync** (off until you set it up) | Once signed in: every 2 minutes, 5 seconds after a synced item changes, when you close the window, and every 5 minutes to fetch changes; "Send to my devices" is checked every 2 minutes | Your end-to-end encrypted data to your Sync server (see section 3) | Settings › Vex Sync: sign out, or choose what to sync |
| **Cloud AI** (off until you set it up) | Only when you ask the AI, or a feature or task you turned on uses it | See section 4 | Remove the AI server address in Settings |

Vex does **not** check mail in the background: the Mail panel reads your inbox only when you open it or press Refresh.

## 3. Vex Sync (off by default)

Sync keeps your data the same across your computers. It does nothing until you enter a Sync server address in Settings › Vex Sync and sign in. It never runs in a private window.

**Signing in.** You type your email address. It is sent (over HTTPS) to the Sync server, which emails you a 6-digit code through **Resend** (resend.com), an email delivery service. So the Sync server and Resend see your email address when a code is sent. The code is valid for 10 minutes and can be tried 5 times.

**What the server keeps.** The server never stores your email address in readable form. It stores a keyed hash (HMAC-SHA-256) of it as your account ID. For each account it stores:

- your synced data as **one encrypted blob**, with its size, revision number and the time and device of the last upload;
- a list of your devices: a random device ID, the device name (by default "Windows-" plus 4 characters), when it was added and when it last synced;
- sign-in sessions: a random token for each device, valid for **1 year** from sign-in and not extended;
- "Send to my devices" items (see below).

For rate limiting it also keeps your IP address for up to about 16 minutes. It does not log your email, IP address, or anything you sync. (The hosting company, such as Cloudflare, may keep its own request logs under its own policy.)

**End-to-end encryption.** Your synced data is encrypted on your PC with AES-256-GCM before it is sent. The key is made on your PC and shown to you once as your **recovery code**. The key and recovery code are never sent to the server. The server cannot read your bookmarks, history or anything else you sync. It can see the metadata listed above (device names, times, sizes, which device sent what).

**What syncs:** bookmarks; browsing history (the last 90 days, at most 1,000 visits); each device's open tabs (up to 100), tab groups, sessions and workspaces; shortcuts, New Tab tiles and tools; notes; reminders and scheduled tasks; settings and theme, look and fonts; keyboard shortcuts; per-site choices (zoom, never-sleep, always-translate, dark mode); custom commands; AI personas, AI routing settings and AI memory. You can leave out any kind of data on each device in Settings › Vex Sync › "Choose what to sync".

**Passkeys.** Vex can act as your passkey provider: when a site offers "Sign in with a passkey" or "Create a passkey", Vex asks you in its own window, makes the key pair itself (ES256), keeps the private key encrypted with Windows in `passkeys.dat` and answers the site with a signature. The private key never leaves the main process of Vex: not to the page, not to Vex's own window, not to logs, backups or problem reports, and it cannot be exported. The site learns only the public key, the passkey's id, the account name it gave Vex and (when you used it) the signature. Vex does not use passkeys in private windows or in off-the-record, burner and Tor tabs, and not while Vex is locked; if you have set a Vex PIN, the PIN is what Vex asks for as "user verification" when a site requires it. Passkeys are not synced unless you turn on "Passkeys" in Settings › Vex Sync › Choose what to sync (and then only the passkeys made after that, which tell sites they are backed up; see the Sync section); a passkey made while it is off stays on this PC.

**Passwords and 2FA.** Saved passwords and authenticator (2FA) accounts are not synced unless you turn them on (Settings › Vex Sync › "Choose what to sync", on each device; Vex asks for your PIN first). They are off by default. When on, they travel with the sites you chose never to save a password on or never to fill a code on. They are end-to-end encrypted like everything else, so the server cannot read them, and each one is also sealed on its own with a key made from your sync key, so even the copy Vex keeps of the synced data on your PC holds no password or 2FA secret in readable form. While Vex is locked, nothing syncs on a device that syncs them. **Passkeys follow the same rules (Settings › Vex Sync › Choose what to sync › Passkeys, off by default, PIN asked first, sealed one by one, nothing readable in the copy on your PC); only passkeys made while it was on are synced. **Never synced:** cookies and AI chat history.

**Send to my devices.** When you send a page to your other devices, its address and title are encrypted on your PC and kept on the server until another device picks them up, for at most **7 days** (newest 20 only).

**Limits.** An upload can be at most 4 MB; a sent page at most 16 KB.

**Deleting Sync data:**

- **Sign out** removes this device and its session from the server and deletes the key from this PC. Your encrypted data stays on the server for your other devices.
- **Remove device** removes another device and ends its session.
- **Wipe cloud data** deletes your encrypted data, your device list, your sent pages and all sessions. The server then holds nothing readable about your account; empty markers with the hashed account ID can remain. Pending sign-in codes and rate-limit records expire within about 16 minutes.
- There is no separate account to close: after a wipe nothing else is kept. Data does not expire on its own if you simply stop using Sync, so wipe it if you are done.
- Inside the encrypted data, Vex keeps small "deleted" markers so other devices know an item was removed. Only your devices can read them.

## 4. AI features

### Local AI (stays on your PC)

- **Ollama.** If you have installed Ollama, Vex talks to it at `localhost:11434` on your own PC, and starts it when it is needed (section 2). Your questions and pages do not leave your PC. When you download a model through Vex, Ollama itself downloads it from the Ollama library.
- **On-device AI (WebLLM).** Runs inside Vex on your graphics card. When you click Download, the model is fetched from huggingface.co (and a small runtime file from raw.githubusercontent.com). After that, nothing is sent.
- **Dictation** (speech to text) runs on your PC. The first time, after asking you, Vex downloads the Whisper model from huggingface.co. Your voice is never sent.
- **Reading text from images and scanned PDFs** (OCR) runs on your PC. The first time, Vex downloads the English language data from cdn.jsdelivr.net.

### Cloud AI (off until you set it up)

Cloud AI only works after you enter an AI server address and access token in Settings. The server is a Cloudflare Worker you deploy yourself (or someone gives you). Vex has no built-in AI server address.

**Which requests go to the cloud.** Once a cloud AI server is set up, with Settings › AI Backend on "Auto" (the default):

- chat, summaries, explanations and tab grouping go to the cloud first, even when Ollama is running;
- translation, history search, multi-tab questions and the AI agent go to the cloud;
- history indexing and the reading digest stay local unless you change their routing;
- if a local model fails, Vex may retry the request in the cloud.

Choose "Prefer local" to keep requests on your PC while Ollama is running (a failed local answer is then never sent to the cloud), or route single features to local. On-device AI (WebLLM) never falls back to the cloud. Without a cloud AI server nothing goes to the cloud.

**What is sent to the AI server**, depending on what you ask:

- your question, the recent conversation, your persona and, if AI memory is on, the facts it remembers about you;
- the page you are asking about: its address, title, visible text (up to 30,000 characters), description, headings and language, or a YouTube video's transcript;
- selected text, a file you dropped into the chat, or an image you asked about;
- for tab features: the addresses and titles (and for multi-tab chat, the text) of the tabs involved;
- for history search: your search and up to 200 history entries (address, title, summary, tags, date);
- for the AI agent: the page address, title, text and a list of buttons and fields on it;
- for screenshot-to-code: the screenshot.

**Which tabs the AI can read.** A private window, and off-the-record, burner and Tor tabs, are never read for AI, for email-code autofill, for Clipboard History or for price history. Routed tabs are treated the same way: a site you send through Tor or a proxy with a site rule, a Tor container, and a container you route through Tor or a proxy. Their pages, titles and addresses are not given to the AI (chat, the agent, "Organize Tabs", Ask both models), and a chat about one is not saved. Saved passwords and authenticator codes are still filled into a routed tab (a password typed on a site routed through Tor is never saved). An ordinary container, with no route of its own, is an ordinary tab for this purpose and can be read when you ask. While all of Vex goes through one route, every tab goes that way and none counts as routed. The one exception for a private or Tor tab is a picture you right-click there and choose "Ask Vex about this image": Vex asks first, and only if you agree fetches it through that tab's own connection (its Tor or proxy route) and sends it to your AI model. A picture from any other tab is fetched through that tab's connection too, never directly by Vex.

**Pages the AI agent reads by itself.** When the agent searches or opens a page to answer you, Vex fetches it itself, **without your cookies or sign-ins**, with an ordinary Chrome `User-Agent`. Searches go to DuckDuckGo, or Bing if that fails. YouTube transcripts come from youtube.com. Saving a page to read later fetches it the same way once, to estimate the reading time.

**Where it goes next.** The AI server forwards the request to **OpenRouter** (openrouter.ai), which passes it to the model (currently Anthropic's Claude Sonnet). Your IP address and identity are not forwarded; OpenRouter sees the server's address. OpenRouter's and the model provider's own privacy policies apply.

**What the AI server keeps.** It does not store your questions, pages or answers and does not log them. It keeps only request counters (per day and per minute) for rate limits, which expire after a day.

## 5. Other features that use the internet when you use them

| Feature | Sent to | What is sent |
|---|---|---|
| Search | Your chosen search engine (Google by default; Bing, DuckDuckGo, Brave, Startpage or Ecosia) | Your search |
| Weather city search, "Use my approximate location" | geocoding-api.open-meteo.com; ipapi.co (then ipwho.is or get.geojs.io if that fails) | What you type; your IP address, once, when you click |
| SponsorBlock (skip sponsor segments on YouTube) | sponsor.ajay.app | The ID of each YouTube video you open in an ordinary tab. Never for a video in a private window, a Tor, off-the-record, burner or container tab, or a site you route through Tor or a proxy. Off until you turn it on in first-run setup or Settings › Privacy & Security (profiles from before it was off by default kept it as they had it) |
| Password breach check (off by default) | Have I Been Pwned (api.pwnedpasswords.com) | Only when you press "Check now" in Password Health with "Check my passwords against known breaches" on: the first 5 characters of the SHA-1 hash of each password. Your passwords and their full hashes never leave your PC |
| Tor | archive.torproject.org (one-time download of Tor), then the Tor network; check.torproject.org to confirm the connection | Your Tor tab traffic goes through Tor |
| Mail panel | Your mail provider's IMAP server (Gmail, Yahoo, iCloud, a local bridge, or the server you enter) | Your login (an app password), to read your mail when you open the panel or press Refresh. Vex only reads mail; it never sends or changes it. While all of Vex goes through Tor or a proxy, mail does too (a local bridge stays local) |
| Extension catalogue | GitHub (api.github.com and github.com) | Which extension to download |
| Install an extension from the Chrome Web Store | Google's extension update server (clients2.google.com), which hands the download to clients2.googleusercontent.com | The extension's id and Vex's Chromium version (for example 148.0). Never from a private window, a Tor tab or a burner tab. No Google account, cookie or list of your other extensions |
| Vencord for the Discord panel | GitHub (Vendicated/Vencord releases) | A normal download |
| Secure DNS (DNS over HTTPS) | The provider you pick: Cloudflare, Google or Quad9 | The names of the sites you visit. Off by default |
| Translate selection / side-by-side translation | Google Translate (translate.googleapis.com) | The text being translated |
| Translate page | Google Translate (opens in a tab) | The page address |
| Dictionary | Wiktionary (en.wiktionary.org) | The word |
| Currency converter | open.er-api.com | Nothing but the request (rates are saved for 12 hours) |
| Free games list | Epic Games and Steam | Nothing but the request |
| RSS feeds | The addresses you added | A normal request, when you open the feeds or a digest runs |
| Link checker and site crawler | The sites you check (no cookies are sent) | A normal request |
| Latency check | 1.1.1.1, 8.8.8.8, Discord, Steam, Riot, Roblox, Epic, YouTube | Only a connection attempt, no data |
| "What is my IP" check | api.ipify.org | Nothing but the request |
| Website asks for your location | ipapi.co, then ipwho.is | Your IP address, only if you allowed the site and did not set a location yourself |
| Accessibility fonts | Google Fonts or cdnfonts.com | A normal font download, only if you turn these fonts on |
| Search image with Google Lens, Wayback Machine, archive.ph, VirusTotal, package tracking | Those sites (opened in a tab) | The image address, page address, file hash or tracking number |
| Report a problem | GitHub (opens a new issue page in a tab) | Nothing until you press Submit on GitHub. Vex fills in your versions and recent problems with addresses, your user folder, email addresses and tokens removed, and shows you all of it to edit first |
| "What's New" | Nothing normally; GitHub's API only if the release notes that come with Vex cannot be read | The version number |
| API tester, MCP servers, queue panel | Addresses you enter | What you send |

Everything else you do on the web goes, as in any browser, to the websites you visit. Their own privacy policies apply.

**Links that open another program.** A site can link to a program on your PC (Word, Steam, VS Code, Zoom, your email program…). Vex opens one only after you clicked or pressed a key on the page, and only once you have said yes for that site and that kind of link (Settings › Site Permissions lists and revokes your answers). A link that makes Word or Excel fetch a document from the internet asks every time. Vex never opens another program from a private window or an off-the-record, burner or Tor tab: the program would reach the internet directly.

**Private routing ("All of Vex" through Tor or a proxy).** Off by default. When you turn it on, every tab, container, private window, off-the-record and burner tab, sidebar app (Discord and Roblox included, whose network help waits until it is off), the link checker and mail go through Tor or the proxy you named, and a session opened later does too. These keep a route of their own: a Tor tab (already on Tor), a container or site you routed yourself, and the latency check, which measures your own connection directly. The ad and tracker block lists go through it too. Vex's other background downloads (the spell-check dictionary, the DRM module, update checks) may not go through that route.

## 6. What Vex does not do

- No analytics, telemetry, usage statistics or crash reporting. Nothing is sent to the author.
- No advertising and no selling or sharing of data.
- No account with the author. Vex does not know who you are.
- The autofill log, problems list and crash log in Settings stay on your PC.

## 7. Your rights and choices

Under laws such as the GDPR you have rights to access and delete your data. With Vex you can do this yourself:

- **On your PC:** everything is in `%APPDATA%\Vex` (and `%APPDATA%\Vex Profiles`). You can export a backup in Settings, clear each kind of data in its panel, or delete the folder.
- **On a Sync server:** "Wipe cloud data" deletes your data. The server holds only encrypted data, device names and a hashed email, so it cannot show you more than your own app already does.
- **On a cloud AI server:** nothing about you is stored beyond short-lived request counters.
- For a server run by someone else, ask that person.
- For third-party services (GitHub, Google, OpenRouter, Resend, Cloudflare and the others above), use their own privacy tools.

## 8. Children

Vex is a general-purpose web browser and is not aimed at children. The author does not knowingly collect data from anyone, including children, because Vex does not send data to the author.

## 9. Changes to this policy

When Vex changes what it sends or does by itself, this file is updated with a new document version and date, and Vex asks you to agree again, once, with a short list of what changed. The history of every change is visible on GitHub.

## 10. Contact

Questions or concerns: open an issue at https://github.com/0xmortuex/Vex/issues.
