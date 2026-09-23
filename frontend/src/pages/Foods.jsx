import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { n1, refUnitLabel } from '../format.js';
import SourceBadge from '../components/SourceBadge.jsx';

const EMPTY = { name: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', ref_unit: '100g', source: '', is_estimate: false };

export default function Foods() {
  const [q, setQ] = useState('');
  const [foods, setFoods] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => api.get(`/foods?q=${encodeURIComponent(q)}`).then(setFoods).catch((e) => setError(e.message)), [q]);
  useEffect(() => { const t = setTimeout(load, 150); return () => clearTimeout(t); }, [load]);

  async function save(form) {
    setError(null);
    try {
      if (form.id) await api.put(`/foods/${form.id}`, form); else await api.post('/foods', form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(f) {
    if (!confirm(`Supprimer « ${f.name} » ? Les entrées de journal déjà saisies sont conservées.`)) return;
    setError(null);
    try { await api.del(`/foods/${f.id}`); load(); } catch (e) { setError(e.message); }
  }

  return (
    <>
      <div className="title-row">
        <h1>Base d'aliments</h1>
        <button className="primary" onClick={() => setEditing({ ...EMPTY })}>Nouvel aliment</button>
      </div>
      {editing && <FoodForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {error && <p className="alert">{error}</p>}
      <input type="search" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Aliment</th><th>kcal</th><th>Prot.</th><th>Gluc.</th><th>Lip.</th><th>Réf.</th><th>Source</th><th /></tr></thead>
          <tbody>
            {foods.map((f) => (
              <tr key={f.id} className={f.is_estimate ? 'estimate-row' : ''}>
                <td>{f.name}</td><td>{n1(f.kcal)}</td><td>{n1(f.protein_g)}</td><td>{n1(f.carbs_g)}</td><td>{n1(f.fat_g)}</td>
                <td className="muted">{refUnitLabel(f.ref_unit)}</td>
                <td><SourceBadge estimate={!!f.is_estimate} source={f.source} /></td>
                <td className="actions">
                  <button className="link" onClick={() => setEditing({ ...f, is_estimate: !!f.is_estimate })}>Éditer</button>
                  <button className="link danger" onClick={() => remove(f)}>Suppr.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">« – » : valeur non renseignée (non fournie par la source). Aucune valeur n'est complétée automatiquement.</p>
    </>
  );
}

export function FoodForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(() => Object.fromEntries(Object.entries({ ...EMPTY, ...initial }).map(([k, v]) => [k, v ?? ''])));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <form className="card form" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
      <h2>{f.id ? 'Modifier' : 'Nouvel'} aliment</h2>
      <label>Nom<input value={f.name} onChange={set('name')} required /></label>
      <label>Unité de référence
        <select value={f.ref_unit} onChange={set('ref_unit')}><option value="100g">pour 100 g</option><option value="unit">par unité</option></select>
      </label>
      <div className="row wrap">
        <label className="grow">kcal<input inputMode="decimal" value={f.kcal} onChange={set('kcal')} required /></label>
        <label className="grow">Protéines (g)<input inputMode="decimal" value={f.protein_g} onChange={set('protein_g')} required /></label>
        <label className="grow">Glucides (g)<input inputMode="decimal" value={f.carbs_g} onChange={set('carbs_g')} /></label>
        <label className="grow">Lipides (g)<input inputMode="decimal" value={f.fat_g} onChange={set('fat_g')} /></label>
      </div>
      <label>Source (CIQUAL, USDA, étiquette…)<input value={f.source} onChange={set('source')} /></label>
      <label className="check"><input type="checkbox" checked={!!f.is_estimate} onChange={set('is_estimate')} /> Valeur estimée (non sourcée)</label>
      <div className="row">
        <button type="submit" className="primary">Enregistrer</button>
        <button type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
