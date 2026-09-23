// Authentification mono-utilisateur : mot de passe hache (scrypt), sessions en base,
// cookie HttpOnly. Les identifiants se definissent en ligne de commande (src/set-password.js).
import crypto from 'node:crypto';

export const COOKIE = 'cals_session';
const LONG_SESSION_DAYS = 90;   // "Rester connecte"
const SHORT_SESSION_DAYS = 1;   // session sans "Rester connecte" (cookie de session navigateur)
const MAX_FAILS = 5;            // tentatives ratees tolerees par IP...
const LOCK_MINUTES = 15;        // ...avant blocage temporaire
const GLOBAL_MAX_FAILS = 30;    // echecs toutes IP confondues sur la fenetre (l'IP client peut etre falsifiee)

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

export function setCredentials(db, username, password) {
  if (!username || username.length > 80) throw new Error('Identifiant invalide (1 a 80 caracteres)');
  if (!password || password.length < 8) throw new Error('Mot de passe trop court (8 caracteres minimum)');
  db.transaction(() => {
    db.prepare(`INSERT INTO auth_user (id, username, password_hash, updated_at) VALUES (1, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, updated_at = excluded.updated_at`)
      .run(username, hashPassword(password));
    db.prepare('DELETE FROM auth_session').run(); // changement de mot de passe : deconnecte partout
  })();
}

export function isConfigured(db) {
  return !!db.prepare('SELECT 1 FROM auth_user WHERE id = 1').get();
}

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

  function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db.prepare("SELECT * FROM auth_session WHERE token_hash = ? AND expires_at > datetime('now')").get(sha256(token));
    return row || null;
  }

  function status(req) {
    const user = db.prepare('SELECT username FROM auth_user WHERE id = 1').get();
    return { configured: !!user, authenticated: !!(user && currentSession(req)), username: user && currentSession(req) ? user.username : null };
  }

  function login(req, res, { username, password, remember }) {
    const ip = clientIp(req);
    const f = fails.get(ip);
    if (f && f.until > Date.now()) {
      const minutes = Math.ceil((f.until - Date.now()) / 60000);
      throw Object.assign(new Error(`Trop de tentatives. Reessayer dans ${minutes} min.`), { status: 429 });
    }
    const windowStart = Date.now() - LOCK_MINUTES * 60000;
    globalFails = globalFails.filter((t) => t > windowStart);
    if (globalFails.length >= GLOBAL_MAX_FAILS) {
      throw Object.assign(new Error(`Trop de tentatives. Reessayer dans ${LOCK_MINUTES} min.`), { status: 429 });
    }
    const user = db.prepare('SELECT * FROM auth_user WHERE id = 1').get();
    if (!user) throw Object.assign(new Error('Aucun identifiant configure sur le serveur.'), { status: 503 });
    const ok = typeof username === 'string' && typeof password === 'string'
      && username === user.username && verifyPassword(password, user.password_hash);
    if (!ok) {
      const count = (f && f.until <= Date.now() && f.count >= MAX_FAILS ? 0 : f?.count || 0) + 1;
      fails.set(ip, { count, until: count >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0 });
      globalFails.push(Date.now());
      throw Object.assign(new Error('Identifiant ou mot de passe incorrect.'), { status: 401 });
    }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    const days = remember ? LONG_SESSION_DAYS : SHORT_SESSION_DAYS;
    db.prepare("INSERT INTO auth_session (token_hash, expires_at, persistent) VALUES (?, datetime('now', ?), ?)")
      .run(sha256(token), `+${days} days`, remember ? 1 : 0);
    db.prepare("DELETE FROM auth_session WHERE expires_at <= datetime('now')").run();
    res.setHeader('Set-Cookie', cookieHeader(token, { maxAgeSeconds: remember ? days * 86400 : undefined, secure: isSecure(req) }));
    return { username: user.username };
  }

  function logout(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(sha256(token));
    res.setHeader('Set-Cookie', cookieHeader('', { maxAgeSeconds: 0, secure: isSecure(req) }));
  }

  /** Middleware : exige une session valide. */
  function requireSession(req, res, next) {
    if (currentSession(req)) return next();
    res.status(401).json({ error: 'Connexion requise', code: 'auth_required' });
  }

  return { status, login, logout, requireSession };
}
