// === A read-only inbox ========================================================
//
// Your newest mail, in Vex, without the webmail page: who, what, when, and the
// message itself as text. It is READ-ONLY on purpose — the mailbox is opened
// with EXAMINE and bodies are fetched with PEEK, so looking at mail in Vex
// never marks it read, moves it, or changes anything on the server. To reply,
// "Open in Gmail" (or Yahoo, iCloud) opens that message in its webmail.
//
// Sign-in is IMAP with an APP PASSWORD — the kind Gmail, Yahoo and iCloud
// issue for mail programs — not your main password. It is tested before it is
// kept, and kept in one file encrypted by Windows (safeStorage), together with
// the addresses. Outlook.com and Hotmail are not supported: Microsoft turned
// off password sign-in for mail programs and requires its own OAuth sign-in.
//
// Each request is its own short connection: connect, read, log out.

const PROVIDERS = {
  gmail:  { name: 'Gmail',  host: 'imap.gmail.com',      port: 993, domains: ['gmail.com', 'googlemail.com'], help: 'Gmail needs an app password: Google Account › Security › 2-Step Verification › App passwords.' },
  yahoo:  { name: 'Yahoo',  host: 'imap.mail.yahoo.com', port: 993, domains: ['yahoo.com', 'ymail.com', 'rocketmail.com'], help: 'Yahoo needs an app password: Account Info › Account security › Generate app password.' },
  icloud: { name: 'iCloud', host: 'imap.mail.me.com',    port: 993, domains: ['icloud.com', 'me.com', 'mac.com'], help: 'iCloud needs an app-specific password: appleid.apple.com › Sign-In and Security › App-Specific Passwords.' },
};
const UNSUPPORTED = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];
const MAX_ACCOUNTS = 10;
const MAX_LIST = 100;
const MAX_MESSAGE_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20000;

function providerFor(email) {
  const domain = String(email).split('@')[1] || '';
  return Object.keys(PROVIDERS).find(k => PROVIDERS[k].domains.includes(domain.toLowerCase())) || null;
}

// Where to answer a message: its webmail, found by Message-ID where the
// webmail can search for one.
function webmailUrl(account, messageId) {
  const q = messageId ? encodeURIComponent(String(messageId).replace(/^<|>$/g, '')) : '';
  if (account.provider === 'gmail') return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(account.email) + (q ? '#search/rfc822msgid%3A' + q : '');
  if (account.provider === 'yahoo') return 'https://mail.yahoo.com/';
  if (account.provider === 'icloud') return 'https://www.icloud.com/mail/';
  return null;
}

function createMail({ ImapFlow, simpleParser, secrets, file, randomId }) {
  async function load() {
    const a = await secrets.read(file, () => { throw new Error('The mail accounts file is not in Vex\'s format'); });
    return Array.isArray(a) ? a : [];
  }
  const save = (accounts) => secrets.write(file, accounts);
  const publicView = (a) => ({ id: a.id, email: a.email, provider: a.provider, host: a.host, port: a.port, name: a.provider ? PROVIDERS[a.provider].name : a.host, webmail: webmailUrl(a) });

  function explain(err, account) {
    const text = String((err && (err.responseText || err.message)) || err || '');
    if (err && (err.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|authentication failed/i.test(text))) {
      return new Error('The mail server refused the password. ' + (account.provider ? PROVIDERS[account.provider].help : 'Use an app password if your provider issues them.'), { cause: err });
    }
    if (err && /ENOTFOUND|EAI_AGAIN/.test(err.code || text)) return new Error('Could not find the mail server ' + account.host, { cause: err });
    if (err && /ETIMEDOUT|timeout/i.test(err.code || text)) return new Error('The mail server did not answer in time', { cause: err });
    return new Error('Mail: ' + (text || 'the connection failed'), { cause: err });
  }

  async function withClient(account, fn) {
    const client = new ImapFlow({
      host: account.host, port: account.port, secure: account.secure !== false,
      auth: { user: account.user || account.email, pass: account.pass },
      logger: false, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS * 3,
      ...(account.requireTls ? { doSTARTTLS: true } : {}),
      ...(account.tls ? { tls: account.tls } : {}),
    });
    try {
      await client.connect();
    } catch (err) { throw explain(err, account); }
    try {
      return await fn(client);
    } catch (err) {
      throw explain(err, account);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  async function find(id) {
    const a = (await load()).find(x => x.id === id);
    if (!a) throw new Error('That mail account is not set up any more');
    return a;
  }

  return {
    async accounts() { return (await load()).map(publicView); },

    // Sign in once to prove the password, then keep it.
    async add({ email, password, host, port, secure }) {
      const addr = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new Error('That is not an email address');
      if (UNSUPPORTED.includes(addr.split('@')[1])) throw new Error('Outlook.com and Hotmail cannot be read here: Microsoft no longer lets mail programs sign in with a password. Open outlook.live.com in a tab instead.');
      const pass = String(password || '');
      if (!pass) throw new Error('Enter the app password');
      const provider = providerFor(addr);
      const account = provider
        ? { email: addr, pass, provider, host: PROVIDERS[provider].host, port: PROVIDERS[provider].port, secure: true }
        : { email: addr, pass, provider: null, host: String(host || '').trim(), port: Number(port) || 993, secure: secure !== false };
      if (!account.provider && !/^[a-z0-9.-]+$/i.test(account.host)) throw new Error('Enter your provider\'s IMAP server, like imap.example.com');
      // Not port 993: the connection must be upgraded with STARTTLS before the
      // password is sent. Only a program on this computer (a local bridge such
      // as ProtonMail Bridge) may be spoken to without it.
      if (!account.secure && !/^(localhost|127\.0\.0\.1)$/i.test(account.host)) account.requireTls = true;
      const accounts = await load();
      if (accounts.some(a => a.email === addr)) throw new Error(addr + ' is already set up');
      if (accounts.length >= MAX_ACCOUNTS) throw new Error('That is ' + MAX_ACCOUNTS + ' accounts already');
      await withClient(account, async () => true);                 // the password works
      account.id = randomId();
      accounts.push(account);
      await save(accounts);
      return publicView(account);
    },

    async remove(id) {
      const accounts = await load();
      const left = accounts.filter(a => a.id !== id);
      if (left.length === accounts.length) throw new Error('That mail account is not set up any more');
      await save(left);
      return true;
    },

    // The newest messages in the inbox, newest first, and how many are unread.
    async inbox(id, limit = 50) {
      const account = await find(id);
      const n = Math.max(1, Math.min(MAX_LIST, Number(limit) || 50));
      return withClient(account, async (client) => {
        const status = await client.status('INBOX', { messages: true, unseen: true });
        await client.mailboxOpen('INBOX', { readOnly: true });
        const messages = [];
        if (status.messages) {
          const from = Math.max(1, status.messages - n + 1);
          for await (const m of client.fetch(from + ':*', { uid: true, envelope: true, flags: true, size: true })) {
            const e = m.envelope || {};
            const f = (e.from && e.from[0]) || {};
            messages.push({ uid: m.uid, subject: e.subject || '', from: { name: f.name || '', address: f.address || '' }, date: e.date ? new Date(e.date).getTime() : null, seen: m.flags ? m.flags.has('\\Seen') : false, flagged: m.flags ? m.flags.has('\\Flagged') : false, size: m.size || 0, messageId: e.messageId || '' });
          }
        }
        messages.sort((a, b) => (b.date || 0) - (a.date || 0) || b.uid - a.uid);
        return { account: publicView(account), total: status.messages || 0, unseen: status.unseen || 0, messages };
      });
    },

    // One message, as text. Nothing is marked read.
    async message(id, uid) {
      const account = await find(id);
      if (!Number.isInteger(uid) || uid < 1) throw new Error('Not a message');
      return withClient(account, async (client) => {
        await client.mailboxOpen('INBOX', { readOnly: true });
        const head = await client.fetchOne(String(uid), { size: true }, { uid: true });
        if (!head) throw new Error('That message is not in the inbox any more');
        if (head.size > MAX_MESSAGE_BYTES) {
          return { tooLarge: true, size: head.size, webmail: webmailUrl(account) };
        }
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        // No text made from HTML here: mailparser's version lists every picture's
        // address (tracking pixels included). The inbox makes its own, without.
        const p = await simpleParser(msg.source, { skipHtmlToText: true, skipImageLinks: true, skipTextToHtml: true });
        // "Dana <dana@shop.example>", without the quotes the header carries.
        const people = (h) => (h ? [].concat(h).flatMap(x => x.value || []).map(v => (v.name ? v.name + ' <' + v.address + '>' : v.address || '')).filter(Boolean).join(', ') : '');
        return {
          uid, subject: p.subject || '', date: p.date ? p.date.getTime() : null,
          from: people(p.from), to: people(p.to), cc: people(p.cc),
          text: p.text || '', html: typeof p.html === 'string' ? p.html : '',
          attachments: (p.attachments || []).map(a => ({ filename: a.filename || 'attachment', size: a.size || 0, contentType: a.contentType || '' })),
          messageId: p.messageId || '', webmail: webmailUrl(account, p.messageId),
        };
      });
    },
  };
}

module.exports = { createMail, providerFor, webmailUrl, PROVIDERS, UNSUPPORTED, MAX_MESSAGE_BYTES };
