import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks/useApi.js';
import Skeleton from '../components/Skeleton.jsx';
import { n0, n1, shortDate, todayIso } from '../format.js';
import LineChart from '../components/LineChart.jsx';

export default function Stats({ onProfileChange }) {
  const { data: stats } = useApi(`/stats?end=${todayIso()}`);
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState(null);


  async function addWeight(e) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/weights', { date, weight_kg: weight });
      setWeight('');
      onProfileChange();
    } catch (err) { setError(err.message); }
  }

  async function removeWeight(id) {
    await api.del(`/weights/${id}`);
    onProfileChange();
  }

  if (!stats) return <><h1>Statistiques</h1><Skeleton lines={5} /><Skeleton lines={4} /></>;
  return (
    <>
      <h1>Statistiques</h1>
      <section className="card">
        <h2>Poids</h2>
        <form className="row inline-form" onSubmit={addWeight}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <input inputMode="decimal" placeholder="kg" value={weight} onChange={(e) => setWeight(e.target.value)} required size={6} />
          <button type="submit" className="primary">Enregistrer</button>
        </form>
        {error && <p className="alert">{error}</p>}
        <p className="muted small">Une mesure par jour. La mesure la plus récente met à jour le poids du profil et recalcule les cibles (sauf cibles manuelles).</p>
        <LineChart points={stats.weights} unit="kg"
          series={[{ key: 'weight_kg', label: 'Poids', className: 's1' }, { key: 'avg7', label: 'Moyenne glissante 7 j', className: 's2' }]} />
        {stats.weights.length > 0 && (
          <details>
            <summary>Historique ({stats.weights.length})</summary>
            <ul className="entries">
              {[...stats.weights].reverse().map((w) => (
                <li key={w.id}><span>{shortDate(w.date)} {w.date.slice(0, 4)}</span>
                  <span className="entry-values">{n1(w.weight_kg)} kg
                    <button className="icon" aria-label="Supprimer la mesure" onClick={() => removeWeight(w.id)}>✕</button></span></li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <h2>Adhérence aux cibles</h2>
        <div className="stats-grid two">
          <Adherence a={stats.adherence7} />
          <Adherence a={stats.adherence30} />
        </div>
        <p className="muted small">Calculé sur les jours comportant au moins une entrée. Écart = moyenne journalière − cible ; écart absolu = moyenne des écarts journaliers en valeur absolue.</p>
      </section>

      <section className="card">
        <h2>Calories (30 jours)</h2>
        <LineChart points={stats.days} unit="kcal" target={stats.targets?.kcal} series={[{ key: 'kcal', label: 'kcal / jour', className: 's1' }]} />
        <h2>Protéines (30 jours)</h2>
        <LineChart points={stats.days} unit="g" target={stats.targets?.protein_g} series={[{ key: 'protein_g', label: 'g / jour', className: 's2' }]} />
      </section>
    </>
  );
}

function Adherence({ a }) {
  const sign = (v) => (v === null ? '–' : `${v > 0 ? '+' : ''}${n0(v)}`);
  return (
    <div>
      <h3>{a.days} derniers jours</h3>
      <p className="muted small">{a.logged_days} jour(s) saisi(s)</p>
      {a.avg_kcal === null ? <p className="muted">Pas de données.</p> : (
        <dl>
          <dt>Moyenne kcal</dt><dd>{n0(a.avg_kcal)} (écart {sign(a.kcal_gap)}, abs. {n0(a.kcal_abs_gap)})</dd>
          <dt>Moyenne protéines</dt><dd>{n0(a.avg_protein_g)} g (écart {sign(a.protein_gap)} g, abs. {n0(a.protein_abs_gap)} g)</dd>
        </dl>
      )}
    </div>
  );
}
