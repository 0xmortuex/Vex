// Gmail SMTP client — sends via smtp.gmail.com:465 using the stored app password.
// IMAP-appends the raw RFC822 to [Gmail]/Sent Mail after send, because Gmail
// only auto-appends for OAuth sends (not app-password sends).

const fs = require('fs');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');
const { loadCredentials } = require('./credentials');

const GMAIL_ATTACHMENT_LIMIT = 25 * 1024 * 1024; // 25 MB

let transporterCache = null;

function getTransporter() {
  if (transporterCache) return transporterCache;
  const creds = loadCredentials();
  if (!creds) throw new Error('No Gmail credentials configured');
  transporterCache = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
  });
  return transporterCache;
}

function resetTransporter() { transporterCache = null; }

function buildRaw(message) {
  const composer = new MailComposer(message);
  return new Promise((resolve, reject) => {
    composer.compile().build((err, raw) => err ? reject(err) : resolve(raw));
  });
}

async function sendMessage({
  to, cc = [], bcc = [], subject, html, text,
  attachments = [], inReplyTo = null, references = null,
}) {
  const creds = loadCredentials();
  if (!creds) throw new Error('No Gmail credentials configured');

  // Enforce Gmail's 25 MB total-attachment limit before we hit the wire.
  let totalBytes = 0;
  for (const a of attachments) {
    if (!a.path) continue;
    try {
      totalBytes += fs.statSync(a.path).size;
    } catch (err) {
      throw new Error(`Attachment not accessible: ${a.filename || a.path}`);
    }
  }
  if (totalBytes > GMAIL_ATTACHMENT_LIMIT) {
    throw new Error(`Gmail attachment limit is 25MB (total ${Math.round(totalBytes / 1024 / 1024)}MB attached)`);
  }

  const transporter = getTransporter();
  const message = {
    from: creds.email,
    to: Array.isArray(to) ? to.join(', ') : to,
    cc: Array.isArray(cc) && cc.length ? cc.join(', ') : undefined,
    bcc: Array.isArray(bcc) && bcc.length ? bcc.join(', ') : undefined,
    subject,
    html: html || undefined,
    text: text || undefined,
    attachments: attachments.map(a => ({
      filename: a.filename,
      path: a.path,
    })),
  };
  if (inReplyTo) message.inReplyTo = inReplyTo;
  if (references) message.references = references;

  const info = await transporter.sendMail(message);

  // Build + return the raw RFC822 so main.js can IMAP-append to Sent.
  const raw = await buildRaw(message).catch(err => {
    console.error('[Vex] MailComposer build failed:', err.message);
    return null;
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
    response: info.response,
    raw,
  };
}

module.exports = { sendMessage, resetTransporter };
