import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { episodeLabel } from '../files.js';
import { markWatched, progressOf, recordProgress } from '../progress.js';
import Icon from '../components/Icon.jsx';
import Thumb from '../components/Thumb.jsx';

export default function Watch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [poll, setPoll] = useState(false);
  const { data: ep, error } = useApi(`/episodes/${id}`, { refreshMs: poll ? 5000 : 0 });
  const { data: series } = useApi(ep ? `/series/${ep.series.id}` : null);
  const video = useRef(null);
  const lastSaved = useRef(0);
  const [playError, setPlayError] = useState(null);
  const [ended, setEnded] = useState(false);
  const [noPicture, setNoPicture] = useState(false);
  const convertedFrom = useRef(null);
  const saveRef = useRef(null);
  // Sortie de la page : on enregistre la position tout de suite.
  useEffect(() => () => saveRef.current?.(true), [id]);

  useEffect(() => { setPlayError(null); setEnded(false); setNoPicture(false); lastSaved.current = 0; }, [id]);
  const processing = ep && (ep.processing === 'queued' || ep.processing === 'running');
  useEffect(() => { setPoll(!!processing); }, [processing]);
  // Fin de conversion pendant qu'on est sur la page : on recharge le lecteur sur la nouvelle video.
  useEffect(() => {
    if (!ep) return;
    if (processing) convertedFrom.current = ep.id;
    else if (convertedFrom.current === ep.id && ep.processing === 'done') { convertedFrom.current = null; setNoPicture(false); setPlayError(null); }
  }, [ep, processing]);

  if (error) return <><Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link><p className="alert">{error.message}</p></>;
  if (!ep) return <div className="watch"><div className="player sk-block" style={{ aspectRatio: '16 / 9' }} /></div>;
  if (ep.status !== 'ready') {
    return <><Link to={`/serie/${ep.series.id}`} className="back"><Icon name="chevronLeft" size={18} /> {ep.series.title}</Link><p className="alert">La vidéo de cet épisode n'est pas encore entièrement envoyée.</p></>;
  }

  const info = { seriesId: ep.series.id, seriesTitle: ep.series.title, label: episodeLabel({ number: ep.number }), thumb: ep.thumb_url, cover: ep.series.cover_url };
  const nextEp = series?.episodes.find((e) => e.id === ep.next_id);

  function onLoaded() {
    const v = video.current;
    // Son sans image : le navigateur ne decode pas la piste video (HEVC, H.264 10 bits...).
    setNoPicture(!!v && v.duration > 0 && v.videoWidth === 0);
    const p = progressOf(ep.id);
    if (v && p && !p.watched && p.pos > 5 && p.pos < v.duration - 10) v.currentTime = p.pos;
    // Active la premiere piste francaise (sinon la premiere piste).
    if (v?.textTracks?.length) {
      const tracks = [...v.textTracks];
      const pick = tracks.find((t) => t.language === 'fr') || tracks[0];
      tracks.forEach((t) => { t.mode = t === pick ? 'showing' : 'disabled'; });
    }
  }

  function save(force = false) {
    const v = video.current;
    if (v && v.duration) recordProgress(ep.id, v.currentTime, v.duration, info, { force });
  }

  saveRef.current = save;

  function onTime() {
    const v = video.current;
    if (!v || Math.abs(v.currentTime - lastSaved.current) < 5) return;
    lastSaved.current = v.currentTime;
    save();
  }

  function onError() {
    const code = video.current?.error?.code;
    setPlayError(code === 4
      ? `Ce navigateur ne sait pas lire ce fichier (${ep.original_name}). Le format le plus compatible est le MP4 (vidéo H.264, son AAC) ; les MKV et vidéos HEVC/H.265 ne sont pas lus par tous les navigateurs.`
      : 'La lecture a échoué (connexion au serveur ?). Recharge la page pour réessayer.');
  }

  return (
    <div className="watch">
      <Link to={`/serie/${ep.series.id}`} className="back"><Icon name="chevronLeft" size={18} /> {ep.series.title}</Link>
      <div className="player">
        <video
          key={ep.video_url}
          ref={video}
          controls
          // Pas de bouton « Télécharger » ni de menu « Enregistrer la vidéo sous ».
          controlsList="nodownload"
          disableRemotePlayback
          onContextMenu={(ev) => ev.preventDefault()}
          autoPlay
          playsInline
          preload="metadata"
          poster={ep.thumb_url || undefined}
          src={ep.video_url}
          onLoadedMetadata={onLoaded}
          onTimeUpdate={onTime}
          onPause={() => save(true)}
          onEnded={() => { markWatched(ep.id, video.current?.duration, info); setEnded(true); }}
          onError={onError}
        >
          {ep.subtitles.map((s) => (
            <track key={s.id} kind="subtitles" src={`/api/media/subtitle/${s.id}`} srcLang={s.lang} label={s.label} />
          ))}
        </video>
        {ended && nextEp && (
          <button className="next-overlay" onClick={() => navigate(`/regarder/${nextEp.id}`)}>
            <span className="eyebrow">Épisode suivant</span>
            <strong>{episodeLabel(nextEp)}</strong>
            <span className="button primary"><Icon name="play" size={16} /> Lecture</span>
          </button>
        )}
      </div>
      {processing && ep.media?.action && ep.media.action !== 'none' && (
        <p className="notice">
          <span className="spinner" /> Cette vidéo est en cours de préparation pour le navigateur
          ({Math.floor((ep.processing_progress || 0) * 100)} %). Si l'image reste noire, reviens quand c'est terminé :
          le lecteur se rechargera tout seul.
        </p>
      )}
      {noPicture && !processing && (
        <p className="alert">
          Le son est lu mais pas l'image : ce navigateur ne sait pas décoder la piste vidéo
          {ep.media?.video ? ` (${ep.media.video})` : ''}.
          {ep.processing === 'failed' ? ` La conversion automatique a échoué : ${ep.processing_error}` : ' Active « Gérer » sur la page de la série pour relancer la conversion.'}
        </p>
      )}
      {playError && <p className="alert">{playError}</p>}

      <div className="watch-bar">
        <div>
          <span className="eyebrow">{ep.series.title}</span>
          <h1>{episodeLabel(ep)}</h1>
          <div className="episode-meta">
            {ep.subtitles.length
              ? ep.subtitles.map((s) => <span key={s.id} className="tag"><Icon name="captions" size={13} /> {s.label}</span>)
              : <span className="tag warn">Sans sous-titres</span>}
          </div>
        </div>
        <div className="row-actions">
          {ep.prev_id && <button className="ghost-btn" onClick={() => navigate(`/regarder/${ep.prev_id}`)}><Icon name="chevronLeft" size={18} /> Précédent</button>}
          {ep.next_id && <button className={ended ? 'primary' : 'ghost-btn'} onClick={() => navigate(`/regarder/${ep.next_id}`)}>Suivant <Icon name="chevronRight" size={18} /></button>}
        </div>
      </div>

      {series && series.episodes.filter((e) => e.status === 'ready').length > 1 && (
        <section className="shelf">
          <h2>Épisodes</h2>
          <ul className="row-scroll">
            {series.episodes.filter((e) => e.status === 'ready').map((e) => {
              const p = progressOf(e.id);
              return (
                <li key={e.id}>
                  <Link to={`/regarder/${e.id}`} className={`continue-card${e.id === ep.id ? ' current' : ''}`}>
                    <Thumb src={e.thumb_url} seed={ep.series.title} number={e.number} progress={p} watched={p?.watched} playable={e.id !== ep.id} />
                    <strong>{episodeLabel(e)}</strong>
                    {e.id === ep.id && <span className="muted small">En cours</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
