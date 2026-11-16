import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { setCredentials } from '../src/lib/auth.js';
import { ffmpegAvailable, plan, probe } from '../src/lib/media.js';

const hasFfmpeg = await ffmpegAvailable();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function make(name, args) {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, out]);
  return out;
}

test('plan : MP4 H.264 lisible, MKV a re-emballer, codec video a convertir', { skip: !hasFfmpeg && 'ffmpeg absent' }, async () => {
  const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3'];
  const mp4 = make('ok.mp4', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  assert.equal(plan(await probe(mp4)).action, 'none');
  const mkv = make('flac.mkv', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'flac']);
  assert.equal(plan(await probe(mkv)).action, 'remux');
  const mpeg4 = make('old.mp4', [...src, '-c:v', 'mpeg4', '-c:a', 'aac']);
  const p = plan(await probe(mpeg4));
  assert.equal(p.action, 'transcode');
  assert.match(p.reason, /mpeg4/);
});

test('traitement complet : conversion, miniature, sous-titres integres extraits', { skip: !hasFfmpeg && 'ffmpeg absent' }, async () => {
  const ass = path.join(tmp, 'subs.ass');
  fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.50,0:00:02.00,Default,,0,0,0,,{\\i1}Bonjour{\\i0} Subaru\n`);
  const video = make('ep.mkv', ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-i', ass, '-t', '3', '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'mpeg4', '-c:a', 'flac', '-c:s', 'ass',
    '-metadata:s:s:0', 'language=fre']);

  const mediaDir = path.join(tmp, 'media');
  const db = openDatabase(':memory:');
  setCredentials(db, 'moi', 'motdepasse1');
  const app = createApp(db, { mediaDir, processing: true });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'moi', password: 'motdepasse1' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const json = (p, opts = {}) => fetch(base + p, { ...opts, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(opts.headers || {}) } }).then((r) => r.json());
    const s = await json('/series', { method: 'POST', body: JSON.stringify({ title: 'Re:Zero' }) });
    const buf = fs.readFileSync(video);
    const e = await json(`/series/${s.id}/episodes`, { method: 'POST', body: JSON.stringify({ filename: 'Re Zero - 01.mkv', size: buf.length, number: 1 }) });
    const up = await json(`/episodes/${e.id}/upload?offset=0`, { method: 'PUT', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal(up.status, 'ready');

    let ep;
    for (let i = 0; i < 300; i += 1) {
      ep = await json(`/episodes/${e.id}`);
      if (ep.processing === 'done' || ep.processing === 'failed') break;
      await new Promise((r) => { setTimeout(r, 100); });
    }
    assert.equal(ep.processing, 'done', ep.processing_error);
    assert.equal(ep.video_mime, 'video/mp4');
    assert.equal(ep.media.converted, 'transcode');
    assert.ok(ep.thumb_url);
    // Planche d'apercus : 10 images minimum pour une video de 3 s, en grille de 10 colonnes.
    assert.equal(ep.storyboard.count, 10);
    assert.equal(ep.storyboard.cols, 10);
    assert.equal(ep.storyboard.w, 160);
    assert.equal(ep.storyboard.h, 90);
    const sb = await fetch(`${base}${ep.storyboard.url.replace(/^\/api/, '')}`, { headers: { Cookie: cookie } });
    assert.match(sb.headers.get('content-type'), /^image\/jpeg/);
    const sbFile = path.join(tmp, 'sb.jpg');
    const sbBuf = Buffer.from(await sb.arrayBuffer());
    fs.writeFileSync(sbFile, sbBuf);
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', sbFile]).toString().trim();
    assert.equal(dims, '1600,90');
    assert.equal(ep.subtitles.length, 1);
    assert.equal(ep.subtitles[0].lang, 'fr');
    assert.equal(ep.subtitles[0].label, 'Français (intégré)');

    // La video servie est maintenant du H.264 8 bits + AAC dans un MP4.
    const served = path.join(tmp, 'served.mp4');
    fs.writeFileSync(served, Buffer.from(await (await fetch(`${base}/media/video/${e.id}`, { headers: { Cookie: cookie } })).arrayBuffer()));
    const p = plan(await probe(served));
    assert.equal(p.action, 'none');
    assert.match(p.video, /^h264 yuv420p/);
    assert.equal(p.audio, 'aac');
    const vtt = await (await fetch(`${base}/media/subtitle/${ep.subtitles[0].id}`, { headers: { Cookie: cookie } })).text();
    assert.match(vtt, /<i>Bonjour<\/i> Subaru/);
    // Un seul fichier video reste sur le disque (l'original est supprime).
    assert.equal(fs.readdirSync(path.join(mediaDir, 'videos')).length, 1);
  } finally {
    server.close();
    db.close();
  }
});
