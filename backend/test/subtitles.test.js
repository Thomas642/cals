import test from 'node:test';
import assert from 'node:assert/strict';
import { toWebVtt } from '../src/lib/subtitles.js';

test('SRT -> VTT : horodatages, BOM, CRLF, lignes multiples', () => {
  const srt = '﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nBonjour\r\n\r\n2\r\n00:01:02,05 --> 00:01:04,100\r\nLigne 1\r\nLigne 2\r\n';
  assert.equal(toWebVtt(srt, 'srt'),
    'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nBonjour\n\n00:01:02.050 --> 00:01:04.100\nLigne 1\nLigne 2\n');
});

test('ASS -> VTT : balises retirees, \\N, virgules dans le texte, tri', () => {
  const ass = `[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:05.00,0:00:06.50,Default,,0,0,0,,{\\i1}Deuxieme{\\i0}, avec virgule
Dialogue: 0,0:00:01.20,0:00:02.00,Default,,0,0,0,,Premiere\\Nligne <2>
Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,ignoree
`;
  assert.equal(toWebVtt(ass, 'ass'),
    'WEBVTT\n\n00:00:01.200 --> 00:00:02.000\nPremiere\nligne &lt;2&gt;\n\n00:00:05.000 --> 00:00:06.500\nDeuxieme, avec virgule\n');
});

test('VTT conserve, formats et contenus invalides refuses', () => {
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:01.000\nSalut\n';
  assert.equal(toWebVtt(vtt, 'vtt'), vtt);
  assert.throws(() => toWebVtt('pas un vtt', 'vtt'), /WEBVTT/);
  assert.throws(() => toWebVtt('rien', 'srt'), /Aucune replique/);
  assert.throws(() => toWebVtt('x', 'sub'), /non pris en charge/);
});

test('migration : une base de la premiere version recoit les colonnes cover_file et thumb_file', async () => {
  const { default: Database } = await import('better-sqlite3');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { openDatabase } = await import('../src/db.js');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'old.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE series (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE episode (id INTEGER PRIMARY KEY, series_id INTEGER NOT NULL, number REAL, title TEXT, original_name TEXT, video_file TEXT,
      video_mime TEXT, video_size INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'uploading', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO series (title) VALUES ('Ancienne');`);
  old.close();
  const db = openDatabase(file);
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  assert.ok(cols('series').includes('cover_file'));
  assert.ok(cols('episode').includes('thumb_file'));
  assert.equal(db.prepare('SELECT title FROM series').get().title, 'Ancienne');
  db.close();
});
