// === The page a lookalike address gets in place of the site ==================
//
// Shown in the tab (main.js, _lookalikePage) instead of loading a name that
// is made to be mistaken for another. The person can go back, continue this
// once, or trust the site for good. No script runs in it: its three choices
// are plain links that main recognises when the tab follows them.

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The one address that means "trust this site and go on". It can never be
// reached for real (.invalid does not resolve); main honours it only while the
// tab is showing this very page, for the very address shown.
const ALLOW_PREFIX = 'https://vex-websafety.invalid/allow?to=';
const allowUrl = (url) => ALLOW_PREFIX + encodeURIComponent(url);

function lookalikePageHtml(url, analysis) {
  let host;
  try { host = new URL(url).hostname; } catch { host = ''; }
  const reasons = (analysis && analysis.reasons || []).map(r => `<li>${esc(r)}</li>`).join('');
  const resembles = analysis && analysis.resembles ? esc(analysis.resembles) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>This address looks like another site</title><meta name="color-scheme" content="light dark">
<style>:root{--bg:#f6f7f9;--text:#1b1f27;--muted:#5b6472;--accent:#b4232a;--btn:#1b1f27;--btn-text:#fff;--rule:#d8dce3}@media (prefers-color-scheme:dark){:root{--bg:#121419;--text:#e6e9ef;--muted:#9aa3b2;--accent:#ff6b6b;--btn:#e6e9ef;--btn-text:#121419;--rule:#2a2f3a}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:600px;padding:32px 24px}h1{font-size:21px;margin:0 0 12px;color:var(--accent)}p{margin:0 0 14px}.muted{color:var(--muted);font-size:13.5px}a{color:var(--text)}
.name{font-weight:700;word-break:break-all}.why{margin:0 0 14px;padding:10px 12px 10px 28px;border:1px solid var(--rule);border-radius:8px;color:var(--muted);font-size:13.5px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:20px 0 14px}button{font:inherit;font-weight:600;padding:8px 18px;border-radius:8px;border:0;background:var(--btn);color:var(--btn-text);cursor:pointer}</style></head>
<body><main><h1>This address looks like another site</h1>
<p><span class="name">${esc(host)}</span> ${resembles ? `is written to look like <b>${resembles}</b>` : 'is written the way sites that fake another site are'}, and it is not that site. Vex stopped before loading it, so nothing you would type there has gone anywhere.</p>
<p class="muted" style="margin-bottom:6px">Why Vex flagged it</p>
<ul class="why">${reasons || '<li>The name looks like one that is made to be mistaken for another.</li>'}</ul>
<div class="actions"><button type="button" id="vex-back" onclick="history.back()">Go back</button><a id="vex-continue" href="${esc(url)}">Continue this once</a><a id="vex-trust" href="${esc(allowUrl(url))}">This site is fine, do not warn again</a></div>
<p class="muted">If you know this site, choosing “do not warn again” adds <b>${esc(host)}</b> to your own list. You can change how often Vex warns, or switch this off, in Vex's Web safety settings.</p>
</main></body></html>`;
}

module.exports = { lookalikePageHtml, allowUrl, ALLOW_PREFIX };
