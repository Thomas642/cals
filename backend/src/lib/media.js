// Traitement des videos avec ffmpeg (installe dans l'image Docker du backend) :
// - analyse (ffprobe) : codecs video/audio, pistes de sous-titres integrees ;
// - conversion en MP4 H.264 8 bits + AAC quand le navigateur ne peut pas lire le fichier
//   (HEVC/H.265, H.264 10 bits, AV1, conteneur MKV...) ; simple re-emballage quand seuls le conteneur
//   ou l'audio posent probleme ;
// - miniature extraite a 25 % de la duree ;
// - extraction des sous-titres texte integres (ASS, SRT...) en WebVTT.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

function run(cmd, args, { onStdout, timeoutMs, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const chunks = [];
    let err = '';
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.stdout.on('data', (d) => {
      if (binary) { chunks.push(d); return; }
      const s = d.toString();
      if (onStdout) onStdout(s); else out += s;
    });
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(binary ? Buffer.concat(chunks) : out);
      else reject(Object.assign(new Error(`${cmd} a echoue (code ${code}) : ${err.trim().split('\n').slice(-3).join(' ')}`), { code }));
    });
  });
}

let available = null;
/** ffmpeg et ffprobe sont-ils installes ? (resultat memorise) */
export async function ffmpegAvailable() {
  if (available === null) {
    try {
      await run('ffprobe', ['-version'], { timeoutMs: 10000 });
      await run('ffmpeg', ['-version'], { timeoutMs: 10000 });
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

export async function probe(file) {
  const json = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 60000 });
  return JSON.parse(json);
}

const TEXT_SUBS = ['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text'];
const BROWSER_AUDIO = ['aac', 'mp3', 'opus', 'vorbis'];

// Piste audio preferee : japonais si present, sinon la piste par defaut, sinon la premiere.
function pickAudio(streams) {
  const audio = streams.filter((s) => s.codec_type === 'audio');
  return audio.find((s) => /^(jpn|ja)$/i.test(s.tags?.language || ''))
    || audio.find((s) => s.disposition?.default) || audio[0] || null;
}

/**
 * Decide du traitement d'une video.
 * action : 'none' (lisible tel quel), 'remux' (copie des flux dans un MP4, audio converti si besoin),
 *          'transcode' (video reencodee en H.264).
 */
export function plan(info) {
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = pickAudio(streams);
  const duration = Number(info.format?.duration) || Number(video?.duration) || 0;
  const subtitles = streams.filter((s) => s.codec_type === 'subtitle').map((s) => ({
    index: s.index, codec: s.codec_name, text: TEXT_SUBS.includes(s.codec_name),
    lang: (s.tags?.language || '').toLowerCase(), title: s.tags?.title || '',
  }));
  if (!video) return { action: 'none', duration, video: null, audio: audio?.codec_name || null, subtitles, reason: 'aucune piste video' };

  const pix = video.pix_fmt || '';
  const videoOk = video.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(pix);
  const audioOk = !audio || BROWSER_AUDIO.includes(audio.codec_name);
  const formats = String(info.format?.format_name || '');
  const containerOk = /mp4|mov/.test(formats) || formats.includes('webm');
  // Plusieurs pistes audio : le navigateur lit la premiere ; on remet la piste preferee seule.
  const audioCount = streams.filter((s) => s.codec_type === 'audio').length;
  const firstAudio = streams.find((s) => s.codec_type === 'audio');
  const audioOrderOk = audioCount <= 1 || firstAudio === audio;

  let action = 'none';
  if (!videoOk) action = 'transcode';
  else if (!audioOk || !containerOk || !audioOrderOk) action = 'remux';
  const reason = !videoOk ? `video ${video.codec_name}${pix ? ` ${pix}` : ''} non lisible par tous les navigateurs`
    : !audioOk ? `audio ${audio.codec_name} non lisible par les navigateurs`
      : !containerOk ? `conteneur ${formats} non lu par tous les navigateurs`
        : !audioOrderOk ? 'piste audio japonaise a placer en premier' : 'lisible tel quel';
  return {
    action, reason, duration, subtitles,
    video: `${video.codec_name}${pix ? ` ${pix}` : ''} ${video.width}x${video.height}`,
    audio: audio ? audio.codec_name : null,
    audioIndex: audio ? audio.index : null,
    videoIndex: video.index,
    width: video.width,
    height: video.height,
    audioCopy: audioOk,
  };
}

/** Lance la conversion ; onProgress(0..1). Le fichier de sortie est un MP4 avec moov au debut (lecture immediate). */
export async function convert(input, output, p, onProgress) {
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', `0:${p.videoIndex}`];
  if (p.audioIndex !== null && p.audioIndex !== undefined) args.push('-map', `0:${p.audioIndex}`);
  if (p.action === 'transcode') {
    args.push('-c:v', 'libx264', '-preset', process.env.X264_PRESET || 'veryfast', '-crf', process.env.X264_CRF || '20',
      '-pix_fmt', 'yuv420p', '-profile:v', 'high');
  } else {
    args.push('-c:v', 'copy');
  }
  if (p.audioIndex !== null && p.audioIndex !== undefined) {
    if (p.audioCopy && p.action !== 'transcode') args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  }
  args.push('-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output);
  let buffer = '';
  const cmd = process.env.FFMPEG_NICE === '0' ? 'ffmpeg' : 'nice';
  const fullArgs = cmd === 'nice' ? ['-n', '10', 'ffmpeg', ...args] : args;
  await run(cmd, fullArgs, {
    onStdout: (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && p.duration > 0) onProgress?.(Math.min(0.999, Number(m[1]) / 1e6 / p.duration));
      }
    },
  });
}

/** Extrait une image JPEG (largeur 640) a la position donnee, en secondes. */
export async function extractThumbnail(input, output, atSeconds) {
  await run('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-ss', String(Math.max(0, atSeconds)), '-i', input,
    '-frames:v', '1', '-update', '1', '-vf', 'scale=640:-2', '-q:v', '4', output], { timeoutMs: 120000 });
  // Meme piege : position au-dela de la fin -> rien d'ecrit, sans erreur.
  try { if (fs.statSync(output).size > 0) return; } catch { /* absent */ }
  throw new Error('ffmpeg n\'a produit aucune miniature');
}

/**
 * Planche d'apercus (storyboard) : jusqu'a 150 images de 160 px reparties sur la duree, en grille de 10 colonnes.
 * Sert a l'apercu sur la barre de temps du lecteur et a l'apercu anime au survol d'un episode.
 * Seules les images cles sont decodees (-skip_frame nokey) : rapide, precision de quelques secondes.
 */
export async function extractStoryboard(input, output, { duration, width, height }) {
  if (!(duration > 0) || !width || !height) throw new Error('duree ou dimensions inconnues');
  const count = Math.min(150, Math.max(10, Math.floor(duration / 10)));
  const interval = duration / count;
  const w = 160;
  const h = Math.max(2, Math.round((w * height) / width / 2) * 2);
  const cols = 10;
  const rows = Math.ceil(count / cols);
  const args = (fast) => ['-hide_banner', '-nostdin', '-y', ...(fast ? ['-skip_frame', 'nokey'] : []), '-i', input,
    '-vf', `fps=1/${interval.toFixed(3)},scale=${w}:${h},tile=${cols}x${rows}`, '-frames:v', '1', '-update', '1', '-q:v', '5', output];
  const written = () => { try { return fs.statSync(output).size > 0; } catch { return false; } };
  // Passe rapide (images cles seulement). ffmpeg peut alors ne rien ecrire sans signaler d'erreur
  // (video avec tres peu d'images cles) : on refait alors une passe complete.
  await run('ffmpeg', args(true), { timeoutMs: 600000 });
  if (!written()) await run('ffmpeg', args(false), { timeoutMs: 1800000 });
  if (!written()) throw new Error('ffmpeg n\'a produit aucune image');
  return { interval, count, cols, rows, w, h };
}

/** Extrait une piste de sous-titres texte integree, convertie en WebVTT par ffmpeg. */
export async function extractSubtitle(input, streamIndex) {
  return run('ffmpeg', ['-hide_banner', '-nostdin', '-i', input, '-map', `0:${streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'],
    { timeoutMs: 300000 });
}

/**
 * Couleur d'ambiance d'une image : teinte dominante parmi les pixels assez colores (24x24 pixels analyses),
 * ramenee a une luminosite lisible sur fond sombre. Retourne "#rrggbb" ou null (image grise).
 */
export async function dominantColor(imagePath) {
  const raw = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', imagePath, '-vf', 'scale=24:24', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { timeoutMs: 30000, binary: true });
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 2 < raw.length; i += 3) {
    const [r, g, b] = [raw[i] / 255, raw[i + 1] / 255, raw[i + 2] / 255];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) continue;
    const sat = d / (1 - Math.abs(2 * l - 1));
    if (sat < 0.25 || l < 0.12 || l > 0.92) continue;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = bins[Math.floor(h / 15) % 24];
    const w = sat * (1 - Math.abs(l - 0.5));
    bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
  }
  const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
  if (best.w < 0.5) return null;
  return readableAccent(best.r / best.w, best.g / best.w, best.b / best.w);
}

// Meme teinte, saturation et luminosite ajustees pour ressortir sur le fond sombre du site.
export function readableAccent(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  h = (h + 360) % 360;
  const l0 = (max + min) / 2;
  const s0 = d ? d / (1 - Math.abs(2 * l0 - 1)) : 0;
  const s = Math.min(0.85, Math.max(0.55, s0));
  const l = 0.62;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}
