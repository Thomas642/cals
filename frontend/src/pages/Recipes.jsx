import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks/useApi.js';
import Skeleton from '../components/Skeleton.jsx';
import { n0, n1, todayIso, unitLabel } from '../format.js';
import FoodPicker from '../components/FoodPicker.jsx';
import SourceBadge from '../components/SourceBadge.jsx';

export default function Recipes() {
  const { data } = useApi('/recipes');
  const recipes = data || [];
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tag, setTag] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);


  const tags = [...new Set(recipes.flatMap((r) => r.tags))].sort();
  const shown = tag ? recipes.filter((r) => r.tags.includes(tag)) : recipes;

  async function act(fn, ok) {
    setError(null); setMsg(null);
    try { await fn(); setMsg(ok); } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="title-row">
        <h1>Recettes</h1>
        <button className="primary" onClick={() => setEditing({ name: '', servings: 1, steps: '', tags: '', ingredients: [] })}>Nouvelle recette</button>
      </div>
      <p className="muted small">Idées de recettes selon votre restant du jour : demandez à l'<Link to="/assistant">assistant</Link>.</p>
      {editing && <RecipeForm initial={editing} onCancel={() => setEditing(null)}
        onSaved={() => setEditing(null)} />}
      {error && <p className="alert">{error}</p>}
      {msg && <p className="ok">{msg}</p>}
      {tags.length > 0 && (
        <div className="tags">
          <button className={!tag ? 'active' : ''} onClick={() => setTag('')}>Toutes</button>
          {tags.map((t) => <button key={t} className={tag === t ? 'active' : ''} onClick={() => setTag(t)}>{t}</button>)}
        </div>
      )}
      {!data && <Skeleton lines={4} />}
      {data && shown.length === 0 && <p className="empty">Aucune recette.</p>}
      {shown.map((r) => (
        <section key={r.id} className="card">
          <div className="title-row">
            <button className="link title" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <h2>{r.name}</h2>
            </button>
            <span className="muted small">{n0(r.per_serving.kcal)} kcal · {n1(r.per_serving.protein_g)} g P / portion ({r.servings} portion{r.servings > 1 ? 's' : ''})</span>
          </div>
          {r.has_estimate && <p className="small"><span className="badge estimate">estimé</span> contient au moins un ingrédient à valeur estimée</p>}
          {open === r.id && (
            <>
              <ul className="entries">
                {r.ingredients.map((i) => (
                  <li key={i.id}><span>{i.name} <SourceBadge estimate={i.is_estimate} source={i.source} /></span>
                    <span className="muted">{n1(i.quantity)} {unitLabel(i.unit, i.quantity)} · {n0(i.kcal)} kcal · {n1(i.protein_g)} g P</span></li>
                ))}
              </ul>
              <p className="small">Total : {n0(r.total.kcal)} kcal · {n1(r.total.protein_g)} g P · glucides {n1(r.total.carbs_g)} g · lipides {n1(r.total.fat_g)} g</p>
              {r.steps && <p className="pre">{r.steps}</p>}
              {r.tags.length > 0 && <p className="muted small">Tags : {r.tags.join(', ')}</p>}
            </>
          )}
          <div className="row">
            <button onClick={() => act(() => api.post(`/recipes/${r.id}/log`, { date: todayIso(), servings: 1 }), `« ${r.name} » ajoutée au journal du jour (1 portion).`)}>Ajouter au journal (1 portion)</button>
            <button className="link" onClick={() => setEditing({ ...r, tags: r.tags.join(', ') })}>Éditer</button>
            <button className="link danger" onClick={() => confirm(`Supprimer « ${r.name} » ?`) && act(() => api.del(`/recipes/${r.id}`), 'Recette supprimée.')}>Supprimer</button>
          </div>
        </section>
      ))}
    </>
  );
}

function RecipeForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState({ ...initial, steps: initial.steps || '' });
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError(null);
    const body = { ...f, ingredients: f.ingredients.map((i) => ({ food_id: i.food_id, quantity: i.quantity, unit: i.unit })) };
    try {
      if (f.id) await api.put(`/recipes/${f.id}`, body); else await api.post('/recipes', body);
      onSaved();
    } catch (err) { setError(err.message); }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h2>{f.id ? 'Modifier' : 'Nouvelle'} recette</h2>
      <div className="row">
        <label className="grow">Nom<input value={f.name} onChange={set('name')} required /></label>
        <label>Portions<input inputMode="numeric" value={f.servings} onChange={set('servings')} required size={4} /></label>
      </div>
      <h3>Ingrédients</h3>
      <ul className="entries">
        {f.ingredients.map((i, idx) => (
          <li key={idx}>
            <span>{i.name}</span>
            <span className="entry-values">
              {n1(i.quantity)} {unitLabel(i.unit, i.quantity)}
              <button type="button" className="icon" aria-label={`Retirer ${i.name}`}
                onClick={() => setF({ ...f, ingredients: f.ingredients.filter((_, k) => k !== idx) })}>✕</button>
            </span>
          </li>
        ))}
      </ul>
      <FoodPicker submitLabel="Ajouter l'ingrédient" onPick={(food, quantity) => setF({ ...f, ingredients: [...f.ingredients,
        { food_id: food.id, name: food.name, quantity, unit: food.ref_unit === '100g' ? 'g' : 'unit' }] })} />
      <label>Étapes<textarea rows={5} value={f.steps} onChange={set('steps')} /></label>
      <label>Tags (séparés par des virgules)<input value={f.tags} onChange={set('tags')} /></label>
      {error && <p className="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="primary">Enregistrer</button>
        <button type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
