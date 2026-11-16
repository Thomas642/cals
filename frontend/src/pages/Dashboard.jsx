import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApi } from '../hooks.js';
import { episodeLabel, formatBytes, friendlyError, hueOf } from '../files.js';
import Icon from '../components/Icon.jsx';

// Seuils d'espace libre (part du disque) : en dessous, alerte.
const WARN_FREE = 0.15;
const CRITICAL_FREE = 0.05;

const pct = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0);

function formatDuration(seconds) {
  if (!seconds) return '0 min';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function ago(sqlDate) {
  const t = Date.parse(`${String(sqlDate).replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

/** Statut avec icone + libelle (jamais la couleur seule). */
function Status({ level, children }) {
  const icon = { good: 'check', warning: 'alert', critical: 'alert' }[level];
  return <span className={`status ${level}`}><Icon name={icon} size={14} /> {children}</span>;
}

export default function Dashboard() {
  const { data: o, error } = useApi('/admin/overview', { refreshMs: 10000 });

  if (error) return <p className="alert">{error.message}</p>;
  if (!o) return <div className="dash-grid"><div className="card sk-block dash-hero-card" /><div className="card sk-block" /></div>;

  const { disk, media, library, server } = o;
  const siteBytes = media.videos + media.subtitles + media.images + media.database;
  const freeRatio = disk ? disk.free / disk.total : 1;
  const diskLevel = freeRatio < CRITICAL_FREE ? 'critical' : freeRatio < WARN_FREE ? 'warning' : 'good';
  const failed = o.processing.filter((p) => p.state === 'failed');
  const active = o.processing.filter((p) => p.state !== 'failed');
  const maxSeries = Math.max(1, ...library.by_series.map((s) => s.bytes));
  const memUsed = server.memory.total - server.memory.available;
  const memRatio = memUsed / server.memory.total;

  const alerts = [];
  if (disk && diskLevel !== 'good') alerts.push({ level: diskLevel, text: `Il ne reste que ${formatBytes(disk.free)} sur le disque (${Math.round(freeRatio * 100)} %).` });
  if (failed.length) alerts.push({ level: 'critical', text: `${failed.length} conversion${failed.length > 1 ? 's ont' : ' a'} échoué.` });
  if (o.incomplete.length) alerts.push({ level: 'warning', text: `${o.incomplete.length} envoi${o.incomplete.length > 1 ? 's' : ''} incomplet${o.incomplete.length > 1 ? 's' : ''} (${formatBytes(o.incomplete.reduce((s, x) => s + x.received, 0))} occupés).` });
  if (!server.ffmpeg && server.video_processing) alerts.push({ level: 'warning', text: 'ffmpeg est introuvable : pas de conversion ni de miniature automatique.' });

  return (
    <div className="dashboard">
      <header className="page-head dash-head">
        <div>
          <span className="eyebrow">Administration</span>
          <h1>Tableau de bord</h1>
        </div>
        <div className="row-actions">
          <span className="muted small"><span className="live-dot" aria-hidden="true" /> Actualisé toutes les 10 s</span>
          <Link className="button ghost-btn" to="/admin/comptes"><Icon name="users" size={16} /> Comptes</Link>
        </div>
      </header>

      {alerts.length > 0 ? (
        <ul className="alert-list">{alerts.map((a, i) => <li key={i}><Status level={a.level}>{a.level === 'critical' ? 'Critique' : 'À surveiller'}</Status> {a.text}</li>)}</ul>
      ) : (
        <p className="all-good"><Status level="good">Tout va bien</Status> Aucune alerte : disque, conversions et envois sont en ordre.</p>
      )}

      {/* ── Disque ─────────────────────────────────────────────── */}
      {disk && (
        <section className="card dash-hero-card">
          <div className="disk-top">
            <div>
              <span className="tile-label">Espace libre sur le serveur</span>
              <div className="hero-figure">{formatBytes(disk.free)}</div>
              <span className="muted">sur {formatBytes(disk.total)} · {Math.round(freeRatio * 100)} % libres</span>
            </div>
            <Status level={diskLevel}>{{ good: 'Confortable', warning: 'À surveiller', critical: 'Critique' }[diskLevel]}</Status>
          </div>
          <DiskBar total={disk.total} site={siteBytes} free={disk.free} />
          <p className="muted small disk-note">Le disque est partagé avec les autres services du serveur (autres sites, surveillance…).</p>
          <dl className="breakdown">
            <div><dt>Vidéos</dt><dd>{formatBytes(media.videos)}</dd></div>
            <div><dt>Miniatures et affiches</dt><dd>{formatBytes(media.images)}</dd></div>
            <div><dt>Sous-titres</dt><dd>{formatBytes(media.subtitles)}</dd></div>
            <div><dt>Base de données</dt><dd>{formatBytes(media.database)}</dd></div>
          </dl>
        </section>
      )}

      {/* ── Chiffres cles ──────────────────────────────────────── */}
      <section className="kpi-row" aria-label="Chiffres clés">
        <Tile label="Séries" value={library.series} />
        <Tile label="Épisodes en ligne" value={library.episodes} />
        <Tile label="Durée totale" value={formatDuration(library.duration_seconds)} />
        <Tile label="Sous-titrés" value={`${library.subtitled} / ${library.episodes}`} sub={library.episodes ? `${Math.round((library.subtitled / library.episodes) * 100)} %` : null} />
        <Tile label="Comptes" value={o.users.total} sub={`${o.users.active_week} actif${o.users.active_week > 1 ? 's' : ''} cette semaine`} />
      </section>

      <div className="dash-grid">
        {/* ── Stockage par serie ─────────────────────────────── */}
        <section className="card">
          <h2>Stockage par série</h2>
          {library.by_series.length === 0 ? <p className="empty">Aucune série.</p> : (
            <ul className="bar-list">
              {library.by_series.map((s) => (
                <li key={s.id} title={`${s.title} : ${formatBytes(s.bytes)}, ${s.episodes} épisode${s.episodes > 1 ? 's' : ''}`}>
                  <Link to={`/serie/${s.id}`} className="bar-name">{s.title}</Link>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(1.5, pct(s.bytes, maxSeries))}%` }} /></span>
                  <span className="bar-value">{formatBytes(s.bytes)} <span className="muted">· {s.episodes} ép.</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Conversions ────────────────────────────────────── */}
        <section className="card">
          <h2>Conversions vidéo</h2>
          {o.processing.length === 0 ? <p className="empty"><Status level="good">À jour</Status> Aucune conversion en cours ni en attente.</p> : (
            <ul className="task-list">
              {[...active, ...failed].map((p) => (
                <li key={p.id}>
                  <div className="task-line">
                    <Link to={`/serie/${p.series_id}`}>{p.series_title} · {episodeLabel(p)}</Link>
                    {p.state === 'failed' ? <Status level="critical">Échec</Status>
                      : <span className="muted small">{p.state === 'queued' ? 'En attente' : `${Math.floor(p.progress * 100)} %`}</span>}
                  </div>
                  {p.state === 'running' && <div className="progress"><span style={{ width: `${Math.floor(p.progress * 100)}%` }} /></div>}
                  {p.state === 'failed' && <p className="small danger-text" title={p.error}>{friendlyError(p.error)}</p>}
                  {p.state !== 'failed' && p.reason && <p className="small muted">{p.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Statistiques de visionnage ─────────────────────── */}
        <section className="card stats-card">
          <h2><Icon name="chart" size={18} /> Statistiques de visionnage</h2>
          {o.stats.by_user.every((u) => !u.seconds && !u.completed) ? (
            <p className="empty">Pas encore de visionnage enregistré. Le temps regardé est compté par le lecteur.</p>
          ) : (
            <>
              <h3 className="sub-h">Temps regardé par personne</h3>
              <ul className="bar-list">
                {o.stats.by_user.filter((u) => u.seconds > 0 || u.completed > 0).map((u) => {
                  const max = Math.max(1, ...o.stats.by_user.map((x) => x.seconds));
                  const name = u.display_name || u.username;
                  return (
                    <li key={u.id} title={`${name} : ${formatDuration(u.seconds)}, ${u.completed} épisode${u.completed > 1 ? 's' : ''} terminé${u.completed > 1 ? 's' : ''}`}>
                      <span className="bar-name">{name}</span>
                      <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(1.5, pct(u.seconds, max))}%` }} /></span>
                      <span className="bar-value">{formatDuration(u.seconds)} <span className="muted">· {u.completed} terminé{u.completed > 1 ? 's' : ''}</span></span>
                    </li>
                  );
                })}
              </ul>
              {o.stats.top_episodes.length > 0 && (
                <>
                  <h3 className="sub-h">Épisodes les plus regardés</h3>
                  <ol className="rank-list">
                    {o.stats.top_episodes.map((e) => (
                      <li key={e.id}>
                        <Link to={`/regarder/${e.id}`}>{e.series_title} · {episodeLabel({ number: e.number })}</Link>
                        <span className="muted small">{e.viewers} personne{e.viewers > 1 ? 's' : ''} · {formatDuration(e.seconds)}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {o.stats.by_series.length > 1 && (
                <>
                  <h3 className="sub-h">Par série</h3>
                  <ul className="bar-list">
                    {o.stats.by_series.map((x) => {
                      const max = Math.max(1, ...o.stats.by_series.map((y) => y.seconds));
                      return (
                        <li key={x.id} title={`${x.title} : ${formatDuration(x.seconds)}, ${x.viewers} personne(s)`}>
                          <Link to={`/serie/${x.id}`} className="bar-name">{x.title}</Link>
                          <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(1.5, pct(x.seconds, max))}%` }} /></span>
                          <span className="bar-value">{formatDuration(x.seconds)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        {/* ── Activite ───────────────────────────────────────── */}
        <section className="card">
          <h2>Activité récente</h2>
          {o.activity.length === 0 ? <p className="empty">Personne n'a encore regardé d'épisode.</p> : (
            <ul className="activity">
              {o.activity.map((a, i) => {
                const name = a.display_name || a.username;
                return (
                  <li key={i}>
                    <span className="avatar" style={{ '--h': hueOf(a.username) }}>{[...name][0]?.toUpperCase()}</span>
                    <div className="grow">
                      <strong>{name}</strong>{' '}
                      <span className="muted">{a.watched ? 'a terminé' : 'regarde'}</span>{' '}
                      <Link to={`/serie/${a.series_id}`}>{a.series_title} · {episodeLabel({ number: a.number })}</Link>
                      {!a.watched && a.dur > 0 && <span className="muted"> ({Math.round((a.pos / a.dur) * 100)} %)</span>}
                    </div>
                    <span className="muted small nowrap">{ago(a.updated_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Serveur ────────────────────────────────────────── */}
        <section className="card">
          <h2>Serveur</h2>
          <div className="meter-block">
            <div className="meter-head"><span>Mémoire vive</span><span>{formatBytes(memUsed)} / {formatBytes(server.memory.total)}</span></div>
            <Meter ratio={memRatio} label={`Mémoire utilisée : ${Math.round(memRatio * 100)} %`} />
          </div>
          <dl className="facts">
            <div><dt>Charge (1 / 5 / 15 min)</dt><dd>{server.load.map((l) => l.toFixed(2).replace('.', ',')).join(' · ')} <span className="muted">pour {server.cpus} cœur{server.cpus > 1 ? 's' : ''}</span></dd></div>
            <div><dt>Serveur allumé depuis</dt><dd>{formatDuration(server.uptime_seconds)}</dd></div>
            <div><dt>Site redémarré il y a</dt><dd>{formatDuration(server.app_uptime_seconds)}</dd></div>
            <div><dt>Conversion vidéo (ffmpeg)</dt><dd>{server.ffmpeg ? <Status level="good">Disponible</Status> : <Status level="warning">Absent</Status>}</dd></div>
            <div><dt>Node.js</dt><dd>{server.node}</dd></div>
          </dl>
        </section>

        {/* ── Envois incomplets ──────────────────────────────── */}
        {o.incomplete.length > 0 && <IncompleteCard items={o.incomplete} />}

        {/* ── Sans sous-titres ───────────────────────────────── */}
        {library.without_subtitles.length > 0 && (
          <section className="card">
            <h2>Épisodes sans sous-titres <span className="count">{library.without_subtitles.length}</span></h2>
            <ul className="chip-links">
              {library.without_subtitles.map((e) => (
                <li key={e.id}><Link to={`/serie/${e.series_id}`}>{e.series_title} · {episodeLabel({ number: e.number })}</Link></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/** Envois arretes : reprise depuis la serie, ou suppression (un par un, ou tous ceux de plus de 24 h). */
function IncompleteCard({ items }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const old = items.filter((x) => Date.now() - Date.parse(`${x.created_at.replace(' ', 'T')}Z`) > 24 * 3600 * 1000);

  async function cleanOld() {
    if (!window.confirm(`Supprimer ${old.length} envoi${old.length > 1 ? 's' : ''} incomplet${old.length > 1 ? 's' : ''} de plus de 24 h ?`)) return;
    setBusy(true);
    try {
      const r = await api.del('/admin/incomplete?older_than_hours=24');
      setMsg(`${r.deleted} envoi${r.deleted > 1 ? 's' : ''} supprimé${r.deleted > 1 ? 's' : ''}, ${formatBytes(r.freed_bytes)} libérés.`);
    } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  async function removeOne(x) {
    if (!window.confirm(`Supprimer « ${x.series_title} · ${episodeLabel(x)} » (${formatBytes(x.received)} déjà envoyés) ?`)) return;
    try { await api.del(`/episodes/${x.id}`); setMsg(`Envoi supprimé, ${formatBytes(x.received)} libérés.`); } catch (err) { setMsg(err.message); }
  }

  return (
    <section className="card">
      <h2>Envois incomplets <span className="count">{items.length}</span></h2>
      <p className="muted small">Ces fichiers partiels occupent de la place. Reprends l'envoi en réimportant le même fichier dans la série, ou supprime-les.</p>
      {old.length > 0 && (
        <button className="ghost-btn danger small-btn clean-btn" onClick={cleanOld} disabled={busy}>
          {busy ? <span className="spinner" /> : <Icon name="trash" size={15} />} Supprimer ceux de plus de 24 h ({old.length} · {formatBytes(old.reduce((t, x) => t + x.received, 0))})
        </button>
      )}
      {msg && <p className="notice small">{msg}</p>}
      <ul className="task-list">
        {items.map((x) => (
          <li key={x.id}>
            <div className="task-line">
              <Link to={`/serie/${x.series_id}`}>{x.series_title} · {episodeLabel(x)}</Link>
              <span className="row-actions">
                <span className="muted small">{Math.floor(pct(x.received, x.size))} % · {ago(x.created_at)}</span>
                <button className="icon-btn ghost danger" onClick={() => removeOne(x)} aria-label={`Supprimer l'envoi ${x.original_name}`}><Icon name="trash" size={15} /></button>
              </span>
            </div>
            <p className="small muted">{x.original_name} — {formatBytes(x.received)} / {formatBytes(x.size)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

/** Jauge : la couleur du remplissage suit la gravite ; le libelle textuel accompagne toujours. */
function Meter({ ratio, label }) {
  const level = ratio > 0.9 ? 'critical' : ratio > 0.75 ? 'warning' : 'good';
  return (
    <div className={`meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={label}>
      <span style={{ width: `${pct(ratio, 1)}%` }} />
    </div>
  );
}

/** Barre segmentee haute : site / autres fichiers / libre, sur la taille totale du disque. */
function DiskBar({ total, site, free }) {
  const other = Math.max(0, total - free - site);
  const parts = [
    { key: 'site', label: 'Ce site (vidéos, images…)', value: site },
    { key: 'other', label: 'Autres fichiers du serveur', value: other },
    { key: 'free', label: 'Libre', value: free },
  ];
  return (
    <figure className="disk-figure">
      <div className="seg-bar" role="img" aria-label={parts.map((p) => `${p.label} : ${formatBytes(p.value)} (${Math.round(pct(p.value, total))} %)`).join(', ')}>
        {parts.map((p) => {
          const w = pct(p.value, total);
          if (w <= 0) return null;
          return (
            <span key={p.key} className={`seg ${p.key}`} style={{ width: `${w}%` }} title={`${p.label} : ${formatBytes(p.value)} (${Math.round(w)} %)`}>
              {w >= 9 && <span className="seg-label">{Math.round(w)} %</span>}
            </span>
          );
        })}
      </div>
      <figcaption className="legend">
        {parts.map((p) => (
          <span key={p.key}><span className={`swatch ${p.key}`} aria-hidden="true" /> {p.label} <span className="muted">{formatBytes(p.value)}</span></span>
        ))}
      </figcaption>
    </figure>
  );
}
