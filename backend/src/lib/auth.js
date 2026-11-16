// Authentification multi-comptes : mot de passe hache (scrypt), sessions en base, cookie HttpOnly.
// Roles : 'admin' (gestion complete, panneau des comptes) et 'viewer' (regarder seulement).
// Le premier administrateur se cree en ligne de commande (src/set-password.js).
import crypto from 'node:crypto';

export const COOKIE = 'cals_session';
const LONG_SESSION_DAYS = 90;   // "Rester connecte"
const SHORT_SESSION_DAYS = 1;   // session sans "Rester connecte" (cookie de session navigateur)
const MAX_FAILS = 5;            // tentatives ratees tolerees par IP...
const LOCK_MINUTES = 15;        // ...avant blocage temporaire
const GLOBAL_MAX_FAILS = 30;    // echecs toutes IP confondues sur la fenetre (l'IP client peut etre falsifiee)
export const ROLES = ['admin', 'viewer'];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
// Hachage factice : meme temps de calcul quand l'identifiant n'existe pas.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const fail = (status, message) => Object.assign(new Error(message), { status });

export function validateUsername(username) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}._-]{2,40}$/u.test(username.trim())) {
    throw fail(400, 'Identifiant invalide : 2 à 40 caractères (lettres, chiffres, point, tiret, tiret bas)');
  }
  return username.trim();
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw fail(400, 'Mot de passe trop court (8 caractères minimum)');
  }
  return password;
}

/** Cree ou met a jour un administrateur (ligne de commande). Deconnecte ses sessions. */
export function setCredentials(db, username, password) {
  const name = validateUsername(username);
  validatePassword(password);
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM app_user WHERE username = ?').get(name);
    if (existing) {
      db.prepare("UPDATE app_user SET password_hash = ?, role = 'admin', disabled = 0, updated_at = datetime('now') WHERE id = ?")
        .run(hashPassword(password), existing.id);
      db.prepare('DELETE FROM auth_session WHERE user_id = ?').run(existing.id);
    } else {
      db.prepare("INSERT INTO app_user (username, password_hash, role) VALUES (?, ?, 'admin')").run(name, hashPassword(password));
    }
  })();
}

export function isConfigured(db) {
  return !!db.prepare("SELECT 1 FROM app_user WHERE role = 'admin' AND disabled = 0").get();
}

export const publicUser = (u) => u && ({ id: u.id, username: u.username, display_name: u.display_name || null, role: u.role });

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(value, { maxAgeSeconds, secure }) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) attrs.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

const isSecure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
const clientIp = (req) => req.headers['cf-connecting-ip'] || req.ip || 'inconnue';

export function createAuth(db) {
  const fails = new Map(); // ip -> { count, until }
  let globalFails = [];     // horodatages des echecs recents, toutes IP

  /** Compte connecte (null si pas de session valide ou compte desactive). */
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    return db.prepare(`SELECT u.* FROM auth_session s JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.disabled = 0`).get(sha256(token)) || null;
  }

  function status(req) {
    const user = currentUser(req);
    return { configured: isConfigured(db), authenticated: !!user, user: publicUser(user) };
  }

  function login(req, res, { username, password, remember }) {
    const ip = clientIp(req);
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      const minutes = Math.ceil((f.until - Date.now()) / 60000);
      throw fail(429, `Trop de tentatives. Réessayer dans ${minutes} min.`);
    }
    const windowStart = Date.now() - LOCK_MINUTES * 60000;
    globalFails = globalFails.filter((t) => t > windowStart);
    if (globalFails.length >= GLOBAL_MAX_FAILS) throw fail(429, `Trop de tentatives. Réessayer dans ${LOCK_MINUTES} min.`);
    if (!isConfigured(db)) throw fail(503, 'Aucun compte administrateur configuré sur le serveur.');
    const user = typeof username === 'string' ? db.prepare('SELECT * FROM app_user WHERE username = ?').get(username.trim()) : null;
    const passOk = typeof password === 'string' && verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passOk || user.disabled) {
      const count = (f && f.until <= Date.now() && f.count >= MAX_FAILS ? 0 : f?.count || 0) + 1;
      fails.set(ip, { count, until: count >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0 });
      globalFails.push(Date.now());
      throw fail(401, user && passOk && user.disabled ? 'Ce compte est désactivé.' : 'Identifiant ou mot de passe incorrect.');
    }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const days = remember ? LONG_SESSION_DAYS : SHORT_SESSION_DAYS;
    db.prepare("INSERT INTO auth_session (token_hash, expires_at, persistent, user_id) VALUES (?, datetime('now', ?), ?, ?)")
      .run(sha256(token), `+${days} days`, remember ? 1 : 0, user.id);
    db.prepare("DELETE FROM auth_session WHERE expires_at <= datetime('now')").run();
    res.setHeader('Set-Cookie', cookieHeader(token, { maxAgeSeconds: remember ? days * 86400 : undefined, secure: isSecure(req) }));
    return publicUser(user);
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(sha256(token));
    res.setHeader('Set-Cookie', cookieHeader('', { maxAgeSeconds: 0, secure: isSecure(req) }));
  }

  /** Middleware : exige une session valide ; le compte est dans req.user. */
  function requireSession(req, res, next) {
    const user = currentUser(req);
    if (user) { req.user = user; return next(); }
    res.status(401).json({ error: 'Connexion requise', code: 'auth_required' });
  }

  /** Middleware : reserve aux administrateurs. */
  function requireAdmin(req, res, next) {
    if (req.user?.role === 'admin') return next();
    res.status(403).json({ error: 'Réservé aux administrateurs', code: 'admin_required' });
  }

  return { status, login, logout, requireSession, requireAdmin, currentUser };
}
