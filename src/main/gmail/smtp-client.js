// Gmail SMTP client (Phase 1: stub, wired in Phase 2 for send).

const nodemailer = require('nodemailer');

function createTransport(email, appPassword) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
  });
}

module.exports = { createTransport };
