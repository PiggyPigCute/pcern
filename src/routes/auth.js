const express = require('express');
const auth = require('../auth');
const mailer = require('../mailer');

const router = express.Router();

function verifyLink(token) {
  return `${process.env.SITE_URL}/auth/verify-email?token=${token}`;
}

async function sendVerification(user) {
  if (!mailer.isConfigured()) return;
  const token = auth.issueVerificationToken(user.id);
  await mailer.sendVerificationEmail(user.email, verifyLink(token));
}

router.post('/signup', async (req, res) => {
  const { email, password, displayName, avatarUrl } = req.body || {};
  try {
    const user = auth.createLocalUser({ email, password, displayName, avatarUrl });
    await sendVerification(user);
    const sessionId = auth.createSession(user.id);
    auth.setSessionCookie(res, req, sessionId);
    res.json({ user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = auth.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }
  const sessionId = auth.createSession(user.id);
  auth.setSessionCookie(res, req, sessionId);
  res.json({ user: auth.publicUser(user) });
});

router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/auth/discord/callback`,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.SITE_URL}/auth/discord/callback`,
      }),
    });
    if (!tokenRes.ok) throw new Error('Échec de l\'échange OAuth Discord.');
    const { access_token: accessToken } = await tokenRes.json();

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meRes.ok) throw new Error('Impossible de récupérer le profil Discord.');
    const me = await meRes.json();

    const avatarUrl = me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith('a_') ? 'gif' : 'png'}`
      : undefined;

    const user = auth.findOrCreateDiscordUser({
      discordId: me.id,
      username: me.global_name || me.username,
      avatarUrl,
    });
    const sessionId = auth.createSession(user.id);
    auth.setSessionCookie(res, req, sessionId);
    res.redirect('/');
  } catch (err) {
    console.error('Discord OAuth :', err.message);
    res.status(500).send(`Connexion Discord échouée : ${err.message}. <a href="/">Retour</a>`);
  }
});

router.post('/logout', (req, res) => {
  const cookies = auth.parseCookies(req);
  const sessionId = auth.verifySessionToken(cookies[auth.SESSION_COOKIE]);
  if (sessionId) auth.destroySession(sessionId);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const user = auth.currentUser(req);
  res.json({ user: auth.publicUser(user) });
});

router.post('/profile', auth.requireAuth, (req, res) => {
  const { displayName, avatarUrl } = req.body || {};
  try {
    const user = auth.updateProfile(req.user.id, { displayName, avatarUrl });
    res.json({ user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/verify-email', (req, res) => {
  const user = auth.verifyEmailToken(req.query.token);
  if (!user) return res.status(400).send('Lien de vérification invalide ou expiré. <a href="/">Retour</a>');
  const sessionId = auth.createSession(user.id);
  auth.setSessionCookie(res, req, sessionId);
  res.redirect('/');
});

router.post('/resend-verification', auth.requireAuth, async (req, res) => {
  if (req.user.provider !== 'local' || req.user.emailVerified) {
    return res.json({ ok: true });
  }
  await sendVerification(req.user);
  res.json({ ok: true });
});

module.exports = router;
