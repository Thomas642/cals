import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { accentStyle, episodeLabel, formatBytes } from '../files.js';
import { recentBySeries, useProgress } from '../progress.js';
import { setManage, useManage } from '../manage.js';
import Icon from '../components/Icon.jsx';
import Poster from '../components/Poster.jsx';
import Thumb from '../components/Thumb.jsx';
import { LogoMark } from '../components/Logo.jsx';

function greeting() {
  const h = new Date().getHours();
  if (h < 5 || h >= 18) return 'Bonsoir';
  return 'Bonjour';
}

export default function Library({ user }) {
  const isAdmin = user.role === 'admin';
  const { data: series, error } = useApi('/series');
  const { data: recentlyAdded } = useApi('/recent');
  const { data: storage } = useApi(isAdmin ? '/storage' : null);
  const manage = useManage() && isAdmin;
  useProgress(); // re-rendu quand la progression change
  const [adding, setAdding] = useState(false);
  const firstName = user.display_name || user.username;

  const recent = series ? recentBySeries().filter((p) => series.some((s) => s.id === p.seriesId)).slice(0, 12) : [];
  const featured = series && (series.find((s) => s.id === recent[0]?.seriesId) || series.find((s) => s.episode_count > 0));

  if (error) return <p className="alert">{error.message}</p>;
  if (series === undefined) return <LibrarySkeleton />;

  if (series.length === 0 && !adding) {
    return (
      <section className="welcome">
        <div className="welcome-art"><LogoMark size={88} /></div>
        <h1>{greeting()} {firstName} !</h1>
        {isAdmin ? (
          <>
            <p>La bibliothèque est vide. Crée une première série, puis importe ses épisodes et leurs sous-titres.</p>
            <button className="primary big-btn" onClick={() => { setManage(true); setAdding(true); }}><Icon name="plus" size={18} /> Créer une série</button>
          </>
        ) : <p>Aucune série pour l'instant. Reviens bientôt !</p>}
      </section>
    );
  }

  return (
    <>
      {featured && !adding && <Hero series={featured} recent={recent.find((p) => p.seriesId === featured.id)} hello={`${greeting()} ${firstName}`} />}

      {adding && <NewSeries onClose={() => setAdding(false)} />}

      {series.some((s) => s.in_list) && (
        <section className="shelf">
          <div className="shelf-head"><h2>Ma liste</h2></div>
          <ul className="row-scroll posters">
            {series.filter((s) => s.in_list).map((s) => (
              <li key={s.id}><PosterCard s={s} /></li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section className="shelf">
          <div className="shelf-head"><h2>Continuer à regarder</h2></div>
          <ul className="row-scroll">
            {recent.map((p) => (
              <li key={p.seriesId}>
                <Link to={`/regarder/${p.episodeId}`} className="continue-card">
                  <Thumb src={p.thumb} seed={p.seriesTitle} progress={p} watched={p.watched} />
                  <strong>{p.seriesTitle}</strong>
                  <span className="muted small">{p.watched ? `${p.label} · vu` : p.dur ? `${p.label} · ${Math.max(1, Math.round((p.dur - p.pos) / 60))} min restantes` : p.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentlyAdded?.length > 0 && (
        <section className="shelf">
          <div className="shelf-head"><h2>Récemment ajoutés</h2></div>
          <ul className="row-scroll">
            {recentlyAdded.map((e) => (
              <li key={e.id}>
                <Link to={`/regarder/${e.id}`} className="continue-card">
                  <div className="thumb-wrap">
                    <Thumb src={e.thumb_url} seed={e.series_title} number={e.number} storyboard={e.storyboard} />
                    {e.is_new && <span className="badge-new on-thumb">Nouveau</span>}
                  </div>
                  <strong>{e.series_title}</strong>
                  <span className="muted small">{episodeLabel(e)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="shelf">
        <div className="shelf-head">
          <h2>Toutes les séries <span className="count">{series.length}</span></h2>
          {manage && !adding && <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Nouvelle série</button>}
        </div>
        <ul className="poster-grid">
          {series.map((s, i) => (
            <li key={s.id} style={{ '--i': i }}><PosterCard s={s} /></li>
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

function PosterCard({ s }) {
  return (
    <Link to={`/serie/${s.id}`} className="poster-card" style={accentStyle(s.accent)}>
      <div className="poster-wrap">
        <Poster series={s} />
        <span className="poster-hover"><span className="poster-play"><Icon name="play" size={22} /></span></span>
        {s.new_count > 0 && <span className="badge-new on-poster">{s.new_count} nouveau{s.new_count > 1 ? 'x' : ''}</span>}
        {s.in_list && <span className="list-flag" title="Dans ma liste"><Icon name="bookmarkOn" size={14} /></span>}
      </div>
      <strong>{s.title}</strong>
      <span className="muted small">
        {[s.year, `${s.episode_count} épisode${s.episode_count > 1 ? 's' : ''}`,
          s.episode_count > 0 && s.subtitled_count > 0 ? (s.subtitled_count === s.episode_count ? 'VOSTFR' : `${s.subtitled_count} sous-titré${s.subtitled_count > 1 ? 's' : ''}`) : null]
          .filter(Boolean).join(' · ')}
      </span>
    </Link>
  );
}

function Hero({ series, recent, hello }) {
  // Fond : miniature 16:9 de l'episode en cours, sinon l'affiche floutee (format portrait).
  // Sans affiche importee, cover_url est la miniature (16:9) du premier episode : affichee nette.
  const bg = recent?.thumb || (!series.has_custom_cover ? series.cover_url : null);
  return (
    <section className="hero">
      <div className="hero-media">
        {bg ? <img className="hero-bg kenburns" src={bg} alt="" />
          : series.cover_url && <img className="hero-bg blur" src={series.cover_url} alt="" />}
      </div>
      <div className="hero-shade" />
      <div className="hero-content">
        <span className="hello">{hello}</span>
        <span className="eyebrow">{recent ? (recent.watched ? 'Dernier épisode vu' : 'Reprendre où tu t\'es arrêté') : 'À découvrir'}</span>
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
    <form className="panel form new-series" onSubmit={submit}>
      <h2>Nouvelle série</h2>
      <label>Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus placeholder="ex. Re:Zero, saison 1" />
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
