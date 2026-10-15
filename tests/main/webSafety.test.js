import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ws = require('../../src/main/web-safety.js');
const { BRANDS } = require('../../src/main/web-safety-brands.js');
const { analyzeHost, classifyDownload, assessPermission, createWebSafety, registrable, skeleton, fold, editDistance, mixesScripts } = ws;

// Real, popular sites that are NOT on the brand list. None may ever be called
// a lookalike, in either mode: this is the false-positive corpus.
const REAL = `
wordpress.com wordpress.org blogger.com blogspot.com tumblr.com wix.com squarespace.com weebly.com godaddy.net
cnet.com zdnet.com theverge.com wired.com arstechnica.com techcrunch.com engadget.com gizmodo.com mashable.com
nbcnews.com abcnews.go.com cbsnews.com foxnews.com reuters.com apnews.com bloomberg.com forbes.com wsj.com ft.com economist.com
washingtonpost.com latimes.com usatoday.com huffpost.com buzzfeed.com vice.com vox.com politico.com npr.org pbs.org time.com
espn.com nfl.com nba.com mlb.com nhl.com fifa.com olympics.com goal.com skysports.com
spotify.net soundcloud.com bandcamp.com deezer.com tidal.com pandora.com last.fm shazam.com genius.com
vimeo.com dailymotion.com crunchyroll.com funimation.com plex.tv roku.com peacocktv.com paramountplus.com
walgreens.com cvs.com kroger.com safeway.com lowes.com macys.com nordstrom.com gap.com nike.com adidas.com puma.com zara.com hm.com uniqlo.com
newegg.com wayfair.com overstock.com chewy.com instacart.com doordash.com grubhub.com ubereats.com yelp.com tripadvisor.com
kayak.com skyscanner.net priceline.com hotels.com trivago.com hostelworld.com vrbo.com southwest.com jetblue.com
bankrate.com nerdwallet.com mint.com creditkarma.com turbotax.com intuit.com quickbooks.com paychex.com gusto.com
tdbank.ca bmo.com cibc.com nationwide.co.uk natwest.com monzo.com starlingbank.com n26.com
python.org nodejs.org rust-lang.org golang.org ruby-lang.org php.net java.com kotlinlang.org swift.org typescriptlang.org
reactjs.org angular.io vuejs.org svelte.dev nextjs.org nuxt.com tailwindcss.com getbootstrap.com jquery.com
postgresql.org mysql.com mongodb.com redis.io sqlite.org elastic.co grafana.com prometheus.io
kubernetes.io terraform.io ansible.com jenkins.io circleci.com travis-ci.com sentry.io datadoghq.com newrelic.com
ubuntu.com debian.org archlinux.org fedoraproject.org kernel.org gnu.org apache.org nginx.org
jetbrains.com visualstudio.com sublimetext.com vim.org eclipse.org
khanacademy.org edx.org codecademy.com freecodecamp.org w3schools.com mdn.dev developer.mozilla.org leetcode.com hackerrank.com
arxiv.org nature.com science.org sciencedirect.com springer.com jstor.org researchgate.net academia.edu
nasa.gov noaa.gov nih.gov cdc.gov who.int un.org worldbank.org imf.org
bbc.co.uk gov.scot service.gov.uk nhs.uk parliament.uk
lemonde.fr lefigaro.fr spiegel.de zeit.de bild.de elpais.com corriere.it repubblica.it
rakuten.co.jp yahoo.co.jp naver.com daum.net baidu.com qq.com weibo.com taobao.com tmall.com jd.com
yandex.ru mail.ru ok.ru rambler.ru
flipkart.com paytm.com zomato.com swiggy.com
mercadolibre.com olx.com globo.com uol.com.br
airtable.com asana.com trello.com monday.com clickup.com basecamp.com todoist.com evernote.com
figma.com canva.com miro.com invisionapp.com sketch.com dribbble.com behance.net unsplash.com pexels.com
mailchimp.com sendgrid.com hubspot.com zendesk.com intercom.com freshworks.com surveymonkey.com typeform.com
gofundme.com kickstarter.com patreon.com indiegogo.com
imgur.com giphy.com flickr.com 500px.com deviantart.com artstation.com
archive.org gutenberg.org goodreads.com audible.com kindle.com
speedtest.net fast.com downdetector.com virustotal.com haveibeenpwned.com
nordvpn.com expressvpn.com surfshark.com protonvpn.com mullvad.net
teamviewer.com anydesk.com logmein.com
`.split(/\s+/).filter(Boolean);

describe('registrable name', () => {
  it('finds the name the owner registered', () => {
    expect(registrable('login.paypal.com')).toBe('paypal.com');
    expect(registrable('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrable('a.b.example.com.au')).toBe('example.com.au');
    expect(registrable('10.0.0.1')).toBe('10.0.0.1');
    expect(registrable('localhost')).toBe('localhost');
  });
  it('every brand on the list is itself a registrable name', () => {
    for (const b of BRANDS) expect(registrable(b), b).toBe(b);
  });
});

describe('brand list is self-consistent', () => {
  it('has about 200 entries', () => { expect(BRANDS.length).toBeGreaterThanOrEqual(190); });
  it('has no duplicates and no two entries that read the same', () => {
    expect(new Set(BRANDS).size).toBe(BRANDS.length);
    const seen = new Map();
    for (const b of BRANDS) {
      const k = fold(skeleton(b));
      // Two short names may legitimately fold together; the checks skip names under four letters.
      if (b.split('.')[0].length < 4) continue;
      expect(seen.has(k) ? [b, seen.get(k)] : null, 'collision').toBeNull();
      seen.set(k, b);
    }
  });
  it('flags none of its own entries, in any mode', () => {
    for (const mode of ['standard', 'strict']) {
      for (const b of BRANDS) {
        expect(analyzeHost(b, { sensitivity: mode }).flagged, b + ' ' + mode).toBe(false);
        expect(analyzeHost('www.' + b, { sensitivity: mode }).flagged, 'www.' + b).toBe(false);
        expect(analyzeHost('accounts.' + b, { sensitivity: mode }).flagged, 'accounts.' + b).toBe(false);
      }
    }
  });
});

describe('false-positive corpus: real popular sites', () => {
  it('has a corpus of a few hundred', () => { expect(REAL.length).toBeGreaterThan(250); });
  for (const mode of ['standard', 'strict']) {
    it('calls none of them a lookalike in ' + mode + ' mode', () => {
      const flagged = REAL.map(h => ({ h, r: analyzeHost(h, { sensitivity: mode }) })).filter(x => x.r.flagged).map(x => x.h + ' -> ' + x.r.kind + ' ' + x.r.resembles);
      expect(flagged).toEqual([]);
    });
  }
  it('does not flag a regional version of a brand', () => {
    for (const h of ['google.co.uk', 'google.com.au', 'google.de', 'amazon.co.uk', 'amazon.de', 'amazon.co.jp', 'ebay.co.uk', 'paypal.me', 'yahoo.co.jp', 'microsoft.com.cn']) {
      expect(analyzeHost(h, { sensitivity: 'standard' }).flagged, h).toBe(false);
    }
  });
  it('does not flag honest internationalised names', () => {
    for (const h of ['xn--mnchen-3ya.de', 'xn--e1afmkfd.xn--p1ai', 'xn--bcher-kva.com', 'xn--fiq228c.cn', 'xn--cckwcxetd.jp']) {
      expect(analyzeHost(h, { sensitivity: 'standard' }).flagged, h).toBe(false);
    }
    expect(analyzeHost('münchen.de').flagged).toBe(false);
    expect(analyzeHost('яндекс.рф').flagged).toBe(false);
    expect(analyzeHost('日本語.jp').flagged).toBe(false);
    expect(analyzeHost('ひらがなカタカナ漢字.jp').flagged).toBe(false);
  });
  it('does not flag this machine or a LAN name or an IP', () => {
    for (const h of ['localhost', '192.168.1.5', '127.0.0.1', 'nas.local', 'router', '[::1]']) expect(analyzeHost(h, { sensitivity: 'strict' }).flagged).toBe(false);
  });
});

describe('lookalike detection', () => {
  const flag = (h, o) => analyzeHost(h, { sensitivity: 'standard', ...(o || {}) });
  it('catches a Cyrillic letter inside a familiar name', () => {
    const r = flag('xn--pypal-4ve.com');                    // pаypal.com (Cyrillic a)
    expect(r.flagged).toBe(true);
    expect(['mixed-script', 'homograph']).toContain(r.kind);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it('catches a name written wholly in look-alike letters', () => {
    expect(flag('xn--80ak6aa92e.com').flagged).toBe(true);   // the famous apple.com one
    const r = flag('аррӏе.com');                           // all Cyrillic
    expect(r.flagged).toBe(true);
    expect(r.resembles).toBe('apple.com');
  });
  it('catches mixed scripts with no brand involved', () => {
    expect(mixesScripts('exаmple')).toBe(true);
    expect(flag('exаmple.com').kind).toBe('mixed-script');
    expect(mixesScripts('日本語かな')).toBe(false);
  });
  it('catches digit and letter-pair substitutions', () => {
    for (const [h, b] of [['paypa1.com', 'paypal.com'], ['rnicrosoft.com', 'microsoft.com'], ['micr0soft.com', 'microsoft.com'], ['arnazon.com', 'amazon.com'],
      ['faceb00k.com', 'facebook.com'], ['g00gle.com', 'google.com'], ['linkedln.com', 'linkedin.com'], ['netf1ix.com', 'netflix.com'], ['vvhatsapp.com', 'whatsapp.com']]) {
      const r = flag(h);
      expect(r.flagged, h).toBe(true);
      expect(r.resembles, h).toBe(b);
    }
  });
  it('catches swapped and doubled letters', () => {
    for (const [h, b] of [['gogole.com', 'google.com'], ['gooogle.com', 'google.com'], ['netfilx.com', 'netflix.com'], ['faceboook.com', 'facebook.com'], ['paypall.com', 'paypal.com']]) {
      const r = flag(h);
      expect(r.flagged, h).toBe(true);
      expect(r.resembles, h).toBe(b);
    }
  });
  it('catches a brand written in front of another site', () => {
    const r = flag('paypal.com.account-verify.xyz');
    expect(r.flagged).toBe(true);
    expect(r.kind).toBe('subdomain');
    expect(flag('login.microsoft.com.evil.example').flagged).toBe(true);
  });
  it('measures against the sites you use too', () => {
    expect(flag('myb4nk.com').flagged).toBe(false);
    expect(flag('myb4nk.com', { topHosts: ['mybank.com'] }).flagged).toBe(true);
    // ...and never flags the site you use itself.
    expect(flag('mybank.com', { topHosts: ['mybank.com'] }).flagged).toBe(false);
    expect(flag('login.mybank.com', { topHosts: ['mybank.com'] }).flagged).toBe(false);
  });
  it('does not call a very short name a lookalike of anything', () => {
    expect(flag('lng.com').flagged).toBe(false);       // ing.com is three letters
    expect(flag('ibn.com').flagged).toBe(false);
  });
  it('honours the allow list and the off setting', () => {
    expect(flag('paypa1.com', { allow: ['paypa1.com'] }).flagged).toBe(false);
    expect(flag('www.paypa1.com', { allow: ['paypa1.com'] }).flagged).toBe(false);
    expect(analyzeHost('paypa1.com', { sensitivity: 'off' }).flagged).toBe(false);
  });
  it('strict adds the weaker signals, standard stays quiet on them', () => {
    expect(analyzeHost('googlf.com', { sensitivity: 'standard' }).flagged).toBe(false);
    expect(analyzeHost('googlf.com', { sensitivity: 'strict' }).flagged).toBe(true);
    expect(analyzeHost('paypal-secure-login.com', { sensitivity: 'standard' }).flagged).toBe(false);
    const r = analyzeHost('paypal-secure-login.com', { sensitivity: 'strict' });
    expect(r.flagged).toBe(true);
    expect(r.level).toBe('medium');
  });
  it('gives a plain line and reasons for the "why was this flagged" text', () => {
    const r = flag('paypa1.com');
    expect(r.line).toMatch(/paypal\.com/);
    expect(r.reasons.join(' ')).toMatch(/numbers|lookalike/);
  });
});

describe('edit distance', () => {
  it('counts a swap as one', () => {
    expect(editDistance('google', 'gogole')).toBe(1);
    expect(editDistance('google', 'gooogle')).toBe(1);
    expect(editDistance('google', 'bing')).toBeGreaterThan(2);
  });
});

describe('download classifier', () => {
  const c = (filename, url, o) => classifyDownload({ filename, url }, { sensitivity: 'standard', ...(o || {}) });
  it('warns on a program from a bare IP address', () => {
    const r = c('setup.exe', 'http://203.0.113.9/files/setup.exe');
    expect(r.warn).toBe(true);
    expect(r.kind).toBe('ip-host');
    expect(r.level).toBe('high');
  });
  it('warns on a double extension from any host', () => {
    const r = c('invoice.pdf.exe', 'https://files.example.org/invoice.pdf.exe');
    expect(r.warn).toBe(true);
    expect(r.kind).toBe('disguised');
    expect(c('photo.jpg.scr', 'https://github.com/x/photo.jpg.scr').warn).toBe(true);
  });
  it('warns on a name that reverses its ending', () => {
    expect(c('report‮gnp.exe', 'https://example.org/x').warn).toBe(true);
  });
  it('warns on a script from a cheap suffix over plain http (two weak reasons)', () => {
    expect(c('fix.ps1', 'http://free-tools.xyz/fix.ps1').warn).toBe(true);
  });
  it('stays quiet on an installer from an ordinary named site on https', () => {
    expect(c('setup.exe', 'https://download.example.org/setup.exe').warn).toBe(false);
    expect(c('app.msi', 'https://cdn.vendor-site.io/app.msi').warn).toBe(false);
  });
  it('stays quiet for well-known hosts, your own sites and the allow list', () => {
    expect(c('VSCodeSetup.exe', 'https://microsoft.com/VSCodeSetup.exe').warn).toBe(false);
    expect(c('tool.exe', 'https://github.com/o/r/releases/download/v1/tool.exe').warn).toBe(false);
    expect(c('a.exe', 'http://203.0.113.9/a.exe', { allow: ['203.0.113.9'] }).warn).toBe(false);
    expect(c('a.exe', 'https://internal.corp-tools.net/a.exe', { topHosts: ['corp-tools.net'] }).warn).toBe(false);
  });
  it('is not bothered by documents, pictures, archives or media', () => {
    for (const f of ['report.pdf', 'photo.png', 'song.mp3', 'data.csv', 'backup.zip', 'movie.mp4', 'paper.docx'])
      expect(c(f, 'http://203.0.113.9/' + f).warn, f).toBe(false);
  });
  it('flags macro documents only in strict mode from an unknown cheap site', () => {
    expect(classifyDownload({ filename: 'q3.xlsm', url: 'https://sales.example.org/q3.xlsm' }, { sensitivity: 'standard' }).warn).toBe(false);
  });
  it('warns on a program from a lookalike host', () => {
    const r = c('update.exe', 'https://paypa1.com/update.exe');
    expect(r.warn).toBe(true);
    expect(r.kind).toBe('lookalike-host');
  });
  it('strict warns on a plain program from an unfamiliar site; off never warns', () => {
    expect(classifyDownload({ filename: 'x.exe', url: 'https://unknown-vendor.example.org/x.exe' }, { sensitivity: 'strict' }).warn).toBe(true);
    expect(classifyDownload({ filename: 'x.exe', url: 'http://203.0.113.9/x.exe' }, { sensitivity: 'off' }).warn).toBe(false);
  });
  it('never warns for this computer or the local network', () => {
    expect(c('x.exe', 'http://localhost:8080/x.exe').warn).toBe(false);
    expect(c('x.exe', 'http://nas.local/x.exe').warn).toBe(false);
  });
  it('gives a plain line', () => {
    expect(c('setup.exe', 'http://203.0.113.9/setup.exe').line).toMatch(/setup\.exe is a program/);
  });
});

describe('permission assessment', () => {
  const a = (p, o, s) => assessPermission({ permission: p, origin: 'https://shop.example.org', gesture: true, recent: [], ...o }, { sensitivity: 'standard', ...(s || {}) });
  it('always has a plain risk line for a sensitive permission, but no alarm for an ordinary ask', () => {
    const r = a('camera');
    expect(r.riskLine).toMatch(/camera/);
    expect(r.summary).toBe('');
    expect(r.level).toBe('normal');
  });
  it('says the site asks for more than it should when it asked for three things', () => {
    const recent = [{ permission: 'camera' }, { permission: 'microphone' }, { permission: 'geolocation' }];
    const r = a('notifications', { recent });
    expect(r.level).toBe('high');
    expect(r.summary).toMatch(/more than it should/);
    expect(r.why.join(' ')).toMatch(/3 different/);
  });
  it('flags a request from a frame of another site', () => {
    const r = a('geolocation', { topOrigin: 'https://news.example.com' });
    expect(r.level).toBe('high');
    expect(r.why.join(' ')).toMatch(/frame of another site/);
  });
  it('flags a lookalike host and an unencrypted page', () => {
    expect(a('camera', { origin: 'https://paypa1.com' }).level).toBe('high');
    expect(a('microphone', { origin: 'http://shop.example.org' }).level).toBe('high');
  });
  it('standard stays quiet on an unprompted ask; strict mentions it', () => {
    expect(a('geolocation', { gesture: false }).level).toBe('normal');
    expect(a('geolocation', { gesture: false }, { sensitivity: 'strict' }).level).toBe('caution');
  });
  it('is silent when off, and for a site on the allow list', () => {
    expect(a('camera', {}, { sensitivity: 'off' }).riskLine).toBe('');
    const r = a('camera', { topOrigin: 'https://x.example.com' }, { allow: ['shop.example.org'] });
    expect(r.level).toBe('normal');
    expect(r.summary).toBe('');
  });
  it('knows nothing about a permission that is not sensitive', () => {
    expect(a('fullscreen').show).toBe(false);
  });
});

describe('stored choices', () => {
  const make = (initial) => {
    let disk = initial || null;
    const writes = [];
    const s = createWebSafety({ read: () => disk, write: async (t) => { disk = t; writes.push(t); }, topHosts: () => [] });
    return { s, writes, disk: () => disk };
  };
  it('keeps sensitivity, allowed sites and paranoid origins', async () => {
    const { s, disk } = make();
    expect(s.sensitivity).toBe('standard');
    await s.setSensitivity('strict');
    await s.allowHost('https://www.Example.com/path');
    await s.setParanoid('https://bank.example.com/login', true);
    const again = createWebSafety({ read: () => disk(), write: async () => {} });
    expect(again.snapshot()).toEqual({ sensitivity: 'strict', allow: ['example.com'], paranoid: ['https://bank.example.com'] });
    expect(again.isParanoid('https://bank.example.com/anything')).toBe(true);
    expect(again.isParanoid('https://other.example.com')).toBe(false);
    expect(again.isAllowed('shop.example.com')).toBe(true);
  });
  it('refuses nonsense and says so', async () => {
    const { s } = make();
    expect(() => s.setSensitivity('paranoid')).toThrow();
    expect(() => s.setParanoid('ftp://x', true)).toThrow();
    expect(() => s.allowHost('')).toThrow();
  });
  it('can forget an allowed site and switch paranoid off', async () => {
    const { s } = make();
    await s.allowHost('a.example.com');
    await s.forgetHost('a.example.com');
    expect(s.snapshot().allow).toEqual([]);
    await s.setParanoid('https://a.example.com', true);
    await s.setParanoid('https://a.example.com', false);
    expect(s.snapshot().paranoid).toEqual([]);
  });
  it('falls back to defaults on a damaged file, loudly', () => {
    const { s } = make('{not json');
    expect(s.snapshot().sensitivity).toBe('standard');
  });
  it('judges through the saved sensitivity', async () => {
    const { s } = make();
    expect(s.analyze('paypa1.com').flagged).toBe(true);
    await s.setSensitivity('off');
    expect(s.analyze('paypa1.com').flagged).toBe(false);
    expect(s.judgeDownload({ filename: 'a.exe', url: 'http://203.0.113.9/a.exe' }).warn).toBe(false);
  });
});

describe('no network', () => {
  it('the module never touches a network or a process API', () => {
    const fs = require('node:fs');
    const text = ['web-safety.js', 'web-safety-brands.js'].map(f => fs.readFileSync(require('node:path').join(__dirname, '../../src/main', f), 'utf8')).join('\n');
    expect(text).not.toMatch(/\bfetch\s*\(|require\(['"](?:https?|net|dns|tls|child_process|electron)['"]\)|XMLHttpRequest|WebSocket|net\.request|\.get\(\s*['"]https?:/);
  });
});
