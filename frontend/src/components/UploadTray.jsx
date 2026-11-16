import { Link } from 'react-router-dom';
import { cancelUpload, clearFinished, retryUpload, useUploads } from '../uploads.js';
import { formatBytes } from '../files.js';
import Icon from './Icon.jsx';

const STATE_LABEL = { queued: 'En attente', uploading: 'Envoi', retrying: 'Reprise', done: 'Terminé', error: 'Échec' };

/** Panneau fixe listant les envois en cours, visible sur toutes les pages. */
export default function UploadTray() {
  const jobs = useUploads();
  if (!jobs.length) return null;
  const active = jobs.filter((j) => j.state !== 'done').length;

  return (
    <aside className="upload-tray" aria-label="Envois en cours">
      <div className="tray-head">
        <strong>{active ? `Envoi de ${active} vidéo${active > 1 ? 's' : ''}` : 'Envois terminés'}</strong>
        {jobs.some((j) => j.state === 'done') && <button className="link small" onClick={clearFinished}>Effacer les terminés</button>}
      </div>
      <ul>
        {jobs.map((j) => {
          const pct = j.size ? Math.floor((j.sent / j.size) * 100) : 0;
          return (
            <li key={j.episodeId} className={`job ${j.state}`}>
              <div className="job-line">
                <Link to={`/serie/${j.seriesId}`} className="job-name" title={j.name}>{j.name}</Link>
                {j.state === 'error' && <button className="icon-btn ghost" onClick={() => retryUpload(j.episodeId)} aria-label="Réessayer"><Icon name="refresh" size={16} /></button>}
                {j.state !== 'done' && <button className="icon-btn ghost" onClick={() => cancelUpload(j.episodeId)} aria-label="Annuler l'envoi"><Icon name="close" size={16} /></button>}
              </div>
              <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <div className="job-meta">
                <span>{STATE_LABEL[j.state]}{j.state !== 'done' ? ` · ${pct} %` : ''}</span>
                <span>{formatBytes(j.sent)} / {formatBytes(j.size)}</span>
              </div>
              {j.error && <div className="job-error">{j.error}</div>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
