// Gestionnaire d'envois de videos : file d'attente globale (on peut naviguer pendant l'envoi),
// envoi par morceaux avec reprise automatique apres une coupure reseau.
import { useSyncExternalStore } from 'react';
import { api, errorFromResponse, parseRetryAfter } from './api.js';

const BIG_CHUNK = 16 * 1024 * 1024;
// Repli si un proxy refuse les gros morceaux (ex. nginx de l'hote avec client_max_body_size 2M) :
// juste sous 2 Mo, pour limiter le nombre de requetes.
const SMALL_CHUNK = 2 * 1024 * 1024 - 64 * 1024;
const MAX_RETRIES = 6;
// Limite de requetes d'un proxy (429) : on attend puis on reprend, sans abandonner trop vite.
const MAX_RATE_LIMIT_WAITS = 30;
const DEFAULT_RATE_LIMIT_WAIT_S = 60;

let chunkSize = BIG_CHUNK;
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
    xhr.upload.onprogress = (e) => update(job, { sent: offset + e.loaded });
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* reponse non JSON (proxy) */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(errorFromResponse(xhr.status, data, parseRetryAfter(xhr.getResponseHeader('Retry-After'))));
    };
    xhr.onerror = () => reject(Object.assign(new Error('Connexion perdue'), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error('Envoi annulé'), { aborted: true }));
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
    const blob = job.file.slice(received, received + chunkSize);
    try {
      const res = await sendChunk(job, received, blob);
      received = res.received;
      retries = 0;
      rateLimitWaits = 0;
      update(job, { state: 'uploading', error: null, received, sent: received });
    } catch (err) {
      if (job.cancelled || err.aborted) return;
      if (err.status === 413 && chunkSize > SMALL_CHUNK) { chunkSize = SMALL_CHUNK; continue; }
      if (err.status === 409 && Number.isInteger(err.data?.received)) { received = err.data.received; continue; }
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
