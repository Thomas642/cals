import { n0 } from '../format.js';
import Disclaimer from './Disclaimer.jsx';

export default function TargetsCard({ profile }) {
  const c = profile.computed;
  return (
    <section className="card">
      <h2>Vos cibles {profile.manual_targets && <span className="badge estimate">manuelles</span>}</h2>
      <div className="stats-grid">
        <div><span className="big">{n0(profile.target_kcal)}</span><span className="muted">kcal / jour</span></div>
        <div><span className="big">{n0(profile.target_protein_g)} g</span><span className="muted">protéines</span></div>
        <div><span className="big">{n0(profile.target_carbs_g)} g</span><span className="muted">glucides</span></div>
        <div><span className="big">{n0(profile.target_fat_g)} g</span><span className="muted">lipides</span></div>
      </div>
      {c && (
        <p className="muted small">
          Âge {c.age} ans · BMR (Mifflin-St Jeor) {n0(c.bmr)} kcal · TDEE {n0(c.tdee)} kcal
          {profile.manual_targets && ` · cible calculée : ${n0(c.target_kcal)} kcal / ${n0(c.target_protein_g)} g P`}
        </p>
      )}
      <Disclaimer />
    </section>
  );
}
