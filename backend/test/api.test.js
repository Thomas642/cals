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
const server = createApp(db, { mediaDir, maxVideoBytes: 1024 * 1024, processing: false }).listen(0);
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
  assert.deepEqual((await call('GET', '/auth/status')).body, { configured: false, authenticated: false, user: null });
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

test('comptes : creation par un admin, spectateur en lecture seule, progression par compte', async () => {
  const s = (await call('POST', '/series', { title: 'Comptes' })).body;
  const e = (await call('POST', `/series/${s.id}/episodes`, { filename: 'c.mp4', size: 3, number: 1 })).body;
  await call('PUT', `/episodes/${e.id}/upload?offset=0`, undefined, { raw: Buffer.from('abc'), headers: { 'Content-Type': 'application/octet-stream' } });
  const pending = (await call('POST', `/series/${s.id}/episodes`, { filename: 'p.mp4', size: 3, number: 2 })).body;

  assert.equal((await call('POST', '/users', { username: 'x', password: 'motdepasse2' })).status, 400);
  assert.equal((await call('POST', '/users', { username: 'lea', password: 'court' })).status, 400);
  const created = await call('POST', '/users', { username: 'Lea', password: 'motdepasse2', display_name: 'Léa' });
  assert.equal(created.status, 201);
  assert.equal(created.body.role, 'viewer');
  assert.equal((await call('POST', '/users', { username: 'lea', password: 'motdepasse2' })).status, 409);
  const adminCookie = cookie;

  // Connexion du spectateur (identifiant insensible a la casse).
  cookie = '';
  const login = await call('POST', '/auth/login', { username: 'lea', password: 'motdepasse2' });
  assert.equal(login.status, 200);
  const { settings, ...who } = (await call('GET', '/auth/status')).body.user;
  assert.deepEqual(who, { id: created.body.id, username: 'Lea', display_name: 'Léa', role: 'viewer' });
  assert.equal(settings.autoplay, true);
  const detail = (await call('GET', `/series/${s.id}`)).body;
  assert.deepEqual(detail.episodes.map((x) => x.id), [e.id]); // episode non termine cache
  assert.equal(detail.episodes[0].original_name, undefined);
  assert.equal((await call('GET', `/episodes/${pending.id}`)).status, 404);
  assert.equal((await call('GET', `/media/video/${e.id}`)).headers.get('content-disposition'), 'inline');
  for (const [m, p, b] of [['POST', '/series', { title: 'Non' }], ['DELETE', `/episodes/${e.id}`], ['PUT', `/series/${s.id}`, { title: 'Non' }],
    ['GET', '/users'], ['GET', '/storage'], ['POST', `/episodes/${e.id}/subtitles`, { filename: 'a.srt', content: 'x' }]]) {
    const r = await call(m, p, b);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.body.code, 'admin_required');
  }
  assert.equal((await call('PUT', `/progress/${e.id}`, { pos: 300, dur: 1440 })).status, 204);
  const prog = (await call('GET', '/progress')).body;
  assert.equal(prog.length, 1);
  assert.equal(prog[0].pos, 300);
  assert.equal(prog[0].series_title, 'Comptes');
  assert.equal(prog[0].watched, false);
  await call('PUT', `/progress/${e.id}`, { pos: 1400, dur: 1440 });
  assert.equal((await call('GET', '/progress')).body[0].watched, true);
  assert.equal((await call('PUT', '/me/password', { current: 'faux', password: 'nouveau-mdp' })).status, 400);
  assert.equal((await call('PUT', '/me/password', { current: 'motdepasse2', password: 'nouveau-mdp' })).status, 204);

  // La progression est propre a chaque compte.
  cookie = adminCookie;
  assert.deepEqual((await call('GET', '/progress')).body, []);

  // Desactivation : le spectateur est deconnecte et ne peut plus se connecter.
  const viewerCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('PUT', `/users/${created.body.id}`, { disabled: true })).body.disabled, true);
  cookie = viewerCookie;
  assert.equal((await call('GET', '/series')).status, 401);
  cookie = '';
  assert.equal((await call('POST', '/auth/login', { username: 'lea', password: 'nouveau-mdp' }, { withCookie: false })).status, 401);
  cookie = adminCookie;

  // Garde-fous : dernier administrateur, propre compte.
  const me = (await call('GET', '/auth/status')).body.user;
  assert.equal((await call('PUT', `/users/${me.id}`, { role: 'viewer' })).status, 409);
  assert.equal((await call('DELETE', `/users/${me.id}`)).status, 409);
  assert.equal((await call('DELETE', `/users/${created.body.id}`)).status, 204);
});

test('migration : l ancien identifiant unique devient administrateur et garde ses sessions', async () => {
  const { default: Database } = await import('better-sqlite3');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-auth-')), 'old.db');
  const old = new Database(file);
  const { hashPassword } = await import('../src/lib/auth.js');
  old.exec(`CREATE TABLE auth_user (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE auth_session (token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, persistent INTEGER NOT NULL DEFAULT 1);`);
  old.prepare('INSERT INTO auth_user (id, username, password_hash) VALUES (1, ?, ?)').run('papa', hashPassword('ancien-mdp'));
  old.prepare("INSERT INTO auth_session (token_hash, expires_at) VALUES ('t', datetime('now', '+1 day'))").run();
  old.close();
  const migrated = openDatabase(file);
  const u = migrated.prepare('SELECT * FROM app_user').get();
  assert.equal(u.username, 'papa');
  assert.equal(u.role, 'admin');
  assert.equal(migrated.prepare('SELECT user_id FROM auth_session').get().user_id, u.id);
  migrated.close();
});

test('tableau de bord : reserve aux administrateurs, chiffres coherents', async () => {
  const s = (await call('POST', '/series', { title: 'Tableau' })).body;
  const e = (await call('POST', `/series/${s.id}/episodes`, { filename: 't.mp4', size: 4, number: 1 })).body;
  await call('PUT', `/episodes/${e.id}/upload?offset=0`, undefined, { raw: Buffer.from('abcd'), headers: { 'Content-Type': 'application/octet-stream' } });
  const half = (await call('POST', `/series/${s.id}/episodes`, { filename: 'moitie.mp4', size: 10, number: 2 })).body;
  await call('PUT', `/episodes/${half.id}/upload?offset=0`, undefined, { raw: Buffer.from('abc'), headers: { 'Content-Type': 'application/octet-stream' } });

  const ov = await call('GET', '/admin/overview');
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  const o = ov.body;
  assert.ok(o.disk.total > 0 && o.disk.free > 0 && o.disk.free <= o.disk.total);
  assert.ok(o.media.videos >= 4);
  const row = o.library.by_series.find((x) => x.id === s.id);
  assert.deepEqual({ episodes: row.episodes, bytes: row.bytes }, { episodes: 1, bytes: 7 }); // 4 octets en ligne + 3 en cours
  assert.ok(o.library.without_subtitles.some((x) => x.id === e.id));
  const inc = o.incomplete.find((x) => x.id === half.id);
  assert.deepEqual({ received: inc.received, size: inc.size, name: inc.original_name }, { received: 3, size: 10, name: 'moitie.mp4' });
  assert.ok(o.server.cpus >= 1 && o.server.memory.total > 0);
  assert.ok(o.users.total >= 1);

  // Un spectateur n'y a pas acces.
  const adminCookie = cookie;
  await call('POST', '/users', { username: 'spectateur2', password: 'motdepasse3' });
  cookie = '';
  await call('POST', '/auth/login', { username: 'spectateur2', password: 'motdepasse3' });
  assert.equal((await call('GET', '/admin/overview')).status, 403);
  cookie = adminCookie;
});

test('lecteur et bibliotheque : reglages, generique, saisons, ordre, deplacement, ma liste, nouveautes, statistiques', async () => {
  const s = (await call('POST', '/series', { title: 'Saisons' })).body;
  const other = (await call('POST', '/series', { title: 'Autre serie' })).body;
  const mk = async (n, season) => {
    const e = (await call('POST', `/series/${s.id}/episodes`, { filename: `s${season}e${n}.mp4`, size: 1, number: n, season })).body;
    await call('PUT', `/episodes/${e.id}/upload?offset=0`, undefined, { raw: Buffer.from('x'), headers: { 'Content-Type': 'application/octet-stream' } });
    return e.id;
  };
  const a = await mk(1, 1); const b = await mk(2, 1); const c = await mk(1, 2);

  // Reglages par compte
  assert.equal((await call('PUT', '/me/settings', { subtitles: { size: 'xxl' } })).status, 400);
  const st = (await call('PUT', '/me/settings', { autoplay: false, subtitles: { size: 'l', bg: 0.85, position: 'top' } })).body;
  assert.deepEqual(st, { autoplay: false, subtitles: { size: 'l', bg: 0.85, position: 'top' } });
  assert.deepEqual((await call('GET', '/auth/status')).body.user.settings, st);

  // Generique : serie par defaut, episode qui le remplace
  assert.equal((await call('PUT', `/series/${s.id}/intro`, { start: 90, end: 80 })).status, 400);
  await call('PUT', `/series/${s.id}/intro`, { start: 60, end: 150 });
  assert.deepEqual((await call('GET', `/episodes/${a}`)).body.intro, { start: 60, end: 150, scope: 'series' });
  await call('PUT', `/episodes/${a}/intro`, { start: 10, end: 99.94 });
  assert.deepEqual((await call('GET', `/episodes/${a}`)).body.intro, { start: 10, end: 99.9, scope: 'episode' });
  await call('PUT', `/episodes/${a}/intro`, { start: null, end: null });
  assert.equal((await call('GET', `/episodes/${a}`)).body.intro.scope, 'series');

  // Saisons et ordre manuel
  let eps = (await call('GET', `/series/${s.id}`)).body.episodes;
  assert.deepEqual(eps.map((e) => [e.season, e.number]), [[1, 1], [1, 2], [2, 1]]);
  assert.equal((await call('PUT', `/series/${s.id}/order`, { episodes: [b, a, 99999] })).status, 400);
  eps = (await call('PUT', `/series/${s.id}/order`, { episodes: [b, a, c] })).body.episodes;
  assert.deepEqual(eps.map((e) => e.id), [b, a, c]);
  assert.equal((await call('GET', `/episodes/${b}`)).body.next_id, a);
  await call('PUT', `/series/${s.id}`, { title: 'Saisons', season_names: { 1: 'Arc 1 · Le début', 2: '' } });
  assert.deepEqual((await call('GET', `/series/${s.id}`)).body.season_names, { 1: 'Arc 1 · Le début' });

  // Deplacement vers une autre serie
  await call('PUT', `/episodes/${c}`, { series_id: other.id, season: 1 });
  assert.deepEqual((await call('GET', `/series/${other.id}`)).body.episodes.map((e) => e.id), [c]);

  // Ma liste
  await call('PUT', `/watchlist/${s.id}`);
  assert.equal((await call('GET', '/series')).body.find((x) => x.id === s.id).in_list, true);
  await call('DELETE', `/watchlist/${s.id}`);
  assert.equal((await call('GET', '/series')).body.find((x) => x.id === s.id).in_list, false);

  // Nouveautes : un episode mis en ligne apres la visite precedente est « nouveau »
  db.prepare("UPDATE app_user SET prev_visit_at = datetime('now', '-1 day'), last_visit_at = datetime('now')").run();
  db.prepare("UPDATE episode SET ready_at = datetime('now', '-2 days') WHERE id != ?").run(b);
  const recent = (await call('GET', '/recent')).body;
  assert.equal(recent[0].id, b);
  assert.equal(recent[0].is_new, true);
  assert.equal(recent.find((x) => x.id === a).is_new, false);
  assert.equal((await call('GET', '/series')).body.find((x) => x.id === s.id).new_count, 1);

  // Temps regarde et episode termine (statistiques)
  await call('PUT', `/progress/${a}`, { pos: 100, dur: 1440, delta: 30 });
  await call('PUT', `/progress/${a}`, { pos: 1420, dur: 1440, delta: 500 }); // delta borne a 120
  const row = db.prepare('SELECT * FROM watch_progress WHERE episode_id = ?').get(a);
  assert.equal(row.seconds_watched, 150);
  assert.equal(row.completions, 1);
  assert.equal(row.watched, 1);
  // Vu a la main : compte comme vu, pas comme une lecture complete
  await call('PUT', `/progress/${b}`, { pos: 0, dur: 0, watched: true, manual: true });
  assert.equal(db.prepare('SELECT completions FROM watch_progress WHERE episode_id = ?').get(b).completions, 0);

  // Statistiques du tableau de bord
  const stats = (await call('GET', '/admin/overview')).body.stats;
  const me = stats.by_user.find((u) => u.username === 'moi');
  assert.equal(me.seconds, 150);
  assert.equal(me.completed, 1);
  const top = stats.top_episodes.find((x) => x.id === a);
  assert.deepEqual({ viewers: top.viewers, completions: top.completions, seconds: top.seconds }, { viewers: 1, completions: 1, seconds: 150 });
  assert.equal(stats.by_series.find((x) => x.id === s.id).seconds, 150);
});
