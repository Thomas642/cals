import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { setCredentials } from '../src/lib/auth.js';

const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'animes-test-'));
const db = openDatabase(':memory:');
const server = createApp(db, { mediaDir, maxVideoBytes: 1024 * 1024 }).listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => { server.close(); fs.rmSync(mediaDir, { recursive: true, force: true }); });

let cookie = '';
async function call(method, p, body, { withCookie = true, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && raw === undefined) h['Content-Type'] = 'application/json';
  if (withCookie && cookie) h.Cookie = cookie;
  const res = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && withCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: data, headers: res.headers };
}

test('authentification : non configuree, refus, connexion, deconnexion', async () => {
  assert.deepEqual((await call('GET', '/auth/status')).body, { configured: false, authenticated: false, username: null });
  assert.equal((await call('GET', '/series')).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'moi', password: 'motdepasse1' })).status, 503);
  setCredentials(db, 'moi', 'motdepasse1');
  assert.equal((await call('POST', '/auth/login', { username: 'moi', password: 'faux-mdp' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { username: 'moi', password: 'motdepasse1' })).status, 200);
  assert.equal((await call('GET', '/series')).status, 200);
  await call('POST', '/auth/logout');
  cookie = '';
  assert.equal((await call('GET', '/series')).status, 401);
  assert.equal((await call('GET', '/media/video/1')).status, 401);
  await call('POST', '/auth/login', { username: 'moi', password: 'motdepasse1' });
});

test('serie, episode, envoi par morceaux avec reprise, lecture partielle', async () => {
  const s = await call('POST', '/series', { title: '  Mon anime ', description: 'Saison 1' });
  assert.equal(s.status, 201);
  assert.equal(s.body.title, 'Mon anime');
  assert.equal((await call('POST', '/series', { title: '' })).status, 400);

  const video = Buffer.alloc(300_000);
  for (let i = 0; i < video.length; i += 1) video[i] = i % 251;
  assert.equal((await call('POST', `/series/${s.body.id}/episodes`, { filename: 'ep1.avi', size: 10 })).status, 400);
  assert.equal((await call('POST', `/series/${s.body.id}/episodes`, { filename: 'ep1.mp4', size: 5 * 1024 * 1024 })).status, 413);
  const e = await call('POST', `/series/${s.body.id}/episodes`, { filename: 'Episode 01.mp4', size: video.length, number: 1, title: 'Le debut' });
  assert.equal(e.status, 201);
  assert.equal(e.body.status, 'uploading');
  const eid = e.body.id;

  const put = (offset, chunk) => call('PUT', `/episodes/${eid}/upload?offset=${offset}`, undefined,
    { raw: chunk, headers: { 'Content-Type': 'application/octet-stream' } });
  let r = await put(0, video.subarray(0, 100_000));
  assert.deepEqual(r.body, { received: 100_000, status: 'uploading' });
  // Mauvaise position : le serveur renvoie la position attendue pour reprendre.
  r = await put(0, video.subarray(0, 10));
  assert.equal(r.status, 409);
  assert.equal(r.body.received, 100_000);
  assert.equal((await call('GET', `/media/video/${eid}`)).status, 404);
  r = await put(100_000, Buffer.concat([video.subarray(100_000), Buffer.alloc(5)]));
  assert.equal(r.status, 400); // depasse la taille annoncee
  r = await put(100_000, video.subarray(100_000));
  assert.deepEqual(r.body, { received: video.length, status: 'ready' });
  assert.equal((await put(video.length, Buffer.alloc(1))).status, 409);

  const full = await call('GET', `/media/video/${eid}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.ok(full.body.equals(video));
  const part = await call('GET', `/media/video/${eid}`, undefined, { headers: { Range: 'bytes=1000-1999' } });
  assert.equal(part.status, 206);
  assert.ok(part.body.equals(video.subarray(1000, 2000)));

  const list = await call('GET', '/series');
  assert.equal(list.body[0].episode_count, 1);
});

test('sous-titres : import SRT converti en VTT, suppression, cascade', async () => {
  const s = (await call('POST', '/series', { title: 'Autre' })).body;
  const e = (await call('POST', `/series/${s.id}/episodes`, { filename: 'a.mkv', size: 4 })).body;
  await call('PUT', `/episodes/${e.id}/upload?offset=0`, undefined, { raw: Buffer.from('abcd'), headers: { 'Content-Type': 'application/octet-stream' } });

  assert.equal((await call('POST', `/episodes/${e.id}/subtitles`, { filename: 'a.txt', content: 'x' })).status, 400);
  const sub = await call('POST', `/episodes/${e.id}/subtitles`, {
    filename: 'a.fr.srt', content: '1\n00:00:01,000 --> 00:00:02,000\nSalut\n',
  });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.label, 'Français');
  assert.equal(sub.body.lang, 'fr');
  const vtt = await call('GET', `/media/subtitle/${sub.body.id}`);
  assert.match(vtt.headers.get('content-type'), /^text\/vtt/);
  assert.equal(vtt.body.toString(), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut\n');

  const detail = await call('GET', `/episodes/${e.id}`);
  assert.equal(detail.body.subtitles.length, 1);
  assert.equal(detail.body.series.title, 'Autre');

  assert.equal((await call('DELETE', `/series/${s.id}`)).status, 204);
  assert.equal((await call('GET', `/episodes/${e.id}`)).status, 404);
  assert.equal((await call('GET', `/media/subtitle/${sub.body.id}`)).status, 404);
  assert.deepEqual(fs.readdirSync(path.join(mediaDir, 'subtitles')), []);
});

test('episodes precedent / suivant', async () => {
  const s = (await call('POST', '/series', { title: 'Ordre' })).body;
  const ids = [];
  for (const n of [2, 1, 3]) {
    const e = (await call('POST', `/series/${s.id}/episodes`, { filename: `e${n}.webm`, size: 1, number: n })).body;
    await call('PUT', `/episodes/${e.id}/upload?offset=0`, undefined, { raw: Buffer.from('x'), headers: { 'Content-Type': 'application/octet-stream' } });
    ids[n] = e.id;
  }
  const mid = (await call('GET', `/episodes/${ids[2]}`)).body;
  assert.equal(mid.prev_id, ids[1]);
  assert.equal(mid.next_id, ids[3]);
  assert.deepEqual((await call('GET', `/series/${s.id}`)).body.episodes.map((e) => e.number), [1, 2, 3]);
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 2)]);

test('miniature d episode, affiche de serie (verification du type par les octets)', async () => {
  const s = (await call('POST', '/series', { title: 'Images' })).body;
  assert.equal(s.cover_url, null);
  const e = (await call('POST', `/series/${s.id}/episodes`, { filename: 'i.mp4', size: 1, number: 1 })).body;
  const img = (p, buf, type = 'image/jpeg') => call('PUT', p, undefined, { raw: buf, headers: { 'Content-Type': type } });

  assert.equal((await img(`/episodes/${e.id}/thumbnail`, Buffer.from('<svg></svg>'), 'image/svg+xml')).status, 400);
  const t = await img(`/episodes/${e.id}/thumbnail`, JPEG);
  assert.equal(t.status, 200);
  assert.match(t.body.thumb_url, new RegExp(`^/api/media/thumb/${e.id}\\?v=`));
  const got = await call('GET', t.body.thumb_url.replace(/^\/api/, ''));
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.ok(got.body.equals(JPEG));
  // Sans affiche importee, la serie prend la miniature du premier episode.
  assert.equal((await call('GET', `/series/${s.id}`)).body.cover_url, t.body.thumb_url);

  const c = await img(`/series/${s.id}/cover`, PNG, 'image/png');
  assert.equal(c.status, 200);
  assert.equal(c.body.has_custom_cover, true);
  assert.match(c.body.cover_url, new RegExp(`^/api/media/cover/${s.id}\\?v=`));
  assert.equal((await call('GET', c.body.cover_url.replace(/^\/api/, ''))).headers.get('content-type'), 'image/png');
  assert.equal((await img(`/series/${s.id}/cover`, Buffer.alloc(9 * 1024 * 1024, 0xff))).status, 413);
  const removed = await call('DELETE', `/series/${s.id}/cover`);
  assert.equal(removed.body.cover_url, t.body.thumb_url);

  assert.equal((await call('DELETE', `/series/${s.id}`)).status, 204);
  assert.deepEqual(fs.readdirSync(path.join(mediaDir, 'images')), []);
});

test('envoi : un morceau fige est coupe par le suivant, qui reprend a la bonne position', async () => {
  const s = (await call('POST', '/series', { title: 'Fige' })).body;
  const e = (await call('POST', `/series/${s.id}/episodes`, { filename: 'f.mp4', size: 10, number: 1 })).body;
  // Morceau annonce a 10 octets mais seulement 4 envoyes, connexion laissee ouverte.
  const http = await import('node:http');
  const stalled = http.request(`${base}/episodes/${e.id}/upload?offset=0`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream', 'Content-Length': 10 },
  });
  stalled.on('error', () => {});
  stalled.write(Buffer.from('abcd'));
  await new Promise((r) => { setTimeout(r, 150); });
  const put = (offset, chunk) => call('PUT', `/episodes/${e.id}/upload?offset=${offset}`, undefined,
    { raw: chunk, headers: { 'Content-Type': 'application/octet-stream' } });
  const first = await put(0, Buffer.from('abcdefghij'));
  assert.equal(first.status, 409);
  assert.equal(first.body.retry, true);
  await new Promise((r) => { setTimeout(r, 100); });
  const pos = (await call('GET', `/episodes/${e.id}`)).body.received;
  assert.equal(pos, 4);
  const done = await put(pos, Buffer.from('efghij'));
  assert.deepEqual(done.body, { received: 10, status: 'ready' });
  assert.equal((await call('GET', `/media/video/${e.id}`)).body.toString(), 'abcdefghij');
});
