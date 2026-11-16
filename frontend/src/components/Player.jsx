import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// Lecteur maison : controles aux couleurs du site, sous-titres rendus par la page (taille, fond, position
// reglables), apercu sur la barre de temps, « Passer l'intro », episode suivant automatique, raccourcis clavier.

const SIZE_SCALE = { s: 2.1, m: 2.6, l: 3.2, xl: 3.9 };       // taille des sous-titres, en % de la largeur
const BG_LABEL = [[0, 'Aucun'], [0.3, 'Léger'], [0.6, 'Moyen'], [0.85, 'Opaque']];
const SIZE_LABEL = [['s', 'Petit'], ['m', 'Moyen'], ['l', 'Grand'], ['xl', 'Très grand']];
const HIDE_AFTER_MS = 2800;
const AUTOPLAY_SECONDS = 10;

export function formatTime(t) {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const readVolume = () => {
  try { const v = Number(localStorage.getItem('anime:volume')); return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem('anime:volume') !== null ? v : 1; } catch { return 1; }
};

const Player = forwardRef(function Player({
  src, poster, subtitles, intro, storyboard, startAt = 0, next, settings, onSettingsChange,
  onTick, onPauseSave, onEnded, onNext, onError, onNoPicture,
}, ref) {
  const wrap = useRef(null);
  const video = useRef(null);
  const cueBox = useRef(null);
  const hideTimer = useRef(null);
  const lastTick = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState(null);           // null | 'subs'
  const [track, setTrack] = useState(-1);           // index de la piste affichee, -1 = aucune
  const [hover, setHover] = useState(null);         // { x, t } survol de la barre
  const [toast, setToast] = useState(null);
  const [countdown, setCountdown] = useState(null); // secondes avant l'episode suivant
  const [ended, setEnded] = useState(false);
  const [started, setStarted] = useState(false);
  // Mode cinema : page assombrie, video sur toute la largeur (memorise dans ce navigateur).
  const [cinema, setCinema] = useState(() => { try { return localStorage.getItem('anime:cinema') === '1'; } catch { return false; } });
  useEffect(() => {
    document.body.classList.toggle('cinema', cinema);
    // La video tient dans l'ecran : on fait defiler la page jusqu'au lecteur (sous la barre du haut).
    if (cinema && wrap.current) window.scrollTo({ top: wrap.current.getBoundingClientRect().top + window.scrollY - 72, behavior: 'smooth' });
    try { localStorage.setItem('anime:cinema', cinema ? '1' : '0'); } catch { /* ignore */ }
    return () => document.body.classList.remove('cinema');
  }, [cinema]);

  const sub = settings?.subtitles || { size: 'm', bg: 0.6, position: 'bottom' };

  useImperativeHandle(ref, () => ({
    currentTime: () => video.current?.currentTime || 0,
    seek: (t) => { if (video.current) video.current.currentTime = t; },
  }), []);

  const flash = useCallback((text) => {
    setToast({ text, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 900);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Affichage des controles (masques apres quelques secondes de lecture) ──
  const poke = useCallback(() => {
    setVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (video.current && !video.current.paused) { setVisible(false); setMenu(null); }
    }, HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => { if (!playing) setVisible(true); else poke(); }, [playing, poke]);

  // ── Pistes de sous-titres : rendues par la page (mode « hidden ») ──
  const pickDefault = useCallback(() => {
    const i = subtitles.findIndex((s) => s.lang === 'fr');
    return i >= 0 ? i : (subtitles.length ? 0 : -1);
  }, [subtitles]);
  useEffect(() => { setTrack(pickDefault()); }, [src, pickDefault]);

  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    const tracks = [...v.textTracks];
    const render = () => {
      const box = cueBox.current;
      if (!box) return;
      box.replaceChildren();
      const t = tracks[track];
      if (!t || !t.activeCues) return;
      for (const cue of [...t.activeCues]) {
        const line = document.createElement('span');
        line.className = 'cue';
        // getCueAsHTML ne produit que les balises WebVTT autorisees (i, b, u...) : pas de HTML arbitraire.
        if (typeof cue.getCueAsHTML === 'function') line.append(cue.getCueAsHTML());
        else line.textContent = cue.text;
        box.append(line);
      }
    };
    tracks.forEach((t, i) => { t.mode = i === track ? 'hidden' : 'disabled'; });
    const t = tracks[track];
    t?.addEventListener('cuechange', render);
    render();
    return () => t?.removeEventListener('cuechange', render);
  }, [track, src, subtitles.length]);

  // iPhone : le plein ecran natif n'affiche que les sous-titres « showing ».
  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    const begin = () => { const t = v.textTracks[track]; if (t) t.mode = 'showing'; };
    const end = () => { const t = v.textTracks[track]; if (t) t.mode = 'hidden'; };
    v.addEventListener('webkitbeginfullscreen', begin);
    v.addEventListener('webkitendfullscreen', end);
    return () => { v.removeEventListener('webkitbeginfullscreen', begin); v.removeEventListener('webkitendfullscreen', end); };
  }, [track]);

  // ── Volume memorise ──
  useEffect(() => {
    if (video.current) { video.current.volume = volume; video.current.muted = muted; }
    try { localStorage.setItem('anime:volume', String(volume)); } catch { /* ignore */ }
  }, [volume, muted]);

  // ── Plein ecran ──
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrap.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = wrap.current;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    else video.current?.webkitEnterFullscreen?.(); // iPhone
  }, []);

  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);
  const seekBy = useCallback((d) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.5, v.currentTime + d));
    flash(d > 0 ? `+${d} s` : `${d} s`);
    poke();
  }, [flash, poke]);
  const cycleSubs = useCallback(() => {
    setTrack((cur) => {
      const nxt = cur + 1 >= subtitles.length ? -1 : cur + 1;
      flash(nxt === -1 ? 'Sous-titres désactivés' : `Sous-titres : ${subtitles[nxt].label}`);
      return nxt;
    });
  }, [subtitles, flash]);
  const skipIntro = useCallback(() => {
    if (video.current && intro) { video.current.currentTime = intro.end; flash('Intro passée'); }
  }, [intro, flash]);

  // ── Raccourcis clavier ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      const v = video.current;
      if (!v) return;
      if (k === 'escape' && menu) { setMenu(null); return; }
      const handled = {
        ' ': togglePlay, k: togglePlay,
        arrowleft: () => seekBy(-10), j: () => seekBy(-10),
        arrowright: () => seekBy(10), l: () => seekBy(10),
        arrowup: () => { setMuted(false); setVolume((x) => { const n = Math.min(1, Math.round((x + 0.1) * 10) / 10); flash(`Volume ${Math.round(n * 100)} %`); return n; }); },
        arrowdown: () => setVolume((x) => { const n = Math.max(0, Math.round((x - 0.1) * 10) / 10); flash(`Volume ${Math.round(n * 100)} %`); return n; }),
        f: toggleFullscreen,
        m: () => setMuted((x) => { flash(x ? 'Son activé' : 'Son coupé'); return !x; }),
        s: cycleSubs, c: cycleSubs,
        i: () => { if (intro && v.currentTime < intro.end) skipIntro(); },
        n: () => { if (next) onNext?.(); },
        t: () => setCinema((c) => { flash(c ? 'Mode cinéma désactivé' : 'Mode cinéma'); return !c; }),
      }[k];
      if (!handled) return;
      e.preventDefault();
      handled();
      poke();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlay, seekBy, toggleFullscreen, cycleSubs, skipIntro, intro, next, onNext, flash, poke, menu]);

  // ── Episode suivant automatique ──
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) { setCountdown(null); onNext?.(); return undefined; }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, onNext]);
  useEffect(() => { setCountdown(null); setEnded(false); setStarted(false); lastTick.current = null; }, [src]);

  // ── Evenements video ──
  function handleLoaded() {
    const v = video.current;
    setDuration(v.duration || 0);
    if (startAt > 5 && startAt < v.duration - 10) v.currentTime = startAt;
    onNoPicture?.(v.duration > 0 && v.videoWidth === 0);
  }
  function handleTime() {
    const v = video.current;
    setTime(v.currentTime);
    if (v.buffered.length) {
      for (let i = 0; i < v.buffered.length; i += 1) {
        if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) { setBuffered(v.buffered.end(i)); break; }
      }
    }
    // Temps reellement regarde (pour les statistiques) : ecart entre deux mises a jour, en lecture seulement.
    let delta = 0;
    if (!v.paused && lastTick.current !== null) {
      const d = v.currentTime - lastTick.current;
      if (d > 0 && d < 2) delta = d;
    }
    lastTick.current = v.currentTime;
    onTick?.(v.currentTime, v.duration, delta);
  }
  function handleEnded() {
    setPlaying(false);
    setMenu(null);
    setEnded(true);
    onEnded?.(video.current?.duration);
    if (next && settings?.autoplay) setCountdown(AUTOPLAY_SECONDS);
  }

  // ── Barre de temps : clic, glisser, apercu ──
  const barRef = useRef(null);
  const timeAt = (clientX) => {
    const r = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    return { x, t: duration ? (x / r.width) * duration : 0 };
  };
  function onBarDown(e) {
    if (!duration) return;
    e.preventDefault();
    barRef.current.setPointerCapture?.(e.pointerId);
    const go = (ev) => { const { x, t } = timeAt(ev.clientX); setHover({ x, t }); video.current.currentTime = t; setTime(t); };
    go(e);
    const move = (ev) => go(ev);
    const up = () => { barRef.current?.removeEventListener('pointermove', move); barRef.current?.removeEventListener('pointerup', up); if (e.pointerType !== 'mouse') setHover(null); };
    barRef.current.addEventListener('pointermove', move);
    barRef.current.addEventListener('pointerup', up);
  }

  const frame = (t) => {
    if (!storyboard) return null;
    const idx = Math.min(storyboard.count - 1, Math.max(0, Math.floor(t / storyboard.interval)));
    return {
      width: storyboard.w, height: storyboard.h,
      backgroundImage: `url(${storyboard.url})`,
      backgroundSize: `${storyboard.w * storyboard.cols}px ${storyboard.h * storyboard.rows}px`,
      backgroundPosition: `-${(idx % storyboard.cols) * storyboard.w}px -${Math.floor(idx / storyboard.cols) * storyboard.h}px`,
    };
  };

  const showSkip = intro && time >= intro.start && time < intro.end - 1 && !ended;
  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;
  const setSub = (patch) => onSettingsChange?.({ subtitles: { ...sub, ...patch } });

  return (
    <div
      ref={wrap}
      className={`player2${visible ? '' : ' idle'}${fullscreen ? ' is-fs' : ''}`}
      onPointerMove={poke}
      onPointerDown={poke}
      style={{ '--sub-scale': SIZE_SCALE[sub.size] || 2.6, '--sub-bg': sub.bg }}
    >
      <video
        ref={video}
        src={src}
        poster={poster || undefined}
        autoPlay
        playsInline
        preload="metadata"
        // Pas de menu « Enregistrer la vidéo sous » ni de bouton de téléchargement.
        controlsList="nodownload"
        disableRemotePlayback
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => {
          if (menu) { setMenu(null); return; } // un clic a cote ferme le menu sans mettre en pause
          if (e.nativeEvent.pointerType !== 'touch') togglePlay(); else setVisible((x) => !x);
        }}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={handleLoaded}
        onTimeUpdate={handleTime}
        onPlay={() => { setPlaying(true); setStarted(true); setEnded(false); setCountdown(null); }}
        onPause={() => { setPlaying(false); lastTick.current = null; onPauseSave?.(); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={handleEnded}
        onError={() => onError?.(video.current?.error?.code)}
        onVolumeChange={() => { const v = video.current; if (v) { setMuted(v.muted); } }}
      >
        {subtitles.map((s) => <track key={s.id} kind="subtitles" src={`/api/media/subtitle/${s.id}`} srcLang={s.lang} label={s.label} />)}
      </video>

      <div ref={cueBox} className={`cues ${sub.position === 'top' ? 'top' : 'bottom'}${visible && sub.position !== 'top' ? ' lifted' : ''}`} aria-live="off" />

      {waiting && <span className="player-spinner spinner big" aria-label="Chargement" />}
      {!started && !playing && !waiting && (
        <button className="big-play" onClick={togglePlay} aria-label="Lecture"><Icon name="play" size={34} /></button>
      )}
      {toast && <div className="player-toast" key={toast.at}>{toast.text}</div>}

      {showSkip && !menu && <button className="skip-intro" onClick={skipIntro}>Passer l'intro <Icon name="chevronRight" size={18} /></button>}

      {ended && next && (
        <div className="next-card">
          <span className="eyebrow">Épisode suivant</span>
          <strong>{next.label}</strong>
          {countdown !== null && <div className="next-count"><span style={{ animationDuration: `${AUTOPLAY_SECONDS}s` }} /></div>}
          <div className="row-actions start">
            <button className="primary" onClick={() => { setCountdown(null); onNext?.(); }}><Icon name="play" size={16} /> {countdown !== null ? `Lecture dans ${countdown} s` : 'Lecture'}</button>
            {countdown !== null && <button className="ghost-btn" onClick={() => setCountdown(null)}>Annuler</button>}
          </div>
        </div>
      )}

      <div className="controls" onPointerDown={(e) => e.stopPropagation()}>
        <div
          ref={barRef}
          className="timeline"
          role="slider"
          tabIndex={-1}
          aria-label="Position dans l'épisode"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} sur ${formatTime(duration)}`}
          onPointerDown={onBarDown}
          onPointerMove={(e) => { if (duration) setHover(timeAt(e.clientX)); }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="tl-track">
            <span className="tl-buffer" style={{ width: `${bufPct}%` }} />
            {intro && duration > 0 && <span className="tl-intro" style={{ left: `${(intro.start / duration) * 100}%`, width: `${((intro.end - intro.start) / duration) * 100}%` }} />}
            <span className="tl-fill" style={{ width: `${pct}%` }} />
            <span className="tl-knob" style={{ left: `${pct}%` }} />
          </div>
          {hover && (
            <div className="tl-preview" style={{ left: `clamp(${(storyboard?.w || 60) / 2}px, ${hover.x}px, calc(100% - ${(storyboard?.w || 60) / 2}px))` }}>
              {storyboard && <div className="tl-frame" style={frame(hover.t)} />}
              <span>{formatTime(hover.t)}</span>
            </div>
          )}
        </div>

        <div className="ctl-row">
          <button className="ctl" onClick={togglePlay} aria-label={playing ? 'Pause (espace)' : 'Lecture (espace)'} title={playing ? 'Pause (espace)' : 'Lecture (espace)'}>
            <Icon name={playing ? 'pause' : 'play'} size={24} />
          </button>
          <button className="ctl" onClick={() => seekBy(-10)} aria-label="Reculer de 10 s (←)" title="Reculer de 10 s (←)"><Icon name="back10" size={24} /></button>
          <button className="ctl" onClick={() => seekBy(10)} aria-label="Avancer de 10 s (→)" title="Avancer de 10 s (→)"><Icon name="fwd10" size={24} /></button>
          <div className="volume">
            <button className="ctl" onClick={() => setMuted((x) => !x)} aria-label={muted ? 'Activer le son (M)' : 'Couper le son (M)'} title="Son (M)">
              <Icon name={muted || volume === 0 ? 'volumeOff' : 'volume'} size={22} />
            </button>
            <input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} aria-label="Volume"
              onChange={(e) => { setMuted(false); setVolume(Number(e.target.value)); }} />
          </div>
          <span className="ctl-time">{formatTime(time)} <span className="muted">/ {formatTime(duration)}</span></span>
          <span className="grow" />
          {next && <button className="ctl" onClick={onNext} aria-label="Épisode suivant (N)" title="Épisode suivant (N)"><Icon name="skipNext" size={22} /></button>}
          <div className="ctl-menu-wrap">
            <button className={`ctl${track >= 0 ? ' on' : ''}`} onClick={() => setMenu(menu === 'subs' ? null : 'subs')} aria-expanded={menu === 'subs'} aria-label="Sous-titres et réglages (S)" title="Sous-titres et réglages (S)">
              <Icon name="captions" size={22} />
            </button>
            {menu === 'subs' && (
              <div className="ctl-menu" role="menu">
                <div className="menu-group">
                  <span className="menu-title">Sous-titres</span>
                  <button className={`opt${track === -1 ? ' sel' : ''}`} onClick={() => setTrack(-1)}>Désactivés</button>
                  {subtitles.map((s, i) => <button key={s.id} className={`opt${track === i ? ' sel' : ''}`} onClick={() => setTrack(i)}>{s.label}</button>)}
                </div>
                <div className="menu-group">
                  <span className="menu-title">Taille</span>
                  <div className="seg-opts">{SIZE_LABEL.map(([v, l]) => <button key={v} className={sub.size === v ? 'sel' : ''} onClick={() => setSub({ size: v })}>{l}</button>)}</div>
                  <span className="menu-title">Fond</span>
                  <div className="seg-opts">{BG_LABEL.map(([v, l]) => <button key={v} className={sub.bg === v ? 'sel' : ''} onClick={() => setSub({ bg: v })}>{l}</button>)}</div>
                  <span className="menu-title">Position</span>
                  <div className="seg-opts">
                    <button className={sub.position === 'bottom' ? 'sel' : ''} onClick={() => setSub({ position: 'bottom' })}>En bas</button>
                    <button className={sub.position === 'top' ? 'sel' : ''} onClick={() => setSub({ position: 'top' })}>En haut</button>
                  </div>
                </div>
                <label className="menu-toggle">
                  <span>Épisode suivant automatique</span>
                  <input type="checkbox" checked={!!settings?.autoplay} onChange={(e) => onSettingsChange?.({ autoplay: e.target.checked })} />
                </label>
              </div>
            )}
          </div>
          {!fullscreen && (
            <button className={`ctl${cinema ? ' on' : ''}`} onClick={() => setCinema((c) => !c)} aria-pressed={cinema} aria-label="Mode cinéma (T)" title="Mode cinéma (T)">
              <Icon name="cinema" size={22} />
            </button>
          )}
          <button className="ctl" onClick={toggleFullscreen} aria-label={fullscreen ? 'Quitter le plein écran (F)' : 'Plein écran (F)'} title="Plein écran (F)">
            <Icon name={fullscreen ? 'fsExit' : 'fs'} size={22} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default Player;
