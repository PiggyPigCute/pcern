const crypto = require('crypto');
const { loadJSON, saveJSON, dataPath } = require('./store');

const USERS_FILE = 'users.json';
const SESSION_COOKIE = 'pcern_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours
const VERIFY_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24h

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

function defaultAvatarUrl() {
  return `${process.env.SITE_URL}/imgs/fish-avatar.jpg`;
}

// une URL d'avatar invalide (pas http/https) casserait l'envoi du webhook
// Discord au moment de poster — on retombe sur l'avatar par défaut plutôt
// que de stocker une valeur qui ferait échouer toute future publication
function sanitizeAvatarUrl(value) {
  const clean = String(value || '').trim().slice(0, 500);
  return /^https?:\/\//i.test(clean) ? clean : defaultAvatarUrl();
}

function loadUsers() {
  return loadJSON(USERS_FILE, []);
}

function saveUsers(users) {
  saveJSON(USERS_FILE, users);
}

function saveUser(user) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx === -1) throw new Error('Utilisateur introuvable.');
  users[idx] = user;
  saveUsers(users);
  return user;
}

function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return loadUsers().find(u => u.provider === 'local' && u.email.toLowerCase() === normalized) || null;
}

function findUserByDiscordId(discordId) {
  return loadUsers().find(u => u.provider === 'discord' && u.discordId === String(discordId)) || null;
}

function findUserById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

function publicUser(user) {
  if (!user) return null;
  const { id, provider, displayName, avatarUrl } = user;
  const emailVerified = provider === 'discord' ? true : user.emailVerified;
  return { id, provider, displayName, avatarUrl, emailVerified };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createLocalUser({ email, password, displayName, avatarUrl }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) {
    throw new Error('Adresse email invalide.');
  }
  if (!password || password.length < 8) {
    throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (findUserByEmail(cleanEmail)) {
    throw new Error('Un compte existe déjà avec cette adresse email.');
  }

  const mailer = require('./mailer');
  const users = loadUsers();
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    provider: 'local',
    email: cleanEmail,
    emailVerified: !mailer.isConfigured(),
    verifyToken: null,
    verifyExpires: null,
    passwordHash: hashPassword(password),
    displayName: String(displayName || cleanEmail.split('@')[0]).trim().slice(0, 60),
    avatarUrl: sanitizeAvatarUrl(avatarUrl),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function findOrCreateDiscordUser({ discordId, username, avatarUrl }) {
  const existing = findUserByDiscordId(discordId);
  if (existing) return existing;

  const users = loadUsers();
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    provider: 'discord',
    discordId: String(discordId),
    displayName: String(username || 'Citoyen·ne').trim().slice(0, 60),
    avatarUrl: avatarUrl || defaultAvatarUrl(),
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function issueVerificationToken(userId) {
  const user = findUserById(userId);
  if (!user || user.provider !== 'local') throw new Error('Compte invalide.');
  user.verifyToken = crypto.randomBytes(24).toString('hex');
  user.verifyExpires = Date.now() + VERIFY_TOKEN_MAX_AGE_MS;
  saveUser(user);
  return user.verifyToken;
}

function verifyEmailToken(token) {
  if (!token) return null;
  const user = loadUsers().find(u => u.provider === 'local' && u.verifyToken === token);
  if (!user || !user.verifyExpires || user.verifyExpires < Date.now()) return null;

  user.emailVerified = true;
  user.verifyToken = null;
  user.verifyExpires = null;
  saveUser(user);
  return user;
}

function updateProfile(userId, { displayName, avatarUrl }) {
  const user = findUserById(userId);
  if (!user) throw new Error('Utilisateur introuvable.');
  if (displayName !== undefined) {
    const clean = String(displayName).trim();
    if (!clean) throw new Error('Le pseudo ne peut pas être vide.');
    user.displayName = clean.slice(0, 60);
  }
  if (avatarUrl !== undefined) {
    user.avatarUrl = sanitizeAvatarUrl(avatarUrl);
  }
  saveUser(user);
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
  return findUserById(session.userId);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Connexion requise.' });
  }
  req.user = user;
  next();
}

function requireVerified(req, res, next) {
  if (req.user.provider === 'local' && !req.user.emailVerified) {
    return res.status(403).json({ error: 'Adresse email non vérifiée.' });
  }
  next();
}

module.exports = {
  SESSION_COOKIE,
  defaultAvatarUrl,
  createLocalUser,
  findOrCreateDiscordUser,
  findUserByEmail,
  findUserByDiscordId,
  findUserById,
  verifyPassword,
  publicUser,
  issueVerificationToken,
  verifyEmailToken,
  updateProfile,
  createSession,
  destroySession,
  parseCookies,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  currentUser,
  requireAuth,
  requireVerified,
};
