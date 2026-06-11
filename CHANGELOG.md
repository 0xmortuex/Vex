# Changelog

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
