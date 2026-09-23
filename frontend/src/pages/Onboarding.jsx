import { useState } from 'react';
import ProfileForm from '../components/ProfileForm.jsx';
import TargetsCard from '../components/TargetsCard.jsx';

export default function Onboarding({ onDone }) {
  const [saved, setSaved] = useState(null);
  return (
    <div className="page narrow">
      <h1>Bienvenue sur Cals</h1>
      {!saved ? (
        <>
          <p className="muted">Renseignez vos mesures et votre objectif pour calculer vos besoins journaliers.</p>
          <ProfileForm onSaved={setSaved} submitLabel="Calculer mes cibles" />
        </>
      ) : (
        <>
          <TargetsCard profile={saved} />
          <button className="primary" onClick={() => onDone(saved)}>Commencer le suivi</button>
        </>
      )}
    </div>
  );
}
