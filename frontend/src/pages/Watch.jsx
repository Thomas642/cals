import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { accentStyle, episodeLabel, seasonName } from '../files.js';
import { markWatched, progressOf, recordProgress, useProgress } from '../progress.js';
import { updateSettings, useSettings } from '../settings.js';
import { useManage } from '../manage.js';
import Icon from '../components/Icon.jsx';
import Thumb from '../components/Thumb.jsx';
import Player, { formatTime } from '../components/Player.jsx';

export default function Watch({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [poll, setPoll] = useState(false);
  const { data: ep, error } = useApi(`/episodes/${id}`, { refreshMs: poll ? 5000 : 0 });
  const { data: series } = useApi(ep ? `/series/${ep.series.id}` : null);
  const settings = useSettings();
  const manage = useManage() && user.role === 'admin';
  useProgress();
  const player = useRef(null);
  const lastSaved = useRef(0);
  const [playError, setPlayError] = useState(null);
  const [noPicture, setNoPicture] = useState(false);

  useEffect(() => { setPlayError(null); setNoPicture(false); lastSaved.current = 0; }, [id]);
  const processing = ep && (ep.processing === 'queued' || ep.processing === 'running');
  useEffect(() => { setPoll(!!processing); }, [processing]);

  const info = ep ? { seriesId: ep.series.id, seriesTitle: ep.series.title, label: episodeLabel({ number: ep.number }), thumb: ep.thumb_url, cover: ep.series.cover_url } : null;
  const ready = series?.episodes.filter((e) => e.status === 'ready') || [];
  const nextEp = ready.find((e) => e.id === ep?.next_id);
  const goNext = useCallback(() => { if (ep?.next_id) navigate(`/regarder/${ep.next_id}`); }, [ep?.next_id, navigate]);

  // Sortie de la page : la position est enregistree tout de suite.
  const flush = useRef(null);
  useEffect(() => () => flush.current?.(), [id]);

  if (error) return <><Link to="/" className="back"><Icon name="chevronLeft" size={18} /> Bibliothèque</Link><p className="alert">{error.message}</p></>;
  if (!ep) return <div className="watch" aria-busy="true"><div className="sk-line w30" /><div className="player2 sk-block" style={{ aspectRatio: '16 / 9' }} /><div className="sk-line w50" /></div>;
  if (ep.status !== 'ready') {
    return <><Link to={`/serie/${ep.series.id}`} className="back"><Icon name="chevronLeft" size={18} /> {ep.series.title}</Link><p className="alert">La vidéo de cet épisode n'est pas encore entièrement envoyée.</p></>;
  }

  const p = progressOf(ep.id);
  const startAt = p && !p.watched ? p.pos : 0;

  function onTick(t, dur, delta) {
    flush.current = () => recordProgress(ep.id, t, dur, info, { force: true });
    const moved = Math.abs(t - lastSaved.current) >= 5;
    if (moved) lastSaved.current = t;
    if (moved || delta > 0) recordProgress(ep.id, t, dur, info, { delta });
  }

  function onError(code) {
    setPlayError(code === 4
      ? `Ce navigateur ne sait pas lire ce fichier (${ep.original_name || 'vidéo'}). Le format le plus compatible est le MP4 (vidéo H.264, son AAC).`
      : 'La lecture a échoué (connexion au serveur ?). Recharge la page pour réessayer.');
  }

  const multiSeason = new Set(ready.map((e) => e.season)).size > 1;

  return (
    <div className="watch themed" style={accentStyle(ep.series.accent)}>
      <Link to={`/serie/${ep.series.id}`} className="back"><Icon name="chevronLeft" size={18} /> {ep.series.title}</Link>
      <Player
        key={ep.video_url}
        ref={player}
        src={ep.video_url}
        poster={ep.thumb_url}
        subtitles={ep.subtitles}
        intro={ep.intro}
        storyboard={ep.storyboard}
        startAt={startAt}
        next={nextEp ? { id: nextEp.id, label: episodeLabel(nextEp) } : null}
        settings={settings}
        onSettingsChange={updateSettings}
        onTick={onTick}
        onPauseSave={() => flush.current?.()}
        onEnded={(dur) => markWatched(ep.id, dur, info)}
        onNext={goNext}
        onError={onError}
        onNoPicture={setNoPicture}
      />

      {processing && ep.media?.action && ep.media.action !== 'none' && (
        <p className="notice">
          <span className="spinner" /> Cette vidéo est en cours de préparation pour le navigateur
          ({Math.floor((ep.processing_progress || 0) * 100)} %). Si l'image reste noire, reviens quand c'est terminé.
        </p>
      )}
      {noPicture && !processing && (
        <p className="alert">
          Le son est lu mais pas l'image : ce navigateur ne sait pas décoder la piste vidéo{ep.media?.video ? ` (${ep.media.video})` : ''}.
          Essaie d'activer l'accélération matérielle du navigateur, ou relance la conversion depuis la page de la série (mode gestion).
        </p>
      )}
      {playError && <p className="alert">{playError}</p>}

      <div className="watch-bar">
        <div>
          <span className="eyebrow">{ep.series.title}{multiSeason || ep.season > 1 ? ` · ${seasonName(ep.series, ep.season)}` : ''}</span>
          <h1>{episodeLabel(ep)}</h1>
          <div className="episode-meta">
            {ep.subtitles.length
              ? ep.subtitles.map((s) => <span key={s.id} className="tag"><Icon name="captions" size={13} /> {s.label}</span>)
              : <span className="tag warn">Sans sous-titres</span>}
          </div>
        </div>
        <div className="row-actions">
          {ep.prev_id && <button className="ghost-btn" onClick={() => navigate(`/regarder/${ep.prev_id}`)}><Icon name="chevronLeft" size={18} /> Précédent</button>}
          {ep.next_id && <button className="ghost-btn" onClick={goNext}>Suivant <Icon name="chevronRight" size={18} /></button>}
        </div>
      </div>

      <details className="shortcuts">
        <summary><Icon name="key" size={15} /> Raccourcis clavier</summary>
        <ul>
          <li><kbd>Espace</kbd> ou <kbd>K</kbd> : lecture / pause</li>
          <li><kbd>←</kbd> <kbd>→</kbd> : reculer / avancer de 10 s</li>
          <li><kbd>↑</kbd> <kbd>↓</kbd> : volume</li>
          <li><kbd>F</kbd> : plein écran</li>
          <li><kbd>M</kbd> : couper le son</li>
          <li><kbd>S</kbd> : changer de sous-titres</li>
          <li><kbd>I</kbd> : passer l'intro</li>
          <li><kbd>N</kbd> : épisode suivant</li>
        </ul>
      </details>

      {manage && <IntroTools ep={ep} player={player} />}

      {ready.length > 1 && (
        <section className="shelf">
          <h2>Épisodes</h2>
          <ul className="row-scroll">
            {ready.map((e) => {
              const pr = progressOf(e.id);
              return (
                <li key={e.id}>
                  <Link to={`/regarder/${e.id}`} className={`continue-card${e.id === ep.id ? ' current' : ''}`}>
                    <Thumb src={e.thumb_url} seed={ep.series.title} number={e.number} progress={pr} watched={pr?.watched} playable={e.id !== ep.id} />
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

/** Reglage du generique depuis le lecteur (administrateurs, mode gestion). */
function IntroTools({ ep, player }) {
  const [start, setStart] = useState(ep.intro?.start ?? null);
  const [end, setEnd] = useState(ep.intro?.end ?? null);
  const [scope, setScope] = useState(ep.intro?.scope || 'series');
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    setStart(ep.intro?.start ?? null);
    setEnd(ep.intro?.end ?? null);
    setScope(ep.intro?.scope || 'series');
    setMsg(null);
  }, [ep.id, ep.intro?.start, ep.intro?.end, ep.intro?.scope]);

  const now = () => Math.round((player.current?.currentTime() || 0) * 10) / 10;
  const path = scope === 'series' ? `/series/${ep.series_id}/intro` : `/episodes/${ep.id}/intro`;

  async function save() {
    try {
      await api.put(path, { start, end });
      setMsg({ ok: true, text: scope === 'series' ? 'Générique enregistré pour toute la série.' : 'Générique enregistré pour cet épisode.' });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  }
  async function clear() {
    try {
      await api.put(path, { start: null, end: null });
      setMsg({ ok: true, text: scope === 'series' ? 'Générique de la série effacé.' : 'Réglage propre à cet épisode effacé : celui de la série s\'applique.' });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  }

  return (
    <section className="panel manage intro-tools">
      <h2><Icon name="upload" size={18} /> Générique d'ouverture</h2>
      <p className="muted small">Place la vidéo au début du générique puis clique « Début ici », et pareil pour la fin. Le bouton « Passer l'intro » apparaîtra pendant ce passage.</p>
      <div className="intro-row">
        <button className="ghost-btn" onClick={() => setStart(now())}>Début ici</button>
        <span className="intro-val">{start === null ? '—' : formatTime(start)}</span>
        <button className="ghost-btn" onClick={() => setEnd(now())}>Fin ici</button>
        <span className="intro-val">{end === null ? '—' : formatTime(end)}</span>
        {start !== null && <button className="link small" onClick={() => player.current?.seek(start)}>Revoir depuis le début du générique</button>}
      </div>
      <div className="intro-row">
        <label className="check"><input type="radio" name="scope" checked={scope === 'series'} onChange={() => setScope('series')} /> Pour toute la série</label>
        <label className="check"><input type="radio" name="scope" checked={scope === 'episode'} onChange={() => setScope('episode')} /> Seulement cet épisode</label>
      </div>
      {msg && <p className={msg.ok ? 'notice small' : 'alert small'}>{msg.text}</p>}
      <div className="row-actions start">
        <button className="primary" disabled={start === null || end === null} onClick={save}>Enregistrer</button>
        <button className="ghost-btn" onClick={clear}>Effacer</button>
      </div>
    </section>
  );
}
