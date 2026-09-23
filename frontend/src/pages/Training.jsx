import { useState } from 'react';
import { api } from '../api.js';
import { useApi } from '../hooks/useApi.js';
import { n1, shortDate, todayIso } from '../format.js';
import { PROGRAM, PROGRAM_INTRO } from '../data/program.js';

export default function Training() {
  const [code, setCode] = useState('J1');
  const { data } = useApi(`/workouts?day_code=${code}`);
  const logs = data || [];
  const [error, setError] = useState(null);
  const day = PROGRAM.find((d) => d.code === code);


  const lastFor = (exercise) => logs.find((l) => l.exercise === exercise);

  return (
    <>
      <h1>Programme d'entraînement</h1>
      <p className="muted small">{PROGRAM_INTRO.materiel} {PROGRAM_INTRO.frequence}</p>
      <div className="tabs" role="tablist">
        {PROGRAM.map((d) => (
          <button key={d.code} role="tab" aria-selected={d.code === code} className={d.code === code ? 'active' : ''} onClick={() => setCode(d.code)}>{d.code}</button>
        ))}
      </div>
      <section className="card">
        <h2>{day.code} · {day.title}</h2>
        <ul className="entries">
          {day.exercises.map(([name, scheme]) => {
            const last = lastFor(name);
            return (
              <li key={name} className="exercise">
                <div>
                  <strong>{name}</strong> <span className="muted">{scheme}</span>
                  {last && <div className="muted small">Dernière fois ({shortDate(last.date)}) : {last.load_kg !== null ? `${n1(last.load_kg)} kg` : 'poids du corps'}{last.reps ? ` · ${last.reps}` : ''}</div>}
                </div>
                <LoadForm onSave={async (v) => {
                  setError(null);
                  try { await api.post('/workouts', { ...v, day_code: code, exercise: name, date: todayIso() }); } catch (e) { setError(e.message); }
                }} />
              </li>
            );
          })}
        </ul>
        {error && <p className="alert">{error}</p>}
        <p className="muted small">{PROGRAM_INTRO.reflexe}</p>
      </section>
      {logs.length > 0 && (
        <section className="card">
          <h2>Journal de charges · {code}</h2>
          <ul className="entries">
            {logs.map((l) => (
              <li key={l.id}>
                <span>{shortDate(l.date)} · {l.exercise}</span>
                <span className="entry-values">{l.load_kg !== null ? `${n1(l.load_kg)} kg` : '—'} {l.reps}
                  <button className="icon" aria-label="Supprimer" onClick={() => api.del(`/workouts/${l.id}`).catch((e) => setError(e.message))}>✕</button></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function LoadForm({ onSave }) {
  const [load, setLoad] = useState('');
  const [reps, setReps] = useState('');
  return (
    <form className="row load-form" onSubmit={(e) => { e.preventDefault(); onSave({ load_kg: load || null, reps: reps || null }); setLoad(''); setReps(''); }}>
      <input inputMode="decimal" placeholder="kg" value={load} onChange={(e) => setLoad(e.target.value)} size={4} aria-label="Charge en kg" />
      <input placeholder="séries x reps" value={reps} onChange={(e) => setReps(e.target.value)} size={8} aria-label="Séries et répétitions" />
      <button type="submit">Noter</button>
    </form>
  );
}
