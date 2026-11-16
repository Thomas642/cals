import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ROLES, createAuth, hashPassword, validatePassword, validateUsername, verifyPassword } from './lib/auth.js';
import { SUBTITLE_EXTENSIONS, toWebVtt } from './lib/subtitles.js';
import { createProcessor } from './lib/processor.js';
import { dominantColor, ffmpegAvailable } from './lib/media.js';
import { downloadImage, getAnime, searchAnime } from './lib/anilist.js';

// Formats video acceptes et type MIME annonce au navigateur. Le MP4 (H.264 + AAC) est le plus
// largement lisible ; MKV et MOV dependent du navigateur et des codecs du fichier.
export const VIDEO_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
};
export const MAX_CHUNK_BYTES = 64 * 1024 * 1024;   // taille maximale d'un morceau envoye
const DISK_MARGIN_BYTES = 512 * 1024 * 1024;        // espace laisse libre sur le disque
const UPLOAD_IDLE_MS = 60 * 1000;                   // morceau abandonne si aucun octet recu pendant ce delai
const MAX_THUMB_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

// Type d'image reconnu par ses premiers octets (le Content-Type annonce n'est pas fiable).
function imageType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
const IMAGE_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Reglages du lecteur par compte.
export const DEFAULT_SETTINGS = { autoplay: true, subtitles: { size: 'm', bg: 0.6, position: 'bottom' } };
const SUB_SIZES = ['s', 'm', 'l', 'xl'];
const SUB_BG = [0, 0.3, 0.6, 0.85];

const httpError = (status, message, extra) => Object.assign(new Error(message), { status, extra });
const notFound = (what) => httpError(404, `${what} introuvable`);

function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, 'Identifiant invalide');
  return n;
}

function text(value, { field, max, required = false }) {
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, `${field} obligatoire`);
    return null;
  }
  if (typeof value !== 'string') throw httpError(400, `${field} invalide`);
  const v = value.trim();
  if (required && !v) throw httpError(400, `${field} obligatoire`);
  if (v.length > max) throw httpError(400, `${field} trop long (${max} caracteres maximum)`);
  return v || null;
}

function seasonNumber(value) {
  if (value === undefined || value === null || value === '') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw httpError(400, 'Numéro de saison invalide');
  return n;
}

function episodeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw httpError(400, 'Numero d\'episode invalide');
  return n;
}

const extensionOf = (filename) => path.extname(String(filename || '')).slice(1).toLowerCase();

export function createApp(db, { mediaDir = process.env.MEDIA_DIR || path.join(process.cwd(), 'data', 'media'),
  maxVideoBytes = (Number(process.env.MAX_VIDEO_GB) || 20) * 1024 ** 3,
  processing = process.env.VIDEO_PROCESSING !== 'off' } = {}) {
  fs.mkdirSync(path.join(mediaDir, 'videos'), { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'subtitles'), { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'images'), { recursive: true });
  const abs = (rel) => path.join(mediaDir, rel);
  const removeFile = (rel) => { if (rel) fs.rmSync(abs(rel), { force: true }); };
  const fileSize = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const uploading = new Map(); // episode -> requete dont un morceau est en cours de reception
  // Couleur d'ambiance de la serie : extraite de l'affiche importee, sinon de la premiere miniature.
  async function refreshAccent(sid, { force = false } = {}) {
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(sid);
    if (!s || (s.accent && !force)) return;
    const src = s.cover_file || db.prepare(`SELECT thumb_file FROM episode WHERE series_id = ? AND thumb_file IS NOT NULL
      ORDER BY season, position IS NULL, position, number IS NULL, number, id LIMIT 1`).get(sid)?.thumb_file;
    let accent = null;
    if (src) { try { if (await ffmpegAvailable()) accent = await dominantColor(path.join(mediaDir, src)); } catch { accent = null; } }
    db.prepare('UPDATE series SET accent = ? WHERE id = ?').run(accent, sid);
  }
  const processor = createProcessor(db, { mediaDir, enabled: processing, onThumbnail: (sid) => refreshAccent(sid) });

  function freeBytes() {
    try {
      const s = fs.statfsSync(mediaDir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  const getSeries = (sid) => db.prepare('SELECT * FROM series WHERE id = ?').get(sid);
  const getEpisode = (eid) => db.prepare('SELECT * FROM episode WHERE id = ?').get(eid);
  const subtitlesOf = (eid) => db.prepare('SELECT id, label, lang, original_name, created_at FROM subtitle WHERE episode_id = ? ORDER BY id').all(eid);

  const version = (file) => path.basename(file, path.extname(file)).slice(0, 8);
  // Generique : reglage propre a l'episode, sinon celui de la serie.
  function introOf(e, s = getSeries(e.series_id)) {
    if (e.intro_start !== null && e.intro_end !== null) return { start: e.intro_start, end: e.intro_end, scope: 'episode' };
    if (s && s.intro_start !== null && s.intro_end !== null) return { start: s.intro_start, end: s.intro_end, scope: 'series' };
    return null;
  }

  function episodeView(e, { user, series } = {}) {
    const received = e.status === 'ready' ? e.video_size : fileSize(`${abs(e.video_file)}.part`);
    return {
      id: e.id, series_id: e.series_id, number: e.number, title: e.title, original_name: e.original_name,
      season: e.season || 1, position: e.position, ready_at: e.ready_at,
      is_new: !!(user?.prev_visit_at && e.ready_at && e.ready_at > user.prev_visit_at),
      intro: introOf(e, series),
      storyboard: e.storyboard_file && e.storyboard ? { ...JSON.parse(e.storyboard), url: `/api/media/storyboard/${e.id}?v=${version(e.storyboard_file)}` } : null,
      video_mime: e.video_mime, video_size: e.video_size, status: e.status, received, created_at: e.created_at,
      processing: e.processing,
      processing_progress: processor.progressOf(e.id) ?? e.processing_progress,
      processing_error: e.processing_error,
      media: e.media_info ? JSON.parse(e.media_info) : null,
      // Version dans l'URL : apres une conversion, le navigateur ne reutilise pas l'ancienne video en cache.
      video_url: e.status === 'ready' ? `/api/media/video/${e.id}?v=${path.basename(e.video_file, path.extname(e.video_file)).slice(0, 8)}` : null,
      thumb_url: e.thumb_file ? `/api/media/thumb/${e.id}?v=${path.basename(e.thumb_file, path.extname(e.thumb_file)).slice(0, 8)}` : null,
      subtitles: subtitlesOf(e.id),
    };
  }

  // Ordre : saison, puis ordre manuel (glisser-deposer), puis numero.
  const EPISODE_ORDER = 'season, position IS NULL, position, number IS NULL, number, id';
  const episodesOf = (sid) => db.prepare(`SELECT * FROM episode WHERE series_id = ? ORDER BY ${EPISODE_ORDER}`).all(sid);

  // Affiche de la serie : image importee, sinon miniature du premier episode qui en a une.
  function coverUrl(s) {
    if (s.cover_file) return `/api/media/cover/${s.id}?v=${path.basename(s.cover_file, path.extname(s.cover_file)).slice(0, 8)}`;
    const e = db.prepare('SELECT id, thumb_file FROM episode WHERE series_id = ? AND thumb_file IS NOT NULL ORDER BY number IS NULL, number, id LIMIT 1').get(s.id);
    return e ? `/api/media/thumb/${e.id}?v=${path.basename(e.thumb_file, path.extname(e.thumb_file)).slice(0, 8)}` : null;
  }
  const seriesView = (s) => ({
    ...s, cover_file: undefined, has_custom_cover: !!s.cover_file, cover_url: coverUrl(s),
    genres: s.genres ? JSON.parse(s.genres) : [], season_names: s.season_names ? JSON.parse(s.season_names) : {},
    intro: s.intro_start !== null && s.intro_end !== null ? { start: s.intro_start, end: s.intro_end } : null,
    intro_start: undefined, intro_end: undefined,
  });

  /** Lit un corps binaire (image) avec une taille maximale. */
  async function readBody(req, max) {
    const len = Number(req.headers['content-length']);
    if (Number.isInteger(len) && len > max) throw httpError(413, `Image trop volumineuse (${Math.round(max / 1024 / 1024)} Mo maximum)`);
    const chunks = [];
    let total = 0;
    for await (const c of req) {
      total += c.length;
      if (total > max) throw httpError(413, `Image trop volumineuse (${Math.round(max / 1024 / 1024)} Mo maximum)`);
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  function saveImage(buf) {
    const t = imageType(buf);
    if (!t) throw httpError(400, 'Image non reconnue (JPEG, PNG ou WebP attendu)');
    const file = `images/${crypto.randomUUID()}.${t.ext}`;
    fs.writeFileSync(abs(file), buf);
    return file;
  }

  function deleteEpisodeFiles(e) {
    removeFile(e.thumb_file);
    removeFile(e.storyboard_file);
    removeFile(e.video_file);
    removeFile(e.video_file && `${e.video_file}.part`);
    for (const s of db.prepare('SELECT file FROM subtitle WHERE episode_id = ?').all(e.id)) removeFile(s.file);
  }

  const app = express();
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '6mb' }));
  const auth = createAuth(db);
  const r = express.Router();

  r.get('/health', (req, res) => res.json({ ok: true }));

  // ---------- Authentification (routes publiques) ----------
  r.get('/auth/status', (req, res) => {
    const st = auth.status(req);
    if (st.user) {
      // Nouvelle visite apres 30 min d'absence : la precedente sert de repere pour les badges « Nouveau ».
      const u = db.prepare('SELECT last_visit_at, settings FROM app_user WHERE id = ?').get(st.user.id);
      const stale = !u.last_visit_at || db.prepare("SELECT ? < datetime('now', '-30 minutes') AS old").get(u.last_visit_at).old;
      if (stale) {
        db.prepare("UPDATE app_user SET prev_visit_at = COALESCE(last_visit_at, datetime('now')), last_visit_at = datetime('now') WHERE id = ?").run(st.user.id);
      } else {
        db.prepare("UPDATE app_user SET last_visit_at = datetime('now') WHERE id = ?").run(st.user.id);
      }
      st.user.settings = { ...DEFAULT_SETTINGS, ...(u.settings ? JSON.parse(u.settings) : {}) };
    }
    res.json(st);
  });
  r.post('/auth/login', (req, res) => res.json(auth.login(req, res, {
    username: req.body?.username, password: req.body?.password, remember: req.body?.remember !== false,
  })));
  r.post('/auth/logout', (req, res) => { auth.logout(req, res); res.status(204).end(); });

  // Toutes les routes suivantes exigent une session.
  r.use(auth.requireSession);

  // Spectateurs : lecture seule (series, episodes, medias) + leur progression et leur mot de passe.
  r.use((req, res, next) => {
    if (req.user.role === 'admin') return next();
    if (req.method === 'GET' && !/^\/(storage|users|admin)(\/|$)/.test(req.path)) return next();
    if (/^\/(progress|watchlist)\/\d+$/.test(req.path) && ['PUT', 'DELETE'].includes(req.method)) return next();
    if (['/me/password', '/me/settings'].includes(req.path) && req.method === 'PUT') return next();
    return auth.requireAdmin(req, res, next);
  });
  const isAdmin = (req) => req.user.role === 'admin';
  // Ce qu'un spectateur voit d'un episode : pas de details techniques ni de nom de fichier.
  const viewFor = (req, e, series) => {
    const v = episodeView(e, { user: req.user, series });
    if (isAdmin(req)) return v;
    const { original_name: _o, media: _m, processing_error: _p, received: _r, ...rest } = v;
    return rest;
  };

  // ---------- Mon compte ----------
  r.put('/me/password', (req, res) => {
    const { current, password } = req.body || {};
    if (typeof current !== 'string' || !verifyPassword(current, req.user.password_hash)) throw httpError(400, 'Mot de passe actuel incorrect');
    validatePassword(password);
    db.prepare("UPDATE app_user SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashPassword(password), req.user.id);
    res.status(204).end();
  });

  r.put('/me/settings', (req, res) => {
    const b = req.body || {};
    const cur = { ...DEFAULT_SETTINGS, ...(req.user.settings ? JSON.parse(req.user.settings) : {}) };
    const next = { ...cur, subtitles: { ...DEFAULT_SETTINGS.subtitles, ...cur.subtitles } };
    if ('autoplay' in b) next.autoplay = !!b.autoplay;
    if (b.subtitles) {
      const sub = b.subtitles;
      if ('size' in sub) { if (!SUB_SIZES.includes(sub.size)) throw httpError(400, 'Taille de sous-titres invalide'); next.subtitles.size = sub.size; }
      if ('bg' in sub) { if (!SUB_BG.includes(Number(sub.bg))) throw httpError(400, 'Fond de sous-titres invalide'); next.subtitles.bg = Number(sub.bg); }
      if ('position' in sub) { if (!['bottom', 'top'].includes(sub.position)) throw httpError(400, 'Position invalide'); next.subtitles.position = sub.position; }
    }
    db.prepare('UPDATE app_user SET settings = ? WHERE id = ?').run(JSON.stringify(next), req.user.id);
    res.json(next);
  });

  // ---------- Ma liste ----------
  r.put('/watchlist/:id', (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    db.prepare('INSERT OR IGNORE INTO watchlist (user_id, series_id) VALUES (?, ?)').run(req.user.id, s.id);
    res.status(204).end();
  });
  r.delete('/watchlist/:id', (req, res) => {
    db.prepare('DELETE FROM watchlist WHERE user_id = ? AND series_id = ?').run(req.user.id, id(req.params.id));
    res.status(204).end();
  });

  // ---------- Recemment ajoutes ----------
  r.get('/recent', (req, res) => {
    const rows = db.prepare(`SELECT e.*, s.title AS series_title FROM episode e JOIN series s ON s.id = e.series_id
      WHERE e.status = 'ready' ORDER BY e.ready_at DESC, e.id DESC LIMIT 16`).all();
    res.json(rows.map((e) => ({ ...viewFor(req, e), series_title: e.series_title })));
  });

  // ---------- Progression de lecture (par compte) ----------
  r.get('/progress', (req, res) => {
    const rows = db.prepare(`SELECT p.episode_id, p.pos, p.dur, p.watched, p.updated_at, e.number, e.title, e.series_id, e.thumb_file,
        s.title AS series_title
      FROM watch_progress p JOIN episode e ON e.id = p.episode_id JOIN series s ON s.id = e.series_id
      WHERE p.user_id = ? AND e.status = 'ready' ORDER BY p.updated_at DESC`).all(req.user.id);
    res.json(rows.map(({ thumb_file: t, ...p }) => ({
      ...p, watched: !!p.watched,
      thumb_url: t ? `/api/media/thumb/${p.episode_id}?v=${path.basename(t, path.extname(t)).slice(0, 8)}` : null,
    })));
  });

  r.put('/progress/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e || e.status !== 'ready') throw notFound('Episode');
    const pos = Number(req.body?.pos);
    const dur = Number(req.body?.dur);
    if (!Number.isFinite(pos) || pos < 0 || !Number.isFinite(dur) || dur < 0 || dur > 86400) throw httpError(400, 'Position invalide');
    // Vu : plus de 95 % regardes, ou moins de 90 s restantes sur un episode de plus de 10 min (generique de fin).
    const watched = req.body?.watched === true || (dur > 0 && (pos / dur > 0.95 || (dur > 600 && dur - pos < 90)));
    // Temps reellement regarde depuis le dernier envoi (statistiques), borne pour eviter les valeurs aberrantes.
    const delta = Math.max(0, Math.min(120, Number(req.body?.delta) || 0));
    const prev = db.prepare('SELECT watched FROM watch_progress WHERE user_id = ? AND episode_id = ?').get(req.user.id, e.id);
    const finishedNow = watched && req.body?.manual !== true && !(prev?.watched && pos === 0);
    db.prepare(`INSERT INTO watch_progress (user_id, episode_id, pos, dur, watched, seconds_watched, completions, updated_at)
      VALUES (@u, @e, @pos, @dur, @w, @delta, @done, datetime('now'))
      ON CONFLICT(user_id, episode_id) DO UPDATE SET pos = excluded.pos, dur = excluded.dur, watched = excluded.watched,
        seconds_watched = seconds_watched + excluded.seconds_watched, completions = completions + excluded.completions, updated_at = excluded.updated_at`)
      .run({ u: req.user.id, e: e.id, pos: watched ? 0 : Math.floor(pos), dur: Math.floor(dur), w: watched || prev?.watched ? 1 : 0, delta, done: finishedNow && !prev?.watched ? 1 : 0 });
    res.status(204).end();
  });

  r.delete('/progress/:id', (req, res) => {
    db.prepare('DELETE FROM watch_progress WHERE user_id = ? AND episode_id = ?').run(req.user.id, id(req.params.id));
    res.status(204).end();
  });

  // ---------- Comptes (administrateurs) ----------
  const listUsers = () => db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at,
      (SELECT MAX(updated_at) FROM watch_progress p WHERE p.user_id = u.id) AS last_watch
    FROM app_user u ORDER BY u.role, u.username COLLATE NOCASE`).all().map((u) => ({ ...u, disabled: !!u.disabled }));
  const activeAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM app_user WHERE role = 'admin' AND disabled = 0").get().n;
  const getUser = (uid) => db.prepare('SELECT * FROM app_user WHERE id = ?').get(uid);
  const displayName = (v) => text(v, { field: 'Nom affiché', max: 60 });
  const role = (v) => {
    if (!ROLES.includes(v)) throw httpError(400, 'Rôle invalide');
    return v;
  };

  r.get('/users', (req, res) => res.json(listUsers()));

  // ---------- Tableau de bord (administrateurs) ----------
  function dirBytes(sub) {
    let total = 0;
    try {
      for (const f of fs.readdirSync(abs(sub), { withFileTypes: true })) if (f.isFile()) total += fileSize(abs(path.join(sub, f.name)));
    } catch { /* dossier absent */ }
    return total;
  }

  // Memoire disponible reelle (MemAvailable) : os.freemem() ne compte pas le cache liberable.
  function memory() {
    const total = os.totalmem();
    try {
      const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
      if (m) return { total, available: Number(m[1]) * 1024 };
    } catch { /* hors Linux */ }
    return { total, available: os.freemem() };
  }

  r.get('/admin/overview', async (req, res) => {
    let disk = null;
    try {
      const st = fs.statfsSync(mediaDir);
      disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize, used: (st.blocks - st.bfree) * st.bsize };
    } catch { /* indisponible */ }
    const dbFile = db.name && db.name !== ':memory:' ? db.name : null;
    const dbBytes = dbFile ? fileSize(dbFile) + fileSize(`${dbFile}-wal`) : 0;
    const media = { videos: dirBytes('videos'), subtitles: dirBytes('subtitles'), images: dirBytes('images'), database: dbBytes };

    const eps = db.prepare('SELECT e.*, s.title AS series_title FROM episode e JOIN series s ON s.id = e.series_id').all();
    const ready = eps.filter((e) => e.status === 'ready');
    const subtitled = new Set(db.prepare('SELECT DISTINCT episode_id FROM subtitle').all().map((x) => x.episode_id));
    const duration = ready.reduce((sum, e) => sum + (e.media_info ? Number(JSON.parse(e.media_info).duration) || 0 : 0), 0);
    const bySeries = new Map();
    for (const e of eps) {
      const cur = bySeries.get(e.series_id) || { id: e.series_id, title: e.series_title, episodes: 0, bytes: 0 };
      if (e.status === 'ready') { cur.episodes += 1; cur.bytes += e.video_size; } else cur.bytes += fileSize(`${abs(e.video_file)}.part`);
      bySeries.set(e.series_id, cur);
    }
    const epLabel = (e) => ({ id: e.id, series_id: e.series_id, series_title: e.series_title, number: e.number, title: e.title });

    const activity = db.prepare(`SELECT u.username, u.display_name, p.episode_id, p.pos, p.dur, p.watched, p.updated_at, e.number, s.title AS series_title, s.id AS series_id
      FROM watch_progress p JOIN app_user u ON u.id = p.user_id JOIN episode e ON e.id = p.episode_id JOIN series s ON s.id = e.series_id
      ORDER BY p.updated_at DESC LIMIT 12`).all().map((a) => ({ ...a, watched: !!a.watched }));
    const users = db.prepare(`SELECT
        COUNT(*) AS total,
        SUM(role = 'admin') AS admins,
        SUM(disabled = 1) AS disabled,
        (SELECT COUNT(DISTINCT user_id) FROM watch_progress WHERE updated_at > datetime('now', '-7 days')) AS active_week
      FROM app_user`).get();

    res.json({
      generated_at: new Date().toISOString(),
      disk,
      media,
      library: {
        series: db.prepare('SELECT COUNT(*) AS n FROM series').get().n,
        episodes: ready.length,
        subtitled: ready.filter((e) => subtitled.has(e.id)).length,
        without_subtitles: ready.filter((e) => !subtitled.has(e.id)).map(epLabel),
        duration_seconds: Math.round(duration),
        by_series: [...bySeries.values()].sort((a, b) => b.bytes - a.bytes),
      },
      processing: eps.filter((e) => ['queued', 'running', 'failed'].includes(e.processing)).map((e) => ({
        ...epLabel(e), state: e.processing, progress: processor.progressOf(e.id) ?? e.processing_progress ?? 0,
        error: e.processing_error, reason: e.media_info ? JSON.parse(e.media_info).reason : null,
      })),
      incomplete: eps.filter((e) => e.status === 'uploading').map((e) => ({
        ...epLabel(e), original_name: e.original_name, received: fileSize(`${abs(e.video_file)}.part`), size: e.video_size, created_at: e.created_at,
      })),
      users: { ...users, admins: users.admins || 0, disabled: users.disabled || 0 },
      stats: {
        // Temps reellement regarde (envoye par le lecteur), episodes termines, par personne.
        by_user: db.prepare(`SELECT u.id, u.username, u.display_name,
            COALESCE(SUM(p.seconds_watched), 0) AS seconds, COALESCE(SUM(p.completions), 0) AS completed,
            COUNT(p.episode_id) AS started, MAX(p.updated_at) AS last_watch
          FROM app_user u LEFT JOIN watch_progress p ON p.user_id = u.id
          GROUP BY u.id ORDER BY seconds DESC, u.username COLLATE NOCASE`).all(),
        top_episodes: db.prepare(`SELECT e.id, e.number, e.season, e.series_id, s.title AS series_title,
            COUNT(DISTINCT CASE WHEN p.completions > 0 OR p.seconds_watched >= 60 THEN p.user_id END) AS viewers,
            COALESCE(SUM(p.completions), 0) AS completions, COALESCE(SUM(p.seconds_watched), 0) AS seconds
          FROM watch_progress p JOIN episode e ON e.id = p.episode_id JOIN series s ON s.id = e.series_id
          GROUP BY e.id HAVING seconds > 0 OR completions > 0 ORDER BY viewers DESC, seconds DESC LIMIT 8`).all(),
        by_series: db.prepare(`SELECT s.id, s.title, COALESCE(SUM(p.seconds_watched), 0) AS seconds, COUNT(DISTINCT p.user_id) AS viewers
          FROM series s JOIN episode e ON e.series_id = s.id JOIN watch_progress p ON p.episode_id = e.id
          GROUP BY s.id HAVING seconds > 0 ORDER BY seconds DESC LIMIT 8`).all(),
      },
      activity,
      server: {
        uptime_seconds: Math.round(os.uptime()),
        app_uptime_seconds: Math.round(process.uptime()),
        load: os.loadavg(),
        cpus: os.cpus().length,
        memory: memory(),
        node: process.version,
        ffmpeg: await ffmpegAvailable(),
        video_processing: processing,
      },
    });
  });

  r.post('/users', (req, res) => {
    const username = validateUsername(req.body?.username);
    const password = validatePassword(req.body?.password);
    if (db.prepare('SELECT 1 FROM app_user WHERE username = ?').get(username)) throw httpError(409, 'Cet identifiant existe déjà');
    const info = db.prepare('INSERT INTO app_user (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, displayName(req.body?.display_name), hashPassword(password), role(req.body?.role ?? 'viewer'));
    res.status(201).json(listUsers().find((u) => u.id === info.lastInsertRowid));
  });

  r.put('/users/:id', (req, res) => {
    const u = getUser(id(req.params.id));
    if (!u) throw notFound('Compte');
    const b = req.body || {};
    const next = {
      display_name: 'display_name' in b ? displayName(b.display_name) : u.display_name,
      role: 'role' in b ? role(b.role) : u.role,
      disabled: 'disabled' in b ? (b.disabled ? 1 : 0) : u.disabled,
    };
    const losesAdmin = u.role === 'admin' && !u.disabled && (next.role !== 'admin' || next.disabled);
    if (losesAdmin && activeAdmins() <= 1) throw httpError(409, 'Il faut garder au moins un administrateur actif');
    if (u.id === req.user.id && next.disabled) throw httpError(409, 'Tu ne peux pas désactiver ton propre compte');
    db.transaction(() => {
      db.prepare("UPDATE app_user SET display_name = ?, role = ?, disabled = ?, updated_at = datetime('now') WHERE id = ?")
        .run(next.display_name, next.role, next.disabled, u.id);
      if (b.password !== undefined && b.password !== '') {
        db.prepare('UPDATE app_user SET password_hash = ? WHERE id = ?').run(hashPassword(validatePassword(b.password)), u.id);
      }
      // Mot de passe change ou compte desactive : deconnexion de ses appareils (sauf la session en cours).
      if ((b.password || next.disabled) && u.id !== req.user.id) db.prepare('DELETE FROM auth_session WHERE user_id = ?').run(u.id);
    })();
    res.json(listUsers().find((x) => x.id === u.id));
  });

  r.delete('/users/:id', (req, res) => {
    const u = getUser(id(req.params.id));
    if (!u) throw notFound('Compte');
    if (u.id === req.user.id) throw httpError(409, 'Tu ne peux pas supprimer ton propre compte');
    if (u.role === 'admin' && !u.disabled && activeAdmins() <= 1) throw httpError(409, 'Il faut garder au moins un administrateur actif');
    db.transaction(() => {
      db.prepare('DELETE FROM auth_session WHERE user_id = ?').run(u.id);
      db.prepare('DELETE FROM app_user WHERE id = ?').run(u.id);
    })();
    res.status(204).end();
  });

  r.get('/storage', (req, res) => {
    const used = db.prepare("SELECT COALESCE(SUM(video_size), 0) AS n FROM episode WHERE status = 'ready'").get().n;
    res.json({ free_bytes: freeBytes(), videos_bytes: used, max_video_bytes: maxVideoBytes, max_chunk_bytes: MAX_CHUNK_BYTES });
  });

  // ---------- Series ----------
  r.get('/series', (req, res) => {
    res.json(db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episode e WHERE e.series_id = s.id AND e.status = 'ready') AS episode_count,
        (SELECT COUNT(DISTINCT e.id) FROM episode e JOIN subtitle t ON t.episode_id = e.id WHERE e.series_id = s.id) AS subtitled_count,
        (SELECT COUNT(*) FROM episode e WHERE e.series_id = s.id AND e.status = 'ready' AND @prev IS NOT NULL AND e.ready_at > @prev) AS new_count,
        EXISTS (SELECT 1 FROM watchlist w WHERE w.series_id = s.id AND w.user_id = @uid) AS in_list,
        (SELECT MAX(e.ready_at) FROM episode e WHERE e.series_id = s.id AND e.status = 'ready') AS last_added
      FROM series s ORDER BY s.title COLLATE NOCASE`).all({ prev: req.user.prev_visit_at, uid: req.user.id })
      .map((x) => ({ ...seriesView(x), in_list: !!x.in_list })));
  });

  r.post('/series', (req, res) => {
    const title = text(req.body?.title, { field: 'Titre', max: 200, required: true });
    const description = text(req.body?.description, { field: 'Description', max: 4000 });
    const info = db.prepare('INSERT INTO series (title, description) VALUES (?, ?)').run(title, description);
    res.status(201).json(seriesView(getSeries(info.lastInsertRowid)));
  });

  r.get('/series/:id', (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    const eps = episodesOf(s.id).filter((e) => isAdmin(req) || e.status === 'ready');
    const inList = !!db.prepare('SELECT 1 FROM watchlist WHERE user_id = ? AND series_id = ?').get(req.user.id, s.id);
    res.json({ ...seriesView(s), in_list: inList, episodes: eps.map((e) => viewFor(req, e, s)) });
  });

  r.put('/series/:id', (req, res) => {
    const sid = id(req.params.id);
    if (!getSeries(sid)) throw notFound('Serie');
    const title = text(req.body?.title, { field: 'Titre', max: 200, required: true });
    const description = text(req.body?.description, { field: 'Description', max: 4000 });
    db.prepare('UPDATE series SET title = ?, description = ? WHERE id = ?').run(title, description, sid);
    if (req.body?.season_names !== undefined) {
      const names = {};
      for (const [k, v] of Object.entries(req.body.season_names || {})) {
        const n = Number(k);
        const t = text(v, { field: 'Nom de saison', max: 80 });
        if (Number.isInteger(n) && n >= 0 && n <= 999 && t) names[n] = t;
      }
      db.prepare('UPDATE series SET season_names = ? WHERE id = ?').run(JSON.stringify(names), sid);
    }
    res.json(seriesView(getSeries(sid)));
  });

  // ---------- Fiches AniList (administrateurs) ----------
  r.get('/admin/anilist/search', async (req, res) => {
    const q = text(req.query.q, { field: 'Recherche', max: 120, required: true });
    res.json(await searchAnime(q));
  });

  // Import d'une fiche : genres, annee, lien ; synopsis et affiche seulement si demandes.
  r.post('/series/:id/anilist', async (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    const a = await getAnime(id(req.body?.id));
    const fields = { anilist_id: a.id, genres: JSON.stringify(a.genres), year: a.year };
    if (req.body?.description && a.description) fields.description = a.description;
    if (req.body?.cover && a.cover) {
      const file = saveImage(await downloadImage(a.cover));
      removeFile(s.cover_file);
      fields.cover_file = file;
    }
    const cols = Object.keys(fields);
    db.prepare(`UPDATE series SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id: s.id });
    if (fields.cover_file) await refreshAccent(s.id, { force: true });
    res.json(seriesView(getSeries(s.id)));
  });

  // Generique d'ouverture : bornes en secondes ; null pour effacer.
  function introBody(b) {
    if (b?.start === null || b?.end === null) return { start: null, end: null };
    const start = Number(b?.start);
    const end = Number(b?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 86400) {
      throw httpError(400, 'Bornes du générique invalides (la fin doit être après le début)');
    }
    return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
  }
  r.put('/series/:id/intro', (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    const { start, end } = introBody(req.body);
    db.prepare('UPDATE series SET intro_start = ?, intro_end = ? WHERE id = ?').run(start, end, s.id);
    res.json(seriesView(getSeries(s.id)));
  });
  r.put('/episodes/:id/intro', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    const { start, end } = introBody(req.body);
    db.prepare('UPDATE episode SET intro_start = ?, intro_end = ? WHERE id = ?').run(start, end, e.id);
    res.json(episodeView(getEpisode(e.id)));
  });

  // Ordre manuel des episodes (glisser-deposer) : liste d'identifiants dans l'ordre voulu.
  r.put('/series/:id/order', (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    const ids = Array.isArray(req.body?.episodes) ? req.body.episodes.map(id) : null;
    if (!ids) throw httpError(400, 'Liste d\'épisodes manquante');
    const own = new Set(episodesOf(s.id).map((e) => e.id));
    if (ids.some((x) => !own.has(x))) throw httpError(400, 'Un épisode n\'appartient pas à cette série');
    const upd = db.prepare('UPDATE episode SET position = ? WHERE id = ?');
    db.transaction(() => ids.forEach((x, i) => upd.run(i, x)))();
    res.json({ ...seriesView(getSeries(s.id)), episodes: episodesOf(s.id).map((e) => viewFor(req, e, s)) });
  });

  // Affiche importee (corps brut : image JPEG, PNG ou WebP).
  r.put('/series/:id/cover', async (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    const file = saveImage(await readBody(req, MAX_COVER_BYTES));
    removeFile(s.cover_file);
    db.prepare('UPDATE series SET cover_file = ? WHERE id = ?').run(file, s.id);
    await refreshAccent(s.id, { force: true });
    res.json(seriesView(getSeries(s.id)));
  });

  r.delete('/series/:id/cover', async (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    removeFile(s.cover_file);
    db.prepare('UPDATE series SET cover_file = NULL WHERE id = ?').run(s.id);
    await refreshAccent(s.id, { force: true });
    res.json(seriesView(getSeries(s.id)));
  });

  r.delete('/series/:id', (req, res) => {
    const sid = id(req.params.id);
    if (!getSeries(sid)) throw notFound('Serie');
    const eps = episodesOf(sid);
    if (eps.some((e) => uploading.has(e.id))) throw httpError(409, 'Un envoi est en cours pour cette serie');
    eps.forEach(deleteEpisodeFiles);
    removeFile(getSeries(sid).cover_file);
    db.prepare('DELETE FROM series WHERE id = ?').run(sid);
    res.status(204).end();
  });

  // ---------- Episodes ----------
  // Creation : annonce le fichier (nom, taille), puis la video est envoyee par morceaux.
  r.post('/series/:id/episodes', (req, res) => {
    const sid = id(req.params.id);
    if (!getSeries(sid)) throw notFound('Serie');
    const filename = text(req.body?.filename, { field: 'Nom du fichier', max: 300, required: true });
    const ext = extensionOf(filename);
    if (!VIDEO_TYPES[ext]) {
      throw httpError(400, `Format video non pris en charge (.${ext || '?'}). Formats acceptes : ${Object.keys(VIDEO_TYPES).join(', ')}`);
    }
    const size = Number(req.body?.size);
    if (!Number.isInteger(size) || size <= 0) throw httpError(400, 'Taille de fichier invalide');
    if (size > maxVideoBytes) throw httpError(413, `Fichier trop volumineux (maximum ${Math.round(maxVideoBytes / 1024 ** 3)} Go)`);
    const free = freeBytes();
    if (free !== null && size + DISK_MARGIN_BYTES > free) {
      throw httpError(507, `Espace disque insuffisant sur le serveur (${(free / 1024 ** 3).toFixed(1)} Go libres)`);
    }
    const number = episodeNumber(req.body?.number);
    const season = seasonNumber(req.body?.season);
    const title = text(req.body?.title, { field: 'Titre', max: 300 });
    const file = `videos/${crypto.randomUUID()}.${ext}`;
    const info = db.prepare(`INSERT INTO episode (series_id, season, number, title, original_name, video_file, video_mime, video_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sid, season, number, title, filename, file, VIDEO_TYPES[ext], size);
    res.status(201).json(episodeView(getEpisode(info.lastInsertRowid)));
  });

  r.get('/episodes/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e || (!isAdmin(req) && e.status !== 'ready')) throw notFound('Episode');
    const s = getSeries(e.series_id);
    const ready = episodesOf(e.series_id).filter((x) => x.status === 'ready');
    const i = ready.findIndex((x) => x.id === e.id);
    res.json({
      ...viewFor(req, e, s),
      series: { id: s.id, title: s.title, cover_url: coverUrl(s), accent: s.accent, season_names: s.season_names ? JSON.parse(s.season_names) : {} },
      prev_id: i > 0 ? ready[i - 1].id : null,
      next_id: i >= 0 && i < ready.length - 1 ? ready[i + 1].id : null,
    });
  });

  // Numero, titre, saison ; series_id deplace l'episode vers une autre serie (en fin de liste).
  r.put('/episodes/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    const b = req.body || {};
    const number = 'number' in b ? episodeNumber(b.number) : e.number;
    const title = 'title' in b ? text(b.title, { field: 'Titre', max: 300 }) : e.title;
    const season = 'season' in b ? seasonNumber(b.season) : e.season;
    let seriesId = e.series_id;
    let position = e.position;
    if (b.series_id !== undefined && Number(b.series_id) !== e.series_id) {
      seriesId = id(b.series_id);
      if (!getSeries(seriesId)) throw notFound('Serie de destination');
      position = null;
    }
    if (season !== e.season) position = null;
    db.prepare('UPDATE episode SET number = ?, title = ?, season = ?, series_id = ?, position = ? WHERE id = ?')
      .run(number, title, season, seriesId, position, e.id);
    res.json(episodeView(getEpisode(e.id)));
  });

  r.delete('/episodes/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    if (uploading.has(e.id)) throw httpError(409, 'Un envoi est en cours pour cet episode');
    deleteEpisodeFiles(e);
    db.prepare('DELETE FROM episode WHERE id = ?').run(e.id);
    res.status(204).end();
  });

  // Miniature capturee par le navigateur a partir de la video (JPEG, PNG ou WebP).
  r.put('/episodes/:id/thumbnail', async (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    const file = saveImage(await readBody(req, MAX_THUMB_BYTES));
    removeFile(e.thumb_file);
    db.prepare('UPDATE episode SET thumb_file = ? WHERE id = ?').run(file, e.id);
    res.json(episodeView(getEpisode(e.id)));
  });

  // Reception d'un morceau de video. offset = octets deja recus (reprise possible apres coupure).
  r.put('/episodes/:id/upload', async (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    if (e.status === 'ready') throw httpError(409, 'La video de cet episode est deja complete');
    if (uploading.has(e.id)) {
      // Un morceau precedent est encore ouvert (connexion figee) : on le coupe, le client reprendra.
      uploading.get(e.id).destroy();
      throw httpError(409, 'Envoi precedent interrompu, reprise', { received: fileSize(`${abs(e.video_file)}.part`), retry: true });
    }
    const part = `${abs(e.video_file)}.part`;
    const received = fileSize(part);
    const offset = Number(req.query.offset);
    if (!Number.isInteger(offset) || offset !== received) {
      throw httpError(409, 'Position d\'envoi incorrecte', { received });
    }
    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length <= 0) throw httpError(411, 'En-tete Content-Length requis');
    if (length > MAX_CHUNK_BYTES) throw httpError(413, 'Morceau trop volumineux');
    if (offset + length > e.video_size) throw httpError(400, 'Le morceau depasse la taille annoncee du fichier');

    uploading.set(e.id, req);
    // Aucun octet recu pendant UPLOAD_IDLE_MS : la connexion est consideree comme perdue.
    req.setTimeout(UPLOAD_IDLE_MS, () => req.destroy());
    try {
      await pipeline(req, fs.createWriteStream(part, { flags: 'a' }));
    } catch {
      // Connexion coupee : les octets deja ecrits restent valables, le client reprendra a partir de la.
      if (!res.headersSent && !req.destroyed) throw httpError(400, 'Envoi interrompu', { received: fileSize(part) });
      return;
    } finally {
      if (uploading.get(e.id) === req) uploading.delete(e.id);
    }
    const now = fileSize(part);
    if (now === e.video_size) {
      fs.renameSync(part, abs(e.video_file));
      db.prepare("UPDATE episode SET status = 'ready', ready_at = datetime('now') WHERE id = ?").run(e.id);
      processor.enqueue(e.id);
    }
    res.json({ received: now, status: now === e.video_size ? 'ready' : 'uploading' });
  });

  // ---------- Sous-titres ----------
  r.post('/episodes/:id/subtitles', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    const filename = text(req.body?.filename, { field: 'Nom du fichier', max: 300, required: true });
    const ext = extensionOf(filename);
    if (!SUBTITLE_EXTENSIONS.includes(ext)) {
      throw httpError(400, `Format de sous-titres non pris en charge (.${ext || '?'}). Formats acceptes : ${SUBTITLE_EXTENSIONS.join(', ')}`);
    }
    if (typeof req.body?.content !== 'string') throw httpError(400, 'Contenu du fichier manquant');
    const vtt = toWebVtt(req.body.content, ext);
    const label = text(req.body?.label, { field: 'Nom de la piste', max: 80 }) || 'Français';
    const lang = (text(req.body?.lang, { field: 'Langue', max: 12 }) || 'fr').toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang)) throw httpError(400, 'Code de langue invalide (ex. fr, ja, en)');
    const file = `subtitles/${crypto.randomUUID()}.vtt`;
    fs.writeFileSync(abs(file), vtt);
    const info = db.prepare('INSERT INTO subtitle (episode_id, label, lang, original_name, file) VALUES (?, ?, ?, ?, ?)')
      .run(e.id, label, lang, filename, file);
    res.status(201).json(db.prepare('SELECT id, label, lang, original_name, created_at FROM subtitle WHERE id = ?').get(info.lastInsertRowid));
  });

  // Relance du traitement (apres un echec, ou pour reanalyser).
  r.post('/episodes/:id/process', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    if (e.status !== 'ready') throw httpError(409, 'La video n\'est pas encore entierement envoyee');
    if (!processing) throw httpError(503, 'Traitement video desactive sur ce serveur (VIDEO_PROCESSING=off)');
    processor.retry(e.id);
    res.json(episodeView(getEpisode(e.id)));
  });

  r.put('/subtitles/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM subtitle WHERE id = ?').get(id(req.params.id));
    if (!s) throw notFound('Sous-titre');
    const label = text(req.body?.label, { field: 'Nom de la piste', max: 80, required: true });
    const lang = (text(req.body?.lang, { field: 'Langue', max: 12, required: true })).toLowerCase();
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang)) throw httpError(400, 'Code de langue invalide (ex. fr, ja, en)');
    db.prepare('UPDATE subtitle SET label = ?, lang = ? WHERE id = ?').run(label, lang, s.id);
    res.json(db.prepare('SELECT id, label, lang, original_name, created_at FROM subtitle WHERE id = ?').get(s.id));
  });

  r.delete('/subtitles/:id', (req, res) => {
    const s = db.prepare('SELECT * FROM subtitle WHERE id = ?').get(id(req.params.id));
    if (!s) throw notFound('Sous-titre');
    removeFile(s.file);
    db.prepare('DELETE FROM subtitle WHERE id = ?').run(s.id);
    res.status(204).end();
  });

  // ---------- Lecture ----------
  // sendFile gere les requetes partielles (Range) : avance/retour rapide dans la video.
  r.get('/media/video/:id', (req, res, next) => {
    const e = getEpisode(id(req.params.id));
    if (!e || e.status !== 'ready') throw notFound('Video');
    res.type(e.video_mime);
    // Lecture dans la page uniquement (pas de proposition d'enregistrement par le navigateur).
    res.sendFile(abs(e.video_file), { headers: { 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  function sendImage(res, next, rel) {
    res.type(IMAGE_MIME[path.extname(rel).slice(1)] || 'application/octet-stream');
    res.sendFile(abs(rel), { headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  }

  r.get('/media/storyboard/:id', (req, res, next) => {
    const e = getEpisode(id(req.params.id));
    if (!e?.storyboard_file) throw notFound('Planche');
    sendImage(res, next, e.storyboard_file);
  });

  r.get('/media/thumb/:id', (req, res, next) => {
    const e = getEpisode(id(req.params.id));
    if (!e?.thumb_file) throw notFound('Miniature');
    sendImage(res, next, e.thumb_file);
  });

  r.get('/media/cover/:id', (req, res, next) => {
    const s = getSeries(id(req.params.id));
    if (!s?.cover_file) throw notFound('Affiche');
    sendImage(res, next, s.cover_file);
  });

  r.get('/media/subtitle/:id', (req, res, next) => {
    const s = db.prepare('SELECT file FROM subtitle WHERE id = ?').get(id(req.params.id));
    if (!s) throw notFound('Sous-titre');
    res.type('text/vtt; charset=utf-8');
    res.sendFile(abs(s.file), { headers: { 'Cache-Control': 'private, no-cache' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  app.locals.processor = processor;
  // Au demarrage : couleur d'ambiance des series qui n'en ont pas encore.
  app.locals.refreshAccents = async () => {
    for (const { id: sid } of db.prepare('SELECT id FROM series WHERE accent IS NULL').all()) await refreshAccent(sid);
  };
  app.use('/api', r);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500 && status !== 507) console.error(err);
    if (res.headersSent) return;
    res.status(status).json({ error: status === 500 ? 'Erreur interne' : err.message, ...(err.extra || {}) });
  });

  return app;
}
