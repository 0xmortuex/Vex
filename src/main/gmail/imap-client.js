// Gmail IMAP client (Phase 1: just connect + count INBOX).
// Phase 2 will add: listMessages, getMessage, markRead, archive, move, delete.

const { ImapFlow } = require('imapflow');

class GmailImapClient {
  constructor(email, appPassword) {
    this.client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: appPassword },
      logger: false, // flip to console for debugging
    });
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.logout().catch(() => {});
  }

  async testConnection() {
    try {
      await this.connect();
      const mailbox = await this.client.mailboxOpen('INBOX');
      const count = mailbox.exists;
      await this.disconnect();
      return { success: true, inboxCount: count };
    } catch (err) {
      try { await this.disconnect(); } catch {}
      return { success: false, error: err.message };
    }
  }
}

module.exports = GmailImapClient;
