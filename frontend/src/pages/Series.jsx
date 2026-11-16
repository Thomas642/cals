import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { enqueueUpload, useUploads } from '../uploads.js';
import {
  SUBTITLE_EXT, VIDEO_EXT, episodeLabel, formatBytes, guessEpisodeNumber, guessSubtitleLang,
  isSubtitle, isVideo, readTextFile,
} from '../files.js';
import Icon from '../components/Icon.jsx';
import Skeleton from '../components/Skeleton.jsx';
import { hueOf } from './Library.jsx';

const ACCEPT_ALL = [...VIDEO_EXT, ...SUBTITLE_EXT].map((e) => `.${e}`).join(',');
const ACCEPT_SUBS = SUBTITLE_EXT.map((e) => `.${e}`).join(',');

async function uploadSubtitle(episodeId, file) {
  const content = await readTextFile(file);
  const { lang, label } = guessSubtitleLang(file.name);
  return api.post(`/episodes/${episodeId}/subtitles`, { filename: file.name, content, lang, label });
}

export default function Series() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: series, error } = useApi(`/series/${id}`);
  const jobs = useUploads();
  const [editing, setEditing] = useState(false);
  const [report, setReport] = useState(null);   // messages apres un import
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef(null);

  if (error) return <><BackLink /><p className="alert">{error.message}</p></>;
  if (!series) return <><BackLink /><Skeleton lines={5} /></>;

  const episodes = series.episodes;

  /** Videos : creation d'un episode par fichier puis envoi. Sous-titres : associes par numero d'episode. */
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
          lines.push({ ok: false, text: `${f.name} : aucun épisode ${number ?? ''} trouvé. Utilise le bouton « Sous-titres » de l'épisode.` });
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
      window.alert(err.message);
    }
  }

  return (
    <>
      <BackLink />
      {editing ? <EditSeries series={series} onClose={() => setEditing(false)} /> : (
        <section className="series-head">
          <div className="cover big" style={{ '--h': hueOf(series.title) }}><span>{[...series.title.trim()][0]?.toUpperCase()}</span></div>
          <div className="grow">
            <h1>{series.title}</h1>
            {series.description && <p className="muted pre">{series.description}</p>}
            <div className="row-actions start">
              <button onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Modifier</button>
              <button className="danger-btn" onClick={removeSeries}><Icon name="trash" size={16} /> Supprimer</button>
            </div>
          </div>
        </section>
      )}

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
        {busy ? <span className="spinner big" /> : <Icon name="upload" size={32} />}
        <strong>Glisse ici des vidéos ou des sous-titres</strong>
        <span className="muted small">
          ou clique pour choisir · vidéos : {VIDEO_EXT.join(', ')} · sous-titres : {SUBTITLE_EXT.join(', ')}
        </span>
        <span className="muted small">Le numéro d'épisode est lu dans le nom du fichier (ex. « Titre - 03.mp4 », « Titre - 03.srt »).</span>
      </div>

      {report && (
        <section className="card report">
          <div className="title-row"><h2>Import</h2><button className="icon-btn subtle-plain" onClick={() => setReport(null)} aria-label="Fermer"><Icon name="close" size={16} /></button></div>
          <ul>{report.map((l, i) => <li key={i} className={l.ok ? 'ok' : 'warn'}>{l.text}</li>)}</ul>
        </section>
      )}

      {episodes.length === 0 ? <p className="empty">Aucun épisode. Glisse les vidéos dans la zone ci-dessus.</p> : (
        <ul className="episodes">
          {episodes.map((e) => <EpisodeRow key={e.id} episode={e} job={jobs.find((j) => j.episodeId === e.id)} />)}
        </ul>
      )}
    </>
  );
}

function BackLink() {
  return <Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link>;
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
    <form className="card form" onSubmit={submit}>
      <label>Titre<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus /></label>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} /></label>
      {error && <p className="alert">{error}</p>}
      <div className="row-actions"><button type="button" onClick={onClose}>Annuler</button><button className="primary" type="submit">Enregistrer</button></div>
    </form>
  );
}

function EpisodeRow({ episode: e, job }) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(e.number ?? '');
  const [title, setTitle] = useState(e.title || '');
  const [error, setError] = useState(null);
  const [subBusy, setSubBusy] = useState(false);
  const subInput = useRef(null);
  const resumeInput = useRef(null);

  const ready = e.status === 'ready';
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

  return (
    <li className="episode">
      <div className="episode-main">
        {ready
          ? <Link to={`/regarder/${e.id}`} className="play-btn" aria-label={`Regarder ${episodeLabel(e)}`}><Icon name="play" size={18} /></Link>
          : <span className="play-btn disabled" aria-hidden="true"><Icon name="upload" size={18} /></span>}
        {editing ? (
          <form className="episode-edit" onSubmit={save}>
            <input aria-label="Numéro" inputMode="decimal" value={number} onChange={(ev) => setNumber(ev.target.value)} placeholder="N°" />
            <input aria-label="Titre" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Titre (facultatif)" maxLength={300} />
            <button className="primary" type="submit"><Icon name="check" size={16} /></button>
            <button type="button" onClick={() => setEditing(false)} aria-label="Annuler"><Icon name="close" size={16} /></button>
          </form>
        ) : (
          <div className="episode-text">
            {ready ? <Link to={`/regarder/${e.id}`} className="episode-title">{episodeLabel(e)}</Link> : <span className="episode-title">{episodeLabel(e)}</span>}
            <span className="muted small" title={e.original_name}>{formatBytes(e.video_size)} · {e.original_name}</span>
          </div>
        )}
        {!editing && (
          <div className="episode-actions">
            <button className="icon-btn subtle-plain" onClick={() => setEditing(true)} aria-label="Modifier"><Icon name="edit" size={16} /></button>
            <button className="icon-btn subtle" onClick={remove} aria-label="Supprimer"><Icon name="trash" size={16} /></button>
          </div>
        )}
      </div>

      {!ready && (
        <div className="episode-upload">
          <div className="progress"><span style={{ width: `${pct}%` }} /></div>
          {job ? <span className="small muted">{job.state === 'error' ? `Échec : ${job.error}` : `Envoi : ${pct} %`}</span> : (
            <span className="small">
              Envoi incomplet ({pct} %).{' '}
              <button className="link" onClick={() => resumeInput.current?.click()}>Reprendre avec le même fichier</button>
              <input ref={resumeInput} type="file" hidden accept={VIDEO_EXT.map((x) => `.${x}`).join(',')}
                onChange={(ev) => { resume(ev.target.files[0]); ev.target.value = ''; }} />
            </span>
          )}
        </div>
      )}

      <div className="subs">
        {e.subtitles.map((s) => (
          <span key={s.id} className="chip" title={s.original_name}>
            <Icon name="captions" size={14} /> {s.label}
            <button className="chip-x" onClick={() => removeSubtitle(s)} aria-label={`Supprimer la piste ${s.label}`}><Icon name="close" size={12} /></button>
          </span>
        ))}
        {e.subtitles.length === 0 && <span className="chip missing">Pas de sous-titres</span>}
        <button className="link small" onClick={() => subInput.current?.click()} disabled={subBusy}>
          {subBusy ? <span className="spinner" /> : <Icon name="plus" size={14} />} Sous-titres
        </button>
        <input ref={subInput} type="file" hidden multiple accept={ACCEPT_SUBS}
          onChange={(ev) => { addSubtitles([...ev.target.files]); ev.target.value = ''; }} />
      </div>
      {error && <p className="alert small">{error}</p>}
    </li>
  );
}
