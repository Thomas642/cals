import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks/useApi.js';
import { longDate, n0, n1, shiftDate, todayIso, unitLabel } from '../format.js';
import Gauge from '../components/Gauge.jsx';
import Ring from '../components/Ring.jsx';
import Icon from '../components/Icon.jsx';
import Skeleton from '../components/Skeleton.jsx';
import FoodPicker from '../components/FoodPicker.jsx';

const ORIGIN_LABELS = { base: 'base', free: 'libre', recipe: 'recette', ia: 'IA' };

export default function Journal({ profile }) {
  const [date, setDate] = useState(todayIso());
  const { data: day } = useApi(`/journal?date=${date}`);
  const [tab, setTab] = useState('base');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setError(null);
    try { await fn(); } catch (e) { setError(e.message); }
  }

  const t = day?.totals;
  const isToday = date === todayIso();
  return (
    <>
      <div className="date-nav">
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, -1))} aria-label="Jour précédent"><Icon name="chevronLeft" /></button>
        <div className="date-title">
          <span className="eyebrow">{isToday ? "Aujourd'hui" : 'Journal'}</span>
          <h1>{longDate(date)}</h1>
          {!isToday && <button className="link" onClick={() => setDate(todayIso())}>Revenir à aujourd'hui</button>}
        </div>
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, 1))} aria-label="Jour suivant"><Icon name="chevronRight" /></button>
      </div>

      {!t ? <Skeleton lines={4} /> : (
        <section className="card summary">
          <Ring value={t.kcal} target={profile.target_kcal} />
          <div className="macros">
            <Gauge label="Protéines" value={t.protein_g} target={profile.target_protein_g} unit="g" tone="protein" />
            <Gauge label="Glucides" value={t.carbs_g} target={profile.target_carbs_g} unit="g" incomplete={t.missing_carbs} tone="carbs" />
            <Gauge label="Lipides" value={t.fat_g} target={profile.target_fat_g} unit="g" incomplete={t.missing_fat} tone="fat" />
          </div>
        </section>
      )}

      {error && <p className="alert">{error}</p>}

      <section className="card">
        <div className="title-row">
          <h2>Repas du jour</h2>
          <button className="primary" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Icon name={adding ? 'close' : 'plus'} size={18} /> {adding ? 'Fermer' : 'Ajouter'}
          </button>
        </div>

        {adding && (
          <div className="add-panel">
            <div className="segmented" role="tablist">
              {[['base', 'Base'], ['free', 'Libre'], ['recipe', 'Recette'], ['routine', 'Routine']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {tab === 'base' && <FoodPicker onPick={(food, quantity) => run(() => api.post('/journal', { date, food_id: food.id, quantity }))} />}
            {tab === 'free' && <FreeEntry onAdd={(entry) => run(() => api.post('/journal', { ...entry, date, origin: 'free' }))} />}
            {tab === 'recipe' && <RecipeAdd onAdd={(id, servings) => run(() => api.post(`/recipes/${id}/log`, { date, servings }))} />}
            {tab === 'routine' && <RoutineAdd onAdd={(id) => run(() => api.post(`/routines/${id}/log`, { date }))} onError={setError} />}
          </div>
        )}

        {!day ? <Skeleton lines={3} card={false} /> : day.entries.length ? (
          <ul className="entries">
            {day.entries.map((e) => (
              <li key={e.id}>
                <div className="entry-main">
                  <strong>{e.display_name}</strong>
                  <span className="muted small">{n1(e.quantity)} {unitLabel(e.unit, e.quantity)} · {ORIGIN_LABELS[e.origin]}</span>
                </div>
                <div className="entry-values">
                  <span className="kcal">{n0(e.kcal)} <small>kcal</small></span>
                  <span className="pill protein">{n1(e.protein_g)} g P</span>
                  <button className="icon-btn subtle" aria-label={`Supprimer ${e.display_name}`} onClick={() => run(() => api.del(`/journal/${e.id}`))}><Icon name="close" size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="empty">Aucune entrée pour ce jour. Appuyez sur « Ajouter ».</p>}
        {day?.entries.length > 0 && <SaveRoutine date={date} onError={setError} />}
        {day?.entries.some((e) => e.food_id) && <RecomputeDay date={date} onError={setError} />}
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
  const { data: recipes } = useApi('/recipes');
  const [servings, setServings] = useState('1');
  if (!recipes) return <Skeleton lines={2} card={false} />;
  if (!recipes.length) return <p className="empty">Aucune recette. Créez-en une dans l'onglet Recettes.</p>;
  return (
    <>
      <label>Portions<input inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} /></label>
      <ul className="entries">
        {recipes.map((r) => (
          <li key={r.id}>
            <div className="entry-main"><strong>{r.name}</strong><span className="muted small">{n0(r.per_serving.kcal)} kcal · {n1(r.per_serving.protein_g)} g P / portion</span></div>
            <button onClick={() => onAdd(r.id, Number(servings.replace(',', '.')) || 1)}>Ajouter</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function RoutineAdd({ onAdd, onError }) {
  const { data: routines } = useApi('/routines');
  if (!routines) return <Skeleton lines={2} card={false} />;
  if (!routines.length) return <p className="empty">Aucune routine. Enregistrez les entrées d'un jour comme routine.</p>;
  return (
    <ul className="entries">
      {routines.map((r) => (
        <li key={r.id}>
          <div className="entry-main"><strong>{r.name}</strong><span className="muted small">{r.items.length} élément(s) · {n0(r.totals.kcal)} kcal · {n1(r.totals.protein_g)} g P</span></div>
          <div className="entry-values">
            <button onClick={() => onAdd(r.id)}>Ajouter</button>
            <button className="icon-btn subtle" aria-label={`Supprimer la routine ${r.name}`} onClick={() => api.del(`/routines/${r.id}`).catch((e) => onError(e.message))}><Icon name="close" size={16} /></button>
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

function RecomputeDay({ date, onError }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm('Recalculer les entrées de ce jour saisies depuis la base avec les valeurs actuelles des aliments ?\n(Les saisies libres, IA et recettes ne changent pas.)')) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post('/journal/recompute', { date });
      setMsg(r.updated ? `${r.updated} entrée(s) mise(s) à jour.` : 'Déjà à jour.');
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="recompute">
      <button className="link" onClick={run} disabled={busy}>Recalculer depuis la base</button>
      <span className="muted small">Applique les valeurs actuelles des aliments aux entrées de ce jour.</span>
      {msg && <span className="ok small">{msg}</span>}
    </div>
  );
}
