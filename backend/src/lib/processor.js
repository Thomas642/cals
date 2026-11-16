// File de traitement des episodes, une video a la fois : analyse, miniature, sous-titres integres,
// conversion pour le navigateur si necessaire. Reprend au demarrage ce qui n'est pas termine.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { convert, extractSubtitle, extractThumbnail, ffmpegAvailable, plan, probe } from './media.js';

const LANGS = { fre: 'fr', fra: 'fr', fr: 'fr', eng: 'en', en: 'en', jpn: 'ja', ja: 'ja' };
const LABELS = { fr: 'Français', en: 'English', ja: '日本語' };

export function createProcessor(db, { mediaDir, enabled = process.env.VIDEO_PROCESSING !== 'off', log = console } = {}) {
  const abs = (rel) => path.join(mediaDir, rel);
  const queue = [];
  const live = new Map(); // episode -> progression en cours (0..1), lue par l'API
  let running = false;

  const get = (id) => db.prepare('SELECT * FROM episode WHERE id = ?').get(id);
  const set = (id, fields) => {
    const cols = Object.keys(fields);
    db.prepare(`UPDATE episode SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
  };

  function freeBytes() {
    try { const s = fs.statfsSync(mediaDir); return s.bavail * s.bsize; } catch { return null; }
  }

  async function handle(id) {
    let e = get(id);
    if (!e || e.status !== 'ready') return;
    if (!(await ffmpegAvailable())) { set(id, { processing: null }); return; }
    set(id, { processing: 'running', processing_error: null });
    live.set(id, 0);
    const input = abs(e.video_file);
    const p = plan(await probe(input));
    let media = { action: p.action, reason: p.reason, video: p.video, audio: p.audio, duration: p.duration };
    const prev = e.media_info ? JSON.parse(e.media_info) : {};
    set(id, { media_info: JSON.stringify({ ...prev, ...media }) });

    // Miniature (vraie image de l'episode, independante des codecs du navigateur).
    if (!e.thumb_file && p.video) {
      const thumb = `images/${crypto.randomUUID()}.jpg`;
      try {
        await extractThumbnail(input, abs(thumb), p.duration > 0 ? p.duration * 0.25 : 10);
        if (get(id)) set(id, { thumb_file: thumb }); else fs.rmSync(abs(thumb), { force: true });
      } catch (err) {
        fs.rmSync(abs(thumb), { force: true });
        log.warn?.(`[traitement] miniature episode ${id} : ${err.message}`);
      }
    }

    // Sous-titres texte integres (MKV de fansub, par exemple) : ajoutes comme pistes, une seule fois.
    if (!prev.subs_extracted) {
      for (const s of p.subtitles.filter((x) => x.text)) {
        try {
          const vtt = await extractSubtitle(input, s.index);
          if (!vtt.includes('-->')) continue;
          const lang = LANGS[s.lang] || (/^[a-z]{2,3}$/.test(s.lang) ? s.lang : 'fr');
          const label = `${(s.title || LABELS[lang] || lang).slice(0, 60)} (intégré)`;
          const file = `subtitles/${crypto.randomUUID()}.vtt`;
          fs.writeFileSync(abs(file), vtt);
          if (!get(id)) { fs.rmSync(abs(file), { force: true }); return; }
          db.prepare('INSERT INTO subtitle (episode_id, label, lang, original_name, file) VALUES (?, ?, ?, ?, ?)')
            .run(id, label, lang, `${e.original_name} (piste ${s.index})`, file);
        } catch (err) {
          log.warn?.(`[traitement] sous-titres integres episode ${id} piste ${s.index} : ${err.message}`);
        }
      }
      media = { ...media, subs_extracted: true };
      set(id, { media_info: JSON.stringify({ ...prev, ...media }) });
    }

    // Conversion pour le navigateur.
    if (p.action !== 'none') {
      const size = fs.statSync(input).size;
      const free = freeBytes();
      // Sortie H.264 parfois plus lourde que la source HEVC : marge large.
      if (free !== null && free < size * 1.6 + 512 * 1024 * 1024) {
        throw new Error(`Espace disque insuffisant pour convertir (${(free / 1024 ** 3).toFixed(1)} Go libres)`);
      }
      const out = `videos/${crypto.randomUUID()}.mp4`;
      const tmp = `${abs(out)}.tmp.mp4`;
      let lastSaved = 0;
      try {
        await convert(input, tmp, p, (ratio) => {
          live.set(id, ratio);
          if (ratio - lastSaved >= 0.02) { lastSaved = ratio; if (get(id)) set(id, { processing_progress: ratio }); }
        });
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      e = get(id);
      if (!e) { fs.rmSync(tmp, { force: true }); return; }
      fs.renameSync(tmp, abs(out));
      const old = e.video_file;
      set(id, { video_file: out, video_mime: 'video/mp4', video_size: fs.statSync(abs(out)).size });
      fs.rmSync(abs(old), { force: true });
      media = { ...media, converted: p.action, action: 'none' };
      set(id, { media_info: JSON.stringify({ ...prev, ...media }) });
    }
    set(id, { processing: 'done', processing_progress: 1 });
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const id = queue.shift();
        try {
          await handle(id);
        } catch (err) {
          log.error?.(`[traitement] episode ${id} : ${err.message}`);
          if (get(id)) set(id, { processing: 'failed', processing_error: String(err.message).slice(0, 500) });
        } finally {
          live.delete(id);
        }
      }
    } finally {
      running = false;
    }
  }

  function enqueue(id) {
    if (!enabled || queue.includes(id)) return;
    set(id, { processing: 'queued', processing_progress: 0, processing_error: null });
    queue.push(id);
    pump();
  }

  /** Au demarrage : episodes en ligne jamais traites, ou interrompus. */
  function resume() {
    if (!enabled) return;
    const rows = db.prepare(`SELECT id FROM episode WHERE status = 'ready'
      AND (processing IS NULL OR processing IN ('queued', 'running')) ORDER BY series_id, number, id`).all();
    rows.forEach((r) => enqueue(r.id));
  }

  return {
    enqueue,
    resume,
    retry: (id) => enqueue(id),
    progressOf: (id) => live.get(id),
    idle: () => !running && queue.length === 0,
  };
}
