// Audit of the development tools (CI's weekly run). Everything Vex ships is
// audited strictly on every push by `npm audit --omit=dev`; this step covers
// the tools that build it.
//
// One advisory is accepted while it cannot be fixed, and only while it stays
// out of what Vex ships. The exception ends by itself: if the package reaches
// the shipped dependencies, or if npm offers a fix that is not a downgrade of
// the tool, this fails and the entry must be removed.
const { execSync } = require('child_process');

const ACCEPTED = [
  {
    advisory: 'GHSA-ch52-4w7c-c8xp',
    package: 'http-cache-semantics',
    why: 'Pulled in by electron-builder (@electron/get, cacheable-request) to download Electron on the build machine; never shipped; no fixed version exists (accepted 2026-10-03).',
  },
];
const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];

function audit(args) {
  let out;
  // A fixed command line (no outside input), so running it through the shell is safe.
  try { out = execSync(['npm', 'audit', '--json', ...args].join(' '), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (err) {
    // npm audit exits 1 when it finds anything; its JSON is still on stdout.
    if (!err.stdout) throw err;
    out = err.stdout;
  }
  const report = JSON.parse(out);
  if (report.error) throw new Error('npm audit failed: ' + JSON.stringify(report.error));
  return report.vulnerabilities || {};
}

function advisoriesOf(entry) {
  return (entry.via || []).filter(v => v && typeof v === 'object' && v.url).map(v => ({ id: v.url.split('/').pop(), severity: v.severity }));
}

const all = audit([]);
const shipped = audit(['--omit=dev']);
const problems = [];

for (const [name, entry] of Object.entries(all)) {
  if (LEVELS.indexOf(entry.severity) < LEVELS.indexOf('high')) continue;
  const own = advisoriesOf(entry).filter(a => LEVELS.indexOf(a.severity) >= LEVELS.indexOf('high'));
  // A package flagged only through another one is reported under that one.
  if (!own.length) continue;
  const unaccepted = own.filter(a => !ACCEPTED.some(x => x.package === name && x.advisory === a.id));
  if (unaccepted.length) { problems.push(`${name}: ${unaccepted.map(a => a.id).join(', ')}`); continue; }
  if (shipped[name]) problems.push(`${name}: accepted only as a build tool, but it is now in what Vex ships`);
  const fix = entry.fixAvailable;
  if (fix === true || (fix && typeof fix === 'object' && !fix.isSemVerMajor)) problems.push(`${name}: a fix is now available — update it and remove its entry from scripts/audit-dev.js`);
}

for (const accepted of ACCEPTED) {
  if (!all[accepted.package]) console.log(`[audit-dev] ${accepted.package} is no longer flagged — remove its entry from scripts/audit-dev.js`);
  else console.log(`[audit-dev] accepted ${accepted.advisory} in ${accepted.package}: ${accepted.why}`);
}
if (problems.length) {
  console.error('[audit-dev] high or critical advisories:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('[audit-dev] no unaccepted high or critical advisories');
