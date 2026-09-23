import { energyCheck } from '../format.js';

export default function EnergyBadge({ food }) {
  const c = energyCheck(food);
  if (c.status === 'ok') return <span className="badge coherent" title={`4P + 4G + 9L = ${c.atwater} kcal`}>cohérent</span>;
  if (c.status === 'bad') return <span className="badge incoherent" title={`4P + 4G + 9L = ${c.atwater} kcal`}>incohérent ({c.atwater} kcal calc.)</span>;
  return <span className="badge incomplete" title="Glucides ou lipides non renseignés">incomplet</span>;
}
