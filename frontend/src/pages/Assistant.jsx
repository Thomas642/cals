import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { n1, todayIso, unitLabel } from '../format.js';
import SourceBadge from '../components/SourceBadge.jsx';
import Icon from '../components/Icon.jsx';
import Disclaimer from '../components/Disclaimer.jsx';

const SUGGESTIONS = [
  'Combien de protéines dans 150 g de blanc de poulet cru ?',
  "Propose-moi une idée de repas pour atteindre ma cible de protéines avec mon restant du jour.",
  "J'ai mangé 2 œufs durs et 100 g de skyr nature, ajoute-les.",
];

export default function Assistant({ aiEnabled }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const date = todayIso();

  async function send(text) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    const history = messages.map((m) => ({ role: m.role, content: m.role === 'user' ? m.content : m.answer }));
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    try {
      const res = await api.post('/assistant', { message, history, date });
      setMessages((prev) => [...prev, { role: 'assistant', ...res }]);
    } catch (e) {
      setError(e.code === 'ia_indisponible' ? `Assistant indisponible : ${e.message}.` : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Assistant nutritionnel</h1>
      {!aiEnabled && (
        <p className="alert">L'assistant IA n'est pas configuré (aucune clé GEMINI_API_KEY ou ANTHROPIC_API_KEY côté serveur). La saisie manuelle reste disponible dans le <Link to="/">journal</Link>.</p>
      )}
      <div className="chat">
        {messages.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={busy || !aiEnabled}>{s}</button>)}
          </div>
        )}
        {messages.map((m, i) => (m.role === 'user'
          ? <div key={i} className="bubble user">{m.content}</div>
          : <AssistantBubble key={i} msg={m} date={date} />))}
        {busy && <div className="bubble assistant muted"><span className="spinner" aria-hidden="true" /> Réflexion…</div>}
      </div>
      {error && <p className="alert">{error} <Link to="/">Passer à la saisie manuelle</Link></p>}
      <form className="row chat-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="grow" placeholder="Posez votre question…" value={input} onChange={(e) => setInput(e.target.value)} maxLength={2000} disabled={!aiEnabled} />
        <button className="primary" type="submit" disabled={busy || !aiEnabled} aria-label="Envoyer"><Icon name="send" size={18} /></button>
      </form>
      <Disclaimer />
    </>
  );
}

function AssistantBubble({ msg, date }) {
  const [status, setStatus] = useState({});
  const mark = (i, s) => setStatus((prev) => ({ ...prev, [i]: s }));

  async function addToJournal(e, i) {
    try {
      await api.post('/journal', { date, display_name: e.aliment, quantity: e.quantite, unit: e.unite,
        kcal: e.kcal, protein_g: e.proteines_g, origin: 'ia' });
      mark(i, 'Ajouté au journal');
    } catch (err) { mark(i, `Refusé : ${err.message}`); }
  }

  // Valeurs ramenees a l'unite de reference (100 g ou unite), marquees estimees si besoin.
  async function addToBase(e, i) {
    const factor = e.unite === 'g' ? 100 / e.quantite : 1 / e.quantite;
    try {
      await api.post('/foods', { name: e.aliment, kcal: Math.round(e.kcal * factor * 10) / 10,
        protein_g: Math.round(e.proteines_g * factor * 10) / 10, ref_unit: e.unite === 'g' ? '100g' : 'unit',
        source: e.est_estime ? `Estimation IA (${e.source})` : e.source, is_estimate: e.est_estime });
      mark(`b${i}`, 'Ajouté à la base');
    } catch (err) { mark(`b${i}`, `Refusé : ${err.message}`); }
  }

  return (
    <div className="bubble assistant">
      <p className="pre">{msg.answer}</p>
      <p className="muted small">Confiance : {msg.confidence}</p>
      {msg.proposed_entries.length > 0 && (
        <ul className="entries proposals">
          {msg.proposed_entries.map((e, i) => (
            <li key={i}>
              <div>
                <strong>{e.aliment}</strong> <SourceBadge estimate={e.est_estime} source={e.source} />
                <div className="muted small">{n1(e.quantite)} {unitLabel(e.unite, e.quantite)} · {n1(e.kcal)} kcal · {n1(e.proteines_g)} g P</div>
              </div>
              <div className="entry-values">
                {status[i] ? <span className="small">{status[i]}</span> : <button onClick={() => addToJournal(e, i)}>Ajouter au journal</button>}
                {e.est_estime && (status[`b${i}`] ? <span className="small">{status[`b${i}`]}</span>
                  : <button onClick={() => addToBase(e, i)}>Ajouter à la base (estimé)</button>)}
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg.rejected_entries?.length > 0 && (
        <p className="alert small">{msg.rejected_entries.length} proposition(s) rejetée(s) par la validation serveur : {msg.rejected_entries.map((r) => r.reason).join(' ; ')}</p>
      )}
    </div>
  );
}
