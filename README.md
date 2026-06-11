# Vex — A Browser Built Just For You

A fast, private, minimal desktop browser built with Electron. No bloat — vertical tabs, a built-in AI agent, ad & tracker blocking, workspaces, and a command bar that does everything.

🔽 **Download:** [0xmortuex.github.io/vex-website](https://0xmortuex.github.io/vex-website/) · [Latest release](https://github.com/0xmortuex/Vex/releases/latest)

> Windows 10/11 · 64-bit. Vex is independent and unsigned, so Windows SmartScreen may warn on first run — click **More info → Run anyway**.

---

## Features

### Core browser
- **Vertical tabs** — Arc-style sidebar tabs with drag-to-reorder
- **Tab groups** — Organize tabs into collapsible, color-coded folders
- **Command bar** — `Ctrl+K` to search, navigate, switch panels, or run any action
- **Ad & tracker blocker** — Built-in, on by default
- **Sidebar panels** — Quick-access panels (WhatsApp, Claude, Spotify, and more)
- **Custom start page** — Clock, search, customizable shortcuts; optional name & GitHub widgets
- **Persistent sessions** — Tabs, groups, and settings restored across restarts

### AI
- **Built-in AI agent** — Summarize pages, ask about what you're reading, translate, and let it click/type to complete tasks
- **Personas** — Switch the assistant's style; bring your own with a system prompt
- **Local or cloud** — Use a local [Ollama](https://ollama.com) model, or your own AI worker (see Self-hosting)

### Productivity
- **Workspaces** — Switch between Work, School, Dev, and Personal contexts
- **Sessions** — Save and restore named sets of tabs
- **Notes** — Markdown notes with preview, pin, and export
- **Downloads manager** — Track downloads with progress
- **Scheduled tasks** — Daily briefings and recurring agent runs
- **Split screen & Picture-in-Picture** — Two tabs side by side; pop any video into a floating window

### Performance & history
- **Tab sleep** — Suspend inactive tabs to near-zero RAM, with auto-sleep and a memory panel
- **Full history** — Searchable browsing history with date filters; reopen closed tabs (`Ctrl+Shift+T`)

### Appearance & utilities
- **Themes** — 7 presets plus a custom color editor
- **Reading mode**, **page translate**, **per-domain zoom**, **screenshots**, **tab previews**
- **Chrome extensions** — Load unpacked extensions or `.zip`/`.crx`
- **Encrypted sync** *(optional)* — End-to-end encrypted tabs/settings/history across devices; your key never leaves your machine

## Download & install

Grab the installer from the [website](https://0xmortuex.github.io/vex-website/) or [Releases](https://github.com/0xmortuex/Vex/releases/latest), run `Vex-Setup.exe`, and you're browsing. Installed copies auto-update from future releases.

## Run from source

```bash
git clone https://github.com/0xmortuex/Vex.git
cd Vex
npm install
npm start
```

Build a Windows installer:

```bash
npm run dist        # produces dist/Vex-Setup.exe
```

## Self-hosting (AI & Sync)

The AI assistant and Sync are **optional** and run on Cloudflare Workers **you deploy yourself** — nothing points at anyone else's backend, so you never spend someone else's API credits or store data on their server.

- Set your **AI Worker URL** and **Sync Worker URL** in **Settings → Cloud Services**.
- Without them, AI falls back to local Ollama and Sync stays off.
- Full deploy steps: [`SELF_HOSTING.md`](SELF_HOSTING.md). Worker source lives in [`workers/`](workers).

## Keyboard shortcuts

| Shortcut | Action | | Shortcut | Action |
|---|---|---|---|---|
| `Ctrl+K` | Command bar | | `Ctrl+Shift+S` | Split screen |
| `Ctrl+T` | New tab | | `Ctrl+Shift+P` | Picture-in-picture |
| `Ctrl+W` | Close tab | | `Ctrl+Shift+N` | Notes |
| `Ctrl+Shift+T` | Reopen closed tab | | `Ctrl+Shift+M` | Memory panel |
| `Ctrl+F` | Find in page | | `Ctrl+Shift+Z` | Sleep current tab |
| `Ctrl+H` | History | | `Ctrl+Alt+R` | Reading mode |
| `Ctrl+=/-` | Zoom in/out | | `Ctrl+Alt+S` | Screenshot |
| `Ctrl+0` | Reset zoom | | `Alt+←/→` | Back / Forward |

## License

MIT · Built by [0xmortuex](https://github.com/0xmortuex)
