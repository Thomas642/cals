/** Blocs gris animes affiches pendant le premier chargement d'une page. */
export default function Skeleton({ lines = 3, card = true }) {
  const body = (
    <div className="skeleton" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="sk-line" style={{ width: `${90 - (i % 3) * 18}%` }} />)}
    </div>
  );
  return card ? <section className="card">{body}</section> : body;
}
