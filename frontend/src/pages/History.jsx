import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { episodeLabel } from '../files.js';
import { loadProgress } from '../progress.js';
import Icon from '../components/Icon.jsx';
import Thumb from '../components/Thumb.jsx';

const toDate = (sql) => new Date(`${String(sql).replace(' ', 'T')}Z`);

function dayLabel(d) {
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Aujourd\'hui';
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

/** Mon historique : tout ce que le profil a regarde, par jour ; on peut retirer une entree ou tout effacer. */
export default function History() {
  const { data: rows, error } = useApi('/me/history');
  const [busy, setBusy] = useState(false);

  async function removeOne(r) {
    try { await api.del(`/progress/${r.episode_id}`); await loadProgress(); } catch (err) { window.alert(err.message); }
  }
  async function clearAll() {
    if (!window.confirm('Effacer tout ton historique ? La progression (reprise, épisodes vus) sera remise à zéro.')) return;
    setBusy(true);
    try { await api.del('/me/history'); await loadProgress(); } catch (err) { window.alert(err.message); } finally { setBusy(false); }
  }

  const groups = [];
  for (const r of rows || []) {
    const d = toDate(r.updated_at);
    const label = dayLabel(d);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push({ ...r, date: d });
  }

  return (
    <div className="history-page">
      <header className="page-head dash-head">
        <div>
          <span className="eyebrow">Mon historique</span>
          <h1>Ce que j'ai regardé</h1>
        </div>
        {rows?.length > 0 && <button className="ghost-btn danger" onClick={clearAll} disabled={busy}><Icon name="trash" size={16} /> Tout effacer</button>}
      </header>
      {error && <p className="alert">{error.message}</p>}
      {!rows && !error && <div aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="sk-line w70" />)}</div>}
      {rows?.length === 0 && <p className="empty">Rien pour l'instant : les épisodes que tu regardes apparaîtront ici.</p>}
      {groups.map((g) => (
        <section key={g.label} className="history-day">
          <h2>{g.label}</h2>
          <ul className="history-list">
            {g.items.map((r) => {
              const pct = r.dur ? Math.round((r.pos / r.dur) * 100) : 0;
              return (
                <li key={r.episode_id} className="history-row">
                  <Link to={`/regarder/${r.episode_id}`} className="history-thumb"><Thumb src={r.thumb_url} seed={r.series_title} number={r.number} progress={r} watched={r.watched} /></Link>
                  <div className="grow">
                    <Link to={`/serie/${r.series_id}`} className="history-series">{r.series_title}</Link>
                    <Link to={`/regarder/${r.episode_id}`} className="history-ep">{episodeLabel(r)}</Link>
                    <span className="muted small">
                      {r.watched ? 'Vu' : pct > 0 ? `Arrêté à ${pct} %` : 'Commencé'} · {r.date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <button className="icon-btn ghost danger" onClick={() => removeOne(r)} aria-label={`Retirer ${r.series_title} ${episodeLabel(r)} de l'historique`} title="Retirer de l'historique">
                    <Icon name="close" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
