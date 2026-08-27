const express = require('express');
const auth = require('../auth');

const router = express.Router();

router.post('/signup', (req, res) => {
  const { username, password, displayName, avatarUrl } = req.body || {};
  try {
    const user = auth.createUser({ username, password, displayName, avatarUrl });
    const sessionId = auth.createSession(user.id);
    auth.setSessionCookie(res, req, sessionId);
    res.json({ user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.findUserByUsername(username);
  if (!user || !auth.verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
  }
  const sessionId = auth.createSession(user.id);
  auth.setSessionCookie(res, req, sessionId);
  res.json({ user: auth.publicUser(user) });
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

module.exports = router;
