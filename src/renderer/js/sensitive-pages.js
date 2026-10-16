// === Which pages are sensitive: banks, payments, sign-in, mail, chat (T3-077, T3-114) =
//
// One small list, read by the two features that must keep away from such pages:
//
//   Cookie-banner auto-reject (page-extras.js, ConsentBlock)  never clicks or hides
//        anything on a bank, a payment page or a sign-in page.
//   Screen-share safe mode (screen-share-safe.js)  blurs the TITLES of these tabs
//        while the screen is being shared.
//
// It reads an ADDRESS and nothing else: no page text, no cookies. A page that is
// not on the list is simply "not sensitive"; a wrong guess in the cautious
// direction (a shop's account page counts) only means a banner is left alone or a
// title is blurred for a while.
const VexSensitive = {
  // Whole words/names that appear in the host of a bank, wallet or money app. Matched as parts of the
  // host's labels, so "mybank.example" and "garanti.com.tr" both count, "banked.example" does not.
  MONEY: ['bank', 'banka', 'banking', 'paypal', 'stripe', 'revolut', 'payoneer', 'skrill', 'venmo', 'wise', 'coinbase', 'binance', 'kraken',
    'metamask', 'ledger', 'trezor', 'blockchain', 'garanti', 'garantibbva', 'isbank', 'akbank', 'yapikredi', 'ziraat', 'halkbank', 'vakifbank',
    'denizbank', 'qnb', 'enpara', 'papara', 'ininal', 'fibabanka', 'teb', 'sekerbank', 'hsbc', 'barclays', 'chase', 'wellsfargo', 'citi', 'capitalone',
    'bankofamerica', 'schwab', 'fidelity', 'robinhood', 'etrade', 'visa', 'mastercard', 'americanexpress'],
  // Hosts for secrets, identity and mail.
  ACCOUNT: ['1password.com', 'bitwarden.com', 'lastpass.com', 'dashlane.com', 'proton.me', 'protonmail.com', 'accounts.google.com',
    'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com', 'id.apple.com', 'mail.google.com', 'outlook.live.com', 'outlook.office.com',
    'outlook.office365.com', 'mail.yahoo.com', 'mail.proton.me', 'turkiye.gov.tr', 'login.gov', 'id.me', 'irs.gov', 'ssa.gov'],
  // The chat sites: their titles carry names and unread counts.
  CHAT: ['discord.com', 'web.whatsapp.com', 'messenger.com', 'web.telegram.org', 'app.slack.com', 'teams.microsoft.com'],
  // A path that is a sign-in, account or payment step wherever it is.
  PATH: /\/(?:log-?in|sign-?in|signin|signon|sso|auth|oauth2?|account|accounts|my-?account|checkout|payment|payments|pay|billing|wallet|verify|2fa|mfa|giris|uye-?girisi|odeme|hesabim|sifre|password)(?:[/.?#-]|$)/i,
  // A host that is itself a sign-in or payment front.
  HOST_LABEL: /^(?:login|signin|sign-in|accounts?|auth|sso|id|secure|pay|payments?|checkout|billing|wallet|online|ebank|ibank|internetbanking|giris)$/i,

  _host(url) { try { const u = new URL(String(url)); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase().replace(/^www\./, '') : ''; } catch { return ''; } },
  _under(host, domain) { return host === domain || host.endsWith('.' + domain); },

  // -> '' | 'money' | 'account' | 'signin' | 'chat'
  kind(url) {
    const host = this._host(url);
    if (!host) return '';
    const labels = host.split('.');
    if (this.ACCOUNT.some(d => this._under(host, d))) return 'account';
    if (this.MONEY.some(w => labels.some(l => l === w || l.startsWith(w + '-') || l.endsWith('-' + w) || l.startsWith(w) && w.length >= 5 || l.endsWith(w) && w.length >= 4))) return 'money';   // mybank counts; banked does not
    if (this.CHAT.some(d => this._under(host, d))) return 'chat';
    if (labels.length > 2 && this.HOST_LABEL.test(labels[0])) return 'signin';
    let path = '';
    try { path = new URL(String(url)).pathname; } catch { path = ''; }
    if (this.PATH.test(path)) return 'signin';
    return '';
  },

  // Pages an automatic click or rewrite must stay away from: money, accounts and sign-in (not chat).
  isSensitiveUrl(url) { const k = this.kind(url); return k === 'money' || k === 'account' || k === 'signin'; },

  // Pages whose tab title should not show on a shared screen.
  hidesTitle(url) { return this.kind(url) !== ''; },
};

if (typeof window !== 'undefined') window.VexSensitive = VexSensitive;
if (typeof module !== 'undefined' && module.exports) module.exports = { VexSensitive };
