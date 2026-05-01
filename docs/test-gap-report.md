# Vex Test-Gap Report

**Date:** 2026-05-01
**Scope:** `src/main.js`, `src/preload.js`, `src/preload-webview.js`, `src/adblocker.js`, `src/pip.js`, `src/renderer/js/**`
**Method:** Static analysis using the `ruflo-testgen` plugin, filtered for pure-logic, branchy, regression-prone functions.

---

## Repo state at time of analysis

- **Existing tests:** 0 (only Jimp's bundled tests inside `node_modules`).
- **Test framework:** none configured. No `test` script in `package.json`. No `jest`/`mocha`/`vitest` in `devDependencies`.
- **Structure note:** there is no `src/main/` directory. Main-process code lives at `src/main.js` (1481 LOC, single file). Renderer is split across 55 files in `src/renderer/js/`.
- **Total in-scope JS:** ~13,585 LOC.

When tests are written, framework selection is open — recommend **vitest** (pure-Node helpers, ESM-native, runs without Electron) for the renderer modules listed below. None of the prioritised functions need the Electron runtime.

---

## Risk categorisation (gap inventory)

### High value — pure functions with branching logic
These are the bullseye targets: zero DOM/Electron dependency, deterministic output, multiple branches per function, several have caused regressions before.

| # | File | Function | Why |
|---|------|----------|-----|
| 1 | `src/main.js:569` | `isExternalProtocol(url)` | Security boundary — gates `shell.openExternal`. Regex + protocol-allowlist Set. |
| 2 | `src/main.js:107` | `normalizeLaunchArg(arg)` | Windows shell argv shape variance — http(s)/file/local-path; `.html` regex. |
| 3 | `src/main.js:124` | `findLaunchUrl(argv)` | Iterates argv calling normalize. Tiny but gates double-click-to-open. |
| 4 | `src/main.js:54`  | `handleFullscreenShortcut(event, input)` | F11 toggle + Esc-when-tracked + modifier rejection. Flagged regression area. |
| 5 | `src/adblocker.js:46` | `shouldBlock(url)` | URL parse + suffix match against `AD_DOMAINS`. Edge cases: subdomain spoofing. |
| 6 | `src/renderer/js/sync-crypto.js` (whole module) | `bytesToBase64`/`base64ToBytes`/`keyToHex`/`hexToKey`/`formatRecoveryCode`/`parseRecoveryCode` | Recovery code round-trip. Failure here = users can't restore on a second device. |
| 7 | `src/renderer/js/scheduler.js:67` | `calculateNextRun(task)` | Branch table for once/daily/weekly/monthly/custom. Time-zone + boundary bugs. |
| 8 | `src/renderer/js/scheduler.js:112` | `_parseCronNext(cron, now)` | 5-field cron with `*`,`,`,`/` operators. Bounded 10080-min loop. Classic bug magnet. |
| 9 | `src/renderer/js/shortcuts-registry.js:111` | `eventToShortcut(e)` | Builds combo string from `KeyboardEvent`. Modifier order + special-key remap. |
| 10 | `src/renderer/js/shortcuts-registry.js:84` | `setShortcut(id, combo)` | Three-state return (`true`/`false`/conflict object). Conflict detection across all bindings. |
| 11 | `src/renderer/js/tab-grouper.js:227` | `_domain(url)` | URL parse + `www.` strip + 40-char fallback. Used by auto-assign. |
| 12 | `src/renderer/js/tab-grouper.js:232` | `_similarity(a, b)` | Jaccard over space-tokenised strings. |
| 13 | `src/renderer/js/tab-grouper.js:243` | `_extractKeywords(pattern, tabs)` | Lowercasing + regex word match + stopword filter + count rank + top-8. |
| 14 | `src/renderer/js/agent-loop.js:31` | `ToolCallHistory` (class) | Loop detection — agent's safety net against re-spamming identical tool calls. |
| 15 | `src/renderer/js/agent-loop.js:89` | `_parseAgentResponse(raw)` | Strips fences, fallback substring match, normalises 6 field-name variants. |
| 16 | `src/renderer/js/ai-router.js:61` | `resolveBackend(feature)` | 5-way decision tree (forceCloud / pref=cloud / pref=local / auto+online / auto+offline). |

### Medium value — state transitions (need refactor before clean tests)
Logic is correct but **embedded** in larger methods that also touch DOM/`localStorage`/`WebviewManager`. Worth testing eventually, but each one needs to be extracted into a pure helper first.

| File | Behavior | Why it's medium not high |
|------|----------|---|
| `src/renderer/js/tabs.js:758-790` | `sleepTab` scroll capture | Inline `await wv.executeJavaScript(...)`. Capture/restore pair flagged as regression source. Extract `serializeScrollPosition(pos)` helper. |
| `src/renderer/js/tabs.js:200-224` | Group auto-delete in `closeTab` | Flagged regression source. Inline. Extract `pruneEmptyGroups(groups, tabs)`. |
| `src/renderer/js/workspaces.js:58-118` | `switchTo(id)` | Mixed save/close/lazy-create sequence. Pure parts: nothing — needs DI of `TabManager`. |
| `src/renderer/js/sessions.js:34-64` | `restoreSession(id, replace)` | Loops over `TabManager.closeTab`. Pure parts: `findIndex(activeTabIndex)` clamping. |
| `src/renderer/js/scheduler.js:208-220` | `_checkDueTasks()` | Time-window logic (`diff <= 60000 && diff >= -60000` and 90s last-run gate). Hidden invariants. |

### Low value — skip
- All renderer `render*` / `_create*Element` / `buildUI` methods (DOM construction).
- IPC forwarding (`window.vex.persistGet/Set`, `ipcMain.handle`/`ipcRenderer.invoke` glue).
- Third-party wrappers (`Ollama.ping`, `electron-updater` setup, `electron-builder` afterPack hook).
- Pure render loops in `horizontal-tabs.js`, `tabs.js _createTabElement`, `command.js renderResults`.
- Toast/modal helpers (`_toast`, `showLoadingModal`, `_promptInput`).

---

## Prioritised recommendation — top 15

For each: file path + line, function name, why it matters, suggested cases (not yet written).

### 1. `src/main.js:569` — `isExternalProtocol(url)`
**Why:** decides which URLs are handed off to the OS shell; security boundary.
**Suggested cases:**
- returns `false` for `null`/`undefined`/`""`/non-string.
- returns `false` for `http://`, `https://`, `file://`, `about:blank`.
- returns `true` for `mailto:`, `tel:`, `magnet:`, `ftp:`, `web+mastodon:foo`.
- rejects malformed schemes like `://foo` or `1http://x`.
- case-insensitive scheme match (`MAILTO:`).

### 2. `src/main.js:107` — `normalizeLaunchArg(arg)`
**Why:** Windows argv shapes — link clicks, file:// URLs, drive-letter paths. Quietly returning `null` on a valid arg breaks "open in Vex".
**Suggested cases:**
- returns the URL unchanged for `http://x.com`, `https://x.com`, `file:///C:/foo.html`.
- converts `C:\Users\me\foo.html` → `file:///C:/Users/me/foo.html`.
- converts `D:/path/to.htm` → file URL (forward slashes, .htm not just .html).
- returns `null` for non-string, empty, or `"foo.html"` (no drive prefix).
- returns `null` for paths that aren't `.html`/`.htm` (e.g. `C:\foo.pdf`).

### 3. `src/main.js:124` — `findLaunchUrl(argv)`
**Why:** entry point for cold-start + second-instance argv.
**Suggested cases:**
- returns first URL found when multiple args are present.
- returns `null` for `[]`, `[null]`, `undefined`.
- skips noise args (`--no-sandbox`, `--remote-debugging-port=9222`) and finds the URL after them.

### 4. `src/main.js:54` — `handleFullscreenShortcut(event, input)`
**Why:** explicitly listed in Vex regression history. State machine across F11/Esc + 4 modifier flags.
**Suggested cases:** (mock `mainWindow` and `event.preventDefault`)
- F11 keyDown with no modifiers → toggles fullscreen, `preventDefault` called, returns `true`.
- F11 keyUp → returns `false`, no toggle.
- F11 + Ctrl → returns `false`, no toggle.
- Esc keyDown when `isFullscreenTracked=true` → exits, `preventDefault` called, returns `true`.
- Esc keyDown when `isFullscreenTracked=false` → returns `false`, **no `preventDefault`** (must not break Esc elsewhere).
- `mainWindow=null` short-circuit returns `false`.

### 5. `src/adblocker.js:46` — `shouldBlock(url)`
**Why:** pure URL classifier; the kind of thing a typo in `AD_DOMAINS` silently breaks.
**Suggested cases:**
- exact host match (`doubleclick.net` → block).
- subdomain match (`pagead.doubleclick.net` → block).
- path substring match (`facebook.com/tr` block; `facebook.com/profile` allow).
- subdomain-spoof rejection (`mydoubleclick.net` → allow; `doubleclick.net.evil.com` → must verify behaviour).
- malformed URL → `false` (no throw).
- non-blocked host (`wikipedia.org`) → `false`.

### 6. `src/renderer/js/sync-crypto.js` — round-trip + recovery-code helpers
**Why:** whole module is pure. End-to-end encryption — round-trip failure = data loss across devices.
**Suggested cases:**
- `bytesToBase64(base64ToBytes(b64)) === b64` for random 1B/100B/65KB buffers.
- `keyToHex(hexToKey(hex)) === hex` for 64-char hex.
- `hexToKey(<63 chars>)` throws with the expected message.
- `parseRecoveryCode(formatRecoveryCode(hex)) === hex` for any valid hex.
- `parseRecoveryCode("12345678 - ABCDEFGH")` strips dashes, spaces, lowercases.
- `parseRecoveryCode(null)` returns `""` (no throw).
- `encrypt(data, key)` followed by `decrypt(_, key)` returns the same object (use Web Crypto via `node:crypto.webcrypto` or `@peculiar/webcrypto` polyfill).

### 7. `src/renderer/js/scheduler.js:67` — `calculateNextRun(task)`
**Why:** branch table per `frequency` field. Wrong next-run = task fires at wrong time or never.
**Suggested cases:** (inject `now` via stub on `Date`)
- `frequency: 'once'` with `runCount: 0` and future startDate → returns that date.
- `frequency: 'once'` with `runCount: 1` → returns `null`.
- `frequency: 'daily'` past today's time → schedules tomorrow same time.
- `frequency: 'daily'` future today's time → schedules today.
- `frequency: 'weekly'` with `daysOfWeek: [1,3,5]` → returns next matching weekday.
- `frequency: 'weekly'` with `daysOfWeek: []` → returns `null`.
- `frequency: 'monthly'` `dayOfMonth: 31` in February → verify behaviour (overflow into March 3 is Date.setDate semantics).
- `frequency: 'custom'` delegates to `_parseCronNext`.

### 8. `src/renderer/js/scheduler.js:112` — `_parseCronNext(cron, now)`
**Why:** classic cron-parsing bug surface. 10080-minute search bound — can return null for valid expressions if bounds wrong.
**Suggested cases:**
- `"* * * * *"` → returns `now + 1 minute`.
- `"30 9 * * *"` → 9:30 today (or tomorrow).
- `"0 */4 * * *"` → next 4-hour boundary.
- `"0 0 1,15 * *"` → next 1st or 15th of month at 00:00.
- 4-field input → `null`.
- empty string → `null`.
- expression that won't match within a week → `null` (gracefully, not throw).

### 9. `src/renderer/js/shortcuts-registry.js:111` — `eventToShortcut(e)`
**Why:** mismatch between this and stored shortcut strings = key silently does nothing.
**Suggested cases:**
- `Ctrl+T` event → `"Ctrl+T"`.
- `Ctrl+Shift+A` event → `"Ctrl+Shift+A"` (modifier order: Ctrl, Alt, Shift).
- modifier-only event (`Control` key) → `null`.
- `ArrowDown` → `"Ctrl+Down"`.
- single lowercase letter → uppercased.
- `F11` with no modifiers → `"F11"`.
- `metaKey` (Cmd on macOS) maps to `"Ctrl"` to match cross-platform bindings.

### 10. `src/renderer/js/shortcuts-registry.js:84` — `setShortcut(id, combo)`
**Why:** three-state return; conflict detection bugs allow two actions to bind the same combo.
**Suggested cases:**
- unknown id → `false`.
- valid id, no conflict → `true`, persisted to `localStorage`.
- combo conflicts with another binding → `{conflict, conflictLabel}`.
- combo equal to *its own* default → `true` (must not flag self-conflict).
- combo equal to current value (no-op) → `true`.

### 11. `src/renderer/js/tab-grouper.js:227` — `_domain(url)`
**Why:** auto-assign matches against `pd.domains`; `_domain("about:blank")` and edge cases must produce stable keys.
**Suggested cases:**
- `https://www.example.com/path` → `"example.com"`.
- `https://example.com` → `"example.com"`.
- `http://sub.example.co.uk/x` → `"sub.example.co.uk"` (no www stripping mid-host).
- `"not a url"` → 40-char prefix fallback.
- `null`/`undefined` → empty string fallback.

### 12. `src/renderer/js/tab-grouper.js:232` — `_similarity(a, b)`
**Why:** Jaccard implementation; off-by-one in union breaks ranking.
**Suggested cases:**
- identical strings → `1`.
- disjoint strings → `0`.
- one empty → `0`.
- both null → `0` (no NaN).
- case-insensitive (`"Foo Bar"` vs `"foo BAR"` → `1`).

### 13. `src/renderer/js/tab-grouper.js:243` — `_extractKeywords(pattern, tabs)`
**Why:** if ranking changes silently, "Remember these patterns" auto-grouping starts matching different tabs across releases.
**Suggested cases:**
- ignores stopwords (verify against `STOPWORDS` set).
- requires count ≥ 2 for inclusion.
- top-8 cap.
- minimum word length 4 (`/[a-z]{4,}/gi`).
- empty input → `[]`.
- titles in mixed case → lowercased before counting.

### 14. `src/renderer/js/agent-loop.js:31` — `ToolCallHistory`
**Why:** safety net that stops the AI agent from re-spamming identical tool calls. If `isStuckInLoop` returns the wrong answer the agent burns iterations.
**Suggested cases:**
- after 0/1 identical calls → `isStuckInLoop` returns `false`.
- after 2 identical calls in last 5 → `true`.
- different args → `false` even with same tool.
- only the last `WINDOW=5` calls are considered (older repeats don't trip).
- `loopGuidance` includes the previous result preview, truncated to ≤ 300 chars.
- `mostRepeated()` after a varied history returns the highest-count signature.
- `reset()` clears history.

### 15. `src/renderer/js/agent-loop.js:89` — `_parseAgentResponse(raw)`
**Why:** robustness against AI output drift — handles 6 field aliases, stripped fences, embedded JSON in prose.
**Suggested cases:**
- raw JSON `{"tool":"navigate","parameters":{"url":"x"}}` → parsed object with `tool`, `parameters`.
- ```` ```json … ``` ```` fenced JSON → unwrapped.
- prose preamble + JSON body → extracts JSON from substring match.
- alias normalisation: `toolName`/`tool_name`/`action`/`function_name`/`name` all populate `tool`.
- alias normalisation: `params`/`arguments`/`args` all populate `parameters`.
- malformed JSON / no `tool` field → `null` (not throw).
- empty/null input → `null`.

### Bonus — 16th candidate if budget allows
**`src/renderer/js/ai-router.js:61` — `resolveBackend(feature)`** — 5-way routing decision (cloud vs local vs auto with online/Ollama gates). Easy to test by stubbing the module-level state vars; bug here = AI calls go to wrong backend silently. Cases: forceCloud always wins, explicit pref overrides auto, auto picks local when offline + Ollama up, auto falls back to cloud when local unavailable.

---

## Surprises / things to flag

1. **The Gmail sanitizer the prompt mentioned no longer exists.** Comments at `src/main.js:594-596`, `796-808`, `949-955` document it being reverted twice — first to a native IMAP/SMTP client (under a `src/main/gmail/` path that *also* doesn't exist), then that whole feature was pulled too. There is no remaining sanitizer to test, and no orphaned tests reference it. The only `gmail` references are cleanup code that deletes leftover credential files.

2. **`src/main/` directory does not exist.** The user prompt assumed a directory layout that isn't there. Main process is a single 1481-line file at `src/main.js`. Scope was adjusted accordingly.

3. **No test infrastructure at all.** Zero test files (outside `node_modules`), no test framework in `devDependencies`, no `test` script. Writing the first test will require choosing and adding a runner. Vitest is the recommended pick — pure-Node, no Electron needed for any of the 15 functions above.

4. **Several flagged "regression-prone" areas are not pure functions yet.** Sleep-tab scroll capture (`tabs.js:765-775`) and group auto-delete (`tabs.js:218-224`) are inline inside larger async methods. Testing them cleanly needs a small extract-helper refactor first — not done in this report-only commit.

5. **`AD_DOMAINS` in `src/adblocker.js` includes pattern entries like `'facebook.com/tr'` (host + path), and `shouldBlock` does a `full.includes(d)` on the host+path concatenation.** This means a benign URL whose path contains `facebook.com/tr` (unlikely but possible) would be blocked. Worth covering with a test before anyone refactors.

6. **`scheduler.js:100` uses `Date.setMonth(getMonth()+1)` after `setDate(dayOfMonth)`.** For `dayOfMonth: 31` in a 30-day month, `Date` overflows into the next month — meaning a "monthly on the 31st" task can fire on the 1st of the following month in some months. Test should make the expected behaviour explicit before code is changed.

---

## Out of scope for this report

- **Writing the tests.** Step 5 of the originating task explicitly says: produce the report only.
- **Picking a test framework / wiring `npm test`.** Decision pending.
- **Coverage measurement.** Not meaningful until at least one test exists.
- **Integration / Electron-runtime tests.** Everything above runs in plain Node + a Web Crypto shim; no Electron needed.
