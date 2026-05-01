# Phase 4 — Tab Stacks (planning doc, not yet implemented)

**Status:** deferred. This document captures the work needed to build it so a future session — or a future contributor — doesn't have to re-derive the design.

**Owner:** unassigned
**Last updated:** 2026-05-01
**Related code paths:** `src/renderer/js/tabs.js`, `src/renderer/js/tab-grouper.js`, `src/renderer/js/horizontal-tabs.js`, `src/renderer/css/tabs.css`, `src/renderer/css/horizontal-tabs.css`, `src/storage.js` (or whatever VexStorage backs onto)

---

## 1. What is a "tab stack"?

A **stack** is a vertical pile of tabs that share a common context — research thread, doc + reference pages, an issue tracker plus the PRs it's about — collapsed into a single strip slot showing only the **top tab**. Clicking a stack switches to its top tab. Right-arrow / chevron on the stack header peels open the stack to expose every member.

Mental model: a tab stack is to a tab group as a stack of papers is to a labelled folder.

| | Tab group (already exists) | Tab stack (this phase) |
|---|---|---|
| All members visible at once? | Yes — collapsible label, members listed below | No — only the top tab shows; others tuck behind |
| Strip footprint | N slots | 1 slot |
| Visual identity | Coloured label above members | Faux "card deck" stagger on the active tab |
| Collapse semantics | Hide/show entire group | Always collapsed; "expand" fans the deck |
| Switching | Click any member | Click stack → switch to top; Ctrl+ArrowDown cycles through |
| Persistence | Saved as `groups` + `tab.groupId` | Saved as `stacks` + `tab.stackId` (NEW) |

Why we want both: Arc-style users keep ~80 tabs alive but only ~6 should clutter the strip at once. Groups shrink labels; stacks shrink **the strip itself**.

---

## 2. Data model

```js
// New TabManager fields:
TabManager.stacks = [
  { id: 'stk_abc',  name: 'Research',    color: '#a855f7',  topTabId: 'tab-12' },
  // No `collapsed` flag — stacks are always collapsed by definition.
  // No `expanded` either — expansion is ephemeral hover/click state, not persisted.
];

// Each tab gains a single new field:
tab.stackId = 'stk_abc' | null;
```

**Invariants** (enforce in `tabs.js`):

1. A tab cannot be in both a group AND a stack — `groupId && stackId` is illegal. Pick the appropriate "container" concept; mixing breaks the strip layout. UI: when adding to a stack, set `groupId = null` and vice versa.
2. `topTabId` must reference a member of the stack (tab where `tab.stackId === stack.id`). On member removal, fall back to the next-most-recently-active member.
3. A stack with zero members must be deleted in the same pass that empties it (mirrors current `groups` cleanup at lines 67-78 of `tabs.js`).
4. Pinned tabs cannot join a stack — pinned semantics already include "always visible," which fights with stack collapse.

**Persistence** (mirror the existing groups path):

- `VexStorage.loadStacks()` / `saveStacks()` — new methods, JSON file `stacks.json` in `userData/vex-storage/`
- Stack save fires from the same call sites as `saveGroups`: tab close, tab move, drag-drop, group create, AI-grouper, sync-engine
- Sync engine (`sync-engine.js`) needs a parallel section — stacks must replicate across devices alongside tabs and groups
- Migration: on load, prune stacks whose `topTabId` doesn't resolve and whose member set is empty

---

## 3. Render work

Two strip layouts — vertical and horizontal — both need updating.

### 3a. Vertical sidebar (`tabs.js` rebuildAllTabs)

Currently iterates `tabs` and emits one `<li class="tab-item">` per tab plus group labels for each non-empty group. For stacks:

1. After iterating ungrouped/grouped tabs, iterate `stacks` and for each stack emit ONE `<li class="tab-item tab-stack" data-stack-id="…">` whose contents reflect the **top** tab (favicon, title) plus a stack indicator badge with the member count.
2. The stack item gets `::before` and `::after` pseudo-elements offset 2px and 4px down-right with reduced opacity to fake the "deck of cards" look. CSS-only, no extra DOM.
3. When the stack is **expanded** (transient — kept in a render-time `_expandedStackIds: Set<string>` on TabManager, not persisted), iterate its members and emit them as `<li class="tab-item in-stack">` immediately below the stack header. Reuse the existing `.in-group` inset styling but with a different left-border colour pulled from `stack.color`.

### 3b. Horizontal top bar (`horizontal-tabs.js` render)

Same model — emit one `.top-tab.top-stack` per stack. Horizontal stacks expand DOWNWARD into a floating popover (positioned with the same logic as `tab-preview.js`'s vertical layout) rather than inline, because the strip is a single row.

### 3c. CSS

New file: `src/renderer/css/tab-stacks.css`. Use existing `--vex-glass-*` tokens — match the chrome.

Selectors to add:
```css
.tab-item.tab-stack { /* deck-of-cards stagger */ }
.tab-item.tab-stack::before,
.tab-item.tab-stack::after { /* offset card silhouettes */ }
.tab-item.tab-stack.expanded { /* opens flow */ }
.tab-item.in-stack { /* member inset */ }

.top-tab.top-stack { /* horizontal variant */ }
.top-stack-popover { /* glassmorphic, --vex-blur-medium */ }
```

---

## 4. Interaction surface

| Trigger | Behaviour |
|---|---|
| Click stack header | Switch to `topTabId` (no expansion) |
| Hover stack header (800ms) | Reuse `TabPreview` for the top tab (already wired) |
| **Long-press** / Alt+Click stack header | Toggle expand state (set/unset `_expandedStackIds`) |
| Right-click stack header | Context menu: Rename / Recolour / Promote member to top / Disband stack / Move members to a new group |
| Ctrl+ArrowDown when active tab is in a stack | Cycle to next member (rotate `topTabId`) |
| Drag tab onto stack header | Add to stack (set `tab.stackId`, clear `tab.groupId`) |
| Drag tab out of stack onto strip gap | Remove from stack, become free tab |
| Drag stack header | Reorder the stack as a unit |

The drag-drop work piggybacks on the existing handlers in `tabs.js` around lines 450-550 (search for `dragstart` / `dragover`). Add stack-as-source and stack-as-target cases.

---

## 5. AI integration (already exists, needs extending)

`tab-grouper.js` currently auto-creates **groups** via Ctrl+Shift+G. For stacks, add a parallel command (proposal: Ctrl+Shift+S) that:

1. Sends the same tab-snapshot prompt to the AI router but asks for stack assignments rather than group assignments. Stacks should be **smaller** than groups (3-7 members, vs. groups which can hold 20+) and **theme-tighter** (a single sub-task, not a domain).
2. Reuses the existing pattern-storage (`groupPatterns` map at line 15 of `tab-grouper.js`) under a new `stackPatterns` map so the heuristic is learned per-user.

---

## 6. Tests (add alongside implementation, mirror existing patterns)

| File | Coverage |
|---|---|
| `tests/renderer/tabStacks.test.js` (new) | jsdom render — stack header shows top tab + count badge, click switches to top, expand reveals members, Alt+click toggles expansion, drag-drop |
| `tests/renderer/tabStacksPersistence.test.js` (new) | Stack save/load roundtrip, prune of orphaned stacks, migration from a save with no `stacks` field, top-tab fallback on member removal |
| Extend `tests/renderer/tabPreview.test.js` | Hover preview on a stack header shows the top tab's thumbnail (no new public surface, just a regression check) |
| Extend `tests/renderer/sidebarContextMenu.test.js`-style | Right-click on stack header shows the stack-specific menu (Rename / Disband / etc.) |

Aim for ≥20 new tests covering data invariants (stack/group exclusivity, top-tab fallback) since those are the hardest to debug at runtime.

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| **Strip flicker on hover-expand** — tabs rebuilding during expand causes layout thrash | Drive expansion via CSS transform on a stable `<ul>`, not a DOM rebuild |
| **Sync drift** — one device with stacks, another without | Sync engine must roundtrip both `groups` and `stacks` keys; missing key = treat as empty array, never overwrite |
| **AI auto-stacker over-stacks** the strip into a single mega-stack | Hard cap stack member count (proposal: 8); refuse AI suggestions exceeding it |
| **Workspace switching loses expansion state** | OK by design — expansion is ephemeral. Document this. |
| **Pinned + stacked conflict** (user pins a stack member) | Pin operation removes the tab from its stack first; surfacing a one-time confirm toast |
| **Stack with 1 member** is just a heavy tab — no value | Auto-disband stacks the moment they fall below 2 members |

---

## 8. Phased rollout (proposed)

| Sub-phase | Scope | Estimated effort |
|---|---|---|
| 4a | Data model + persistence + invariants + storage tests (no UI) | 0.5 day |
| 4b | Vertical-sidebar render + click-to-switch + CSS deck-of-cards visual | 1 day |
| 4c | Expand/collapse interaction + Ctrl+ArrowDown cycle + context menu | 0.5 day |
| 4d | Horizontal-bar render + popover expansion | 0.5 day |
| 4e | Drag-drop into/out of stacks | 1 day |
| 4f | AI auto-stacker (Ctrl+Shift+S) + stackPatterns learning | 0.5 day |
| 4g | Sync engine integration + multi-device roundtrip test | 0.5 day |

Total: ~4.5 dev-days, plus QA on the drag-drop matrix (which is the historically buggy area in tabs.js).

---

## 9. Open questions for whoever picks this up

1. Should a stack member tab show the stack's colour somewhere when the stack is expanded? Mirror `--group-color`? Or keep neutral to avoid visual noise?
2. When the user clicks the "next tab" shortcut (Ctrl+Tab), do we step into stack members or skip to the next stack? Recommend: skip (stack acts like a single tab from the keyboard's POV); members reachable only via Ctrl+ArrowDown.
3. AI stacker prompt wording: stacks should be **temporal/task-bound** ("PR review", "this morning's research") vs. groups which are **domain-bound** ("Work", "Recipes"). Do we have enough signal in tab metadata to tell the difference, or do we need to explicitly ask the model?

---

*Once this work begins, supersede this doc with a "Phase 4 — Tab Stacks (shipped)" section in `docs/ARCHITECTURE.md` and delete this file.*
