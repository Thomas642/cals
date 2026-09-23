import { useState } from 'react';
import { api } from '../api.js';
import { ACTIVITY_LABELS, GOAL_LABELS, INTENSITY_LABELS } from '../format.js';

const EMPTY = { username: '', sex: 'M', birth_date: '', height_cm: '', weight_kg: '', activity_level: 'moderate',
  goal: 'fat_loss', goal_intensity: 'moderate', manual_targets: false,
  target_kcal: '', target_protein_g: '', target_carbs_g: '', target_fat_g: '' };

export default function ProfileForm({ initial, onSaved, submitLabel, allowManual = false }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...Object.fromEntries(
    Object.entries(initial || {}).filter(([k]) => k in EMPTY).map(([k, v]) => [k, v ?? '']),
  ) }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.put('/profile', form));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>Prénom ou nom d'utilisateur<input value={form.username} onChange={set('username')} required maxLength={80} /></label>
      <div className="row">
        <label className="grow">Sexe
          <select value={form.sex} onChange={set('sex')}><option value="M">Homme</option><option value="F">Femme</option></select>
        </label>
        <label className="grow">Date de naissance<input type="date" value={form.birth_date} onChange={set('birth_date')} required /></label>
      </div>
      <div className="row">
        <label className="grow">Taille (cm)<input inputMode="decimal" value={form.height_cm} onChange={set('height_cm')} required /></label>
        <label className="grow">Poids actuel (kg)<input inputMode="decimal" value={form.weight_kg} onChange={set('weight_kg')} required /></label>
      </div>
      <label>Niveau d'activité
        <select value={form.activity_level} onChange={set('activity_level')}>
          {Object.entries(ACTIVITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <div className="row">
        <label className="grow">Objectif
          <select value={form.goal} onChange={set('goal')}>
            {Object.entries(GOAL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {form.goal !== 'maintain' && (
          <label className="grow">Intensité
            <select value={form.goal_intensity || 'moderate'} onChange={set('goal_intensity')}>
              {Object.entries(INTENSITY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      {allowManual && (
        <fieldset>
          <legend><label className="check"><input type="checkbox" checked={!!form.manual_targets} onChange={set('manual_targets')} /> Forcer des cibles manuelles</label></legend>
          {form.manual_targets && (
            <div className="row wrap">
              <label className="grow">kcal<input inputMode="numeric" value={form.target_kcal} onChange={set('target_kcal')} required /></label>
              <label className="grow">Protéines (g)<input inputMode="numeric" value={form.target_protein_g} onChange={set('target_protein_g')} required /></label>
              <label className="grow">Glucides (g)<input inputMode="numeric" value={form.target_carbs_g} onChange={set('target_carbs_g')} /></label>
              <label className="grow">Lipides (g)<input inputMode="numeric" value={form.target_fat_g} onChange={set('target_fat_g')} /></label>
            </div>
          )}
          <p className="muted small">Les cibles manuelles priment sur le calcul et ne sont plus recalculées automatiquement.</p>
        </fieldset>
      )}
      {error && <p className="alert">{error}</p>}
      <button type="submit" className="primary" disabled={saving}>{saving ? 'Enregistrement…' : submitLabel}</button>
    </form>
  );
}
