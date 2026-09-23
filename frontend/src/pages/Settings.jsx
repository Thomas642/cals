import { useState } from 'react';
import ProfileForm from '../components/ProfileForm.jsx';
import TargetsCard from '../components/TargetsCard.jsx';

export default function Settings({ profile, onSaved }) {
  const [msg, setMsg] = useState(null);
  return (
    <>
      <h1>Réglages</h1>
      <TargetsCard profile={profile} />
      <section className="card">
        <h2>Profil, objectif et cibles</h2>
        <p className="muted small">Enregistrer recalcule les cibles (sauf cibles manuelles).</p>
        <ProfileForm key={profile.created_at + profile.weight_kg} initial={profile} allowManual submitLabel="Enregistrer et recalculer"
          onSaved={(p) => { onSaved(p); setMsg('Profil enregistré.'); }} />
        {msg && <p className="ok">{msg}</p>}
      </section>
      <section className="card">
        <h2>Export et sauvegarde</h2>
        <p className="muted small">Export JSON complet (profil, journal, aliments, recettes, routines, poids, séances).
          La sauvegarde du fichier SQLite se fait côté serveur (voir README).</p>
        <a className="button" href="/api/export" download>Télécharger l'export JSON</a>
      </section>
    </>
  );
}
