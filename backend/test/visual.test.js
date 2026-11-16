import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dominantColor, ffmpegAvailable, readableAccent } from '../src/lib/media.js';
import { cleanDescription } from '../src/lib/anilist.js';

const hue = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test('couleur d ambiance : teinte dominante, eclaircie pour le fond sombre', { skip: !(await ffmpegAvailable()) && 'ffmpeg absent' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accent-'));
  // Image surtout bleue avec une bande grise : le gris est ignore, la teinte bleue l'emporte.
  const img = path.join(dir, 'blue.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x1e3a8a:s=120x80', '-f', 'lavfi', '-i', 'color=c=gray:s=40x80',
    '-filter_complex', '[0][1]hstack', '-frames:v', '1', img]);
  const c = await dominantColor(img);
  assert.match(c, /^#[0-9a-f]{6}$/);
  assert.ok(Math.abs(hue(c) - hue('#1e3a8a')) < 12, `teinte ${hue(c)}`);
  // Image entierement grise : pas de couleur d'ambiance.
  const gray = path.join(dir, 'gray.png');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64', '-frames:v', '1', gray]);
  assert.equal(await dominantColor(gray), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readableAccent : meme teinte, luminosite 62 %', () => {
  const c = readableAccent(0.1, 0.05, 0.3); // violet tres sombre
  assert.ok(Math.abs(hue(c) - 252) < 3);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  assert.ok(Math.round((Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 2.55) >= 60);
});

test('synopsis AniList : HTML, source et notes retires', () => {
  const raw = 'Subaru is <i>lost</i> &amp; rescued.<br>\n<br>\n(Source: Anime News Network)\n<br><br>\n<i>Notes:<br>- first episode 50 min</i>';
  assert.equal(cleanDescription(raw), 'Subaru is lost & rescued.');
  assert.equal(cleanDescription('Line one.<br><br>Line two.\n\nNotes: x'), 'Line one.\n\nLine two.');
  assert.equal(cleanDescription(null), null);
  assert.equal(cleanDescription('No Man&rsquo;s Land &#8212; it&#x27;s &hellip; &unknown;'), 'No Man’s Land — it\'s … &unknown;');
});
