// === Report a problem ======================================================
//
// Settings › About › "Report a problem…" and the command bar's "Report a
// Problem" open a GitHub issue already filled in with what a bug report always
// has to ask for anyway: Vex's version, Electron and Chromium, the Windows
// build, the look and theme, and the last lines of Vex's own problem and crash
// lists (js/problems.js; main's crash-log.json via app:diagnostics).
//
// Nothing is sent by itself. The text is shown first, in full, in a box the
// user can edit or empty; only "Open on GitHub" opens the page, and GitHub
// posts nothing until Submit is pressed there. Before it is shown, the text is
// scrubbed: query strings and fragments come off every address, the Windows
// user folder becomes %USERPROFILE%, and emails and anything shaped like a
// token are replaced.
//
// The whole report travels in the address, so it is kept under GitHub's
// length limit (and Vex's own 8192-character cap for opening a link): the
// oldest log lines go first, and the report says how many were left out.
const VexReport = (() => {
  const NEW_ISSUE = 'https://github.com/0xmortuex/Vex/issues/new';
  // open-external and data-contracts refuse anything over 8192 characters;
  // GitHub itself starts failing around the same size. Stay clear of both.
  const MAX_URL = 7800;
  const LOG_LINES = 25;

  // --- scrubbing ---------------------------------------------------------
  // Order matters: addresses first (so an email inside a query string goes with
  // the query), then user folders, then emails, then tokens.
  const RULES = [
    // A fragment can carry an OAuth access token; a query string, anything.
    // (A fragment after a query string goes with it.)
    [/\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>()]*)\?[^\s"'<>()]*/gi, '$1?[query removed]'],
    [/\b([a-z][a-z0-9+.-]*:\/\/[^\s#"'<>()]*)#[^\s"'<>()]+/gi, '$1#[removed]'],
    // C:\Users\<name>, C:/Users/<name>, file:///C:/Users/<name>, \\?\C:\Users\<name>.
    // A drive letter is required, so a web path such as /users/123 is left
    // alone. A name with a space ("Jane Doe") is taken up to the next slash.
    [/[a-z]:[\\/]{1,2}Users[\\/]+(?:[^\\/"'<>:|?*\r\n]+(?=[\\/])|[^\\/\s"'<>:|?*]+)/gi, '%USERPROFILE%'],
    [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email removed]'],
    // Well-known token shapes, then a JWT, then "token=…" and "token": "…"
    // pairs, then any long unbroken run of letters AND digits (a key, a session
    // id, a hash).
    [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g, '[token removed]'],
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[token removed]'],
    [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [removed]'],
    [/\b(token|access_token|refresh_token|id_token|api[_-]?key|apikey|secret|client_secret|password|passwd|pwd|auth|sid|key)=[^\s"'&,;]+/gi, '$1=[removed]'],
    [/("(?:token|access_token|refresh_token|id_token|api_?key|apikey|secret|client_secret|password|authorization)"\s*:\s*")[^"]*"/gi, '$1[removed]"'],
    [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[token removed]'],
  ];

  function scrub(text) {
    let out = String(text == null ? '' : text);
    for (const [re, to] of RULES) out = out.replace(re, to);
    return out;
  }

  // --- gathering -----------------------------------------------------------
  function lookLabel(style, colors) {
    if (!style) return 'unknown';
    return colors && colors !== 'look' ? `${style} (${colors} colours)` : style;
  }

  // The log, oldest first: crashes from earlier launches, this launch's events,
  // then the quiet problems. `d` is main's app:diagnostics answer.
  function logLines(d, problems) {
    const out = [];
    const when = (at) => { try { return new Date(at).toISOString().replace('T', ' ').slice(0, 16); } catch { return '?'; } };
    const started = d && d.startedAt;
    for (const e of (d && Array.isArray(d.crashHistory) ? d.crashHistory : [])) {
      if (started && e.at >= started) continue;              // listed again below, as an event
      out.push({ at: e.at || 0, text: `${when(e.at)} crash log — ${e.kind}: ${e.detail || ''}${e.version ? ' (v' + e.version + ')' : ''}` });
    }
    for (const e of (d && Array.isArray(d.events) ? d.events : [])) {
      out.push({ at: e.at || 0, text: `${when(e.at)} this launch — ${e.kind}: ${e.detail || ''}` });
    }
    for (const x of (d && Array.isArray(d.extensionErrors) ? d.extensionErrors : [])) {
      out.push({ at: (started || 0), text: `extension failed to load — ${x.folder}: ${x.error}` });
    }
    for (const p of (Array.isArray(problems) ? problems : [])) {
      out.push({ at: p.at || 0, text: `${when(p.at)} problem — ${p.area}: ${p.message}${p.n > 1 ? ` (x${p.n})` : ''}${p.detail ? ' — ' + p.detail : ''}` });
    }
    out.sort((a, b) => a.at - b.at);
    return out.map(x => x.text.replace(/\s+/g, ' ').trim());
  }

  // The report text. `lines` are already scrubbed; `left` is how many older
  // lines were dropped to fit.
  function compose(info, lines, left) {
    const env = [
      `- Vex: ${info.version || '?'}`,
      `- Electron: ${info.electron || '?'} · Chromium: ${info.chrome || '?'}`,
      `- Windows: ${info.os || '?'}${info.arch ? ' (' + info.arch + ')' : ''}`,
      `- Look: ${lookLabel(info.style, info.colors)} · Theme: ${info.theme || '?'}`,
    ];
    if (info.safeMode) env.push('- Started in safe mode');
    const log = lines.length
      ? ['```', ...lines, '```']
      : ['Nothing in Vex\'s problem or crash lists.'];
    if (left > 0) log.push(`(${left} older line${left === 1 ? '' : 's'} left out to fit GitHub's link length.)`);
    return [
      '### What happened',
      'Describe what you did, what you expected, and what happened instead.',
      '',
      '### Vex',
      ...env,
      '',
      `### Recent problems and crashes (last ${lines.length}, oldest first)`,
      ...log,
      '',
    ].join('\n');
  }

  function issueUrl(title, body) {
    return NEW_ISSUE + '?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
  }

  // Build the scrubbed report, dropping the oldest log lines until the address
  // fits. Returns { title, body, left }.
  function build(info, rawLines, maxLines = LOG_LINES) {
    const title = `Problem in Vex ${info.version || ''}`.trim();
    const all = rawLines.map(scrub);
    let lines = all.slice(-maxLines);
    let left = all.length - lines.length;
    let body = compose(info, lines, left);
    while (lines.length && issueUrl(title, body).length > MAX_URL) {
      lines = lines.slice(1);
      left++;
      body = compose(info, lines, left);
    }
    // A single enormous line can still be too long: cut it.
    if (issueUrl(title, body).length > MAX_URL) body = fitText(title, body).body;
    return { title, body, left };
  }

  // What the user edited may be longer than fits. Cut from the end, on a
  // character that does not split a percent-escape, and say so in the text.
  const CUT_NOTE = '\n\n[Shortened to fit GitHub\'s link length.]';
  function fitText(title, body) {
    if (issueUrl(title, body).length <= MAX_URL) return { body, cut: false };
    let lo = 0, hi = body.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (issueUrl(title, body.slice(0, mid) + CUT_NOTE).length <= MAX_URL) lo = mid; else hi = mid - 1;
    }
    return { body: body.slice(0, lo) + CUT_NOTE, cut: true };
  }

  // The first line of the preview may be "Title: …", so the title is editable
  // in the same box as the body.
  function splitTitle(text, fallback) {
    const m = /^Title:[ \t]*(.*)\r?\n/.exec(text);
    if (!m) return { title: fallback, body: text };
    return { title: m[1].trim() || fallback, body: text.slice(m[0].length).replace(/^\r?\n/, '') };
  }

  async function gather() {
    let d = {};
    if (typeof window !== 'undefined' && window.vex && typeof window.vex.diagnostics === 'function') {
      d = await window.vex.diagnostics();
    }
    const problems = (typeof VexProblems !== 'undefined') ? VexProblems.all() : [];
    const gs = (typeof window !== 'undefined' && window.VexGuiStyle) || null;
    const info = {
      version: d.version, electron: d.electron, chrome: d.chrome, os: d.os, arch: d.arch, safeMode: d.safeMode,
      style: gs && typeof gs.get === 'function' ? gs.get() : '',
      colors: gs && typeof gs.getColors === 'function' && typeof gs.isBrowserLook === 'function' && gs.isBrowserLook() ? gs.getColors() : '',
      theme: (typeof ThemeManager !== 'undefined' && ThemeManager.currentTheme) || '',
    };
    return { info, lines: logLines(d, problems) };
  }

  let busy = false;
  async function open() {
    if (busy) return false;
    busy = true;
    try {
      let report;
      try {
        const { info, lines } = await gather();
        report = build(info, lines);
      } catch (err) {
        window.showToast?.('Could not put the report together: ' + ((err && err.message) || err), 'error', 6000);
        if (typeof VexProblems !== 'undefined') VexProblems.note('Report a problem', 'Could not put the report together', err);
        return false;
      }
      let text = 'Title: ' + report.title + '\n\n' + report.body;
      let note = '';
      for (;;) {
        const edited = await window.vexPrompt({
          title: 'Report a problem',
          message: 'This is exactly what goes into the GitHub issue: read it, change it, or delete anything you would rather not share. ' +
            'Addresses have lost their query strings, your Windows user folder reads %USERPROFILE%, and emails and tokens are removed. ' +
            'Nothing is sent until you press Open on GitHub, and GitHub posts nothing until you press Submit there.' + note,
          value: text,
          multiline: true,
          wide: true,
          label: 'Report',
          okLabel: 'Open on GitHub',
        });
        if (edited == null) return false;
        const { title, body } = splitTitle(String(edited), report.title);
        const fitted = fitText(title, body);
        if (fitted.cut) {
          // Never send what was not shown: show the shortened text again.
          text = 'Title: ' + title + '\n\n' + fitted.body;
          note = '\n\nIt was too long for a GitHub link, so the end was cut. Check it again.';
          continue;
        }
        const url = issueUrl(title, fitted.body);
        if (typeof TabManager !== 'undefined') {
          TabManager.createTab(url, true);
          if (typeof SidebarManager !== 'undefined') SidebarManager.hideActivePanel?.();
        } else if (window.vex && typeof window.vex.openExternal === 'function') {
          await window.vex.openExternal(url);
        } else {
          throw new Error('There is no way to open the GitHub page from here');
        }
        return true;
      }
    } finally { busy = false; }
  }

  function init() {
    const btn = typeof document !== 'undefined' && document.getElementById('btn-report-problem');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => { open().catch(err => window.showToast?.((err && err.message) || String(err), 'error', 6000)); });
  }

  return { open, init, scrub, build, compose, logLines, issueUrl, fitText, splitTitle, MAX_URL, LOG_LINES, NEW_ISSUE };
})();

if (typeof window !== 'undefined') {
  window.VexReport = VexReport;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => VexReport.init());
  else VexReport.init();
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexReport };
