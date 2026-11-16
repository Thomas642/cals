// Conversion des sous-titres en WebVTT, seul format lu nativement par la balise <track> des navigateurs.
// Formats acceptes : SRT, WebVTT, ASS/SSA (styles, positions et effets ASS ignores : texte seul).

export const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'ass', 'ssa'];

function normalize(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

function vttTime(totalMs) {
  const ms = Math.max(0, Math.round(totalMs));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

// Le texte d'une replique ne doit pas contenir de ligne vide ni "-->" (sinon le parseur VTT coupe la replique).
function cleanCueText(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/-->/g, '→');
}

function srtToVtt(src) {
  const cues = [];
  const timing = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  const toMs = (h, m, s, f) => ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(f.padEnd(3, '0'));
  for (const block of src.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => timing.test(l));
    if (i < 0) continue;
    const t = lines[i].match(timing);
    const text = cleanCueText(lines.slice(i + 1).join('\n'));
    if (!text) continue;
    cues.push(`${vttTime(toMs(t[1], t[2], t[3], t[4]))} --> ${vttTime(toMs(t[5], t[6], t[7], t[8]))}\n${text}`);
  }
  return cues;
}

function assTime(v) {
  const m = String(v).trim().match(/^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number((m[4] || '0').padEnd(3, '0').slice(0, 3));
}

function assToVtt(src) {
  const items = [];
  let inEvents = false;
  let format = null;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const fields = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const parts = line.slice(line.indexOf(':') + 1).split(',');
    // Le dernier champ (Text) peut contenir des virgules : on le recolle.
    const values = parts.slice(0, fields.length - 1).concat(parts.slice(fields.length - 1).join(','));
    const get = (name) => values[fields.indexOf(name)];
    const start = assTime(get('start'));
    const end = assTime(get('end'));
    if (start === null || end === null || end <= start) continue;
    const text = cleanCueText(String(get('text') ?? '')
      .replace(/\{[^}]*\}/g, '')          // balises de style {\i1}, {\pos(...)}, ...
      .replace(/\\N/gi, '\n')
      .replace(/\\h/g, ' ')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    if (!text) continue;
    items.push({ start, end, text });
  }
  items.sort((a, b) => a.start - b.start);
  return items.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`);
}

/** Convertit le contenu d'un fichier de sous-titres en WebVTT. Leve une erreur 400 si rien n'est lisible. */
export function toWebVtt(content, extension) {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  const src = normalize(content);
  let out;
  if (ext === 'vtt') {
    if (!/^WEBVTT/.test(src)) throw Object.assign(new Error('Fichier VTT invalide (doit commencer par WEBVTT)'), { status: 400 });
    out = src.endsWith('\n') ? src : `${src}\n`;
    if (!out.includes('-->')) out = null;
  } else if (ext === 'srt') {
    const cues = srtToVtt(src);
    out = cues.length ? `WEBVTT\n\n${cues.join('\n\n')}\n` : null;
  } else if (ext === 'ass' || ext === 'ssa') {
    const cues = assToVtt(src);
    out = cues.length ? `WEBVTT\n\n${cues.join('\n\n')}\n` : null;
  } else {
    throw Object.assign(new Error(`Format non pris en charge (.${ext}). Formats acceptes : ${SUBTITLE_EXTENSIONS.join(', ')}`), { status: 400 });
  }
  if (!out) throw Object.assign(new Error('Aucune replique lisible dans ce fichier de sous-titres'), { status: 400 });
  return out;
}
