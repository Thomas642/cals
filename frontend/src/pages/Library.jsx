import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { formatBytes } from '../files.js';
import Icon from '../components/Icon.jsx';
import Skeleton from '../components/Skeleton.jsx';

// Couleur stable par serie (vignette sans image).
export function hueOf(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

export default function Library() {
  const { data: series, error } = useApi('/series');
  const { data: storage } = useApi('/storage');
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="title-row">
        <h1>Bibliothèque</h1>
        {!adding && <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Nouvelle série</button>}
      </div>

      {adding && <NewSeries onClose={() => setAdding(false)} />}
      {error && <p className="alert">{error.message}</p>}
      {series === undefined && !error && <Skeleton lines={4} />}

      {series?.length === 0 && !adding && (
        <section className="card empty-state">
          <Icon name="library" size={40} />
          <h2>Aucune série pour l'instant</h2>
          <p className="muted">Crée une série, puis importe ses épisodes et leurs sous-titres.</p>
          <button className="primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Créer une série</button>
        </section>
      )}

      {series?.length > 0 && (
        <ul className="series-grid">
          {series.map((s) => (
            <li key={s.id}>
              <Link to={`/serie/${s.id}`} className="series-card">
                <div className="cover" style={{ '--h': hueOf(s.title) }}><span>{[...s.title.trim()][0]?.toUpperCase()}</span></div>
                <div className="series-info">
                  <strong>{s.title}</strong>
                  <span className="muted small">
                    {s.episode_count} épisode{s.episode_count > 1 ? 's' : ''}
                    {s.episode_count > 0 && ` · ${s.subtitled_count} sous-titré${s.subtitled_count > 1 ? 's' : ''}`}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {storage && (
        <p className="muted small storage">
          Vidéos : {formatBytes(storage.videos_bytes)} · Espace libre sur le serveur : {formatBytes(storage.free_bytes)}
        </p>
      )}
    </>
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
    <form className="card form" onSubmit={submit}>
      <h2>Nouvelle série</h2>
      <label>Titre
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus placeholder="ex. Frieren, saison 1" />
      </label>
      <label>Description <span className="muted small">(facultatif)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={4000} />
      </label>
      {error && <p className="alert">{error}</p>}
      <div className="row-actions">
        <button type="button" onClick={onClose}>Annuler</button>
        <button type="submit" className="primary" disabled={busy || !title.trim()}>{busy ? <span className="spinner" /> : <Icon name="check" size={18} />} Créer</button>
      </div>
    </form>
  );
}
