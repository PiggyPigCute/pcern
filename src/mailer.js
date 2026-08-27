let transporter = null;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function sendVerificationEmail(to, link) {
  if (!isConfigured()) {
    console.log(`[mailer] SMTP non configuré — lien de vérification pour ${to} : ${link}`);
    return;
  }
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: "Vérifie ton adresse email — Portail Citoyen·ne de l'Ernestie",
    text: `Confirme ton adresse email en ouvrant ce lien : ${link}`,
    html: `<p>Confirme ton adresse email en cliquant sur ce lien :</p><p><a href="${link}">${link}</a></p>`,
  });
}

module.exports = { isConfigured, sendVerificationEmail };
