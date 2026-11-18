// Discord is a plain web page in Vex (2026-11-17): the panel loads discord.com and Vex adds nothing to it.
// This holds the whole of that in one place, by reading the source:
//   - no client mod: no Vencord installer, no extension in the Discord panel's session, the page's CSP is left alone;
//   - no Discord-specific script, style or button press in the page: no visibility spoof, no rest mode, no theme,
//     no hotkeys that press Mute, no stylesheet, no read of its buttons, messages or server bar;
//   - Vex itself calls none of Discord's API or gateway addresses and never reads the account's token;
//   - boosts, userscripts, page automations and the agent refuse Discord's hosts;
//   - the block bypass (ByeDPI, the built-in proxy) only changes how the connection is made.
// The one address of Discord's API that stays is the owner's own announcement webhook (main/comms-tools.js): a
// webhook is what Discord gives a server owner for posting from outside, and it has nothing to do with the panel,
// the account or its token.
import { describe, it, expect } from 'vitest';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(full, out); continue; }
    if (/\.(js|html)$/.test(e.name)) out.push(full);
  }
  return out;
}
const FILES = walk(SRC).map(f => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') }));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const offenders = (re, allow = () => false) => FILES.filter(f => !allow(f.rel) && re.test(f.text)).map(f => f.rel);

describe('Vex calls none of Discord\'s API or gateway addresses', () => {
  it('no source file names a Discord API address, except the owner\'s webhook', () => {
    // discord.com/api/<anything> that is not /api/webhooks/
    expect(offenders(/discord(?:app)?\.com\/api\/(?!webhooks\/)/i)).toEqual([]);
    expect(offenders(/discord(?:app)?\.com\\\/api\\\/(?!webhooks)/i)).toEqual([]);   // the same, written inside a regular expression
  });
  it('no source file names the gateway', () => {
    expect(offenders(/gateway\.discord\.gg|gateway-[a-z0-9-]+\.discord\.gg/i)).toEqual([]);
  });
  it('the only sender to a Discord address is the webhook in main/comms-tools.js', () => {
    const withWebhook = offenders(/\/api\/webhooks|\\\/api\\\/webhooks/i);
    expect(withWebhook.filter(f => !/comms-tools|announce-composer|i18n|redact|webhook-inspector|feature-|share-space|faq|legal|egress|dialogs-tr/.test(f))).toEqual([]);
    expect(read('src/main/comms-tools.js')).toMatch(/method: 'POST'/);
    expect(read('src/main/comms-tools.js')).not.toMatch(/vex-bridge\.json|vex-status\.json|statusWrite|bridgeRead/);
  });
  it('the bypass test asks for two pages of discord.com, never an API address', () => {
    const main = read('src/main.js');
    expect(main).toMatch(/_testOne\('https:\/\/discord\.com\/app'\)/);
    expect(main).toMatch(/_testOne\('https:\/\/discord\.com\/login'\)/);
  });
});

describe('Vex never reads the Discord account\'s token', () => {
  it('nothing reaches for the token in the page, its storage or its bundle', () => {
    expect(offenders(/webpackChunkdiscord_app|getToken\(\)\s*[;,)]?\s*\/\/.*discord|localStorage\.token\b|["']token["']\s*\)\s*;?\s*\/\/.*discord/i)).toEqual([]);
    expect(offenders(/discord[\s\S]{0,200}Authorization\s*:/i, (rel) => /i18n|feature-|faq/.test(rel))).toEqual([]);
  });
});

describe('no client mod and nothing of Vex\'s in the Discord page', () => {
  const main = read('src/main.js');
  it('there is no Vencord installer, dev reload, heap profiler or bridge', () => {
    expect(main).not.toMatch(/discord:install-vencord|_installedVencord|_findLocalVencordZip|discord-dev|discord-heap|vencord-folders/);
    for (const gone of ['src/main/discord-dev.js', 'src/main/discord-heap.js', 'src/main/vencord-folders.js', 'src/main/discord-lite.js', 'src/main/discord-popout-back.js',
      'src/main/content-pin.js', 'src/renderer/js/discord-theme.js', 'src/renderer/js/discord-tokens.js', 'src/renderer/js/discord-status.js', 'src/renderer/js/vencord-bridge.js',
      'src/renderer/js/discord-plugin-ram.js', 'src/renderer/js/discord-measure.js', 'tools/vencord-bridge', 'docs/vencord-bridge.md']) {
      expect(fs.existsSync(path.join(ROOT, gone)), gone).toBe(false);
    }
  });
  it('no extension is loaded into the Discord panel\'s session', () => {
    const ext = require('../../src/main/extensions.js');
    expect(ext.NO_EXTENSION_PARTITIONS).toContain('persist:discord');
    expect(Object.keys(ext.APP_PARTITIONS)).not.toContain('persist:discord');
    expect(main).toMatch(/partitions\.filter\(p => !extHelpers\.NO_EXTENSION_PARTITIONS\.includes\(p\)\)/);
    expect(main).toMatch(/if \(extHelpers\.NO_EXTENSION_PARTITIONS\.some\(p => secureSessions\.fromPartition\(p\) === ses\)\) return;/);
  });
  it('the page\'s Content-Security-Policy and requests are left alone', () => {
    expect(main).not.toMatch(/stripAllCsp|isHeavyDiscordMedia|stillVersionOf|discord:lite/);
  });
  it('there is no Discord site tweak (the visibility spoof and rest mode are gone)', () => {
    const { SITE_TWEAKS } = require('../../src/site-tweaks.js');
    expect(SITE_TWEAKS.filter(t => /discord/i.test(String(t.hosts) + t.name))).toEqual([]);
    expect(offenders(/__vexRest|discord-always-visible/)).toEqual([]);
  });
  it('nothing presses or reads Discord\'s own buttons, messages or server bar', () => {
    // A selector for one of Discord's buttons (Vex's own "Mute tab" labels are attributes, not selectors).
    expect(offenders(/\[aria-label\^?=\\?"(?:Mute|Unmute|Deafen|Undeafen|Disconnect|Stop Streaming)/)).toEqual([]);
    expect(offenders(/guildsnav___|data-list-id=\\?"chat-messages|messageListItem|rtcConnectionStatus/)).toEqual([]);
    expect(offenders(/window\.Vencord|Vencord\.Settings|VexPluginProfiler/)).toEqual([]);
  });
});

describe('the general page tools refuse Discord', () => {
  it('boosts are never applied to it and cannot be made for it', () => {
    const src = read('src/renderer/js/boosts.js');
    expect(src).toMatch(/if \(!b \|\| b\.paused \|\| this\.isDiscordHost\(host\)\) \{ this\._writeCss\(webview, ''\); return; \}/);
    expect(src.match(/if \(this\.isDiscordHost\(host\)\) \{ window\.showToast\?\.\(this\.DISCORD_WHY, 'error'\); return; \}/g)).toHaveLength(2);
  });
  it('no userscript matches it, in a tab either, whatever its owner allowed', () => {
    const us = require('../../src/main/userscripts.js');
    const script = { meta: { matches: ['*://*/*'], includes: [], excludeMatches: [], excludes: [] }, userHosts: ['discord.com'] };
    expect(us.scriptMatches(script, 'https://example.com/')).toBe(true);
    for (const url of ['https://discord.com/channels/@me', 'https://canary.discord.com/app', 'https://discordapp.com/', 'https://discord.gg/abc']) expect(us.scriptMatches(script, url), url).toBe(false);
    expect(us.scriptMatches(script, 'https://discord.com.example.test/')).toBe(true);
    expect(us.tabAllowed({ partition: 'persist:discord' })).toBe(false);
  });
  it('an automation is never recorded on it, never opens it and never acts in it', () => {
    const M = require('../../src/renderer/js/automations-model.js');
    expect(() => M.cleanUrl('https://discord.com/channels/@me')).toThrow(/plain page/);
    expect(M.urlRefusal('https://ptb.discord.com/app', { isPrivateHost: () => false })).toMatch(/plain page/);
    expect(M.urlRefusal('https://example.com/', { isPrivateHost: () => false })).toBe('');
    expect(M.discordRefusal('https://discord.gg/abc')).toMatch(/plain page/);
    expect(M.discordRefusal('not a url')).toBe('');
    expect(read('src/main/automations-run.js')).toMatch(/const onDiscord = Model\.discordRefusal\(await driver\.currentUrl\(\)\);\s*if \(onDiscord\) return await fail\(i, step, 'navigation-refused', onDiscord\);/);
  });
  it('the agent never works in it or goes to it', () => {
    const src = read('src/renderer/js/agent-safety.js');
    expect(src).toMatch(/if \(\/\(\^\|\\\.\)\(discord\\\.com\|discordapp\\\.com\|discord\\\.gg\)\$\/i\.test\(u\.hostname\)\) return 'Discord is a plain page in Vex/);
  });
  it('fingerprint noise and the navigator values that go with it are never put on it', () => {
    const helpers = require('../../src/main-helpers.js');
    for (const url of ['https://discord.com/app', 'https://canary.discord.com/x', 'https://discordapp.com/']) expect(helpers.farbleFor(true, 'persist:discord', {}, url), url).toBe(false);
    expect(helpers.farbleFor(true, 'persist:main', {}, 'https://example.com/')).toBe(true);
  });
});

describe('the block bypass stays at the network level', () => {
  it('it sets a proxy for the session and runs nothing in the page', () => {
    for (const rel of ['src/renderer/js/discord-bypass.js', 'src/main/discord-pac.js', 'src/main/byedpi-share.js', 'src/byedpi.js', 'src/main-dpi-bypass.js']) {
      expect(read(rel), rel).not.toMatch(/executeJavaScript|insertCSS|vexGuestEval|webFrame/);
    }
  });
});
