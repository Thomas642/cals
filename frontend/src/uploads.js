// Gestionnaire d'envois de videos : file d'attente globale (on peut naviguer pendant l'envoi),
// envoi par morceaux avec reprise automatique apres une coupure reseau.
import { useSyncExternalStore } from 'react';
import { api, errorFromResponse, parseRetryAfter } from './api.js';
import { thumbnailFromFile } from './thumbs.js';

const MB = 1024 * 1024;
const BIG_CHUNK = 16 * MB;
// Repli si un proxy refuse les gros morceaux (ex. nginx de l'hote avec client_max_body_size 2M) :
// juste sous 2 Mo, pour limiter le nombre de requetes.
const SMALL_CHUNK = 2 * MB - 64 * 1024;
// Duree visee pour un morceau : sur une connexion lente, des morceaux plus petits evitent
// les requetes tres longues que les proxys coupent.
const TARGET_CHUNK_SECONDS = 20;
// Aucune progression pendant ce delai : la requete est consideree comme figee, on la relance.
const STALL_MS = 45 * 1000;
const MAX_RETRIES = 10;
// Limite de requetes d'un proxy (429) : on attend puis on reprend, sans abandonner trop vite.
const MAX_RATE_LIMIT_WAITS = 30;
const DEFAULT_RATE_LIMIT_WAIT_S = 60;

let maxChunk = BIG_CHUNK;     // plafond (abaisse apres un 413)
let chunkSize = 4 * MB;       // ajuste selon le debit mesure
let jobs = [];                 // instantane immuable pour useSyncExternalStore
const listeners = new Set();
let running = false;

function emit() {
  jobs = [...jobs];
  listeners.forEach((fn) => fn());
}
function update(job, patch) {
  Object.assign(job, patch);
  emit();
}

function sendChunk(job, offset, blob) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    job.xhr = xhr;
    xhr.open('PUT', `/api/episodes/${job.episodeId}/upload?offset=${offset}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    let stalled = false;
    let watchdog = null;
    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { stalled = true; xhr.abort(); }, STALL_MS);
    };
    const done = () => clearTimeout(watchdog);
    xhr.upload.onprogress = (e) => { arm(); update(job, { sent: offset + e.loaded }); };
    // Fin de l'envoi du corps : on laisse au serveur le temps de repondre (ecriture sur disque).
    xhr.upload.onload = () => arm();
    xhr.onload = () => {
      done();
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* reponse non JSON (proxy) */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(errorFromResponse(xhr.status, data, parseRetryAfter(xhr.getResponseHeader('Retry-After'))));
    };
    xhr.onerror = () => { done(); reject(Object.assign(new Error('Connexion perdue'), { network: true })); };
    xhr.onabort = () => {
      done();
      if (stalled) reject(Object.assign(new Error('Connexion figée (aucune progression depuis 45 s)'), { network: true }));
      else reject(Object.assign(new Error('Envoi annulé'), { aborted: true }));
    };
    arm();
    xhr.send(blob);
  });
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function runJob(job) {
  update(job, { state: 'uploading', error: null });
  let received = job.received;
  let retries = 0;
  let rateLimitWaits = 0;
  while (received < job.size) {
    if (job.cancelled) return;
    const blob = job.file.slice(received, received + Math.min(chunkSize, maxChunk));
    try {
      const started = performance.now();
      const res = await sendChunk(job, received, blob);
      const seconds = (performance.now() - started) / 1000;
      if (blob.size >= MB && seconds > 0) {
        const ideal = (blob.size / seconds) * TARGET_CHUNK_SECONDS;
        chunkSize = Math.max(SMALL_CHUNK, Math.min(BIG_CHUNK, Math.round(ideal / MB) * MB || SMALL_CHUNK));
      }
      received = res.received;
      retries = 0;
      rateLimitWaits = 0;
      update(job, { state: 'uploading', error: null, received, sent: received });
    } catch (err) {
      if (job.cancelled || err.aborted) return;
      if (err.status === 413 && Math.min(chunkSize, maxChunk) > SMALL_CHUNK) { maxChunk = SMALL_CHUNK; continue; }
      if (err.status === 409 && Number.isInteger(err.data?.received)) {
        received = err.data.received;
        update(job, { sent: received, received });
        if (err.data.retry) await wait(1500); // le serveur ferme le morceau precedent
        continue;
      }
      if (err.status === 429 && rateLimitWaits < MAX_RATE_LIMIT_WAITS) {
        rateLimitWaits += 1;
        const seconds = Math.min(600, err.retryAfter ?? DEFAULT_RATE_LIMIT_WAIT_S * Math.min(rateLimitWaits, 5));
        update(job, { state: 'retrying', error: `Limite de requêtes du proxy atteinte, reprise dans ${seconds} s…`, sent: received });
        await wait(seconds * 1000);
        if (job.cancelled) return;
        continue;
      }
      if (err.status === 401 || err.status === 404 || retries >= MAX_RETRIES || !(err.network || err.status >= 500)) {
        update(job, { state: 'error', error: err.message, sent: received, received });
        return;
      }
      retries += 1;
      if (err.network) chunkSize = Math.max(SMALL_CHUNK, Math.floor(chunkSize / 2 / MB) * MB);
      update(job, { state: 'retrying', error: `${err.message}, nouvel essai…`, sent: received });
      await wait(Math.min(30000, 1000 * 2 ** retries));
      // Le serveur a peut-etre recu une partie du morceau : la reponse 409 donnera la bonne position.
    }
  }
  update(job, { state: 'done', received: job.size, sent: job.size });
  api.invalidate();
  // Le panneau disparait quelques secondes apres la fin du dernier envoi.
  setTimeout(() => { if (!hasActiveUploads()) clearFinished(); }, 8000);
}

async function pump() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = jobs.find((j) => j.state === 'queued');
      if (!next) break;
      await runJob(next);
    }
  } finally {
    running = false;
  }
}

/** Ajoute l'envoi d'un fichier pour un episode deja cree (reprend a episode.received). */
export function enqueueUpload(episode, file) {
  if (!episode.thumb_url) thumbnailFromFile(episode.id, file);
  jobs = jobs.filter((j) => j.episodeId !== episode.id);
  jobs.push({
    episodeId: episode.id, seriesId: episode.series_id, name: file.name, file,
    size: episode.video_size, received: episode.received || 0, sent: episode.received || 0,
    state: 'queued', error: null,
  });
  emit();
  pump();
}

export function cancelUpload(episodeId) {
  const job = jobs.find((j) => j.episodeId === episodeId);
  if (!job) return;
  job.cancelled = true;
  job.xhr?.abort();
  jobs = jobs.filter((j) => j !== job);
  emit();
}

export function retryUpload(episodeId) {
  const job = jobs.find((j) => j.episodeId === episodeId);
  if (job && job.state === 'error') { update(job, { state: 'queued', error: null }); pump(); }
}

export function clearFinished() {
  jobs = jobs.filter((j) => j.state !== 'done');
  emit();
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function useUploads() {
  return useSyncExternalStore(subscribe, () => jobs);
}

export const hasActiveUploads = () => jobs.some((j) => ['queued', 'uploading', 'retrying'].includes(j.state));

window.addEventListener('beforeunload', (e) => {
  if (hasActiveUploads()) { e.preventDefault(); e.returnValue = ''; }
});
