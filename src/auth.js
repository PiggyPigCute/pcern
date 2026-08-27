const crypto = require('crypto');
const { loadJSON, saveJSON, dataPath } = require('./store');

const USERS_FILE = 'users.json';
const SESSION_COOKIE = 'pcern_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours

function loadOrCreateSessionSecret() {
  try {
    return require('fs').readFileSync(dataPath('session-secret'), 'utf8').trim();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const secret = crypto.randomBytes(32).toString('hex');
    require('fs').writeFileSync(dataPath('session-secret'), secret);
    return secret;
  }
}

const sessionSecret = loadOrCreateSessionSecret();

// sessionId -> { userId, createdAt } ; en mémoire seulement, les sessions ne
// survivent pas à un redémarrage (acceptable à cette échelle)
const sessions = new Map();

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !password || typeof stored !== 'string') return false;
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;

  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function loadUsers() {
  return loadJSON(USERS_FILE, []);
}

function saveUsers(users) {
  saveJSON(USERS_FILE, users);
}

function findUserByUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return loadUsers().find(u => u.username.toLowerCase() === normalized) || null;
}

function findUserById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

function publicUser(user) {
  if (!user) return null;
  const { id, username, displayName, avatarUrl } = user;
  return { id, username, displayName, avatarUrl };
}

function createUser({ username, password, displayName, avatarUrl }) {
  const cleanUsername = String(username || '').trim();
  if (cleanUsername.length < 3) {
    throw new Error('Le pseudo doit contenir au moins 3 caractères.');
  }
  if (!password || password.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (findUserByUsername(cleanUsername)) {
    throw new Error('Ce pseudo est déjà pris.');
  }

  const users = loadUsers();
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    username: cleanUsername,
    passwordHash: hashPassword(password),
    displayName: String(displayName || cleanUsername).trim().slice(0, 60),
    avatarUrl: String(avatarUrl || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function createSession(userId) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  sessions.set(sessionId, { userId, createdAt: Date.now() });
  return sessionId;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const sessionId = token.slice(0, idx);
  const signature = token.slice(idx + 1);

  const expected = sign(sessionId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return sessions.has(sessionId) ? sessionId : null;
}

function setSessionCookie(res, req, sessionId) {
  res.cookie(SESSION_COOKIE, `${sessionId}.${sign(sessionId)}`, {
    httpOnly: true,
    sameSite: 'lax',
    // req.secure reflète X-Forwarded-Proto derrière un reverse proxy (voir
    // app.set('trust proxy', 1) dans server.js) : un cookie Secure en dur
    // serait silencieusement rejeté tant que le site tourne en http local
    secure: req.secure,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE);
}

function currentUser(req) {
  const cookies = parseCookies(req);
  const sessionId = verifySessionToken(cookies[SESSION_COOKIE]);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  const user = findUserById(session.userId);
  return user;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Connexion requise.' });
  }
  req.user = user;
  next();
}

module.exports = {
  SESSION_COOKIE,
  createUser,
  findUserByUsername,
  verifyPassword,
  publicUser,
  createSession,
  destroySession,
  parseCookies,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  currentUser,
  requireAuth,
};
