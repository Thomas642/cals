import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createAuth } from './lib/auth.js';
import { SUBTITLE_EXTENSIONS, toWebVtt } from './lib/subtitles.js';

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

function episodeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw httpError(400, 'Numero d\'episode invalide');
  return n;
}

const extensionOf = (filename) => path.extname(String(filename || '')).slice(1).toLowerCase();

export function createApp(db, { mediaDir = process.env.MEDIA_DIR || path.join(process.cwd(), 'data', 'media'),
  maxVideoBytes = (Number(process.env.MAX_VIDEO_GB) || 20) * 1024 ** 3 } = {}) {
  fs.mkdirSync(path.join(mediaDir, 'videos'), { recursive: true });
  fs.mkdirSync(path.join(mediaDir, 'subtitles'), { recursive: true });
  const abs = (rel) => path.join(mediaDir, rel);
  const removeFile = (rel) => { if (rel) fs.rmSync(abs(rel), { force: true }); };
  const fileSize = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const uploading = new Set(); // episodes dont un morceau est en cours de reception

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

  function episodeView(e) {
    const received = e.status === 'ready' ? e.video_size : fileSize(`${abs(e.video_file)}.part`);
    return {
      id: e.id, series_id: e.series_id, number: e.number, title: e.title, original_name: e.original_name,
      video_mime: e.video_mime, video_size: e.video_size, status: e.status, received, created_at: e.created_at,
      subtitles: subtitlesOf(e.id),
    };
  }

  const episodesOf = (sid) => db.prepare('SELECT * FROM episode WHERE series_id = ? ORDER BY number IS NULL, number, id').all(sid);

  function deleteEpisodeFiles(e) {
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
  r.get('/auth/status', (req, res) => res.json(auth.status(req)));
  r.post('/auth/login', (req, res) => res.json(auth.login(req, res, {
    username: req.body?.username, password: req.body?.password, remember: req.body?.remember !== false,
  })));
  r.post('/auth/logout', (req, res) => { auth.logout(req, res); res.status(204).end(); });

  // Toutes les routes suivantes exigent une session.
  r.use(auth.requireSession);

  r.get('/storage', (req, res) => {
    const used = db.prepare("SELECT COALESCE(SUM(video_size), 0) AS n FROM episode WHERE status = 'ready'").get().n;
    res.json({ free_bytes: freeBytes(), videos_bytes: used, max_video_bytes: maxVideoBytes, max_chunk_bytes: MAX_CHUNK_BYTES });
  });

  // ---------- Series ----------
  r.get('/series', (req, res) => {
    res.json(db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM episode e WHERE e.series_id = s.id AND e.status = 'ready') AS episode_count,
        (SELECT COUNT(DISTINCT e.id) FROM episode e JOIN subtitle t ON t.episode_id = e.id WHERE e.series_id = s.id) AS subtitled_count
      FROM series s ORDER BY s.title COLLATE NOCASE`).all());
  });

  r.post('/series', (req, res) => {
    const title = text(req.body?.title, { field: 'Titre', max: 200, required: true });
    const description = text(req.body?.description, { field: 'Description', max: 4000 });
    const info = db.prepare('INSERT INTO series (title, description) VALUES (?, ?)').run(title, description);
    res.status(201).json(getSeries(info.lastInsertRowid));
  });

  r.get('/series/:id', (req, res) => {
    const s = getSeries(id(req.params.id));
    if (!s) throw notFound('Serie');
    res.json({ ...s, episodes: episodesOf(s.id).map(episodeView) });
  });

  r.put('/series/:id', (req, res) => {
    const sid = id(req.params.id);
    if (!getSeries(sid)) throw notFound('Serie');
    const title = text(req.body?.title, { field: 'Titre', max: 200, required: true });
    const description = text(req.body?.description, { field: 'Description', max: 4000 });
    db.prepare('UPDATE series SET title = ?, description = ? WHERE id = ?').run(title, description, sid);
    res.json(getSeries(sid));
  });

  r.delete('/series/:id', (req, res) => {
    const sid = id(req.params.id);
    if (!getSeries(sid)) throw notFound('Serie');
    const eps = episodesOf(sid);
    if (eps.some((e) => uploading.has(e.id))) throw httpError(409, 'Un envoi est en cours pour cette serie');
    eps.forEach(deleteEpisodeFiles);
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
    const title = text(req.body?.title, { field: 'Titre', max: 300 });
    const file = `videos/${crypto.randomUUID()}.${ext}`;
    const info = db.prepare(`INSERT INTO episode (series_id, number, title, original_name, video_file, video_mime, video_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sid, number, title, filename, file, VIDEO_TYPES[ext], size);
    res.status(201).json(episodeView(getEpisode(info.lastInsertRowid)));
  });

  r.get('/episodes/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    const s = getSeries(e.series_id);
    const ready = episodesOf(e.series_id).filter((x) => x.status === 'ready');
    const i = ready.findIndex((x) => x.id === e.id);
    res.json({
      ...episodeView(e),
      series: { id: s.id, title: s.title },
      prev_id: i > 0 ? ready[i - 1].id : null,
      next_id: i >= 0 && i < ready.length - 1 ? ready[i + 1].id : null,
    });
  });

  r.put('/episodes/:id', (req, res) => {
    const eid = id(req.params.id);
    if (!getEpisode(eid)) throw notFound('Episode');
    db.prepare('UPDATE episode SET number = ?, title = ? WHERE id = ?')
      .run(episodeNumber(req.body?.number), text(req.body?.title, { field: 'Titre', max: 300 }), eid);
    res.json(episodeView(getEpisode(eid)));
  });

  r.delete('/episodes/:id', (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    if (uploading.has(e.id)) throw httpError(409, 'Un envoi est en cours pour cet episode');
    deleteEpisodeFiles(e);
    db.prepare('DELETE FROM episode WHERE id = ?').run(e.id);
    res.status(204).end();
  });

  // Reception d'un morceau de video. offset = octets deja recus (reprise possible apres coupure).
  r.put('/episodes/:id/upload', async (req, res) => {
    const e = getEpisode(id(req.params.id));
    if (!e) throw notFound('Episode');
    if (e.status === 'ready') throw httpError(409, 'La video de cet episode est deja complete');
    if (uploading.has(e.id)) throw httpError(409, 'Un envoi est deja en cours pour cet episode');
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

    uploading.add(e.id);
    try {
      await pipeline(req, fs.createWriteStream(part, { flags: 'a' }));
    } catch {
      // Connexion coupee : les octets deja ecrits restent valables, le client reprendra a partir de la.
      if (!res.headersSent && !req.destroyed) throw httpError(400, 'Envoi interrompu', { received: fileSize(part) });
      return;
    } finally {
      uploading.delete(e.id);
    }
    const now = fileSize(part);
    if (now === e.video_size) {
      fs.renameSync(part, abs(e.video_file));
      db.prepare("UPDATE episode SET status = 'ready' WHERE id = ?").run(e.id);
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
    res.sendFile(abs(e.video_file), { headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

  r.get('/media/subtitle/:id', (req, res, next) => {
    const s = db.prepare('SELECT file FROM subtitle WHERE id = ?').get(id(req.params.id));
    if (!s) throw notFound('Sous-titre');
    res.type('text/vtt; charset=utf-8');
    res.sendFile(abs(s.file), { headers: { 'Cache-Control': 'private, no-cache' } }, (err) => {
      if (err && !res.headersSent) next(err);
    });
  });

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
