// Outils sur les fichiers importes : type, numero d'episode devine depuis le nom, lecture des sous-titres.

export const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mkv', 'mov'];
export const SUBTITLE_EXT = ['srt', 'vtt', 'ass', 'ssa'];

export const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
export const isVideo = (f) => VIDEO_EXT.includes(extOf(f.name));
export const isSubtitle = (f) => SUBTITLE_EXT.includes(extOf(f.name));

/**
 * Devine le numero d'episode depuis un nom de fichier, ex. :
 * "[Groupe] Titre - 03 [1080p].mkv" -> 3, "Titre S01E12.mp4" -> 12, "Titre 第5話.mp4" -> 5.
 * Retourne null si aucun numero fiable n'est trouve.
 */
export function guessEpisodeNumber(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_.]+/g, ' ');
  const explicit = base.match(/(?:\bS\d{1,2}\s*E|\bEP?\.?\s*|\bEpisode\s*|第\s*)(\d{1,4})(?:\.\d)?/i);
  if (explicit) return Number(explicit[1]);
  const cleaned = base
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')                 // [Groupe], (1080p), {...}
    .replace(/\b\d{3,4}p\b|\b[xh]\.?26[45]\b|\b10\s?bits?\b|\b(19|20)\d{2}\b|\bS\d{1,2}\b/gi, ' ');
  const dash = cleaned.match(/\s-\s*(\d{1,4})(?:v\d)?\b/);
  if (dash) return Number(dash[1]);
  const nums = cleaned.match(/\b\d{1,4}\b/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}

/**
 * Langue devinee depuis le DERNIER mot du nom (ex. "ep01.fr.srt", "ep01_eng.ass", "ep01 [ja].srt").
 * Un mot comme "JP" ailleurs dans le nom ("ARC 01 - EP 1 - JP - FR.srt") designe souvent l'audio : ignore.
 * Francais par defaut.
 */
export function guessSubtitleLang(name) {
  const tokens = name.toLowerCase().replace(/\.[^.]+$/, '').split(/[^a-z]+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (['en', 'eng', 'english'].includes(last)) return { lang: 'en', label: 'English' };
  if (['ja', 'jpn', 'japanese'].includes(last)) return { lang: 'ja', label: '日本語' };
  return { lang: 'fr', label: 'Français' };
}

export const SUBTITLE_LANGS = [
  { lang: 'fr', label: 'Français' },
  { lang: 'en', label: 'English' },
  { lang: 'ja', label: '日本語' },
];

/** Lit un fichier texte en UTF-8, UTF-16 (BOM) ou, a defaut, Windows-1252 (anciens SRT francais). */
export async function readTextFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function formatBytes(n) {
  if (n === null || n === undefined) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${units[i]}`;
}

export const episodeLabel = (e) => {
  const num = e.number !== null && e.number !== undefined ? `Épisode ${String(e.number).replace('.', ',')}` : 'Épisode';
  return e.title ? `${num} · ${e.title}` : num;
};

// Teinte stable par titre (vignettes sans image).
export function hueOf(title) {
  let h = 0;
  for (const c of String(title)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}
