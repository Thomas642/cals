import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks.js';
import { episodeLabel } from '../files.js';
import Icon from '../components/Icon.jsx';
import Skeleton from '../components/Skeleton.jsx';

// Position de lecture memorisee dans ce navigateur (reprise la ou on s'etait arrete).
const posKey = (id) => `anime:pos:${id}`;
const readPos = (id) => { try { return Number(localStorage.getItem(posKey(id))) || 0; } catch { return 0; } };
const writePos = (id, t) => { try { if (t > 0) localStorage.setItem(posKey(id), String(Math.floor(t))); else localStorage.removeItem(posKey(id)); } catch { /* stockage indisponible */ } };

export default function Watch() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: ep, error } = useApi(`/episodes/${id}`);
  const video = useRef(null);
  const lastSaved = useRef(0);
  const [playError, setPlayError] = useState(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => { setPlayError(null); setEnded(false); }, [id]);

  if (error) return <><Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link><p className="alert">{error.message}</p></>;
  if (!ep) return <Skeleton lines={6} />;
  if (ep.status !== 'ready') {
    return <><Link to={`/serie/${ep.series.id}`} className="back"><Icon name="chevronLeft" size={18} /> {ep.series.title}</Link><p className="alert">La vidéo de cet épisode n'est pas encore entièrement envoyée.</p></>;
  }

  function onLoaded() {
    const pos = readPos(ep.id);
    const v = video.current;
    if (v && pos > 5 && pos < v.duration - 10) v.currentTime = pos;
    // Active la premiere piste francaise (sinon la premiere piste).
    if (v?.textTracks?.length) {
      const tracks = [...v.textTracks];
      const pick = tracks.find((t) => t.language === 'fr') || tracks[0];
      tracks.forEach((t) => { t.mode = t === pick ? 'showing' : 'disabled'; });
    }
  }

  function onTime() {
    const v = video.current;
    if (!v || Math.abs(v.currentTime - lastSaved.current) < 5) return;
    lastSaved.current = v.currentTime;
    writePos(ep.id, v.duration && v.currentTime > v.duration - 30 ? 0 : v.currentTime);
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
          key={ep.id}
          ref={video}
          controls
          autoPlay
          playsInline
          preload="metadata"
          src={`/api/media/video/${ep.id}`}
          onLoadedMetadata={onLoaded}
          onTimeUpdate={onTime}
          onPause={() => video.current && writePos(ep.id, video.current.currentTime)}
          onEnded={() => { writePos(ep.id, 0); setEnded(true); }}
          onError={onError}
        >
          {ep.subtitles.map((s) => (
            <track key={s.id} kind="subtitles" src={`/api/media/subtitle/${s.id}`} srcLang={s.lang} label={s.label} />
          ))}
        </video>
      </div>
      {playError && <p className="alert">{playError}</p>}

      <div className="watch-bar">
        <div>
          <h1>{episodeLabel(ep)}</h1>
          <p className="muted small">
            {ep.subtitles.length ? `Sous-titres : ${ep.subtitles.map((s) => s.label).join(', ')}` : 'Pas de sous-titres pour cet épisode'}
          </p>
        </div>
        <div className="row-actions">
          {ep.prev_id && <button onClick={() => navigate(`/regarder/${ep.prev_id}`)}><Icon name="chevronLeft" size={18} /> Précédent</button>}
          {ep.next_id && <button className={ended ? 'primary' : ''} onClick={() => navigate(`/regarder/${ep.next_id}`)}>Suivant <Icon name="chevronRight" size={18} /></button>}
        </div>
      </div>
    </div>
  );
}
