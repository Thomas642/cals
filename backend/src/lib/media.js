// Traitement des videos avec ffmpeg (installe dans l'image Docker du backend) :
// - analyse (ffprobe) : codecs video/audio, pistes de sous-titres integrees ;
// - conversion en MP4 H.264 8 bits + AAC quand le navigateur ne peut pas lire le fichier
//   (HEVC/H.265, H.264 10 bits, AV1, conteneur MKV...) ; simple re-emballage quand seuls le conteneur
//   ou l'audio posent probleme ;
// - miniature extraite a 25 % de la duree ;
// - extraction des sous-titres texte integres (ASS, SRT...) en WebVTT.
import { spawn } from 'node:child_process';

function run(cmd, args, { onStdout, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = timeoutMs ? setTimeout(() => child.kill('SIGKILL'), timeoutMs) : null;
    child.stdout.on('data', (d) => { const s = d.toString(); if (onStdout) onStdout(s); else out += s; });
    child.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
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
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', output], { timeoutMs: 120000 });
}

/** Extrait une piste de sous-titres texte integree, convertie en WebVTT par ffmpeg. */
export async function extractSubtitle(input, streamIndex) {
  return run('ffmpeg', ['-hide_banner', '-nostdin', '-i', input, '-map', `0:${streamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'],
    { timeoutMs: 300000 });
}
