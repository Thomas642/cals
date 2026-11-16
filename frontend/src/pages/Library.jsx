import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { formatBytes } from '../files.js';
import { recentBySeries, useProgress } from '../progress.js';
import { setManage, useManage } from '../manage.js';
import Icon from '../components/Icon.jsx';
import Poster from '../components/Poster.jsx';
import Thumb from '../components/Thumb.jsx';

export default function Library() {
  const { data: series, error } = useApi('/series');
  const { data: storage } = useApi('/storage');
  const manage = useManage();
  useProgress(); // re-rendu quand la progression change
  const [adding, setAdding] = useState(false);

  const recent = series ? recentBySeries().filter((p) => series.some((s) => s.id === p.seriesId)).slice(0, 12) : [];
  const featured = series && (series.find((s) => s.id === recent[0]?.seriesId) || series.find((s) => s.episode_count > 0));

  if (error) return <p className="alert">{error.message}</p>;
  if (series === undefined) return <LibrarySkeleton />;

  if (series.length === 0 && !adding) {
    return (
      <section className="welcome">
        <div className="welcome-art" aria-hidden="true"><Icon name="library" size={44} /></div>
        <h1>Bienvenue</h1>
        <p>Crée ta première série, puis importe ses épisodes et leurs sous-titres.</p>
        <button className="primary big-btn" onClick={() => { setManage(true); setAdding(true); }}><Icon name="plus" size={18} /> Créer une série</button>
      </section>
    );
  }

  return (
    <>
      {featured && !adding && <Hero series={featured} recent={recent.find((p) => p.seriesId === featured.id)} />}

      {adding && <NewSeries onClose={() => setAdding(false)} />}

      {recent.length > 0 && (
        <section className="shelf">
          <h2>Continuer à regarder</h2>
          <ul className="row-scroll">
            {recent.map((p) => (
              <li key={p.seriesId}>
                <Link to={`/regarder/${p.episodeId}`} className="continue-card">
                  <Thumb src={p.thumb} seed={p.seriesTitle} progress={p} watched={p.watched} />
                  <strong>{p.seriesTitle}</strong>
                  <span className="muted small">{p.watched ? `${p.label} · vu` : p.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="shelf">
        <div className="shelf-head">
          <h2>Toutes les séries</h2>
          {manage && !adding && <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Nouvelle série</button>}
        </div>
        <ul className="poster-grid">
          {series.map((s) => (
            <li key={s.id}>
              <Link to={`/serie/${s.id}`} className="poster-card">
                <Poster series={s} />
                <strong>{s.title}</strong>
                <span className="muted small">
                  {s.episode_count} épisode{s.episode_count > 1 ? 's' : ''}
                  {s.episode_count > 0 && s.subtitled_count > 0 && ` · ${s.subtitled_count === s.episode_count ? 'VOSTFR' : `${s.subtitled_count} sous-titré${s.subtitled_count > 1 ? 's' : ''}`}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {manage && storage && (
        <p className="muted small storage">
          Vidéos : {formatBytes(storage.videos_bytes)} · Espace libre sur le serveur : {formatBytes(storage.free_bytes)}
        </p>
      )}
    </>
  );
}

function Hero({ series, recent }) {
  return (
    <section className="hero">
      {/* Fond : miniature 16:9 de l'episode en cours, sinon l'affiche floutee (format portrait). */}
      {recent?.thumb
        ? <img className="hero-bg" src={recent.thumb} alt="" />
        : series.cover_url && <img className="hero-bg blur" src={series.cover_url} alt="" />}
      <div className="hero-shade" />
      <div className="hero-content">
        <span className="eyebrow">{recent ? 'Reprendre' : 'À voir'}</span>
        <h1>{series.title}</h1>
        {series.description && <p className="hero-desc">{series.description}</p>}
        <div className="row-actions start">
          {recent
            ? <Link className="button primary big-btn" to={`/regarder/${recent.episodeId}`}><Icon name="play" size={18} /> {recent.watched ? 'Revoir' : 'Reprendre'} · {recent.label}</Link>
            : <Link className="button primary big-btn" to={`/serie/${series.id}`}><Icon name="play" size={18} /> Voir les épisodes</Link>}
          {recent && <Link className="button glass big-btn" to={`/serie/${series.id}`}>Tous les épisodes</Link>}
        </div>
      </div>
    </section>
  );
}

function LibrarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Chargement">
      <div className="hero sk-block" />
      <ul className="poster-grid">{Array.from({ length: 6 }, (_, i) => <li key={i}><div className="poster sk-block" /></li>)}</ul>
    </div>
  );
}

function NewSeries({ onClose }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api.post('/series', { title, description });
      navigate(`/serie/${s.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Nouvelle série</h2>
      <label>Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus placeholder="ex. Frieren, saison 1" />
      </label>
      <label>Description <span className="muted small">(facultatif)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} />
      </label>
      {error && <p className="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" className="ghost-btn" onClick={onClose}>Annuler</button>
        <button type="submit" className="primary" disabled={busy || !title.trim()}>{busy ? <span className="spinner" /> : <Icon name="check" size={18} />} Créer</button>
      </div>
    </form>
  );
}
