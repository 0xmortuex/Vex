// Gmail IMAP client (Phase 2: persistent connection + list/read/actions).
// One authenticated connection per Vex session. Reopens lazily if it drops.

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const gmailCreds = require('./credentials');

// Strip HTML tags + collapse whitespace for list-view previews. Not a security
// barrier — just a cheap way to turn HTML fragments into a snippet. Full HTML
// sanitization for the reading pane happens in the renderer via DOMPurify.
function extractPreview(buf) {
  if (!buf) return '';
  const str = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  return str
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

class GmailImapClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this._connectPromise = null;
  }

  async ensureConnected() {
    if (this.connected && this.client?.usable) return;
    // Dedupe concurrent reconnects — if one is already in flight, await that.
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = (async () => {
      const creds = gmailCreds.loadCredentials();
      if (!creds) throw new Error('No Gmail credentials configured');
      this.client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: creds.email, pass: creds.appPassword },
        logger: false,
      });
      this.client.on('close', () => { this.connected = false; });
      this.client.on('error', (err) => {
        console.error('[Gmail IMAP]', err?.message || err);
        this.connected = false;
      });
      await this.client.connect();
      this.connected = true;
    })();

    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async disconnect() {
    if (this.client) {
      try { await this.client.logout(); } catch {}
      this.client = null;
      this.connected = false;
    }
  }

  // --- Read operations ------------------------------------------------------

  async listInbox({ limit = 50, before = null } = {}) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      const status = this.client.mailbox;
      const totalCount = status.exists;
      if (totalCount === 0) return { messages: [], totalCount: 0, nextBefore: null };

      const from = before ?? totalCount;
      const start = Math.max(1, from - limit + 1);
      const range = `${start}:${from}`;

      const messages = [];
      for await (const msg of this.client.fetch(range, {
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
        bodyParts: ['1'],
        uid: true,
      })) {
        messages.push({
          uid: msg.uid,
          seq: msg.seq,
          from: msg.envelope?.from?.[0] ?? null,
          subject: msg.envelope?.subject ?? '(no subject)',
          date: msg.envelope?.date ?? msg.internalDate ?? null,
          flags: Array.from(msg.flags ?? []),
          size: msg.size,
          preview: extractPreview(msg.bodyParts?.get?.('1') ?? null),
        });
      }
      messages.reverse(); // newest-first
      return {
        messages,
        totalCount,
        nextBefore: start > 1 ? start - 1 : null,
      };
    } finally {
      lock.release();
    }
  }

  async getMessage(uid) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      const msg = await this.client.fetchOne(uid, {
        source: true,
        envelope: true,
        flags: true,
        internalDate: true,
      }, { uid: true });
      if (!msg) return null;

      const parsed = await simpleParser(msg.source);

      return {
        uid,
        from: msg.envelope?.from ?? [],
        to: msg.envelope?.to ?? [],
        cc: msg.envelope?.cc ?? [],
        subject: msg.envelope?.subject ?? '(no subject)',
        date: msg.envelope?.date ?? msg.internalDate ?? null,
        flags: Array.from(msg.flags ?? []),
        html: parsed.html || null,
        text: parsed.text || '',
        attachments: (parsed.attachments || []).map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          cid: a.cid,
        })),
      };
    } finally {
      lock.release();
    }
  }

  // --- Test connection (Phase 1 onboarding) --------------------------------
  // Kept for back-compat: onboarding still creates a throwaway client for
  // credential verification. Uses a temporary client, NOT the singleton —
  // so a failed save doesn't poison the persistent session state.
  async testConnection() {
    let tmp = null;
    try {
      const creds = gmailCreds.loadCredentials();
      // Fallback for onboarding flow: the caller passes creds via a one-shot
      // method, so we read from what the onboarding handler wrote temporarily.
      // We actually want to accept creds directly here.
      throw new Error('Use testConnectionWith(email, appPassword) instead');
    } finally {
      if (tmp) try { await tmp.logout(); } catch {}
    }
  }

  // --- Flag / mutation operations ------------------------------------------

  async markRead(uid, read = true) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      if (read) await this.client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      else await this.client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    } finally { lock.release(); }
  }

  async star(uid, starred = true) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      if (starred) await this.client.messageFlagsAdd(uid, ['\\Flagged'], { uid: true });
      else await this.client.messageFlagsRemove(uid, ['\\Flagged'], { uid: true });
    } finally { lock.release(); }
  }

  async archive(uid) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      await this.client.messageMove(uid, '[Gmail]/All Mail', { uid: true });
    } finally { lock.release(); }
  }

  async trash(uid) {
    await this.ensureConnected();
    const lock = await this.client.getMailboxLock('INBOX');
    try {
      await this.client.messageMove(uid, '[Gmail]/Trash', { uid: true });
    } finally { lock.release(); }
  }
}

// Singleton — Vex is one account per install.
const gmailImap = new GmailImapClient();

// One-shot test for onboarding: verifies credentials by opening a throwaway
// IMAP connection. Separate from the singleton so a failed attempt doesn't
// leave the singleton in a half-connected state.
async function testConnectionWith(email, appPassword) {
  const tmp = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  try {
    await tmp.connect();
    const mailbox = await tmp.mailboxOpen('INBOX');
    const count = mailbox.exists;
    try { await tmp.logout(); } catch {}
    return { success: true, inboxCount: count };
  } catch (err) {
    try { await tmp.logout(); } catch {}
    return { success: false, error: err.message };
  }
}

module.exports = { gmailImap, testConnectionWith };
