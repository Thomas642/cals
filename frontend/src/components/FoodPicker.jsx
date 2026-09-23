import { useDeferredValue, useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { n1, refUnitLabel } from '../format.js';
import SourceBadge from './SourceBadge.jsx';

/** Recherche dans la base + quantite. onPick(food, quantity). */
export default function FoodPicker({ onPick, submitLabel = 'Ajouter' }) {
  const [q, setQ] = useState('');
  const { data: all } = useApi('/foods');
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState('');
  const query = useDeferredValue(q.trim().toLowerCase());
  const foods = (all || []).filter((f) => !query || f.name.toLowerCase().includes(query));

  const preview = useMemo(() => {
    const qty = Number(String(quantity).replace(',', '.'));
    if (!selected || !qty) return null;
    const f = selected.ref_unit === '100g' ? qty / 100 : qty;
    return { kcal: selected.kcal * f, protein: selected.protein_g * f };
  }, [selected, quantity]);

  function submit(e) {
    e.preventDefault();
    const qty = Number(String(quantity).replace(',', '.'));
    if (!selected || !(qty > 0)) return;
    onPick(selected, qty);
    setQuantity('');
  }

  return (
    <form className="picker" onSubmit={submit}>
      <input type="search" placeholder="Rechercher un aliment…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="picker-list">
        {foods.slice(0, 30).map((f) => (
          <li key={f.id}>
            <button type="button" className={selected?.id === f.id ? 'selected' : ''} onClick={() => setSelected(f)}>
              <span>{f.name}</span>
              <span className="muted small">{n1(f.kcal)} kcal · {n1(f.protein_g)} g P {refUnitLabel(f.ref_unit)}</span>
              <SourceBadge estimate={!!f.is_estimate} source={f.source} />
            </button>
          </li>
        ))}
        {foods.length === 0 && <li className="muted small">Aucun aliment trouvé.</li>}
      </ul>
      {selected && (
        <div className="row">
          <label className="grow">
            Quantité ({selected.ref_unit === '100g' ? 'g' : 'unités'})
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} required autoFocus />
          </label>
          <button type="submit" className="primary">{submitLabel}</button>
        </div>
      )}
      {preview && <p className="muted small">{selected.name} : {n1(preview.kcal)} kcal · {n1(preview.protein)} g protéines</p>}
    </form>
  );
}
