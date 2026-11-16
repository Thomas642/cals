import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { enqueueUpload, useUploads } from '../uploads.js';
import {
  SUBTITLE_EXT, VIDEO_EXT, episodeLabel, formatBytes, guessEpisodeNumber, guessSubtitleLang,
  isSubtitle, isVideo, readTextFile,
} from '../files.js';
import { nextToWatch, progressOf, useProgress } from '../progress.js';
import { useManage } from '../manage.js';
import { fillMissingThumbnails } from '../thumbs.js';
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

export default function Series() {
  const { id } = useParams();
  const { data: series, error } = useApi(`/series/${id}`);
  const manage = useManage();
  const jobs = useUploads();
  useProgress();

  useEffect(() => { if (series) fillMissingThumbnails(series.episodes); }, [series]);

  if (error) return <><BackLink /><p className="alert">{error.message}</p></>;
  if (!series) return <><BackLink /><div className="series-hero sk-block" /></>;

  const episodes = series.episodes;
  const ready = episodes.filter((e) => e.status === 'ready');
  const next = nextToWatch(episodes);
  const subtitled = ready.filter((e) => e.subtitles.length).length;

  return (
    <>
      <section className="series-hero">
        {series.cover_url && <img className="hero-bg" src={series.cover_url} alt="" />}
        <div className="hero-shade" />
        <div className="series-hero-inner">
          <BackLink />
          <div className="series-hero-body">
            <Poster series={series} className="hero-poster" />
            <div className="series-hero-text">
              <h1>{series.title}</h1>
              <p className="meta">
                {ready.length} épisode{ready.length > 1 ? 's' : ''}
                {ready.length > 0 && <> · {subtitled === ready.length ? <span className="tag">VOSTFR</span> : `${subtitled} sous-titré${subtitled > 1 ? 's' : ''}`}</>}
              </p>
              {series.description && <p className="hero-desc">{series.description}</p>}
              {next && (
                <div className="row-actions start">
                  <Link className="button primary big-btn" to={`/regarder/${next.episode.id}`}>
                    <Icon name="play" size={18} /> {next.resume ? 'Reprendre' : next.restart ? 'Revoir depuis le début' : 'Lecture'} · {episodeLabel({ number: next.episode.number })}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {manage && <ManagePanel series={series} />}

      <section className="shelf">
        <h2>Épisodes</h2>
        {episodes.length === 0 ? (
          <p className="empty">{manage ? 'Aucun épisode : glisse les vidéos dans la zone d\'import ci-dessus.' : 'Aucun épisode pour l\'instant. Active « Gérer » en haut pour importer des vidéos.'}</p>
        ) : (
          <ul className="episode-list">
            {episodes.filter((e) => manage || e.status === 'ready' || jobs.some((j) => j.episodeId === e.id)).map((e) => (
              <EpisodeRow key={e.id} episode={e} series={series} manage={manage} job={jobs.find((j) => j.episodeId === e.id)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BackLink() {
  return <Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link>;
}

/** Outils de gestion : import (videos + sous-titres), edition de la serie, affiche, suppression. */
function ManagePanel({ series }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
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
        let number = guessEpisodeNumber(f.name);
        if (number === null || known.some((e) => e.number === number)) number = nextNumber;
        nextNumber = Math.max(nextNumber, Math.floor(number) + 1);
        try {
          const ep = await api.post(`/series/${series.id}/episodes`, { filename: f.name, size: f.size, number });
          known.push(ep);
          enqueueUpload(ep, f);
          lines.push({ ok: true, text: `${f.name} → épisode ${number} (envoi lancé)` });
        } catch (err) {
          lines.push({ ok: false, text: `${f.name} : ${err.message}` });
        }
      }
      for (const f of subs) {
        const number = guessEpisodeNumber(f.name);
        const target = number !== null ? known.find((e) => e.number === number) : (known.length === 1 ? known[0] : null);
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
          <button className="ghost-btn" onClick={() => coverInput.current?.click()}><Icon name="library" size={16} /> {series.has_custom_cover ? 'Changer l\'affiche' : 'Choisir une affiche'}</button>
          {series.has_custom_cover && <button className="ghost-btn" onClick={removeCover}>Retirer l'affiche</button>}
          <button className="ghost-btn danger" onClick={removeSeries}><Icon name="trash" size={16} /> Supprimer la série</button>
          <input ref={coverInput} type="file" hidden accept="image/jpeg,image/png,image/webp"
            onChange={(e) => { changeCover(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>
      {error && <p className="alert">{error}</p>}
      {editing && <EditSeries series={series} onClose={() => setEditing(false)} />}

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

function EpisodeRow({ episode: e, series, manage, job }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(e.number ?? '');
  const [title, setTitle] = useState(e.title || '');
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
      await api.put(`/episodes/${e.id}`, { number: number === '' ? null : Number(String(number).replace(',', '.')), title });
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

  const thumb = <Thumb src={e.thumb_url} seed={series.title} number={e.number} progress={progress} watched={progress?.watched} playable={ready} />;

  return (
    <li className={`episode-row${ready ? '' : ' pending'}`}>
      {ready ? <Link to={`/regarder/${e.id}`} className="episode-thumb" aria-label={`Regarder ${episodeLabel(e)}`}>{thumb}</Link> : <div className="episode-thumb">{thumb}</div>}

      <div className="episode-body">
        {editing ? (
          <form className="episode-edit" onSubmit={save}>
            <input aria-label="Numéro" inputMode="decimal" value={number} onChange={(ev) => setNumber(ev.target.value)} placeholder="N°" />
            <input aria-label="Titre" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Titre (facultatif)" maxLength={300} />
            <button className="primary" type="submit" aria-label="Enregistrer"><Icon name="check" size={16} /></button>
            <button type="button" className="ghost-btn" onClick={() => setEditing(false)} aria-label="Annuler"><Icon name="close" size={16} /></button>
          </form>
        ) : (
          <>
            {ready ? <Link to={`/regarder/${e.id}`} className="episode-title">{episodeLabel(e)}</Link> : <span className="episode-title">{episodeLabel(e)}</span>}
            <div className="episode-meta">
              {e.subtitles.map((s) => (
                <span key={s.id} className="tag" title={s.original_name}>
                  <Icon name="captions" size={13} /> {s.label}
                  {manage && <button className="tag-x" onClick={() => removeSubtitle(s)} aria-label={`Supprimer la piste ${s.label}`}><Icon name="close" size={11} /></button>}
                </span>
              ))}
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
        {error && <p className="alert small">{error}</p>}
      </div>

      {manage && !editing && (
        <div className="episode-actions">
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
