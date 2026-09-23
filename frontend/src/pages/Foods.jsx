import { useDeferredValue, useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks/useApi.js';
import Skeleton from '../components/Skeleton.jsx';
import { n1, refUnitLabel } from '../format.js';
import SourceBadge from '../components/SourceBadge.jsx';
import EnergyBadge from '../components/EnergyBadge.jsx';
import { energyCheck } from '../format.js';

const EMPTY = { name: '', kcal: '', protein_g: '', carbs_g: '', fat_g: '', ref_unit: '100g', source: '', is_estimate: false };

export default function Foods() {
  const [q, setQ] = useState('');
  const { data: all } = useApi('/foods');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);
  // Filtrage local (la base complete est deja en cache) : resultats instantanes.
  const [toCheck, setToCheck] = useState(false);
  const query = useDeferredValue(q.trim().toLowerCase());
  const checks = (all || []).map((f) => energyCheck(f).status);
  const nBad = checks.filter((c) => c === 'bad').length;
  const nIncomplete = checks.filter((c) => c === 'incomplete').length;
  const foods = (all || []).filter((f) => (!query || f.name.toLowerCase().includes(query))
    && (!toCheck || energyCheck(f).status !== 'ok'));

  async function save(form) {
    setError(null);
    try {
      if (form.id) await api.put(`/foods/${form.id}`, form); else await api.post('/foods', form);
      setEditing(null);
    } catch (e) { setError(e.message); }
  }

  async function remove(f) {
    if (!confirm(`Supprimer « ${f.name} » ? Les entrées de journal déjà saisies sont conservées.`)) return;
    setError(null);
    try { await api.del(`/foods/${f.id}`); } catch (e) { setError(e.message); }
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
      {all && (
        <div className="check-summary">
          <span className="muted small">{nBad} incohérent(s) · {nIncomplete} incomplet(s) sur {all.length}</span>
          <label className="check small"><input type="checkbox" checked={toCheck} onChange={(e) => setToCheck(e.target.checked)} /> À vérifier seulement</label>
        </div>
      )}
      {all && (
        <ul className="food-cards card">
          {foods.map((f) => (
            <li key={f.id} className={f.is_estimate ? 'estimate-row' : ''}>
              <div className="entry-main">
                <strong>{f.name}</strong>
                <span className="muted small">
                  {n1(f.kcal)} kcal · {n1(f.protein_g)} g P
                  {f.carbs_g !== null && ` · ${n1(f.carbs_g)} g G`}{f.fat_g !== null && ` · ${n1(f.fat_g)} g L`} {refUnitLabel(f.ref_unit)}
                </span>
                <span className="badges"><SourceBadge estimate={!!f.is_estimate} source={f.source} /> <EnergyBadge food={f} /></span>
              </div>
              <div className="entry-values">
                <button className="link" onClick={() => setEditing({ ...f, is_estimate: !!f.is_estimate })}>Éditer</button>
                <button className="link danger" onClick={() => remove(f)}>Suppr.</button>
              </div>
            </li>
          ))}
          {foods.length === 0 && <li className="empty">Aucun aliment trouvé.</li>}
        </ul>
      )}
      {!all ? <Skeleton lines={8} /> : <div className="table-wrap">
        <table>
          <thead><tr><th>Aliment</th><th>kcal</th><th>Prot.</th><th>Gluc.</th><th>Lip.</th><th>Réf.</th><th>Source</th><th>Cohérence</th><th /></tr></thead>
          <tbody>
            {foods.map((f) => (
              <tr key={f.id} className={f.is_estimate ? 'estimate-row' : ''}>
                <td>{f.name}</td><td>{n1(f.kcal)}</td><td>{n1(f.protein_g)}</td><td>{n1(f.carbs_g)}</td><td>{n1(f.fat_g)}</td>
                <td className="muted">{refUnitLabel(f.ref_unit)}</td>
                <td><SourceBadge estimate={!!f.is_estimate} source={f.source} /></td>
                <td><EnergyBadge food={f} /></td>
                <td className="actions">
                  <button className="link" onClick={() => setEditing({ ...f, is_estimate: !!f.is_estimate })}>Éditer</button>
                  <button className="link danger" onClick={() => remove(f)}>Suppr.</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
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
      <p className="small muted">Contrôle : 4 × P + 4 × G + 9 × L = {(() => { const c = energyCheck(f); return c.status === 'incomplete' ? 'à compléter' : `${c.atwater} kcal (${c.status === 'ok' ? 'cohérent' : 'incohérent'} avec ${f.kcal || 0} kcal)`; })()}</p>
      <label>Source (CIQUAL, USDA, étiquette…)<input value={f.source} onChange={set('source')} /></label>
      <label className="check"><input type="checkbox" checked={!!f.is_estimate} onChange={set('is_estimate')} /> Valeur estimée (non sourcée)</label>
      <div className="row">
        <button type="submit" className="primary">Enregistrer</button>
        <button type="button" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}
