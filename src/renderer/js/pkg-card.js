// === Package page card =========================================================
//
// On a package's page at npmjs.com, pypi.org or crates.io a small card says what
// the page does not: the latest version, when it was last released, the licence,
// weekly downloads (npm, crates), whether it is deprecated, whether a public
// advisory covers the latest version, a one-line safety verdict with the reasons,
// and a "copy add command" button (pnpm add / uv add / cargo add).
//
// The facts come from the registries' own public APIs, fetched by Vex's main
// process through the bounded public fetch (src/main/pkg-intel.js); only the
// package name leaves this computer, and a private, Tor or routed tab never asks.
// The verdict is a rough check and says so. winget has no public API of this kind
// and is not covered.
const VexPkgCard = {
  ENABLED_KEY: 'vex.pkgCard.enabled',
  enabled() { return VexBench.flag(this.ENABLED_KEY); },
  setEnabled(on) { VexBench.setFlag(this.ENABLED_KEY, on); },

  // Which package an address is about (the same rule main uses).
  parse(url) {
    let u;
    try { u = new URL(String(url)); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
    if (host === 'npmjs.com' && seg[0] === 'package' && seg[1]) return { eco: 'npm', name: seg[1].startsWith('@') && seg[2] ? seg[1] + '/' + seg[2] : seg[1] };
    if (host === 'pypi.org' && seg[0] === 'project' && seg[1]) return { eco: 'pypi', name: seg[1] };
    if (host === 'crates.io' && seg[0] === 'crates' && seg[1]) return { eco: 'crates', name: seg[1] };
    return null;
  },

  // Pure: the card for one result.
  spec(info) {
    const rows = [['Latest', info.version || 'unknown']];
    rows.push(['Last release', info.lastPublish ? new Date(info.lastPublish).toLocaleDateString() + (info.ageDays != null ? ' (' + (info.ageDays < 60 ? info.ageDays + ' days' : Math.round(info.ageDays / 30) + ' months') + ' ago)' : '') : 'unknown']);
    rows.push(['Licence', info.license || 'none declared']);
    if (info.downloadsWeek != null) rows.push(['Downloads / week', info.downloadsWeek.toLocaleString()]);
    if (info.deprecated) rows.push(['Deprecated', typeof info.deprecated === 'string' ? info.deprecated.slice(0, 80) : 'yes']);
    rows.push(['Advisories', info.advisoriesChecked ? (info.advisories.length ? info.advisories.length + ' (' + info.advisories.map(a => a.id).slice(0, 3).join(', ') + ')' : 'none found') : 'not checked']);
    const verdict = { ok: 'Nothing looked wrong', caution: 'Worth a look', warning: 'Be careful' }[info.safety.level];
    return {
      id: 'vex-pkg-card', mode: 'card', tone: info.safety.level, title: info.name + ': ' + verdict, rows,
      lines: info.safety.reasons.map(r => '- ' + r).concat(info.notes.length ? ['Not available: ' + info.notes.join('; ')] : [], ['A quick check, not an audit.']),
      actions: [{ label: 'Copy: ' + info.addCommand, copy: info.addCommand }],
    };
  },

  async onSettled(tab, wv) {
    if (!VexBench.canRead(wv)) return;
    const pkg = this.parse(tab.url);
    if (!pkg) return;
    const r = await window.vex.devbenchPkg(pkg.eco, pkg.name);
    if (!r || !r.ok) throw new Error((r && r.error) || 'The package facts could not be fetched');
    // The tab may have moved on while the registry answered.
    const now = this.parse(VexBench.pageUrl(wv));
    if (!now || now.name !== pkg.name) return;
    await VexBench.inPage(wv, this.spec(r.info));
  },

  settingsRows(box) {
    box.appendChild(VexSettingsGroup.note('Adds a card to npm, PyPI and crates.io package pages. Asks each registry\'s public API for the package name only (listed in Privacy > Network). Not covered: winget.'));
  },
};

if (typeof window !== 'undefined') {
  window.VexPkgCard = VexPkgCard;
  VexBench.register({
    id: 'pkg-card', title: 'Package page intelligence', hint: 'npm, PyPI, crates.io',
    enabled: () => VexPkgCard.enabled(), setEnabled: (on) => VexPkgCard.setEnabled(on),
    settingsRows: (box) => VexPkgCard.settingsRows(box), onSettled: (t, wv) => VexPkgCard.onSettled(t, wv),
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { VexPkgCard };
