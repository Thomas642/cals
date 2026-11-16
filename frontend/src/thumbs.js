// Miniatures d'episodes capturees dans le navigateur : une image de la video, dessinee dans un canvas.
// Si le navigateur ne sait pas decoder la video (ex. HEVC), le serveur la cree avec ffmpeg.
import { api } from './api.js';

const WIDTH = 640;
const TIMEOUT_MS = 20000;

/** Capture une image a ~25 % de la video (apres le generique d'ouverture la plupart du temps). */
export function captureFrame(src) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(blob);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !Number.isFinite(video.duration)) { finish(null); return; }
      video.currentTime = Math.min(video.duration * 0.25, Math.max(0, video.duration - 1));
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = Math.round((WIDTH * video.videoHeight) / video.videoWidth);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b), 'image/jpeg', 0.82);
      } catch {
        finish(null);
      }
    };
    video.src = src;
  });
}

async function upload(episodeId, blob) {
  const res = await fetch(`/api/episodes/${episodeId}/thumbnail`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Miniature depuis le fichier local, au moment de l'import. */
export async function thumbnailFromFile(episodeId, file) {
  const url = URL.createObjectURL(file);
  try {
    const blob = await captureFrame(url);
    if (blob) { await upload(episodeId, blob); api.invalidate(); }
  } catch { /* miniature facultative */ } finally {
    URL.revokeObjectURL(url);
  }
}
