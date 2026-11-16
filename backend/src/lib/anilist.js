// Fiches de series depuis l'API publique AniList (GraphQL), a la demande d'un administrateur.
// Conditions AniList (consultees en novembre 2026) : gratuit pour un usage non commercial ; interdit pour un
// service concurrent de liste/suivi, pour la collecte massive et comme stockage. On ne fait que des
// recherches ponctuelles, une fiche a la fois.
const ENDPOINT = 'https://graphql.anilist.co';

const GENRES_FR = {
  Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Ecchi: 'Ecchi', Fantasy: 'Fantasy',
  Horror: 'Horreur', 'Mahou Shoujo': 'Magical girl', Mecha: 'Mecha', Music: 'Musique', Mystery: 'Mystère',
  Psychological: 'Psychologique', Romance: 'Romance', 'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie',
  Sports: 'Sport', Supernatural: 'Surnaturel', Thriller: 'Thriller',
};

const FIELDS = `id siteUrl format episodes seasonYear startDate { year } genres
  title { romaji english native } coverImage { extraLarge large color } bannerImage description(asHtml: false)`;

async function query(q, variables) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: q, variables }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error('AniList injoignable depuis le serveur'), { status: 502 });
  }
  if (res.status === 429) throw Object.assign(new Error('AniList limite le nombre de requêtes : réessaie dans une minute'), { status: 429 });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.errors) {
    throw Object.assign(new Error(data?.errors?.[0]?.message ? `AniList : ${data.errors[0].message}` : `AniList a répondu ${res.status}`), { status: 502 });
  }
  return data.data;
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', uuml: 'ü', ouml: 'ö',
};
const decodeEntities = (t) => t
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** Synopsis sans HTML ni notes de source (« (Source: ...) », « Notes: »). */
export function cleanDescription(text) {
  if (!text) return null;
  const plain = decodeEntities(String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .split(/\n?\s*\((?:Source|Sources)\s*:|\n\s*Notes?\s*:/i)[0]
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain.slice(0, 4000) || null;
}

const view = (m) => ({
  id: m.id,
  url: m.siteUrl,
  title: m.title.english || m.title.romaji,
  romaji: m.title.romaji,
  native: m.title.native,
  year: m.seasonYear || m.startDate?.year || null,
  format: m.format,
  episodes: m.episodes,
  genres: (m.genres || []).map((g) => GENRES_FR[g] || g),
  cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
  cover_small: m.coverImage?.large || null,
  color: m.coverImage?.color || null,
  banner: m.bannerImage || null,
  description: cleanDescription(m.description),
});

export async function searchAnime(text) {
  const data = await query(`query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } } }`, { q: text });
  return data.Page.media.map(view);
}

export async function getAnime(id) {
  const data = await query(`query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`, { id });
  if (!data.Media) throw Object.assign(new Error('Fiche AniList introuvable'), { status: 404 });
  return view(data.Media);
}

/** Telecharge l'affiche (image JPEG/PNG/WebP, 8 Mo max). */
export async function downloadImage(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)anilist\.co$/.test(u.hostname)) throw Object.assign(new Error('Adresse d\'image refusée'), { status: 400 });
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`Affiche indisponible (HTTP ${res.status})`), { status: 502 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw Object.assign(new Error('Affiche trop lourde'), { status: 413 });
  return buf;
}
