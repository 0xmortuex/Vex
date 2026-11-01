// === The page a reported-dangerous address gets in place of the site =========
//
// Shown in the tab (main.js, _threatPage) instead of loading the site. No script runs in it. Its
// choices are plain links to addresses that can never be reached for real (.invalid does not
// resolve); main recognises them only while this very tab is showing this very page:
//
//   BACK      "Go back to safety" (it has the focus, so Enter is the safe choice)
//   CONTINUE  "Continue anyway", inside a closed <details>: a second click, and it is logged
//   TRUST     "Never warn about this site", in the same <details>
//
// For the test page (vex-safety-test.invalid) Continue and Trust only show a note.

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ORIGIN = 'https://vex-threat.invalid';
const BACK_URL = ORIGIN + '/back';
const CONTINUE_PREFIX = ORIGIN + '/continue?to=';
const TRUST_PREFIX = ORIGIN + '/trust?to=';
const continueUrl = (url) => CONTINUE_PREFIX + encodeURIComponent(url);
const trustUrl = (url) => TRUST_PREFIX + encodeURIComponent(url);

function threatPageHtml(url, hit) {
  let host;
  try { host = new URL(url).hostname; } catch { host = ''; }
  const test = !!hit && hit.kind === 'test';
  const why = test
    ? 'This is a test. No real site is involved and nothing was downloaded; it shows what you would see for a site on the list.'
    : hit && hit.kind === 'address'
      ? 'This exact page address is on a list of reported phishing and malware pages.'
      : 'The site name <b>' + esc(hit && hit.matched || host) + '</b> is on a list of reported phishing and malware sites.';
  const cont = test ? '#tested' : esc(continueUrl(url));
  const trust = test ? '#tested' : esc(trustUrl(url));
  return `<!doctype html><html><head><meta charset="utf-8"><title>This site is reported as dangerous</title><meta name="color-scheme" content="light dark">
<style>:root{--bg:#f6f7f9;--text:#1b1f27;--muted:#5b6472;--accent:#b4232a;--btn:#1b1f27;--btn-text:#fff;--rule:#d8dce3}@media (prefers-color-scheme:dark){:root{--bg:#121419;--text:#e6e9ef;--muted:#9aa3b2;--accent:#ff6b6b;--btn:#e6e9ef;--btn-text:#121419;--rule:#2a2f3a}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:600px;padding:32px 24px}h1{font-size:22px;margin:0 0 12px;color:var(--accent)}p{margin:0 0 14px}.muted{color:var(--muted);font-size:13.5px}a{color:var(--text)}
.name{font-weight:700;word-break:break-all}.btn{display:inline-block;font-weight:600;padding:9px 20px;border-radius:8px;background:var(--btn);color:var(--btn-text);text-decoration:none}.btn:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.actions{margin:20px 0 18px}details{border-top:1px solid var(--rule);padding-top:10px;font-size:13.5px;color:var(--muted)}summary{cursor:pointer;width:max-content}summary:focus-visible,details a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}details p{margin:10px 0}details .row{display:flex;flex-wrap:wrap;gap:16px}
#tested{display:none;margin-top:12px;padding:8px 12px;border:1px solid var(--rule);border-radius:8px}#tested:target{display:block}</style></head>
<body><main><h1>This site is reported as dangerous</h1>
<p><span class="name">${esc(host)}</span> may try to steal your passwords or put harmful software on this computer. Vex stopped before loading it, so nothing you would type there has gone anywhere.</p>
<p class="muted">${why}</p>
<div class="actions"><a class="btn" id="vex-safe" href="${esc(BACK_URL)}" autofocus>Go back to safety</a></div>
<details><summary id="vex-continue-open">Continue anyway</summary>
<p>Only go on if you are sure this site is safe. Vex will note that you continued to <b>${esc(host)}</b> in this tab.</p>
<div class="row"><a id="vex-continue" href="${cont}">I understand the risk, open the site</a><a id="vex-trust" href="${trust}">Never warn me about this site</a></div>
<div id="tested">This is the test page, so nothing was opened and nothing was saved. A real warning would have gone on to the site here.</div></details>
<p class="muted" style="margin-top:18px">Checked on this computer against a list Vex keeps; the address you went to was not sent anywhere. You can turn this off, or see the list, in Vex Settings under Privacy and security.</p>
</main></body></html>`;
}

module.exports = { threatPageHtml, continueUrl, trustUrl, BACK_URL, CONTINUE_PREFIX, TRUST_PREFIX };
