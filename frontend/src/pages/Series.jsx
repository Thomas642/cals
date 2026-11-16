import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { enqueueUpload, useUploads } from '../uploads.js';
import {
  SUBTITLE_EXT, SUBTITLE_LANGS, VIDEO_EXT, episodeLabel, formatBytes, guessEpisodeNumber, guessSeason, guessSubtitleLang,
  accentStyle, friendlyError, isSubtitle, isVideo, readTextFile, seasonName,
} from '../files.js';
import { markUnwatched, markWatched, nextToWatch, progressOf, useProgress } from '../progress.js';
import { useManage } from '../manage.js';
import Icon from '../components/Icon.jsx';
import Poster from '../components/Poster.jsx';
import Thumb from '../components/Thumb.jsx';

const ACCEPT_ALL = [...VIDEO_EXT, ...SUBTITLE_EXT].map((e) => `.${e}`).join(',');
const ACCEPT_SUBS = SUBTITLE_EXT.map((e) => `.${e}`).join(',');
const ACCEPT_VIDEO = VIDEO_EXT.map((e) => `.${e}`).join(',');

async function uploadSubtitle(episodeId, file) {
  const content = await readTextFile(file);
  const { lang, label } = guessSubtitleLang(file.name);
  return api.post(`/episodes/${episodeId}/subtitles`, { filename: file.name, content, lang, label });
}

async function putImage(path, file) {
  const res = await fetch(`/api${path}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Erreur serveur (HTTP ${res.status})`);
  api.invalidate();
  return data;
}

export default function Series({ user }) {
  const { id } = useParams();
  const [poll, setPoll] = useState(false);
  const { data: series, error } = useApi(`/series/${id}`, { refreshMs: poll ? 4000 : 0 });
  const manage = useManage() && user.role === 'admin';
  const jobs = useUploads();
  useProgress();

  const [season, setSeason] = useState(null);
  const [dragId, setDragId] = useState(null);

  // Pendant une conversion, la page se rafraichit toute seule (progression, miniature, pistes extraites).
  useEffect(() => { setPoll(!!series?.episodes.some((e) => isProcessing(e))); }, [series]);
  useEffect(() => { setSeason(null); }, [id]);

  if (error) return <><BackLink /><p className="alert">{error.message}</p></>;
  if (!series) return <SeriesSkeleton />;

  const episodes = series.episodes;
  const ready = episodes.filter((e) => e.status === 'ready');
  const next = nextToWatch(episodes);
  const subtitled = ready.filter((e) => e.subtitles.length).length;
  const visible = episodes.filter((e) => manage || e.status === 'ready' || jobs.some((j) => j.episodeId === e.id));
  const seasons = [...new Set(visible.map((e) => e.season || 1))].sort((a, b) => a - b);
  // Saison affichee : choisie, sinon celle de l'episode a lancer, sinon la premiere.
  const current = seasons.includes(season) ? season : (seasons.includes(next?.episode.season) ? next.episode.season : seasons[0]);
  const shown = seasons.length > 1 ? visible.filter((e) => (e.season || 1) === current) : visible;
  const shownReady = shown.filter((e) => e.status === 'ready');
  const allSeen = shownReady.length > 0 && shownReady.every((e) => progressOf(e.id)?.watched);
  const info = (e) => ({ seriesId: series.id, seriesTitle: series.title, label: episodeLabel({ number: e.number }), thumb: e.thumb_url });

  function toggleSeason() {
    if (allSeen) shownReady.forEach((e) => markUnwatched(e.id));
    else shownReady.filter((e) => !progressOf(e.id)?.watched).forEach((e) => markWatched(e.id, e.media?.duration || 0, info(e), { manual: true }));
  }

  async function toggleList() {
    try { await api[series.in_list ? 'del' : 'put'](`/watchlist/${series.id}`); } catch (err) { window.alert(err.message); }
  }

  async function renameSeason() {
    const name = window.prompt(`Nom de la ${seasonName(series, current).toLowerCase().startsWith('saison') ? 'saison' : 'partie'} ${current} (vide pour « Saison ${current} ») :`, series.season_names?.[current] || '');
    if (name === null) return;
    try { await api.put(`/series/${series.id}`, { title: series.title, description: series.description, season_names: { ...series.season_names, [current]: name } }); } catch (err) { window.alert(err.message); }
  }

  // Glisser-deposer : nouvel ordre de la saison affichee, les autres saisons gardent le leur.
  async function dropOn(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const ids = shown.map((e) => e.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    const order = seasons.flatMap((n) => (n === current || seasons.length === 1 ? ids : visible.filter((e) => (e.season || 1) === n).map((e) => e.id)));
    setDragId(null);
    try { await api.put(`/series/${series.id}/order`, { episodes: order }); } catch (err) { window.alert(err.message); }
  }
  async function moveBy(e, delta) {
    const ids = shown.map((x) => x.id);
    const i = ids.indexOf(e.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const order = seasons.flatMap((n) => (n === current || seasons.length === 1 ? ids : visible.filter((x) => (x.season || 1) === n).map((x) => x.id)));
    try { await api.put(`/series/${series.id}/order`, { episodes: order }); } catch (err) { window.alert(err.message); }
  }

  return (
    <div className="themed" style={accentStyle(series.accent)}>
      <section className="series-hero">
        {/* Fond net : image de l'episode a lancer ; sinon l'affiche floutee. */}
        <div className="hero-media">
          {(next?.episode.thumb_url || ready.find((e) => e.thumb_url)?.thumb_url)
            ? <img className="hero-bg kenburns" src={next?.episode.thumb_url || ready.find((e) => e.thumb_url).thumb_url} alt="" />
            : series.cover_url && <img className="hero-bg blur" src={series.cover_url} alt="" />}
        </div>
        <div className="hero-shade" />
        <div className="series-hero-inner">
          <BackLink />
          <div className="series-hero-body">
            <Poster series={series} className="hero-poster" />
            <div className="series-hero-text">
              <h1>{series.title}</h1>
              <p className="meta">
                {series.year && <>{series.year} · </>}
                {ready.length} épisode{ready.length > 1 ? 's' : ''}
                {ready.length > 0 && <> · {subtitled === ready.length ? <span className="tag">VOSTFR</span> : `${subtitled} sous-titré${subtitled > 1 ? 's' : ''}`}</>}
              </p>
              {series.genres?.length > 0 && (
                <div className="genres">{series.genres.map((g) => <span key={g} className="genre">{g}</span>)}</div>
              )}
              {series.description && <p className="hero-desc">{series.description}</p>}
              <div className="row-actions start">
                {next && (
                  <Link className="button primary big-btn" to={`/regarder/${next.episode.id}`}>
                    <Icon name="play" size={18} /> {next.resume ? 'Reprendre' : next.restart ? 'Revoir depuis le début' : 'Lecture'} · {seasons.length > 1 ? `${seasonName(series, next.episode.season)} · ` : ''}{episodeLabel({ number: next.episode.number })}
                  </Link>
                )}
                <button className={`button glass big-btn${series.in_list ? ' in-list' : ''}`} onClick={toggleList} aria-pressed={series.in_list}>
                  <Icon name={series.in_list ? 'bookmarkOn' : 'bookmark'} size={18} /> {series.in_list ? 'Dans ma liste' : 'Ma liste'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {manage && <ManagePanel series={series} />}

      <section className="shelf">
        <div className="shelf-head episodes-head">
          <h2>Épisodes</h2>
          {shownReady.length > 0 && (
            <button className="ghost-btn small-btn" onClick={toggleSeason}>
              <Icon name="eyeCheck" size={15} /> {allSeen ? 'Tout marquer comme non vu' : `Tout marquer comme vu${seasons.length > 1 ? ' (cette saison)' : ''}`}
            </button>
          )}
        </div>
        {seasons.length > 1 && (
          <div className="season-tabs" role="tablist" aria-label="Saisons">
            {seasons.map((n) => (
              <button key={n} role="tab" aria-selected={n === current} className={n === current ? 'sel' : ''} onClick={() => setSeason(n)}>
                {seasonName(series, n)}
                <span className="count">{visible.filter((e) => (e.season || 1) === n).length}</span>
              </button>
            ))}
            {manage && <button className="link small" onClick={renameSeason}><Icon name="edit" size={14} /> Renommer</button>}
          </div>
        )}
        {manage && seasons.length === 1 && episodes.length > 0 && (
          <p className="muted small">Astuce : pour créer une saison 2 (ou un arc), modifie le numéro de saison d'un épisode avec le crayon. Glisse les épisodes par la poignée pour changer leur ordre.</p>
        )}
        {episodes.length === 0 ? (
          <p className="empty">{manage ? 'Aucun épisode : glisse les vidéos dans la zone d\'import ci-dessus.' : 'Aucun épisode pour l\'instant.'}</p>
        ) : (
          <ul className="episode-list">
            {shown.map((e, i) => (
              <EpisodeRow key={e.id} episode={e} series={series} manage={manage} job={jobs.find((j) => j.episodeId === e.id)}
                dragging={dragId === e.id} onDragStart={() => setDragId(e.id)} onDrop={() => dropOn(e.id)} onDragEnd={() => setDragId(null)}
                onMove={(d) => moveBy(e, d)} first={i === 0} last={i === shown.length - 1} info={info(e)} activeSeason={current} />
            ))}
          </ul>
        )}
      </section>
      {series.anilist_id && (
        <p className="source-note muted small">
          Genres, année{series.description ? ' et synopsis' : ''} : fiche <a href={`https://anilist.co/anime/${series.anilist_id}`} target="_blank" rel="noreferrer noopener">AniList</a>.
        </p>
      )}
    </div>
  );
}

const isProcessing = (e) => e.processing === 'queued' || e.processing === 'running';
const needsConversion = (e) => isProcessing(e) && e.media?.action && e.media.action !== 'none';

/** Etat du traitement serveur (analyse / conversion) d'un episode en ligne. */
function ProcessingInfo({ episode: e, manage }) {
  const [busy, setBusy] = useState(false);
  const pct = Math.floor((e.processing_progress || 0) * 100);
  async function retry() {
    setBusy(true);
    try { await api.post(`/episodes/${e.id}/process`); } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  }
  if (e.processing === 'failed') {
    if (!manage) return null;
    return (
      <div className="processing failed small">
        <span title={e.processing_error}>Conversion impossible : {friendlyError(e.processing_error)}</span>{' '}
        <button className="link" onClick={retry} disabled={busy}>Réessayer</button>
      </div>
    );
  }
  if (!isProcessing(e)) return null;
  const converting = e.media?.action && e.media.action !== 'none';
  return (
    <div className="processing small">
      <div className="progress"><span style={{ width: `${converting ? pct : 0}%` }} /></div>
      <span className="muted">
        {e.processing === 'queued' ? 'En attente de traitement…'
          : converting ? `Préparation pour le navigateur : ${pct} %${manage && e.media?.reason ? ` (${e.media.reason})` : ''}`
            : 'Analyse de la vidéo…'}
      </span>
    </div>
  );
}

/** Piste de sous-titres ; en mode gestion, la langue se change et la piste se supprime. */
function SubtitleTag({ sub: s, manage, onRemove }) {
  const [error, setError] = useState(null);
  async function changeLang(lang) {
    const known = SUBTITLE_LANGS.find((l) => l.lang === lang);
    const wasDefaultLabel = SUBTITLE_LANGS.some((l) => l.label === s.label);
    try {
      await api.put(`/subtitles/${s.id}`, { lang, label: wasDefaultLabel && known ? known.label : s.label });
    } catch (err) { setError(err.message); }
  }
  if (!manage) return <span className="tag" title={s.original_name}><Icon name="captions" size={13} /> {s.label}</span>;
  return (
    <span className="tag" title={error || s.original_name}>
      <Icon name="captions" size={13} /> {s.label}
      <select className="tag-lang" value={SUBTITLE_LANGS.some((l) => l.lang === s.lang) ? s.lang : ''} onChange={(ev) => changeLang(ev.target.value)}
        aria-label={`Langue de la piste ${s.label}`}>
        {!SUBTITLE_LANGS.some((l) => l.lang === s.lang) && <option value="">{s.lang}</option>}
        {SUBTITLE_LANGS.map((l) => <option key={l.lang} value={l.lang}>{l.lang.toUpperCase()}</option>)}
      </select>
      <button className="tag-x" onClick={onRemove} aria-label={`Supprimer la piste ${s.label}`}><Icon name="close" size={11} /></button>
    </span>
  );
}

function SeriesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <div className="series-hero sk-block" />
      <div className="sk-line w30" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="episode-row"><div className="thumb sk-block" /><div><div className="sk-line w50" /><div className="sk-line w30" /></div></div>
      ))}
    </div>
  );
}

function BackLink() {
  return <Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link>;
}

/** Outils de gestion : import (videos + sous-titres), edition de la serie, affiche, suppression. */
function ManagePanel({ series }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [anilist, setAnilist] = useState(false);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const coverInput = useRef(null);
  const jobs = useUploads();
  const episodes = series.episodes;

  /** Videos : un episode par fichier (ou reprise d'un envoi incomplet du meme fichier). Sous-titres : par numero. */
  async function importFiles(fileList) {
    const files = [...fileList];
    const videos = files.filter(isVideo).sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    const subs = files.filter(isSubtitle);
    const ignored = files.filter((f) => !isVideo(f) && !isSubtitle(f));
    const lines = [];
    setBusy(true);
    try {
      let nextNumber = Math.floor(Math.max(0, ...episodes.map((e) => e.number || 0))) + 1;
      const known = [...episodes];
      for (const f of videos) {
        const unfinished = known.find((e) => e.status === 'uploading' && e.original_name === f.name && e.video_size === f.size
          && !jobs.some((j) => j.episodeId === e.id && j.state !== 'error'));
        if (unfinished) {
          enqueueUpload(unfinished, f);
          lines.push({ ok: true, text: `${f.name} → reprise de l'envoi de l'épisode ${unfinished.number}` });
          continue;
        }
        const season = guessSeason(f.name) ?? 1;
        let number = guessEpisodeNumber(f.name);
        if (number === null || known.some((e) => e.number === number && (e.season || 1) === season)) number = nextNumber;
        nextNumber = Math.max(nextNumber, Math.floor(number) + 1);
        try {
          const ep = await api.post(`/series/${series.id}/episodes`, { filename: f.name, size: f.size, number, season });
          known.push(ep);
          enqueueUpload(ep, f);
          lines.push({ ok: true, text: `${f.name} → ${season > 1 ? `saison ${season}, ` : ''}épisode ${number} (envoi lancé)` });
        } catch (err) {
          lines.push({ ok: false, text: `${f.name} : ${err.message}` });
        }
      }
      for (const f of subs) {
        const number = guessEpisodeNumber(f.name);
        const subSeason = guessSeason(f.name);
        const candidates = number !== null ? known.filter((e) => e.number === number && (subSeason === null || (e.season || 1) === subSeason)) : [];
        const target = number !== null ? (candidates.find((e) => (e.season || 1) === 1) || candidates[0]) : (known.length === 1 ? known[0] : null);
        if (!target) {
          lines.push({ ok: false, text: `${f.name} : aucun épisode ${number ?? ''} trouvé. Utilise « + Sous-titres » sur l'épisode.` });
          continue;
        }
        try {
          await uploadSubtitle(target.id, f);
          lines.push({ ok: true, text: `${f.name} → sous-titres de l'épisode ${target.number}` });
        } catch (err) {
          lines.push({ ok: false, text: `${f.name} : ${err.message}` });
        }
      }
      ignored.forEach((f) => lines.push({ ok: false, text: `${f.name} : format non pris en charge` }));
    } finally {
      setBusy(false);
      setReport(lines);
      api.invalidate();
    }
  }

  async function removeSeries() {
    if (!window.confirm(`Supprimer « ${series.title} » et ses ${episodes.length} épisode(s) ? Les vidéos seront effacées du serveur.`)) return;
    try {
      await api.del(`/series/${series.id}`);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeCover(file) {
    if (!file) return;
    setError(null);
    try { await putImage(`/series/${series.id}/cover`, file); } catch (err) { setError(err.message); }
  }

  async function removeCover() {
    try { await api.del(`/series/${series.id}/cover`); } catch (err) { setError(err.message); }
  }

  return (
    <section className="panel manage">
      <div className="manage-head">
        <h2><Icon name="upload" size={18} /> Gestion de la série</h2>
        <div className="row-actions">
          <button className="ghost-btn" onClick={() => setEditing(!editing)}><Icon name="edit" size={16} /> Titre et description</button>
          <button className="ghost-btn" onClick={() => setAnilist(!anilist)}><Icon name="sparkle" size={16} /> Fiche AniList</button>
          <button className="ghost-btn" onClick={() => coverInput.current?.click()}><Icon name="library" size={16} /> {series.has_custom_cover ? 'Changer l\'affiche' : 'Choisir une affiche'}</button>
          {series.has_custom_cover && <button className="ghost-btn" onClick={removeCover}>Retirer l'affiche</button>}
          <button className="ghost-btn danger" onClick={removeSeries}><Icon name="trash" size={16} /> Supprimer la série</button>
          <input ref={coverInput} type="file" hidden accept="image/jpeg,image/png,image/webp"
            onChange={(e) => { changeCover(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>
      {error && <p className="alert">{error}</p>}
      {editing && <EditSeries series={series} onClose={() => setEditing(false)} />}
      {anilist && <AniListPanel series={series} onClose={() => setAnilist(false)} />}

      <div
        className={`dropzone${dragOver ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) importFiles(e.dataTransfer.files); }}
        onClick={() => !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      >
        <input ref={input} type="file" multiple accept={ACCEPT_ALL} hidden
          onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} />
        <span className="drop-icon">{busy ? <span className="spinner" /> : <Icon name="upload" size={26} />}</span>
        <strong>Glisse ici des vidéos ou des sous-titres</strong>
        <span className="muted small">ou clique pour choisir · vidéos : {VIDEO_EXT.join(', ')} · sous-titres : {SUBTITLE_EXT.join(', ')}</span>
        <span className="muted small">Le numéro d'épisode est lu dans le nom du fichier (« Titre - 03.mp4 », « Titre - 03.srt »). Réimporter une vidéo dont l'envoi s'est arrêté le reprend.</span>
      </div>

      {report && (
        <div className="report">
          <div className="report-head"><strong>Résultat de l'import</strong><button className="icon-btn ghost" onClick={() => setReport(null)} aria-label="Fermer"><Icon name="close" size={16} /></button></div>
          <ul>{report.map((l, i) => <li key={i} className={l.ok ? 'ok' : 'warn'}>{l.text}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

/** Recherche d'une fiche sur AniList et import (genres, annee ; synopsis et affiche au choix). */
function AniListPanel({ series, onClose }) {
  const [q, setQ] = useState(series.title);
  const [results, setResults] = useState(null);
  const [picked, setPicked] = useState(null);
  const [useDesc, setUseDesc] = useState(!series.description);
  const [useCover, setUseCover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function search(e) {
    e?.preventDefault();
    setBusy(true); setError(null); setPicked(null);
    try { setResults(await api.refresh(`/admin/anilist/search?q=${encodeURIComponent(q)}`)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function importIt() {
    setBusy(true); setError(null);
    try {
      await api.post(`/series/${series.id}/anilist`, { id: picked.id, description: useDesc, cover: useCover });
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="anilist">
      <form className="anilist-search" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titre de l'anime (romaji ou anglais)" aria-label="Rechercher sur AniList" />
        <button className="primary" disabled={busy || !q.trim()}>{busy ? <span className="spinner" /> : 'Rechercher'}</button>
        <button type="button" className="ghost-btn" onClick={onClose}>Fermer</button>
      </form>
      {error && <p className="alert small">{error}</p>}
      {results?.length === 0 && <p className="muted small">Aucun résultat.</p>}
      {results?.length > 0 && !picked && (
        <ul className="anilist-results">
          {results.map((r) => (
            <li key={r.id}>
              <button className="anilist-item" onClick={() => setPicked(r)}>
                {r.cover_small && <img src={r.cover_small} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <span className="grow">
                  <strong>{r.title}</strong>
                  <span className="muted small">{[r.romaji !== r.title ? r.romaji : null, r.year, r.format, r.episodes ? `${r.episodes} ép.` : null].filter(Boolean).join(' · ')}</span>
                  <span className="small genres-line">{r.genres.join(', ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="anilist-pick">
          {picked.cover_small && <img src={picked.cover_small} alt="" referrerPolicy="no-referrer" />}
          <div className="grow">
            <strong>{picked.title}</strong>
            <p className="muted small">{[picked.year, picked.format, picked.genres.join(', ')].filter(Boolean).join(' · ')}</p>
            {picked.description && <p className="small pick-desc">{picked.description}</p>}
            <label className="check"><input type="checkbox" checked={useDesc} onChange={(e) => setUseDesc(e.target.checked)} disabled={!picked.description} /> Remplacer la description par ce synopsis (en anglais, modifiable ensuite)</label>
            <label className="check"><input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} disabled={!picked.cover} /> Utiliser cette affiche (l'image reste la propriété de ses ayants droit)</label>
            <p className="muted small">Les genres et l'année sont toujours importés.</p>
            <div className="row-actions start">
              <button className="primary" onClick={importIt} disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="check" size={16} />} Importer</button>
              <button className="ghost-btn" onClick={() => setPicked(null)}>Autre résultat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditSeries({ series, onClose }) {
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description || '');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await api.put(`/series/${series.id}`, { title, description });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="form edit-series" onSubmit={submit}>
      <label>Titre<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus /></label>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} /></label>
      {error && <p className="alert">{error}</p>}
      <div className="row-actions"><button type="button" className="ghost-btn" onClick={onClose}>Annuler</button><button className="primary" type="submit">Enregistrer</button></div>
    </form>
  );
}

function EpisodeRow({ episode: e, series, manage, job, dragging, onDragStart, onDrop, onDragEnd, onMove, first, last, info }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(e.number ?? '');
  const [title, setTitle] = useState(e.title || '');
  const [seasonField, setSeasonField] = useState(e.season || 1);
  const [target, setTarget] = useState(e.series_id);
  const [over, setOver] = useState(false);
  const { data: allSeries } = useApi(editing ? '/series' : null);
  const [error, setError] = useState(null);
  const [subBusy, setSubBusy] = useState(false);
  const subInput = useRef(null);
  const resumeInput = useRef(null);

  const ready = e.status === 'ready';
  const progress = progressOf(e.id);
  const pct = job ? Math.floor((job.sent / job.size) * 100) : Math.floor((e.received / e.video_size) * 100);

  async function save(ev) {
    ev.preventDefault();
    try {
      await api.put(`/episodes/${e.id}`, {
        number: number === '' ? null : Number(String(number).replace(',', '.')), title,
        season: Number(seasonField) || 1, series_id: Number(target),
      });
      setEditing(false);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer « ${episodeLabel(e)} » (vidéo et sous-titres) ?`)) return;
    try { await api.del(`/episodes/${e.id}`); } catch (err) { setError(err.message); }
  }

  async function addSubtitles(files) {
    setSubBusy(true);
    setError(null);
    try {
      for (const f of files) await uploadSubtitle(e.id, f);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubBusy(false);
    }
  }

  async function removeSubtitle(s) {
    if (!window.confirm(`Supprimer la piste « ${s.label} » (${s.original_name || 'sous-titres'}) ?`)) return;
    try { await api.del(`/subtitles/${s.id}`); } catch (err) { setError(err.message); }
  }

  function resume(file) {
    if (!file) return;
    if (file.size !== e.video_size) {
      setError(`Ce fichier ne correspond pas : ${formatBytes(file.size)} au lieu de ${formatBytes(e.video_size)} (${e.original_name}).`);
      return;
    }
    setError(null);
    enqueueUpload(e, file);
  }

  // Statut d'envoi lisible, y compris les attentes (429, connexion figee) affichees aussi dans le panneau.
  let uploadText = null;
  if (!ready) {
    if (!job) uploadText = null;
    else if (job.state === 'error') uploadText = `Échec : ${job.error}`;
    else if (job.state === 'retrying') uploadText = job.error;
    else if (job.state === 'queued') uploadText = 'En attente…';
    else uploadText = `Envoi : ${pct} % · ${formatBytes(job.sent)} / ${formatBytes(job.size)}`;
  }

  const thumb = <Thumb src={e.thumb_url} seed={series.title} number={e.number} progress={progress} watched={progress?.watched} playable={ready} storyboard={e.storyboard} />;
  const dnd = manage && !editing ? {
    draggable: true,
    onDragStart: (ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(e.id)); onDragStart?.(); },
    onDragOver: (ev) => { ev.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (ev) => { ev.preventDefault(); setOver(false); onDrop?.(); },
    onDragEnd: () => { setOver(false); onDragEnd?.(); },
  } : {};

  return (
    <li className={`episode-row${ready ? '' : ' pending'}${dragging ? ' dragging' : ''}${over ? ' drop-over' : ''}`} {...dnd}>
      {manage && !editing && (
        <div className="reorder">
          <span className="grip" title="Glisser pour changer l'ordre" aria-hidden="true"><Icon name="grip" size={18} /></span>
          <button className="icon-btn ghost tiny" onClick={() => onMove?.(-1)} disabled={first} aria-label="Monter"><Icon name="chevronUp" size={14} /></button>
          <button className="icon-btn ghost tiny" onClick={() => onMove?.(1)} disabled={last} aria-label="Descendre"><Icon name="chevronDown" size={14} /></button>
        </div>
      )}
      {ready ? <Link to={`/regarder/${e.id}`} className="episode-thumb" aria-label={`Regarder ${episodeLabel(e)}`}>{thumb}</Link> : <div className="episode-thumb">{thumb}</div>}

      <div className="episode-body">
        {editing ? (
          <form className="episode-edit" onSubmit={save}>
            <label className="mini">Saison<input aria-label="Saison" inputMode="numeric" value={seasonField} onChange={(ev) => setSeasonField(ev.target.value)} /></label>
            <label className="mini">N°<input aria-label="Numéro" inputMode="decimal" value={number} onChange={(ev) => setNumber(ev.target.value)} /></label>
            <label className="grow">Titre<input aria-label="Titre" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="(facultatif)" maxLength={300} /></label>
            <label className="grow">Série
              <select value={target} onChange={(ev) => setTarget(ev.target.value)} aria-label="Déplacer vers la série">
                {(allSeries || [{ id: series.id, title: series.title }]).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            </label>
            <div className="edit-btns">
              <button className="primary" type="submit" aria-label="Enregistrer"><Icon name="check" size={16} /></button>
              <button type="button" className="ghost-btn" onClick={() => setEditing(false)} aria-label="Annuler"><Icon name="close" size={16} /></button>
            </div>
          </form>
        ) : (
          <>
            <div className="episode-title-row">
              {ready ? <Link to={`/regarder/${e.id}`} className="episode-title">{episodeLabel(e)}</Link> : <span className="episode-title">{episodeLabel(e)}</span>}
              {e.is_new && <span className="badge-new">Nouveau</span>}
            </div>
            <div className="episode-meta">
              {needsConversion(e) && !manage && <span className="tag info">En préparation…</span>}
              {e.subtitles.map((s) => <SubtitleTag key={s.id} sub={s} manage={manage} onRemove={() => removeSubtitle(s)} />)}
              {e.subtitles.length === 0 && ready && <span className="tag warn">Sans sous-titres</span>}
              {manage && <span className="muted small file-name" title={e.original_name}>{formatBytes(e.video_size)} · {e.original_name}</span>}
            </div>
          </>
        )}

        {!ready && (
          <div className="episode-upload">
            <div className="progress"><span style={{ width: `${pct}%` }} /></div>
            {job ? <span className={`small ${job.state === 'error' ? 'danger-text' : 'muted'}`}>{uploadText}</span> : (
              <span className="small">
                Envoi incomplet ({pct} %).{' '}
                <button className="link" onClick={() => resumeInput.current?.click()}>Reprendre avec le même fichier</button>
                <input ref={resumeInput} type="file" hidden accept={ACCEPT_VIDEO}
                  onChange={(ev) => { resume(ev.target.files[0]); ev.target.value = ''; }} />
              </span>
            )}
          </div>
        )}
        {ready && <ProcessingInfo episode={e} manage={manage} />}
        {error && <p className="alert small">{error}</p>}
      </div>

      {ready && !editing && !manage && (
        <div className="episode-actions">
          <button className={`icon-btn ghost seen-btn${progress?.watched ? ' on' : ''}`}
            onClick={() => (progress?.watched ? markUnwatched(e.id) : markWatched(e.id, e.media?.duration || 0, info, { manual: true }))}
            aria-pressed={!!progress?.watched} aria-label={progress?.watched ? 'Marquer comme non vu' : 'Marquer comme vu'}
            title={progress?.watched ? 'Marquer comme non vu' : 'Marquer comme vu'}>
            <Icon name="eyeCheck" size={18} />
          </button>
        </div>
      )}
      {manage && !editing && (
        <div className="episode-actions">
          {ready && (
            <button className={`icon-btn ghost seen-btn${progress?.watched ? ' on' : ''}`}
              onClick={() => (progress?.watched ? markUnwatched(e.id) : markWatched(e.id, e.media?.duration || 0, info, { manual: true }))}
              aria-label={progress?.watched ? 'Marquer comme non vu' : 'Marquer comme vu'} title={progress?.watched ? 'Marquer comme non vu' : 'Marquer comme vu'}>
              <Icon name="eyeCheck" size={18} />
            </button>
          )}
          <button className="ghost-btn small-btn" onClick={() => subInput.current?.click()} disabled={subBusy}>
            {subBusy ? <span className="spinner" /> : <Icon name="plus" size={14} />} Sous-titres
          </button>
          <input ref={subInput} type="file" hidden multiple accept={ACCEPT_SUBS}
            onChange={(ev) => { addSubtitles([...ev.target.files]); ev.target.value = ''; }} />
          <button className="icon-btn ghost" onClick={() => setEditing(true)} aria-label="Modifier"><Icon name="edit" size={16} /></button>
          <button className="icon-btn ghost danger" onClick={remove} aria-label="Supprimer"><Icon name="trash" size={16} /></button>
        </div>
      )}
    </li>
  );
}
