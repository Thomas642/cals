import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { longDate, n0, n1, shiftDate, todayIso, unitLabel } from '../format.js';
import Gauge from '../components/Gauge.jsx';
import FoodPicker from '../components/FoodPicker.jsx';

const ORIGIN_LABELS = { base: 'base', free: 'libre', recipe: 'recette', ia: 'IA' };

export default function Journal({ profile }) {
  const [date, setDate] = useState(todayIso());
  const [day, setDay] = useState(null);
  const [tab, setTab] = useState('base');
  const [error, setError] = useState(null);

  const load = useCallback(() => api.get(`/journal?date=${date}`).then(setDay).catch((e) => setError(e.message)), [date]);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }

  const t = day?.totals;
  return (
    <>
      <div className="date-nav">
        <button onClick={() => setDate(shiftDate(date, -1))} aria-label="Jour précédent">‹</button>
        <div>
          <h1>{longDate(date)}</h1>
          {date !== todayIso() && <button className="link" onClick={() => setDate(todayIso())}>Revenir à aujourd'hui</button>}
        </div>
        <button onClick={() => setDate(shiftDate(date, 1))} aria-label="Jour suivant">›</button>
      </div>

      {t && (
        <section className="card gauges">
          <Gauge label="Calories" value={t.kcal} target={profile.target_kcal} unit="kcal" />
          <Gauge label="Protéines" value={t.protein_g} target={profile.target_protein_g} unit="g" />
          <Gauge label="Glucides" value={t.carbs_g} target={profile.target_carbs_g} unit="g" incomplete={t.missing_carbs} />
          <Gauge label="Lipides" value={t.fat_g} target={profile.target_fat_g} unit="g" incomplete={t.missing_fat} />
        </section>
      )}

      {error && <p className="alert">{error}</p>}

      <section className="card">
        <h2>Repas du jour</h2>
        {day?.entries.length ? (
          <ul className="entries">
            {day.entries.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.display_name}</strong>
                  <span className="muted small"> · {n1(e.quantity)} {unitLabel(e.unit, e.quantity)} · {ORIGIN_LABELS[e.origin]}</span>
                </div>
                <div className="entry-values">
                  <span>{n0(e.kcal)} kcal</span>
                  <span className="muted">{n1(e.protein_g)} g P</span>
                  <button className="icon" aria-label={`Supprimer ${e.display_name}`} onClick={() => run(() => api.del(`/journal/${e.id}`))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Aucune entrée pour ce jour.</p>}
        {day?.entries.length > 0 && <SaveRoutine date={date} onError={setError} />}
      </section>

      <section className="card">
        <h2>Ajouter</h2>
        <div className="tabs" role="tablist">
          {[['base', 'Depuis la base'], ['free', 'Saisie libre'], ['recipe', 'Recette'], ['routine', 'Routine']].map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab === 'base' && <FoodPicker onPick={(food, quantity) => run(() => api.post('/journal', { date, food_id: food.id, quantity }))} />}
        {tab === 'free' && <FreeEntry onAdd={(entry) => run(() => api.post('/journal', { ...entry, date, origin: 'free' }))} />}
        {tab === 'recipe' && <RecipeAdd onAdd={(id, servings) => run(() => api.post(`/recipes/${id}/log`, { date, servings }))} />}
        {tab === 'routine' && <RoutineAdd onAdd={(id) => run(() => api.post(`/routines/${id}/log`, { date }))} />}
      </section>
    </>
  );
}

function FreeEntry({ onAdd }) {
  const empty = { display_name: '', quantity: '', unit: 'g', kcal: '', protein_g: '', carbs_g: '', fat_g: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onAdd(f); setF(empty); }}>
      <label>Nom<input value={f.display_name} onChange={set('display_name')} required /></label>
      <div className="row">
        <label className="grow">Quantité<input inputMode="decimal" value={f.quantity} onChange={set('quantity')} required /></label>
        <label className="grow">Unité<select value={f.unit} onChange={set('unit')}><option value="g">g</option><option value="unit">unité</option></select></label>
      </div>
      <p className="muted small">Valeurs totales pour la quantité saisie.</p>
      <div className="row wrap">
        <label className="grow">kcal<input inputMode="decimal" value={f.kcal} onChange={set('kcal')} required /></label>
        <label className="grow">Protéines (g)<input inputMode="decimal" value={f.protein_g} onChange={set('protein_g')} /></label>
        <label className="grow">Glucides (g)<input inputMode="decimal" value={f.carbs_g} onChange={set('carbs_g')} /></label>
        <label className="grow">Lipides (g)<input inputMode="decimal" value={f.fat_g} onChange={set('fat_g')} /></label>
      </div>
      <button className="primary" type="submit">Ajouter</button>
    </form>
  );
}

function RecipeAdd({ onAdd }) {
  const [recipes, setRecipes] = useState(null);
  const [servings, setServings] = useState('1');
  useEffect(() => { api.get('/recipes').then(setRecipes).catch(() => setRecipes([])); }, []);
  if (!recipes) return <p className="muted">Chargement…</p>;
  if (!recipes.length) return <p className="muted">Aucune recette. Créez-en une dans l'onglet Recettes.</p>;
  return (
    <>
      <label>Portions<input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} /></label>
      <ul className="entries">
        {recipes.map((r) => (
          <li key={r.id}>
            <div><strong>{r.name}</strong><span className="muted small"> · {n0(r.per_serving.kcal)} kcal · {n1(r.per_serving.protein_g)} g P / portion</span></div>
            <button onClick={() => onAdd(r.id, Number(servings.replace(',', '.')) || 1)}>Ajouter</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function RoutineAdd({ onAdd }) {
  const [routines, setRoutines] = useState(null);
  const load = () => api.get('/routines').then(setRoutines).catch(() => setRoutines([]));
  useEffect(() => { load(); }, []);
  if (!routines) return <p className="muted">Chargement…</p>;
  if (!routines.length) return <p className="muted">Aucune routine. Enregistrez les entrées d'un jour comme routine.</p>;
  return (
    <ul className="entries">
      {routines.map((r) => (
        <li key={r.id}>
          <div><strong>{r.name}</strong><span className="muted small"> · {r.items.length} élément(s) · {n0(r.totals.kcal)} kcal · {n1(r.totals.protein_g)} g P</span></div>
          <div className="entry-values">
            <button onClick={() => onAdd(r.id)}>Ajouter</button>
            <button className="icon" aria-label={`Supprimer la routine ${r.name}`} onClick={() => api.del(`/routines/${r.id}`).then(load)}>✕</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SaveRoutine({ date, onError }) {
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  async function save(e) {
    e.preventDefault();
    try { await api.post('/routines', { name, from_date: date }); setDone(true); setName(''); } catch (err) { onError(err.message); }
  }
  return (
    <form className="row inline-form" onSubmit={save}>
      <input placeholder="Nom de routine (ex. Petit-déjeuner)" value={name} onChange={(e) => { setName(e.target.value); setDone(false); }} required />
      <button type="submit">Enregistrer comme routine</button>
      {done && <span className="ok small">Routine créée.</span>}
    </form>
  );
}
