# Local services and the webhook inspector: threat model

Covers `src/main/local-services.js` (T3-033), `src/main/webhook-inspector.js` (T3-058)
and their window side, `src/renderer/js/local-tools-ui.js`.

Both features are **off by default** and arrive off for a profile that already exists.
They are the two places where Vex can start a program or open a listening port, so they
are built to do as little as possible and to be unable to do anything the owner has not
confirmed in a box that main (not a web page, not the window) shows.

## Local-service launcher

### What it does

Starts and stops dev servers the owner listed: `pnpm run <script>`, `npm run <script>`,
`wrangler dev`, `python <script.py> [words]`, `node <script.js> [words]`, `uv run <words>`.
Nothing else. There is no template that takes a program name or a free command line.

### How a service gets added

1. The owner switches the feature on in Settings (Vex's own window).
2. The owner presses "Allow local services". **Main** shows a confirm box. Without a yes,
   nothing below works (`armed` stays false in `local-services.json`).
3. The owner presses "Choose folder". **Main** opens the system folder dialog and holds
   the answer as a one-use grant (5 minutes). The window never supplies a path.
4. The owner picks one template and types its few words (a script name, a script inside
   the folder, up to 6 words made of letters, digits and `_ . : = @ / \ -`).
5. **Main** rebuilds the argument array from the template, checks every word again, checks
   that a script is a real file inside the granted folder (symlinks followed), looks the
   program up on `PATH` (never inside the granted folder, never relative) and shows a
   confirm box with the exact program, arguments and folder. Only a yes saves it.

### How it runs

- `spawn(file, argv[], { shell: false, cwd: <granted folder>, windowsHide: true })`.
  `spawn` rather than `execFile` because a dev server runs for hours and `execFile` buffers
  output and kills the child at `maxBuffer`. The argument is still an array and no shell is
  involved.
- A `.cmd` shim (how npm/pnpm/wrangler install on Windows) cannot be started without a shell,
  so main reads the shim, finds the node script it runs and starts `node.exe <script>`
  itself. A shim it cannot read this way is refused with an explanation; a `.bat` is refused.
- The child's environment is Vex's, minus `ELECTRON_*`, `VEX_*` and `NODE_OPTIONS`.
- The first Start of each service in a Vex session shows the exact program and arguments in
  a confirm box again, so a changed list file would be noticed.
- Nothing starts by itself: not at launch, not on a schedule, not for a page, an extension
  or the AI. The channels are `UI_ONLY` and closed in a private window.

### Stopping

Only a child this module started and still holds. Before it ends it, main asks Windows for the
live `ExecutablePath`, `CommandLine` and creation time of that process id and checks them against
what it started; any mismatch leaves the process alone and says why. It then runs
`taskkill /PID <pid> /T /F` for that verified root (the tree of a dev server). The module keeps the
child handle, so the process id cannot have been reused while it is held. When Vex quits it stops
what it started the same way. If Vex crashes the children are not tracked afterwards: stop them
yourself.

### Residual risk

- Anything running as the owner can edit `local-services.json`. That already lets it run
  programs directly; the per-session confirm shows the real argument array before Vex starts it.
- The owner can add a template command that runs code (`node`, `python`, `uv run`, `pnpm run`).
  That is the purpose of a dev-server launcher, and the owner confirms the exact line.
- A dev server the owner starts is a normal program with the owner's rights.

### Not built (deferred)

Starting from a file edited outside the browser; a command typed free-form; auto-start with a
workspace; a stop for processes Vex did not start (never); an automatic restart on crash.

## Webhook inspector

- Listens on `127.0.0.1` only, on a port the owner types (1024-65535), for 1-60 minutes, then
  stops itself. One listener at a time. No tunnel, no public address, no forwarding.
- A request whose `Host` header is not `127.0.0.1` or `localhost` (a DNS-rebinding page) is
  answered 421 and not listed. Every answer is the same small JSON; no CORS headers are sent.
- Bodies over 1 MiB are not kept (the sender gets 413); at most 100 requests and 8 MiB are held,
  oldest dropped first. Nothing is written to disk.
- What arrives is data from whoever can reach the port (any program on this computer, or a web
  page that posts to it). The window shows it with `textContent` only.
- "Replay in the API playground" fills the playground's form with the method, body and headers
  and a placeholder address (`replace-me.invalid`). Nothing is sent until the owner picks an
  address and presses Send there; the playground's own rules (public addresses, or localhost only
  when ticked) apply.
