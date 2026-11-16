import { useCallback, useEffect, useRef, useState } from 'react';
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
  const { data: top } = useApi('/top');
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState(null);
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

  const genres = [...new Set(series.flatMap((s) => s.genres || []))].sort((a, b) => a.localeCompare(b, 'fr'));
  const filtering = q.trim() !== '' || genre !== null;
  const results = filtering ? series.filter((s) => (!genre || s.genres?.includes(genre)) && matches(s, q)) : [];
  const reco = recommend(series, recent);

  return (
    <>
      {featured && !adding && <HeroCarousel slides={pickSlides(series, recent)} hello={`${greeting()} ${firstName}`} />}

      {adding && <NewSeries onClose={() => setAdding(false)} />}

      <section className="finder" aria-label="Rechercher une série">
        <div className="search-box">
          <Icon name="search" size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher une série (titre, romaji, japonais)…" aria-label="Rechercher une série" />
          {q && <button className="icon-btn ghost" onClick={() => setQ('')} aria-label="Effacer la recherche"><Icon name="close" size={16} /></button>}
        </div>
        {genres.length > 0 && (
          <div className="genre-chips" role="group" aria-label="Filtrer par genre">
            <button className={genre === null ? 'sel' : ''} aria-pressed={genre === null} onClick={() => setGenre(null)}>Tous</button>
            {genres.map((g) => <button key={g} className={genre === g ? 'sel' : ''} aria-pressed={genre === g} onClick={() => setGenre(genre === g ? null : g)}>{g}</button>)}
          </div>
        )}
      </section>

      {filtering ? (
        <section className="shelf">
          <div className="shelf-head"><h2>{results.length} résultat{results.length > 1 ? 's' : ''}{genre ? ` · ${genre}` : ''}</h2></div>
          {results.length === 0 ? <p className="empty">Aucune série ne correspond.</p> : (
            <ul className="poster-grid">{results.map((s, i) => <li key={s.id} style={{ '--i': i }}><PosterCard s={s} /></li>)}</ul>
          )}
        </section>
      ) : (<>

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

      {top?.length > 0 && (
        <section className="shelf">
          <div className="shelf-head"><h2>Top 10 de la famille</h2></div>
          <ol className="row-scroll top10">
            {top.map((s, i) => (
              <li key={s.id}>
                <Link to={`/serie/${s.id}`} className="top-card" style={accentStyle(s.accent)} aria-label={`Numéro ${i + 1} : ${s.title}, ${s.viewers} personne${s.viewers > 1 ? 's' : ''}`}>
                  <span className="top-rank" aria-hidden="true">{i + 1}</span>
                  <Poster series={s} />
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {reco && (
        <section className="shelf">
          <div className="shelf-head"><h2>Parce que tu as regardé {reco.anchor.title}</h2></div>
          <ul className="row-scroll posters">
            {reco.items.map((s) => <li key={s.id}><PosterCard s={s} /></li>)}
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
                    <Thumb src={e.thumb_url} seed={e.series_title} number={e.number} storyboard={e.storyboard} duration={e.duration} />
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

      </>)}

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

// Recherche sans accents ni majuscules, sur le titre, le romaji et le titre japonais.
const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function matches(s, q) {
  const n = norm(q.trim());
  return !n || [s.title, s.title_romaji, s.title_native].some((t) => norm(t).includes(n));
}

// « Parce que tu as regarde... » : series pas encore commencees, classees par genres en commun avec celles vues.
function recommend(series, recent) {
  const seen = new Set(recent.map((r) => r.seriesId));
  const weights = new Map();
  for (const s of series.filter((x) => seen.has(x.id))) for (const g of s.genres || []) weights.set(g, (weights.get(g) || 0) + 1);
  if (!weights.size) return null;
  const items = series
    .filter((s) => !seen.has(s.id) && s.episode_count > 0)
    .map((s) => ({ s, score: (s.genres || []).reduce((t, g) => t + (weights.get(g) || 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.s);
  if (!items.length) return null;
  // Serie de reference : la plus recemment regardee qui partage un genre avec la premiere suggestion.
  const anchorId = recent.find((r) => series.find((x) => x.id === r.seriesId)?.genres?.some((g) => items[0].genres?.includes(g)))?.seriesId;
  const anchor = series.find((x) => x.id === anchorId);
  return anchor ? { anchor, items } : null;
}

// Series mises en avant : en cours d'abord, puis avec des nouveautes, puis les autres ; 5 au plus.
function pickSlides(series, recent) {
  const out = [];
  const add = (s, r) => { if (s && s.episode_count > 0 && !out.some((x) => x.series.id === s.id) && out.length < 5) out.push({ series: s, recent: r }); };
  recent.slice(0, 2).forEach((r) => add(series.find((s) => s.id === r.seriesId), r));
  series.filter((s) => s.new_count > 0).sort((a, b) => (b.last_added || '').localeCompare(a.last_added || '')).forEach((s) => add(s, recent.find((r) => r.seriesId === s.id)));
  [...series].sort((a, b) => (b.last_added || '').localeCompare(a.last_added || '')).forEach((s) => add(s, recent.find((r) => r.seriesId === s.id)));
  return out;
}

const SLIDE_MS = 8000;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Carrousel de l'accueil : defilement automatique (pause au survol, au focus et si l'onglet est cache). */
function HeroCarousel({ slides, hello }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef(null);
  const count = slides.length;
  const go = useCallback((i) => setIndex(((i % count) + count) % count), [count]);

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (count < 2 || paused || reducedMotion()) return undefined;
    const t = setTimeout(() => { if (!document.hidden) go(index + 1); }, SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, count, go]);

  if (!count) return null;
  return (
    <section
      className="hero carousel"
      aria-roledescription="carrousel"
      aria-label="Séries mises en avant"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPaused(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPaused(false); }}
      onFocus={() => setPaused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
      }}
    >
      {slides.map((sl, i) => (
        <Slide key={sl.series.id} {...sl} hello={hello} active={i === index} label={`${i + 1} sur ${count}`} />
      ))}
      {count > 1 && (
        <>
          <button className="car-arrow prev" onClick={() => go(index - 1)} aria-label="Série précédente"><Icon name="chevronLeft" size={22} /></button>
          <button className="car-arrow next" onClick={() => go(index + 1)} aria-label="Série suivante"><Icon name="chevronRight" size={22} /></button>
          <div className="car-dots" role="tablist" aria-label="Choisir une série">
            {slides.map((sl, i) => (
              <button key={sl.series.id} role="tab" aria-selected={i === index} aria-label={sl.series.title} className={i === index ? 'on' : ''}
                onClick={() => go(i)} style={accentStyle(sl.series.accent)}>
                {i === index && !paused && !reducedMotion() && <span style={{ animationDuration: `${SLIDE_MS}ms` }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Slide({ series, recent, hello, active, label }) {
  // Fond : miniature 16:9 de l'episode en cours, sinon (sans affiche importee) la premiere miniature, nette ;
  // une affiche importee (format portrait) est floutee.
  const bg = recent?.thumb || (!series.has_custom_cover ? series.cover_url : null);
  const eyebrow = recent ? (recent.watched ? 'Dernier épisode vu' : 'Reprendre où tu t\'es arrêté')
    : series.new_count > 0 ? `${series.new_count} nouvel${series.new_count > 1 ? 's' : ''} épisode${series.new_count > 1 ? 's' : ''}` : 'À découvrir';
  return (
    <div className={`slide themed${active ? ' active' : ''}`} style={accentStyle(series.accent)} aria-hidden={!active}
      role="group" aria-roledescription="diapositive" aria-label={`${series.title} (${label})`}>
      <div className="hero-media">
        {bg ? <img className={`hero-bg${active ? ' kenburns' : ''}`} src={bg} alt="" />
          : series.cover_url && <img className="hero-bg blur" src={series.cover_url} alt="" />}
      </div>
      <div className="hero-shade" />
      <div className="hero-content">
        <span className="hello">{hello}</span>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{series.title}</h1>
        {(series.year || series.genres?.length > 0) && (
          <div className="genres">
            {series.year && <span className="genre">{series.year}</span>}
            {series.genres?.slice(0, 3).map((g) => <span key={g} className="genre">{g}</span>)}
          </div>
        )}
        {series.description && <p className="hero-desc">{series.description}</p>}
        <div className="row-actions start">
          {recent
            ? <Link tabIndex={active ? 0 : -1} className="button primary big-btn" to={`/regarder/${recent.episodeId}`}><Icon name="play" size={18} /> {recent.watched ? 'Revoir' : 'Reprendre'} · {recent.label}</Link>
            : <Link tabIndex={active ? 0 : -1} className="button primary big-btn" to={`/serie/${series.id}`}><Icon name="play" size={18} /> Voir les épisodes</Link>}
          {recent && <Link tabIndex={active ? 0 : -1} className="button glass big-btn" to={`/serie/${series.id}`}>Tous les épisodes</Link>}
        </div>
      </div>
    </div>
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
