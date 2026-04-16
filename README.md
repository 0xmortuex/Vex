# Vex — A Browser Built Just For You

A minimal, personalized browser built with Electron. No bloat. Vertical tabs, built-in Discord/WhatsApp/Claude panels, ad blocker, and a command bar that does everything.

![Vex Screenshot](assets/screenshot.png)

## Features

### Phase 1 — Core Browser
- **Vertical Tabs** — Arc-style sidebar tabs with drag reorder
- **Tab Groups** — Organize tabs into collapsible folders with colors
- **Sidebar Panels** — Quick access to Discord, WhatsApp, and Claude AI
- **Custom Start Page** — Clock, search, shortcuts, weather widget
- **Command Bar** — Ctrl+K to do anything: search, navigate, switch panels
- **Ad & Tracker Blocker** — Built-in pattern-based blocking
- **Iframe Bypass** — Strips X-Frame-Options so sites like Discord load in webviews
- **Persistent Sessions** — Tabs, groups, and settings saved across restarts
- **Context Menu** — Right-click for back/forward/reload/copy in webviews
- **Find in Page** — Ctrl+F search within any page
- **Zoom** — Ctrl+/- to zoom active page

### Phase 2 — Workspace & Tools
- **CUSA Workspace** — Legislative tools panel with quick links to Constitution, Code of Justice, BillForge, LoopholeMap
- **Built-in Tools** — One-click access to FlashMind, ReconX, CipherLab, LoopholeMap, AIJudge, NetMap, BillForge
- **Roblox Hub** — Quick actions for Home, Games, Friends, Trade, Catalog, Groups
- **GitHub Panel** — Profile stats, recent repos with language colors and stars, contribution overview
- **Picture-in-Picture** — Pop any video into a floating always-on-top window (Ctrl+Shift+P)
- **Split-Screen** — View two tabs side-by-side with resizable divider (Ctrl+Shift+S)
- **Enhanced Start Page** — My Tools row, CUSA at a Glance widget, Recent GitHub Activity feed

## Roadmap (Phase 3)

- Embedded Discord feed in CUSA workspace
- Live CUSA activity tracking
- Tab session saving/restoring
- Workspace sync across devices
- Enhanced trade tracking for Roblox
- Inline code editor for dev tools

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+K | Command bar |
| Ctrl+T | New tab |
| Ctrl+W | Close tab |
| Ctrl+R | Reload |
| Ctrl+F | Find in page |
| Ctrl+/- | Zoom in/out |
| Ctrl+0 | Reset zoom |
| Ctrl+Shift+S | Toggle split screen |
| Ctrl+Shift+P | Picture-in-picture |
| Alt+Left/Right | Navigate back/forward |

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
