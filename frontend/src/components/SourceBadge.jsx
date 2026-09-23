/** Distinction visuelle valeur sourcee / estimee (principe de rigueur des donnees). */
export default function SourceBadge({ estimate, source }) {
  return estimate
    ? <span className="badge estimate" title={source || 'Valeur estimée'}>estimé</span>
    : <span className="badge sourced" title={source || ''}>{source || 'sourcé'}</span>;
}
