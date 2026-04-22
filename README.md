# Vex — A Browser Built Just For You

A minimal, personalized browser built with Electron. No bloat. Vertical tabs, built-in WhatsApp/Claude panels, ad blocker, and a command bar that does everything.

![Vex Screenshot](assets/screenshot.png)

## Features

### Core Browser
- **Vertical Tabs** — Arc-style sidebar tabs with drag reorder
- **Tab Groups** — Organize tabs into collapsible folders with colors
- **Sidebar Panels** — Quick access to WhatsApp, Claude AI, and more
- **Custom Start Page** — Clock, search, customizable shortcuts, weather widget
- **Command Bar** — Ctrl+K to do anything: search, navigate, switch panels
- **Ad & Tracker Blocker** — Built-in pattern-based blocking
- **Iframe Bypass** — Strips X-Frame-Options so sites load in webviews
- **Persistent Sessions** — Tabs, groups, and settings saved across restarts

### Workspace & Tools
- **CUSA Workspace** — Legislative tools: Constitution, Code of Justice, BillForge, LoopholeMap
- **Built-in Tools** — FlashMind, CipherLab, LoopholeMap, AIJudge, NetMap, BillForge
- **Roblox Hub** — Quick actions for Home, Games, Friends, Trade, Catalog, Groups
- **GitHub Panel** — Profile stats, recent repos, contribution overview
- **Picture-in-Picture** — Pop any video into a floating window
- **Split-Screen** — View two tabs side-by-side

### Productivity
- **Workspace Profiles** — Switch between Personal, CUSA, School, Dev contexts
- **Tab Sessions** — Save and restore named tab sessions
- **Notes & Scratchpad** — Markdown notes with preview, pin, export
- **Downloads Manager** — Track downloads with progress bars
- **Customizable Shortcuts** — Edit start page Quick Access links
- **Customizable Tools** — Add/remove/reorder sidebar tools

### Performance & History
- **Tab Sleep Mode** — Suspend inactive tabs to near-zero RAM
- **Auto-Sleep** — Automatically sleep tabs after configurable inactivity
- **Memory Panel** — Per-tab memory usage with sleep/wake/close actions
- **Restore Tabs** — Reopen tabs from last session on startup
- **Recently Closed** — Ctrl+Shift+T to reopen closed tabs (last 25)
- **Full History** — Searchable browsing history with date filters

### Appearance & Utilities
- **Theme Editor** — 7 presets + custom color editor
- **Reading Mode** — Strip clutter, focus on article content
- **Translate Page** — Translate via Google Translate
- **Screenshots** — Capture visible area, save or copy
- **Zoom per Domain** — Ctrl+=/Ctrl+- with per-site persistence
- **Tab Preview** — Thumbnail preview on hover

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+K | Command bar |
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+Shift+T | Reopen closed tab |
| Ctrl+R | Reload |
| Ctrl+F | Find in page |
| Ctrl+H | History |
| Ctrl+=/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| Ctrl+Shift+S | Split screen |
| Ctrl+Shift+P | Picture-in-picture |
| Ctrl+Shift+N | Notes |
| Ctrl+Shift+M | Memory panel |
| Ctrl+Shift+O | Sessions |
| Ctrl+Shift+Z | Sleep current tab |
| Ctrl+Shift+R | Hard reload (clear cache) |
| Ctrl+Alt+R | Reading mode |
| Ctrl+Alt+S | Screenshot |
| Alt+Left/Right | Back/Forward |

## Install & Run

```bash
git clone https://github.com/0xmortuex/Vex.git
cd Vex
npm install
npm start
```

## Build

```bash
npm run dist
```

## License

MIT
